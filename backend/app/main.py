from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List, Optional

from . import database
from .models import models, schemas
from .services import geospatial, risk_engine

app = FastAPI(title="NWIS API", description="Nearby Wells Intelligence System API", version="1.0.0")

# Configure CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Wells ────────────────────────────────────────────────────────────────────

@app.get("/api/wells", response_model=List[schemas.Well])
def get_wells(status: Optional[str] = Query(None), db: Session = Depends(database.get_db)):
    """Return all wells, optionally filtered by status."""
    query = db.query(models.Well)
    if status:
        query = query.filter(models.Well.status == status.upper())
    return query.all()


@app.get("/api/wells/{well_id}", response_model=schemas.Well)
def get_well(well_id: str, db: Session = Depends(database.get_db)):
    well = db.query(models.Well).filter(models.Well.well_id == well_id).first()
    if not well:
        raise HTTPException(status_code=404, detail="Well not found")
    return well


@app.get("/api/wells/{well_id}/nearby", response_model=List[schemas.NearbyWellResponse])
def get_nearby_wells(well_id: str, radius_km: float = 10.0, db: Session = Depends(database.get_db)):
    return geospatial.get_nearby_wells(db, well_id, radius_km)


@app.get("/api/wells/{well_id}/events", response_model=List[schemas.WellEvent])
def get_well_events(well_id: str, db: Session = Depends(database.get_db)):
    events = db.query(models.WellEvent).filter(models.WellEvent.well_id == well_id).all()
    return events


@app.get("/api/wells/{well_id}/parameters", response_model=List[schemas.DrillingParameter])
def get_drilling_parameters(well_id: str, limit: int = Query(100, le=500), db: Session = Depends(database.get_db)):
    params = (
        db.query(models.DrillingParameter)
        .filter(models.DrillingParameter.well_id == well_id)
        .order_by(models.DrillingParameter.depth)
        .limit(limit)
        .all()
    )
    return params


# ── Risk ─────────────────────────────────────────────────────────────────────

@app.get("/api/risk/current", response_model=List[schemas.RiskPrediction])
def get_current_risk(well_id: str, radius_km: float = 10.0, db: Session = Depends(database.get_db)):
    return risk_engine.analyze_risk(db, well_id, radius_km)


# ── Stats ─────────────────────────────────────────────────────────────────────

@app.get("/api/stats/summary", response_model=schemas.SystemStats)
def get_system_stats(db: Session = Depends(database.get_db)):
    """Return high-level summary statistics for the dashboard."""
    total_wells = db.query(models.Well).count()
    active_wells = db.query(models.Well).filter(models.Well.status == "ACTIVE").count()
    completed_wells = db.query(models.Well).filter(models.Well.status == "COMPLETED").count()
    suspended_wells = db.query(models.Well).filter(models.Well.status == "SUSPENDED").count()
    total_events = db.query(models.WellEvent).count()
    high_severity_events = db.query(models.WellEvent).filter(
        models.WellEvent.severity.in_(["HIGH", "CRITICAL"])
    ).count()

    # Event type breakdown
    event_types = {}
    for event_type in ["MUD_LOSS", "STUCK_PIPE", "KICK", "TORQUE_SPIKE", "CEMENTING_ISSUE"]:
        count = db.query(models.WellEvent).filter(models.WellEvent.event_type == event_type).count()
        event_types[event_type] = count

    return schemas.SystemStats(
        total_wells=total_wells,
        active_wells=active_wells,
        completed_wells=completed_wells,
        suspended_wells=suspended_wells,
        total_events=total_events,
        high_severity_events=high_severity_events,
        event_type_breakdown=event_types,
    )


@app.get("/api/events", response_model=List[schemas.WellEvent])
def get_all_events(
    severity: Optional[str] = Query(None),
    event_type: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
    db: Session = Depends(database.get_db),
):
    """Return events across all wells with optional filters."""
    query = db.query(models.WellEvent)
    if severity:
        query = query.filter(models.WellEvent.severity == severity.upper())
    if event_type:
        query = query.filter(models.WellEvent.event_type == event_type.upper())
    return query.order_by(models.WellEvent.date.desc()).limit(limit).all()
