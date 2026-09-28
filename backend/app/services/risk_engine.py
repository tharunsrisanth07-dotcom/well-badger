from typing import List, Dict, Any
from sqlalchemy.orm import Session
from ..models import models, schemas

def analyze_risk(db: Session, active_well_id: str, radius_km: float = 10.0) -> List[schemas.RiskPrediction]:
    # Import here to avoid circular imports if any
    from .geospatial import get_nearby_wells
    
    nearby_wells = get_nearby_wells(db, active_well_id, radius_km)
    active_well = db.query(models.Well).filter(models.Well.well_id == active_well_id).first()
    
    if not active_well:
        return []
        
    # Analyze the upcoming 100m interval
    upcoming_start = active_well.total_depth
    upcoming_end = active_well.total_depth + 100
    
    # We will score risks based on:
    # 1. Did the event occur in a nearby well?
    # 2. Was it in the same formation?
    # 3. Did it occur near the upcoming depth interval (within +/- 50m of upcoming start/end)?
    
    risk_scores = {
        "MUD_LOSS": {"score": 0, "events": [], "wells": set()},
        "STUCK_PIPE": {"score": 0, "events": [], "wells": set()},
        "TORQUE_SPIKE": {"score": 0, "events": [], "wells": set()},
        "KICK": {"score": 0, "events": [], "wells": set()},
        "CEMENTING_ISSUE": {"score": 0, "events": [], "wells": set()},
    }
    
    for well_response in nearby_wells:
        for event in well_response.relevant_events:
            # Check depth proximity
            depth_match = (upcoming_start - 50) <= event.depth <= (upcoming_end + 50)
            formation_match = event.formation == active_well.formation
            
            if depth_match or formation_match:
                # Base score for just happening
                score_increment = 10
                
                # Bonus for formation match
                if formation_match:
                    score_increment += 15
                    
                # Bonus for depth match
                if depth_match:
                    score_increment += 20
                
                # Distance penalty
                dist_penalty = (well_response.distance_km / radius_km) * 10
                score_increment = max(5, score_increment - dist_penalty)
                
                if event.event_type in risk_scores:
                    risk_scores[event.event_type]["score"] += score_increment
                    risk_scores[event.event_type]["events"].append(event)
                    risk_scores[event.event_type]["wells"].add(well_response.well.well_id)
                    
    predictions = []
    
    for r_type, data in risk_scores.items():
        # Normalize score to max 100 roughly, just for demonstration
        final_score = min(100.0, data["score"])
        if final_score > 0:
            level = "LOW"
            if final_score > 70:
                level = "HIGH"
            elif final_score > 40:
                level = "MEDIUM"
                
            predictions.append(schemas.RiskPrediction(
                risk_type=r_type,
                score=round(final_score, 1),
                level=level,
                interval_start=upcoming_start,
                interval_end=upcoming_end,
                confidence=min(100.0, len(data["wells"]) * 25.0), # 4 wells gives 100% confidence
                evidence=[f"{len(data['wells'])} nearby wells encountered {r_type.replace('_', ' ').lower()} in similar conditions."],
                supporting_wells=list(data["wells"])
            ))
            
    # Sort by score descending
    predictions.sort(key=lambda x: x.score, reverse=True)
    
    return predictions
