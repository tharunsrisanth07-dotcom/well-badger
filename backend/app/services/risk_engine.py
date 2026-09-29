"""
Historical Similarity Risk Engine — NWIS

NOT a machine-learning model. This is an evidence-based risk engine that
scores drilling risks using historical patterns from nearby/offset wells.

Clearly labelled as "Historical Similarity Risk Engine" in all outputs.

Risk scoring inputs:
  - Distance to supporting well (closer = higher weight)
  - Formation match (same formation = significant bonus)
  - Depth proximity to upcoming interval
  - Number of events / supporting wells
  - Event severity
  - Time recency of events (more recent = slightly higher weight)

Outputs per risk type:
  - risk_score: 0–100 (bounded)
  - risk_level: LOW | MEDIUM | HIGH | CRITICAL
  - evidence_strength: Weak | Moderate | Strong | Very Strong
  - contributing_factors: transparent breakdown
  - explanation: 1-2 sentence human-readable rationale
  - historical_zone: derived from event_analysis
"""
from typing import List, Dict
from datetime import datetime
from sqlalchemy.orm import Session
import joblib
import pandas as pd
from pathlib import Path

from ..models import models, schemas
from . import relevance as rel_svc
from .event_analysis import derive_historical_risk_zones

ML_MODEL_PATH = Path(__file__).resolve().parent.parent.parent / "ml_model.joblib"
ml_model = None
if ML_MODEL_PATH.exists():
    try:
        ml_model = joblib.load(ML_MODEL_PATH)
    except Exception:
        pass

# ── Look-up tables ─────────────────────────────────────────────────────────────
RISK_TYPES = ["MUD_LOSS", "STUCK_PIPE", "KICK", "TORQUE_SPIKE", "CEMENTING_ISSUE"]

SEVERITY_WEIGHTS = {"CRITICAL": 1.0, "HIGH": 0.75, "MEDIUM": 0.45, "LOW": 0.20}



UPCOMING_WINDOW_M = 100.0   # Look ahead this many metres from current_depth
ZONE_MATCH_PAD_M  = 20.0    # Events within ±20 m of upcoming window boundary count


def _evidence_label(n_wells: int, n_events: int) -> str:
    if n_wells >= 4 or n_events >= 6:
        return "Very Strong"
    if n_wells >= 3 or n_events >= 4:
        return "Strong"
    if n_wells >= 2 or n_events >= 2:
        return "Moderate"
    return "Weak"


def _risk_level(score: float) -> str:
    if score >= 75:
        return "CRITICAL"
    if score >= 55:
        return "HIGH"
    if score >= 30:
        return "MEDIUM"
    return "LOW"


def analyze_risk(
    db: Session,
    active_well_id: str,
    radius_km: float = 10.0,
    current_depth_override: float | None = None,
) -> List[schemas.RiskPrediction]:
    """
    Analyse drilling risk for the active well based on historical offset-well data.

    current_depth_override: if provided, use this depth instead of the stored value
    (supports the POC depth-simulation feature).
    """
    active_well = db.query(models.Well).filter(models.Well.well_id == active_well_id).first()
    if not active_well:
        return []

    # Use overridden depth if provided (simulation mode)
    current_depth = current_depth_override if current_depth_override is not None else active_well.current_depth
    upcoming_start = current_depth
    upcoming_end   = current_depth + UPCOMING_WINDOW_M

    # Get nearby wells with relevance scores
    nearby = rel_svc.get_nearby_wells_with_relevance(db, active_well_id, radius_km)

    # Derive historical risk zones
    risk_zones = derive_historical_risk_zones(db, active_well_id, nearby, min_supporting_wells=2)
    zone_by_type = {z.risk_type: z for z in risk_zones}

    # Run ML Model inference
    ml_probs = {}
    if ml_model and active_well.current_formation:
        try:
            X_infer = pd.DataFrame([{"depth": current_depth, "formation": active_well.current_formation}])
            probs = ml_model.predict_proba(X_infer)[0]
            for cls, prob in zip(ml_model.classes_, probs):
                if cls != "NONE":
                    ml_probs[cls] = round(float(prob) * 100, 1)
        except Exception:
            pass

    # Accumulate raw signals per risk type
    accum: Dict[str, Dict] = {
        rt: {"raw": 0.0, "events": [], "wells": set(), "factors": []}
        for rt in RISK_TYPES
    }

    for nw in nearby:
        for evt in nw.relevant_events:
            rt = evt.event_type
            if rt not in accum:
                continue

            sev_w = SEVERITY_WEIGHTS.get(evt.severity, 0.3)

            # Formation match bonus
            fm_match = (evt.formation == active_well.current_formation)
            fm_bonus = 0.20 if fm_match else 0.0

            # Depth proximity scoring
            depth_in_window = (upcoming_start - ZONE_MATCH_PAD_M) <= evt.depth <= (upcoming_end + ZONE_MATCH_PAD_M)
            depth_within_150 = abs(evt.depth - current_depth) <= 150
            depth_bonus = 0.0
            if depth_in_window:
                depth_bonus = 0.30
            elif depth_within_150:
                depth_bonus = 0.15

            # Distance (spatial relevance inverse — nw.relevance.spatial_score is already 0-1)
            spatial_w = nw.relevance.spatial_score

            # Recency bonus (events <3 years old get slight bump)
            try:
                days_ago = (datetime.now() - evt.date).days if evt.date else 3650
            except Exception:
                days_ago = 3650
            recency_w = 1.0 if days_ago < 1095 else 0.85

            # Combined contribution for this event
            contribution = (sev_w + fm_bonus + depth_bonus) * spatial_w * recency_w * 20.0

            accum[rt]["raw"] += contribution
            accum[rt]["events"].append(evt)
            accum[rt]["wells"].add(nw.well.well_id)

    predictions: List[schemas.RiskPrediction] = []

    for rt, data in accum.items():
        if data["raw"] <= 0:
            continue

        n_wells  = len(data["wells"])
        n_events = len(data["events"])
        raw_score = data["raw"]

        # Normalise to 0–100 with diminishing returns to avoid instant 95/100 from repeated events
        score = min(95.0, 25.0 + (raw_score ** 0.85) * 1.5)

        level   = _risk_level(score)
        ev_str  = _evidence_label(n_wells, n_events)

        # Build contributing factors
        factors: List[schemas.ContributingFactor] = []
        if n_wells > 0:
            factors.append(schemas.ContributingFactor(
                factor="Supporting offset wells",
                detail=f"{n_wells} nearby well(s) recorded {rt.replace('_', ' ').lower()} events",
                weight=round(n_wells / max(1, n_wells + 2), 2),
            ))
        depth_evts = [e for e in data["events"]
                      if (upcoming_start - ZONE_MATCH_PAD_M) <= e.depth <= (upcoming_end + ZONE_MATCH_PAD_M)]
        if depth_evts:
            factors.append(schemas.ContributingFactor(
                factor="Depth proximity",
                detail=f"{len(depth_evts)} event(s) within the upcoming {upcoming_start:.0f}–{upcoming_end:.0f} m interval",
                weight=0.30,
            ))
        fm_evts = [e for e in data["events"] if e.formation == active_well.current_formation]
        if fm_evts:
            factors.append(schemas.ContributingFactor(
                factor="Formation match",
                detail=f"{len(fm_evts)} event(s) in same formation ({active_well.current_formation})",
                weight=0.25,
            ))

        # Explanation text
        zone = zone_by_type.get(rt)
        if zone:
            zone_txt = f"A historical risk zone is identified at {zone.interval_start:.0f}–{zone.interval_end:.0f} m."
        else:
            zone_txt = f"Events were recorded near the upcoming {upcoming_start:.0f}–{upcoming_end:.0f} m interval."

        explanation = (
            f"{n_wells} nearby offset well(s) experienced {rt.replace('_', ' ').lower()} "
            f"events in similar geological conditions. {zone_txt}"
        )

        # Extract historical mitigations
        historical_mits = []
        for e in data["events"]:
            if e.mitigation and e.mitigation not in historical_mits:
                historical_mits.append(e.mitigation)
        rec_mit = "Historical mitigation observed: " + " | ".join(historical_mits[:2]) if historical_mits else None

        predictions.append(schemas.RiskPrediction(
            risk_type=rt,
            risk_score=round(score, 1),
            risk_level=level,
            interval_start=zone.interval_start if zone else upcoming_start,
            interval_end=zone.interval_end if zone else upcoming_end,
            evidence_strength=ev_str,
            supporting_wells=list(data["wells"]),
            supporting_events=[e.event_id for e in data["events"]],
            contributing_factors=factors,
            historical_zone=zone,
            explanation=explanation,
            recommended_mitigation=rec_mit,
            ml_probability=ml_probs.get(rt),
        ))

    predictions.sort(key=lambda p: p.risk_score, reverse=True)
    return predictions
