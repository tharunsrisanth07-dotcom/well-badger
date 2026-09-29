"""
Audit Log / Explainability Report Generator — NWIS

Oil India Limited specifically requested "Reproducible Audit Logs" and
"Model Integrity Checks" in the SIH26121 problem statement.

This service generates a structured, timestamped audit record of:
  - How every risk score was computed
  - Which wells contributed evidence
  - What the ML model predicted vs the evidence engine
  - A human-readable decision trail

Output: AuditReport — suitable for PDF/JSON download.
"""

from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..models import schemas, models
from . import risk_engine
from .relevance import get_nearby_wells_with_relevance
from .event_analysis import derive_historical_risk_zones


class AuditEntry(BaseModel):
    risk_type: str
    evidence_score: float
    ml_probability: Optional[float]
    final_risk_level: str
    supporting_wells: List[str]
    contributing_factors: List[str]
    decision_rationale: str
    integrity_check: str   # CONSISTENT | ML_HIGHER | ML_LOWER | ML_UNAVAILABLE


class AuditReport(BaseModel):
    report_id: str
    generated_at: str
    well_id: str
    current_depth_m: float
    current_formation: str
    radius_km: float
    engine_version: str
    ml_model_active: bool
    offset_wells_analysed: int
    total_events_examined: int
    audit_entries: List[AuditEntry]
    overall_integrity_status: str
    disclaimer: str


def generate_audit_report(
    db: Session,
    well_id: str,
    radius_km: float = 10.0,
    current_depth_override: Optional[float] = None,
) -> AuditReport:
    """Generate a full explainability + audit report for the active well."""

    well = db.query(models.Well).filter(models.Well.well_id == well_id).first()
    if not well:
        return AuditReport(
            report_id="ERROR",
            generated_at=datetime.now().isoformat(),
            well_id=well_id,
            current_depth_m=0,
            current_formation="UNKNOWN",
            radius_km=radius_km,
            engine_version="2.0.0",
            ml_model_active=False,
            offset_wells_analysed=0,
            total_events_examined=0,
            audit_entries=[],
            overall_integrity_status="ERROR",
            disclaimer="Well not found.",
        )

    depth = current_depth_override if current_depth_override is not None else well.current_depth

    nearby = get_nearby_wells_with_relevance(db, well_id, radius_km)
    predictions = risk_engine.analyze_risk(db, well_id, radius_km, current_depth_override=current_depth_override)

    total_events = sum(len(nw.relevant_events) for nw in nearby)

    from . import risk_engine as re_mod
    ml_active = re_mod.ml_model is not None

    entries: List[AuditEntry] = []
    for pred in predictions:
        factors_txt = [f"{f.factor}: {f.detail}" for f in pred.contributing_factors]

        # Integrity check
        if pred.ml_probability is None:
            integrity = "ML_UNAVAILABLE"
        else:
            ml_equiv_score = pred.ml_probability  # 0-100
            diff = abs(pred.risk_score - ml_equiv_score)
            if diff <= 20:
                integrity = "CONSISTENT"
            elif ml_equiv_score > pred.risk_score:
                integrity = "ML_HIGHER"
            else:
                integrity = "ML_LOWER"

        rationale = (
            f"Evidence engine scored {pred.risk_type} at {pred.risk_score}/100 "
            f"({pred.risk_level}) based on {len(pred.supporting_wells)} offset well(s) "
            f"and {len(pred.supporting_events)} historical event(s). "
            f"Evidence strength: {pred.evidence_strength}. "
        )
        if pred.ml_probability is not None:
            rationale += f"ML model predicted {pred.ml_probability}% probability at current depth/formation. "
        rationale += f"Integrity check: {integrity}."

        entries.append(AuditEntry(
            risk_type=pred.risk_type,
            evidence_score=pred.risk_score,
            ml_probability=pred.ml_probability,
            final_risk_level=pred.risk_level,
            supporting_wells=pred.supporting_wells,
            contributing_factors=factors_txt,
            decision_rationale=rationale,
            integrity_check=integrity,
        ))

    # Overall integrity
    statuses = [e.integrity_check for e in entries]
    if all(s == "CONSISTENT" for s in statuses):
        overall = "ALL_CONSISTENT"
    elif "ML_UNAVAILABLE" in statuses and len(set(statuses)) == 1:
        overall = "ML_UNAVAILABLE"
    elif any(s in ("ML_HIGHER", "ML_LOWER") for s in statuses):
        overall = "REVIEW_REQUIRED"
    else:
        overall = "CONSISTENT"

    return AuditReport(
        report_id=f"NWIS-AUDIT-{well_id}-{datetime.now().strftime('%Y%m%d%H%M%S')}",
        generated_at=datetime.now().isoformat(),
        well_id=well_id,
        current_depth_m=depth,
        current_formation=well.current_formation,
        radius_km=radius_km,
        engine_version="2.0.0",
        ml_model_active=ml_active,
        offset_wells_analysed=len(nearby),
        total_events_examined=total_events,
        audit_entries=entries,
        overall_integrity_status=overall,
        disclaimer=(
            "NWIS is a decision-support tool. All risk assessments are based on historical "
            "offset-well data and ML inference on synthetic training data. The drilling engineer "
            "remains the sole decision-maker. This report is generated for audit and traceability purposes."
        ),
    )
