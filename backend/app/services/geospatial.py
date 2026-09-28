from haversine import haversine, Unit
from typing import List, Dict, Any
from sqlalchemy.orm import Session
from ..models import models, schemas

def get_nearby_wells(db: Session, active_well_id: str, radius_km: float) -> List[schemas.NearbyWellResponse]:
    active_well = db.query(models.Well).filter(models.Well.well_id == active_well_id).first()
    if not active_well:
        return []
        
    all_wells = db.query(models.Well).filter(models.Well.well_id != active_well_id).all()
    
    nearby_wells = []
    
    for well in all_wells:
        # Calculate distance
        dist = haversine((active_well.latitude, active_well.longitude), (well.latitude, well.longitude), unit=Unit.KILOMETERS)
        
        if dist <= radius_km:
            # Get events for this well
            events = db.query(models.WellEvent).filter(models.WellEvent.well_id == well.well_id).all()
            
            # Convert to Pydantic schemas
            well_schema = schemas.Well.from_orm(well)
            events_schema = [schemas.WellEvent.from_orm(e) for e in events]
            
            nearby_wells.append(schemas.NearbyWellResponse(
                well=well_schema,
                distance_km=dist,
                relevant_events=events_schema
            ))
            
    # Sort by distance
    nearby_wells.sort(key=lambda x: x.distance_km)
    
    return nearby_wells
