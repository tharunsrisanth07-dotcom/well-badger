from pydantic import BaseModel
from typing import List, Optional, Dict
from datetime import datetime


# ── Well ─────────────────────────────────────────────────────────────────────

class WellBase(BaseModel):
    well_id: str
    name: str
    field: str
    latitude: float
    longitude: float
    status: str
    total_depth: float
    formation: str


class WellCreate(WellBase):
    pass


class Well(WellBase):
    class Config:
        from_attributes = True


# ── Well Event ────────────────────────────────────────────────────────────────

class WellEventBase(BaseModel):
    well_id: str
    event_type: str
    depth: float
    formation: str
    severity: str
    description: str
    cause: str
    mitigation: str
    outcome: str
    date: datetime
    source_document: str


class WellEvent(WellEventBase):
    event_id: int

    class Config:
        from_attributes = True


# ── Risk ─────────────────────────────────────────────────────────────────────

class RiskPrediction(BaseModel):
    risk_type: str
    score: float
    level: str
    interval_start: float
    interval_end: float
    confidence: float
    evidence: List[str]
    supporting_wells: List[str]


# ── Nearby Wells ──────────────────────────────────────────────────────────────

class NearbyWellResponse(BaseModel):
    well: Well
    distance_km: float
    relevant_events: List[WellEvent]


# ── Drilling Parameters ───────────────────────────────────────────────────────

class DrillingParameter(BaseModel):
    id: int
    well_id: str
    depth: float
    rop: Optional[float] = None
    wob: Optional[float] = None
    rpm: Optional[float] = None
    torque: Optional[float] = None
    pressure: Optional[float] = None
    flow_rate: Optional[float] = None
    mud_weight: Optional[float] = None
    timestamp: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Stats ─────────────────────────────────────────────────────────────────────

class SystemStats(BaseModel):
    total_wells: int
    active_wells: int
    completed_wells: int
    suspended_wells: int
    total_events: int
    high_severity_events: int
    event_type_breakdown: Dict[str, int]
