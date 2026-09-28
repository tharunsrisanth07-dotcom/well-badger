# keep geospatial.py for backward-compat — real logic moved to relevance.py
from haversine import haversine, Unit
from typing import List
from sqlalchemy.orm import Session

from ..models import models, schemas
from .relevance import get_nearby_wells_with_relevance


def get_nearby_wells(db: Session, active_well_id: str, radius_km: float) -> List[schemas.NearbyWellResponse]:
    """Thin wrapper around relevance.get_nearby_wells_with_relevance for backward compat."""
    return get_nearby_wells_with_relevance(db, active_well_id, radius_km)
