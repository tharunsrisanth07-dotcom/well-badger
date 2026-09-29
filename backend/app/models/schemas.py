from pydantic import BaseModel
from typing import List, Optional, Dict, Any
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
    current_depth: float          # Active drilling depth — differs from total_depth for active wells
    current_formation: str        # Formation currently being drilled
    formation: str                # Primary/target formation


class WellCreate(WellBase):
    pass


class Well(WellBase):
    spud_date: Optional[datetime] = None

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
    source_page: Optional[int] = None


class WellEvent(WellEventBase):
    event_id: int

    class Config:
        from_attributes = True


# ── Relevance scoring ─────────────────────────────────────────────────────────

class RelevanceBreakdown(BaseModel):
    spatial_score: float        # 0–1 based on distance
    depth_score: float          # 0–1 based on depth proximity
    formation_score: float      # 0–1 based on formation match
    event_density: float        # 0–1 normalised event count
    overall: float              # 0–1 weighted composite
    label: str                  # HIGH | MEDIUM | LOW


class NearbyWellResponse(BaseModel):
    well: Well
    distance_km: float
    relevant_events: List[WellEvent]
    relevance: RelevanceBreakdown


# ── Historical Risk Zone ──────────────────────────────────────────────────────

class HistoricalRiskZone(BaseModel):
    risk_type: str
    interval_start: float
    interval_end: float
    supporting_well_ids: List[str]
    supporting_event_ids: List[int]
    event_count: int
    formation: str
    explanation: str             # human-readable rationale


# ── Risk ─────────────────────────────────────────────────────────────────────

class ContributingFactor(BaseModel):
    factor: str
    detail: str
    weight: float               # contribution to final score 0–1


class RiskPrediction(BaseModel):
    risk_type: str
    risk_score: float           # 0–100
    risk_level: str             # LOW | MEDIUM | HIGH | CRITICAL
    interval_start: float
    interval_end: float
    evidence_strength: str      # Weak | Moderate | Strong | Very Strong
    supporting_wells: List[str]
    supporting_events: List[int]
    contributing_factors: List[ContributingFactor]
    historical_zone: Optional[HistoricalRiskZone] = None
    explanation: str            # 1-2 sentence human-readable explanation
    recommended_mitigation: Optional[str] = None
    ml_probability: Optional[float] = None

    # Legacy alias kept for backward compat
    @property
    def score(self) -> float:
        return self.risk_score

    @property
    def level(self) -> str:
        return self.risk_level


# ── Alerts ────────────────────────────────────────────────────────────────────

class Alert(BaseModel):
    alert_id: str
    well_id: str
    alert_type: str             # APPROACHING_RISK_ZONE | FORMATION_MATCH | PARAMETER_ANOMALY
    severity: str               # WARNING | HIGH | CRITICAL
    title: str
    body: str
    current_depth: float
    risk_interval_start: float
    risk_interval_end: float
    distance_to_zone_m: float   # metres until top of risk zone
    primary_risk: str
    supporting_wells: List[str]
    recommended_mitigation: Optional[str] = None
    source_documents: List[str] = []


# ── Search ────────────────────────────────────────────────────────────────────

class SearchResult(BaseModel):
    result_type: str            # well | event | document
    well_id: str
    well_name: str
    event: Optional[WellEvent] = None
    distance_km: Optional[float] = None
    relevance_score: float
    highlight: str              # short snippet for display


class SearchResponse(BaseModel):
    query: str
    total_results: int
    results: List[SearchResult]
    filters_applied: Dict[str, Any]


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


# ── Document ──────────────────────────────────────────────────────────────────

class DocumentSummary(BaseModel):
    document_id: str
    well_id: str
    filename: str
    document_type: str
    date: datetime
    processing_status: str

    class Config:
        from_attributes = True
