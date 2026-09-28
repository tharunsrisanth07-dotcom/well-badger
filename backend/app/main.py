from fastapi import FastAPI, Depends, HTTPException, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List, Optional
import os

from . import database
from .models import models, schemas
from .services import geospatial, risk_engine
from .services.relevance import get_nearby_wells_with_relevance
from .services.event_analysis import derive_historical_risk_zones
from .services.alert_engine import generate_alerts
from .services.search import search_knowledge

app = FastAPI(
    title="NWIS API",
    description="Nearby Wells Intelligence System — Historical Similarity Risk Engine",
    version="2.0.0",
)

cors_origins_env = os.getenv("NWIS_CORS_ORIGINS", "http://localhost:5173")
origins = [origin.strip() for origin in cors_origins_env.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Wells ─────────────────────────────────────────────────────────────────────

@app.get("/api/wells", response_model=List[schemas.Well])
def get_wells(status: Optional[str] = Query(None), db: Session = Depends(database.get_db)):
    """Return all wells, optionally filtered by status."""
    q = db.query(models.Well)
    if status:
        q = q.filter(models.Well.status == status.upper())
    return q.all()


@app.get("/api/wells/active", response_model=List[schemas.Well])
def get_active_wells(db: Session = Depends(database.get_db)):
    """Return only ACTIVE wells — used to populate the active-well selector."""
    return db.query(models.Well).filter(models.Well.status == "ACTIVE").all()


@app.get("/api/wells/{well_id}", response_model=schemas.Well)
def get_well(well_id: str, db: Session = Depends(database.get_db)):
    well = db.query(models.Well).filter(models.Well.well_id == well_id).first()
    if not well:
        raise HTTPException(status_code=404, detail=f"Well {well_id!r} not found")
    return well


@app.get("/api/wells/{well_id}/nearby", response_model=List[schemas.NearbyWellResponse])
def get_nearby_wells(
    well_id: str,
    radius_km: float = Query(10.0, ge=1.0, le=50.0),
    db: Session = Depends(database.get_db),
):
    """Return nearby wells sorted by relevance (not just distance)."""
    return get_nearby_wells_with_relevance(db, well_id, radius_km)


@app.get("/api/wells/{well_id}/events", response_model=List[schemas.WellEvent])
def get_well_events(well_id: str, db: Session = Depends(database.get_db)):
    return db.query(models.WellEvent).filter(models.WellEvent.well_id == well_id).all()


@app.get("/api/wells/{well_id}/parameters", response_model=List[schemas.DrillingParameter])
def get_drilling_parameters(
    well_id: str,
    limit: int = Query(100, le=500),
    db: Session = Depends(database.get_db),
):
    return (
        db.query(models.DrillingParameter)
        .filter(models.DrillingParameter.well_id == well_id)
        .order_by(models.DrillingParameter.depth)
        .limit(limit)
        .all()
    )


@app.get("/api/wells/{well_id}/documents", response_model=List[schemas.DocumentSummary])
def get_well_documents(well_id: str, db: Session = Depends(database.get_db)):
    """Return document summaries for a specific well."""
    return (
        db.query(models.Document)
        .filter(models.Document.well_id == well_id)
        .all()
    )


# ── Risk ─────────────────────────────────────────────────────────────────────

@app.get("/api/risk/current", response_model=List[schemas.RiskPrediction])
def get_current_risk(
    well_id: str,
    radius_km: float = Query(10.0, ge=1.0, le=50.0),
    current_depth: Optional[float] = Query(None, description="Override current depth for simulation"),
    db: Session = Depends(database.get_db),
):
    """
    Analyse drilling risk for the active well.
    Uses Historical Similarity Risk Engine (evidence-based, NOT ML).
    Pass current_depth to simulate drilling progression.
    """
    return risk_engine.analyze_risk(db, well_id, radius_km, current_depth_override=current_depth)


@app.get("/api/risk/zones", response_model=List[schemas.HistoricalRiskZone])
def get_risk_zones(
    well_id: str,
    radius_km: float = Query(10.0, ge=1.0, le=50.0),
    db: Session = Depends(database.get_db),
):
    """Return derived historical risk zones (clustered from offset-well events)."""
    nearby = get_nearby_wells_with_relevance(db, well_id, radius_km)
    return derive_historical_risk_zones(db, well_id, nearby)


@app.get("/api/alerts/{well_id}", response_model=List[schemas.Alert])
def get_alerts(
    well_id: str,
    radius_km: float = Query(10.0, ge=1.0, le=50.0),
    current_depth: Optional[float] = Query(None, description="Override current depth for simulation"),
    db: Session = Depends(database.get_db),
):
    """Return active alerts for the well (triggered by approaching/inside risk zones)."""
    return generate_alerts(db, well_id, radius_km, current_depth_override=current_depth)


# ── Events ────────────────────────────────────────────────────────────────────

@app.get("/api/events", response_model=List[schemas.WellEvent])
def get_all_events(
    severity: Optional[str] = Query(None),
    event_type: Optional[str] = Query(None),
    formation: Optional[str] = Query(None),
    min_depth: Optional[float] = Query(None),
    max_depth: Optional[float] = Query(None),
    limit: int = Query(100, le=500),
    db: Session = Depends(database.get_db),
):
    """Return events with optional filters."""
    q = db.query(models.WellEvent)
    if severity:
        q = q.filter(models.WellEvent.severity == severity.upper())
    if event_type:
        q = q.filter(models.WellEvent.event_type == event_type.upper())
    if formation:
        q = q.filter(models.WellEvent.formation == formation)
    if min_depth is not None:
        q = q.filter(models.WellEvent.depth >= min_depth)
    if max_depth is not None:
        q = q.filter(models.WellEvent.depth <= max_depth)
    return q.order_by(models.WellEvent.date.desc()).limit(limit).all()


# ── Search ────────────────────────────────────────────────────────────────────

@app.get("/api/search", response_model=schemas.SearchResponse)
def search(
    q: str = Query(..., min_length=2, description="Natural language or keyword query"),
    active_well_id: Optional[str] = Query(None),
    radius_km: float = Query(20.0),
    limit: int = Query(20, le=50),
    db: Session = Depends(database.get_db),
):
    """
    Search the knowledge base using keywords or natural language.
    Supports: event types, formations, depth ranges, well IDs.
    """
    return search_knowledge(db, q, active_well_id, radius_km, limit)


# ── Documents ─────────────────────────────────────────────────────────────────

@app.get("/api/documents", response_model=List[schemas.DocumentSummary])
def get_documents(
    well_id: Optional[str] = Query(None),
    doc_type: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
    db: Session = Depends(database.get_db),
):
    q = db.query(models.Document)
    if well_id:
        q = q.filter(models.Document.well_id == well_id)
    if doc_type:
        q = q.filter(models.Document.document_type == doc_type.upper())
    return q.order_by(models.Document.date.desc()).limit(limit).all()


@app.get("/api/documents/{doc_id}")
def get_document(doc_id: str, db: Session = Depends(database.get_db)):
    """Return full document text (for inspection/traceability)."""
    doc = db.query(models.Document).filter(models.Document.document_id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"document_id": doc.document_id, "well_id": doc.well_id,
            "filename": doc.filename, "text": doc.text, "date": doc.date}


# ── Stats ─────────────────────────────────────────────────────────────────────

@app.get("/api/stats/summary", response_model=schemas.SystemStats)
def get_system_stats(db: Session = Depends(database.get_db)):
    total_wells     = db.query(models.Well).count()
    active_wells    = db.query(models.Well).filter(models.Well.status == "ACTIVE").count()
    completed_wells = db.query(models.Well).filter(models.Well.status == "COMPLETED").count()
    suspended_wells = db.query(models.Well).filter(models.Well.status == "SUSPENDED").count()
    total_events    = db.query(models.WellEvent).count()
    high_sev        = db.query(models.WellEvent).filter(
        models.WellEvent.severity.in_(["HIGH", "CRITICAL"])
    ).count()

    breakdown = {}
    for etype in ["MUD_LOSS", "STUCK_PIPE", "KICK", "TORQUE_SPIKE", "CEMENTING_ISSUE"]:
        breakdown[etype] = db.query(models.WellEvent).filter(
            models.WellEvent.event_type == etype
        ).count()

    return schemas.SystemStats(
        total_wells=total_wells,
        active_wells=active_wells,
        completed_wells=completed_wells,
        suspended_wells=suspended_wells,
        total_events=total_events,
        high_severity_events=high_sev,
        event_type_breakdown=breakdown,
    )
