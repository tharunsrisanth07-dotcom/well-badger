"""
Anomaly Detector — NWIS

Analyses drilling parameter time-series (ROP, WOB, RPM, Torque, Pressure)
to surface statistically significant anomalies in real-time.

Method: Z-score based outlier detection with rolling window mean/std.
This is intentionally transparent and fast for a POC — production would use
LSTM/Isolation Forest on a streaming window.

Output per parameter:
  - anomaly_type: ROP_DROP | TORQUE_SPIKE | PRESSURE_SURGE | etc.
  - depth_m: where it occurred
  - z_score: how many std-devs from mean
  - value: the actual value
  - baseline_mean: rolling mean at that point
  - severity: LOW | MEDIUM | HIGH | CRITICAL
  - narrative: human-readable explanation
"""

from typing import List, Dict, Optional
from sqlalchemy.orm import Session
from pydantic import BaseModel
import statistics

from ..models import models


# ── Output schema ─────────────────────────────────────────────────────────────

class ParameterAnomaly(BaseModel):
    parameter: str
    anomaly_type: str
    depth_m: float
    value: float
    baseline_mean: float
    z_score: float
    severity: str         # LOW | MEDIUM | HIGH | CRITICAL
    narrative: str


class AnomalyReport(BaseModel):
    well_id: str
    total_anomalies: int
    anomalies: List[ParameterAnomaly]
    summary: str


# ── Thresholds ────────────────────────────────────────────────────────────────

PARAM_CONFIG = {
    "torque":    {"label": "Torque",   "anomaly_hi": "TORQUE_SPIKE",    "anomaly_lo": "TORQUE_DROP"},
    "pressure":  {"label": "Pressure", "anomaly_hi": "PRESSURE_SURGE",  "anomaly_lo": "PRESSURE_DROP"},
    "rop":       {"label": "ROP",      "anomaly_hi": "ROP_SURGE",       "anomaly_lo": "ROP_DROP"},
    "wob":       {"label": "WOB",      "anomaly_hi": "WOB_SPIKE",       "anomaly_lo": "WOB_DROP"},
    "mud_weight":{"label": "Mud Wt",   "anomaly_hi": "MUD_WEIGHT_SURGE","anomaly_lo": "MUD_WEIGHT_DROP"},
}

NARRATIVES = {
    "TORQUE_SPIKE":    "Sudden torque surge at {depth:.0f} m — possible ledge, BHA whirl, or formation hardness change. Check for stuck-pipe precursors.",
    "TORQUE_DROP":     "Torque drop at {depth:.0f} m — possible string twist-off or bit balling. Investigate immediately.",
    "PRESSURE_SURGE":  "Standpipe pressure spike at {depth:.0f} m — possible pack-off, bit jet plugging, or swabbing. Monitor ECD closely.",
    "PRESSURE_DROP":   "Standpipe pressure drop at {depth:.0f} m — possible washout or mud-pump issue.",
    "ROP_DROP":        "Significant ROP reduction at {depth:.0f} m — possible bit dulling, formation change, or weight-transfer issue.",
    "ROP_SURGE":       "Unusual ROP increase at {depth:.0f} m — possible faulted zone, natural fracture, or lost circulation precursor.",
    "WOB_SPIKE":       "Weight on Bit spike at {depth:.0f} m — possible ledge contact or bit bounce. Reduce WOB.",
    "WOB_DROP":        "Weight on Bit drop at {depth:.0f} m — possible bit off-bottom or weight-transfer loss.",
    "MUD_WEIGHT_SURGE":"Mud weight increase at {depth:.0f} m — check for accidental weighted pill or contamination.",
    "MUD_WEIGHT_DROP": "Mud weight drop at {depth:.0f} m — influx dilution risk. Check pit volume.",
}


def _severity(z: float) -> str:
    az = abs(z)
    if az >= 3.5: return "CRITICAL"
    if az >= 2.5: return "HIGH"
    if az >= 2.0: return "MEDIUM"
    return "LOW"


def _zscore_anomalies(
    values: List[float],
    depths: List[float],
    param_key: str,
    z_threshold: float = 2.0,
) -> List[ParameterAnomaly]:
    """Detect z-score outliers in a parameter series."""
    if len(values) < 5:
        return []

    mean = statistics.mean(values)
    try:
        std = statistics.stdev(values)
    except statistics.StatisticsError:
        return []

    if std < 1e-6:
        return []

    cfg = PARAM_CONFIG[param_key]
    anomalies = []

    for i, (val, depth) in enumerate(zip(values, depths)):
        z = (val - mean) / std
        if abs(z) < z_threshold:
            continue

        atype = cfg["anomaly_hi"] if z > 0 else cfg["anomaly_lo"]
        narrative_tmpl = NARRATIVES.get(atype, "Anomalous {param} reading at {depth:.0f} m.")
        narrative = narrative_tmpl.format(depth=depth, param=cfg["label"])

        anomalies.append(ParameterAnomaly(
            parameter=cfg["label"],
            anomaly_type=atype,
            depth_m=round(depth, 1),
            value=round(val, 3),
            baseline_mean=round(mean, 3),
            z_score=round(z, 2),
            severity=_severity(z),
            narrative=narrative,
        ))

    return anomalies


def detect_anomalies(
    db: Session,
    well_id: str,
    limit: int = 200,
) -> AnomalyReport:
    """Run anomaly detection across all drilling parameters for a well."""
    params = (
        db.query(models.DrillingParameter)
        .filter(models.DrillingParameter.well_id == well_id)
        .order_by(models.DrillingParameter.depth)
        .limit(limit)
        .all()
    )

    if not params:
        return AnomalyReport(
            well_id=well_id,
            total_anomalies=0,
            anomalies=[],
            summary="No drilling parameter data found for this well.",
        )

    depths = [p.depth for p in params]
    all_anomalies: List[ParameterAnomaly] = []

    for key in PARAM_CONFIG:
        vals = [getattr(p, key) for p in params if getattr(p, key) is not None]
        dep_filtered = [p.depth for p in params if getattr(p, key) is not None]
        if vals:
            all_anomalies.extend(_zscore_anomalies(vals, dep_filtered, key))

    # Sort by severity then depth
    sev_order = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
    all_anomalies.sort(key=lambda a: (sev_order.get(a.severity, 9), a.depth_m))

    critical = sum(1 for a in all_anomalies if a.severity == "CRITICAL")
    high     = sum(1 for a in all_anomalies if a.severity == "HIGH")

    if critical > 0:
        summary = f"⚠ {critical} CRITICAL and {high} HIGH anomalies detected. Immediate review recommended."
    elif high > 0:
        summary = f"{high} HIGH severity parameter anomalies detected. Verify drilling parameters."
    elif all_anomalies:
        summary = f"{len(all_anomalies)} low-level anomalies detected. Monitor closely."
    else:
        summary = "No significant parameter anomalies detected. Drilling parameters within normal range."

    return AnomalyReport(
        well_id=well_id,
        total_anomalies=len(all_anomalies),
        anomalies=all_anomalies,
        summary=summary,
    )
