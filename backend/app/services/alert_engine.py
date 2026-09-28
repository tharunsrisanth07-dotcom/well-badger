"""
Alert Engine — NWIS

Generates context-aware alerts when:
  1. Active well's current depth is approaching (within 50 m of) a historical risk zone
  2. Active well has entered a historical risk zone
  3. Multiple nearby wells support a high-severity risk type

Alerts are decision-support only — the engineer makes the final call.
"""
from typing import List
from sqlalchemy.orm import Session
import uuid

from ..models import models, schemas
from .event_analysis import derive_historical_risk_zones
from . import relevance as rel_svc

APPROACH_THRESHOLD_M = 50.0   # Alert when this many metres from zone top


def generate_alerts(
    db: Session,
    active_well_id: str,
    radius_km: float = 10.0,
    current_depth_override: float | None = None,
) -> List[schemas.Alert]:
    active_well = db.query(models.Well).filter(models.Well.well_id == active_well_id).first()
    if not active_well:
        return []

    current_depth = current_depth_override if current_depth_override is not None else active_well.current_depth

    nearby = rel_svc.get_nearby_wells_with_relevance(db, active_well_id, radius_km)
    zones  = derive_historical_risk_zones(db, active_well_id, nearby, min_supporting_wells=2)

    alerts: List[schemas.Alert] = []

    for zone in zones:
        dist_to_zone = zone.interval_start - current_depth   # positive = above zone

        # Already inside zone
        if zone.interval_start <= current_depth <= zone.interval_end:
            severity = "CRITICAL"
            title    = f"INSIDE RISK ZONE — {zone.risk_type.replace('_', ' ')}"
            body     = (
                f"Active well is currently drilling inside a historical risk zone "
                f"({zone.interval_start:.0f}–{zone.interval_end:.0f} m). "
                f"{zone.explanation} Immediate review recommended."
            )
            dist_m = 0.0

        # Approaching zone
        elif 0 < dist_to_zone <= APPROACH_THRESHOLD_M:
            severity = "HIGH"
            title    = f"APPROACHING RISK ZONE — {zone.risk_type.replace('_', ' ')}"
            body     = (
                f"Active well is {dist_to_zone:.0f} m above the historical risk zone "
                f"({zone.interval_start:.0f}–{zone.interval_end:.0f} m). "
                f"{zone.explanation}"
            )
            dist_m = dist_to_zone

        else:
            continue

        # Source documents from supporting events
        source_docs: List[str] = []
        for nw in nearby:
            for evt in nw.relevant_events:
                if evt.event_id in zone.supporting_event_ids and evt.source_document:
                    if evt.source_document not in source_docs:
                        source_docs.append(
                            f"{evt.source_document}"
                            + (f" p.{evt.source_page}" if evt.source_page else "")
                        )

        # Recommended mitigation from most common event type in zone
        from .risk_engine import MITIGATIONS_BY_TYPE
        rec_mit = MITIGATIONS_BY_TYPE.get(zone.risk_type)

        alerts.append(schemas.Alert(
            alert_id=str(uuid.uuid4())[:8],
            well_id=active_well_id,
            alert_type="INSIDE_RISK_ZONE" if dist_m == 0.0 else "APPROACHING_RISK_ZONE",
            severity=severity,
            title=title,
            body=body,
            current_depth=current_depth,
            risk_interval_start=zone.interval_start,
            risk_interval_end=zone.interval_end,
            distance_to_zone_m=dist_m,
            primary_risk=zone.risk_type,
            supporting_wells=zone.supporting_well_ids,
            recommended_mitigation=rec_mit,
            source_documents=source_docs[:4],
        ))

    # Sort: CRITICAL first, then by proximity
    alerts.sort(key=lambda a: (0 if a.severity == "CRITICAL" else 1, a.distance_to_zone_m))
    return alerts
