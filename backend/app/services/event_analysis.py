"""
Event Analysis Service.

Derives historical risk zones from offset-well events.
A risk zone is a depth interval where multiple nearby wells experienced
similar events — making it a credible "danger zone" for the active well.

This is NOT ML — it is an evidence-based similarity engine.
Clearly labelled as such in the UI.
"""
from typing import List, Dict
from sqlalchemy.orm import Session

from ..models import models, schemas

# Two events of the same type within this band → they belong to same zone
CLUSTER_BAND_M = 60.0


def _cluster_events(events: list, band_m: float) -> List[List]:
    """Group events of the same type that fall within band_m of each other."""
    if not events:
        return []
    sorted_evts = sorted(events, key=lambda e: e.depth)
    clusters = [[sorted_evts[0]]]
    for evt in sorted_evts[1:]:
        if evt.depth - clusters[-1][-1].depth <= band_m:
            clusters[-1].append(evt)
        else:
            clusters.append([evt])
    return clusters


def derive_historical_risk_zones(
    db: Session,
    active_well_id: str,
    nearby_responses: List[schemas.NearbyWellResponse],
    min_supporting_wells: int = 2,
) -> List[schemas.HistoricalRiskZone]:
    """
    Build historical risk zones by clustering nearby-well events of the same type
    that occur within CLUSTER_BAND_M of each other.

    Only zones supported by ≥ min_supporting_wells are surfaced.
    """
    active_well = db.query(models.Well).filter(models.Well.well_id == active_well_id).first()
    if not active_well:
        return []

    # Gather all events from nearby wells grouped by event_type
    events_by_type: Dict[str, list] = {}
    for nw in nearby_responses:
        for evt in nw.relevant_events:
            events_by_type.setdefault(evt.event_type, []).append(evt)

    zones: List[schemas.HistoricalRiskZone] = []
    seen_zone_ids: set = set()

    for event_type, evts in events_by_type.items():
        clusters = _cluster_events(evts, CLUSTER_BAND_M)
        for cluster in clusters:
            well_ids = list({e.well_id for e in cluster})
            if len(well_ids) < min_supporting_wells:
                continue

            # Build zone boundaries
            min_depth = min(e.depth for e in cluster)
            max_depth = max(e.depth for e in cluster)
            # Pad by 5 m either side
            zone_start = max(0, min_depth - 5)
            zone_end   = max_depth + 5

            zone_key = f"{event_type}:{zone_start:.0f}:{zone_end:.0f}"
            if zone_key in seen_zone_ids:
                continue
            seen_zone_ids.add(zone_key)

            formation = cluster[0].formation if cluster else active_well.current_formation

            # Human-readable explanation
            depth_above = active_well.current_depth - zone_end
            proximity_txt = (
                f"Active well is {abs(depth_above):.0f} m {'above' if depth_above > 0 else 'inside or below'} this zone."
                if depth_above >= -10 else
                f"Active well is {abs(depth_above):.0f} m inside this zone."
            )
            explanation = (
                f"{len(cluster)} event(s) of type {event_type.replace('_', ' ')} were recorded "
                f"in {len(well_ids)} nearby well(s) between {zone_start:.0f}–{zone_end:.0f} m "
                f"in the {formation} formation. {proximity_txt}"
            )

            zones.append(schemas.HistoricalRiskZone(
                risk_type=event_type,
                interval_start=round(zone_start, 1),
                interval_end=round(zone_end, 1),
                supporting_well_ids=well_ids,
                supporting_event_ids=[e.event_id for e in cluster],
                event_count=len(cluster),
                formation=formation,
                explanation=explanation,
            ))

    # Sort by depth proximity to active well's current depth
    zones.sort(
        key=lambda z: abs(z.interval_start - active_well.current_depth)
    )
    return zones
