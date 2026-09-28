"""
Search / Query Service — NWIS

Supports keyword + metadata filtering for the knowledge base.
No LLM required — deterministic retrieval against structured event records.

Supported query patterns:
  "mud loss at 2900m"
  "stuck pipe nearby"
  "what happened in WELL-103"
  "kick in Barail"
  "mitigation for mud loss"
  "show high severity events"
"""
import re
from typing import List, Optional
from sqlalchemy.orm import Session
from haversine import haversine, Unit

from ..models import models, schemas

EVENT_TYPE_ALIASES = {
    "mud loss":        "MUD_LOSS",
    "mud_loss":        "MUD_LOSS",
    "stuck pipe":      "STUCK_PIPE",
    "stuck_pipe":      "STUCK_PIPE",
    "kick":            "KICK",
    "torque":          "TORQUE_SPIKE",
    "torque spike":    "TORQUE_SPIKE",
    "cementing":       "CEMENTING_ISSUE",
    "cement":          "CEMENTING_ISSUE",
}

SEVERITY_ALIASES = {
    "critical": "CRITICAL",
    "high":     "HIGH",
    "medium":   "MEDIUM",
    "low":      "LOW",
}

FORMATION_NAMES = ["tipam", "barail", "kopili", "sylhet"]


def _extract_depth(query: str) -> Optional[float]:
    """Extract depth in metres from query text."""
    m = re.search(r"(\d{3,4})\s*m?\b", query)
    return float(m.group(1)) if m else None


def _extract_event_type(query: str) -> Optional[str]:
    ql = query.lower()
    for alias, etype in EVENT_TYPE_ALIASES.items():
        if alias in ql:
            return etype
    return None


def _extract_severity(query: str) -> Optional[str]:
    ql = query.lower()
    for alias, sev in SEVERITY_ALIASES.items():
        if alias in ql:
            return sev
    return None


def _extract_formation(query: str) -> Optional[str]:
    ql = query.lower()
    for fm in FORMATION_NAMES:
        if fm in ql:
            return fm.capitalize()
    return None


def _extract_well_id(query: str) -> Optional[str]:
    """Extract explicit well ID like WELL-103 or ACTIVE-001."""
    m = re.search(r"\b(WELL-\d+|ACTIVE-\d+)\b", query.upper())
    return m.group(1) if m else None


def search_knowledge(
    db: Session,
    query: str,
    active_well_id: Optional[str] = None,
    radius_km: float = 20.0,
    limit: int = 30,
) -> schemas.SearchResponse:
    ql = query.strip().lower()

    # Extract intent signals
    depth_target  = _extract_depth(query)
    event_type    = _extract_event_type(query)
    severity      = _extract_severity(query)
    formation     = _extract_formation(query)
    well_id_match = _extract_well_id(query)

    filters_applied = {
        "depth": depth_target,
        "event_type": event_type,
        "severity": severity,
        "formation": formation,
        "well_id": well_id_match,
    }

    # Base query
    q = db.query(models.WellEvent)

    if well_id_match:
        q = q.filter(models.WellEvent.well_id == well_id_match)
    if event_type:
        q = q.filter(models.WellEvent.event_type == event_type)
    if severity:
        q = q.filter(models.WellEvent.severity == severity)
    if formation:
        q = q.filter(models.WellEvent.formation == formation)
    if depth_target:
        q = q.filter(
            models.WellEvent.depth >= depth_target - 100,
            models.WellEvent.depth <= depth_target + 100,
        )

    all_events = q.order_by(models.WellEvent.depth).limit(limit * 3).all()

    # Fetch active well for distance calc
    active_well = None
    if active_well_id:
        active_well = db.query(models.Well).filter(models.Well.well_id == active_well_id).first()

    results: List[schemas.SearchResult] = []
    seen_ids = set()
    for evt in all_events:
        if evt.event_id in seen_ids:
            continue
        seen_ids.add(evt.event_id)

        # Relevance score
        score = 0.5
        if event_type and evt.event_type == event_type:
            score += 0.2
        if formation and evt.formation == formation:
            score += 0.15
        if depth_target and abs(evt.depth - depth_target) < 50:
            score += 0.15
        if severity and evt.severity == severity:
            score += 0.1

        # Distance from active well
        dist_km = None
        if active_well:
            w = db.query(models.Well).filter(models.Well.well_id == evt.well_id).first()
            if w:
                dist_km = round(haversine(
                    (active_well.latitude, active_well.longitude),
                    (w.latitude, w.longitude),
                    unit=Unit.KILOMETERS,
                ), 2)
                if dist_km <= radius_km:
                    score += 0.1

        highlight = (
            f"{evt.event_type.replace('_', ' ')} at {evt.depth:.0f} m ({evt.formation}) — "
            f"{evt.severity} severity. Source: {evt.source_document}"
        )

        w_obj = db.query(models.Well).filter(models.Well.well_id == evt.well_id).first()

        results.append(schemas.SearchResult(
            result_type="event",
            well_id=evt.well_id,
            well_name=w_obj.name if w_obj else evt.well_id,
            event=schemas.WellEvent.from_orm(evt),
            distance_km=dist_km,
            relevance_score=round(min(1.0, score), 3),
            highlight=highlight,
        ))

    results.sort(key=lambda r: r.relevance_score, reverse=True)
    results = results[:limit]

    return schemas.SearchResponse(
        query=query,
        total_results=len(results),
        results=results,
        filters_applied={k: v for k, v in filters_applied.items() if v is not None},
    )
