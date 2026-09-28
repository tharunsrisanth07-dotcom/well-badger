"""
Relevance scoring for nearby/offset wells.

Calculates a composite relevance score for each nearby well relative to the
active well, considering:
  - Spatial proximity (distance)
  - Spatial proximity (distance)
  - Depth similarity (current_depth)
  - Formation match (based on historical events in the well matching active formation)
  - Historical event density near the upcoming interval

The score is transparent and explainable — each component is returned separately.
"""
from typing import List
from haversine import haversine, Unit
from sqlalchemy.orm import Session

from ..models import models, schemas

# Configurable weights (must sum to 1.0)
WEIGHTS = {
    "spatial":    0.25,
    "depth":      0.30,
    "formation":  0.25,
    "events":     0.20,
}

DEPTH_WINDOW = 150   # m — events within ±150 m of current_depth count as relevant
MAX_EVENTS   = 5     # normalise event count against this


def _spatial_score(distance_km: float, radius_km: float) -> float:
    """Higher score for closer wells; 1.0 at 0 km, 0.0 at radius."""
    return max(0.0, 1.0 - (distance_km / radius_km))


def _depth_score(active_depth: float, well_depth: float) -> float:
    """Similarity based on current_depth proximity. Full score if within 200 m."""
    diff = abs(active_depth - well_depth)
    return max(0.0, 1.0 - diff / 500.0)


def _formation_score(active_formation: str, events: list) -> float:
    """Bonus if the offset well had events in the active well's current formation."""
    if not events:
        return 0.0
    matching = sum(1 for e in events if e.formation == active_formation)
    return min(1.0, matching / 2.0)


def _event_density_score(events: list, active_depth: float) -> float:
    """Fraction of events near the active depth window."""
    relevant = [e for e in events if abs(e.depth - active_depth) <= DEPTH_WINDOW]
    return min(1.0, len(relevant) / MAX_EVENTS)


def _label(score: float) -> str:
    if score >= 0.65:
        return "HIGH"
    if score >= 0.35:
        return "MEDIUM"
    return "LOW"


def compute_relevance(
    active_well: models.Well,
    offset_well: models.Well,
    distance_km: float,
    radius_km: float,
    events: list,
) -> schemas.RelevanceBreakdown:
    sp = _spatial_score(distance_km, radius_km)
    dp = _depth_score(active_well.current_depth, offset_well.current_depth)
    fm = _formation_score(active_well.current_formation, events)
    ev = _event_density_score(events, active_well.current_depth)

    overall = (
        WEIGHTS["spatial"]   * sp +
        WEIGHTS["depth"]     * dp +
        WEIGHTS["formation"] * fm +
        WEIGHTS["events"]    * ev
    )

    return schemas.RelevanceBreakdown(
        spatial_score=round(sp, 3),
        depth_score=round(dp, 3),
        formation_score=round(fm, 3),
        event_density=round(ev, 3),
        overall=round(overall, 3),
        label=_label(overall),
    )


def get_nearby_wells_with_relevance(
    db: Session,
    active_well_id: str,
    radius_km: float = 10.0,
) -> List[schemas.NearbyWellResponse]:
    """Return nearby wells sorted by relevance (not just distance)."""
    active_well = db.query(models.Well).filter(models.Well.well_id == active_well_id).first()
    if not active_well:
        return []

    all_wells = db.query(models.Well).filter(models.Well.well_id != active_well_id).all()
    
    # Bulk fetch events to prevent N+1 queries
    all_well_ids = [w.well_id for w in all_wells]
    all_events = db.query(models.WellEvent).filter(models.WellEvent.well_id.in_(all_well_ids)).all()
    events_by_well = {}
    for e in all_events:
        events_by_well.setdefault(e.well_id, []).append(e)

    results: List[schemas.NearbyWellResponse] = []
    for well in all_wells:
        dist_km = haversine(
            (active_well.latitude, active_well.longitude),
            (well.latitude, well.longitude),
            unit=Unit.KILOMETERS,
        )
        if dist_km > radius_km:
            continue

        events_orm = events_by_well.get(well.well_id, [])
        events_schema = [schemas.WellEvent.from_orm(e) for e in events_orm]

        relevance = compute_relevance(active_well, well, dist_km, radius_km, events_orm)

        results.append(schemas.NearbyWellResponse(
            well=schemas.Well.from_orm(well),
            distance_km=round(dist_km, 3),
            relevant_events=events_schema,
            relevance=relevance,
        ))

    # Sort by relevance descending (most useful first)
    results.sort(key=lambda r: r.relevance.overall, reverse=True)
    return results
