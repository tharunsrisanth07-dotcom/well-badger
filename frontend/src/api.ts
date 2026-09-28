import axios from 'axios';

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api';

// ── Core types ────────────────────────────────────────────────────────────────

export interface Well {
  well_id: string;
  name: string;
  field: string;
  latitude: number;
  longitude: number;
  status: string;
  total_depth: number;
  current_depth: number;
  current_formation: string;
  formation: string;
  spud_date?: string | null;
}

export interface WellEvent {
  event_id: number;
  well_id: string;
  event_type: string;
  depth: number;
  formation: string;
  severity: string;
  description: string;
  cause: string;
  mitigation: string;
  outcome: string;
  date: string;
  source_document: string;
  source_page?: number | null;
}

export interface RelevanceBreakdown {
  spatial_score: number;
  depth_score: number;
  formation_score: number;
  event_density: number;
  overall: number;
  label: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface NearbyWell {
  well: Well;
  distance_km: number;
  relevant_events: WellEvent[];
  relevance: RelevanceBreakdown;
}

export interface ContributingFactor {
  factor: string;
  detail: string;
  weight: number;
}

export interface HistoricalRiskZone {
  risk_type: string;
  interval_start: number;
  interval_end: number;
  supporting_well_ids: string[];
  supporting_event_ids: number[];
  event_count: number;
  formation: string;
  explanation: string;
}

export interface RiskPrediction {
  risk_type: string;
  risk_score: number;
  risk_level: string;
  interval_start: number;
  interval_end: number;
  evidence_strength: string;
  supporting_wells: string[];
  supporting_events: number[];
  contributing_factors: ContributingFactor[];
  historical_zone?: HistoricalRiskZone | null;
  explanation: string;
  recommended_mitigation?: string | null;
}

export interface Alert {
  alert_id: string;
  well_id: string;
  alert_type: string;
  severity: string;
  title: string;
  body: string;
  current_depth: number;
  risk_interval_start: number;
  risk_interval_end: number;
  distance_to_zone_m: number;
  primary_risk: string;
  supporting_wells: string[];
  recommended_mitigation?: string | null;
  source_documents: string[];
}

export interface SearchResult {
  result_type: string;
  well_id: string;
  well_name: string;
  event?: WellEvent | null;
  distance_km?: number | null;
  relevance_score: number;
  highlight: string;
}

export interface SearchResponse {
  query: string;
  total_results: number;
  results: SearchResult[];
  filters_applied: Record<string, unknown>;
}

export interface DrillingParameter {
  id: number;
  well_id: string;
  depth: number;
  rop: number | null;
  wob: number | null;
  rpm: number | null;
  torque: number | null;
  pressure: number | null;
  flow_rate: number | null;
  mud_weight: number | null;
  timestamp: string | null;
}

export interface SystemStats {
  total_wells: number;
  active_wells: number;
  completed_wells: number;
  suspended_wells: number;
  total_events: number;
  high_severity_events: number;
  event_type_breakdown: Record<string, number>;
}

export interface DocumentSummary {
  document_id: string;
  well_id: string;
  filename: string;
  document_type: string;
  date: string;
  processing_status: string;
}

// ── API calls ─────────────────────────────────────────────────────────────────

export const getWells = (status?: string) =>
  axios.get<Well[]>(`${API}/wells`, { params: status ? { status } : {} }).then(r => r.data);

export const getActiveWells = () =>
  axios.get<Well[]>(`${API}/wells/active`).then(r => r.data);

export const getWell = (id: string) =>
  axios.get<Well>(`${API}/wells/${id}`).then(r => r.data);

export const getNearbyWells = (id: string, radius: number) =>
  axios.get<NearbyWell[]>(`${API}/wells/${id}/nearby`, { params: { radius_km: radius } }).then(r => r.data);

export const getWellEvents = (id: string) =>
  axios.get<WellEvent[]>(`${API}/wells/${id}/events`).then(r => r.data);

export const getDrillingParameters = (id: string, limit = 100) =>
  axios.get<DrillingParameter[]>(`${API}/wells/${id}/parameters`, { params: { limit } }).then(r => r.data);

export const getWellDocuments = (id: string) =>
  axios.get<DocumentSummary[]>(`${API}/wells/${id}/documents`).then(r => r.data);

export const getCurrentRisk = (id: string, radius: number, currentDepth?: number) =>
  axios.get<RiskPrediction[]>(`${API}/risk/current`, {
    params: { well_id: id, radius_km: radius, ...(currentDepth !== undefined ? { current_depth: currentDepth } : {}) },
  }).then(r => r.data);

export const getRiskZones = (id: string, radius: number) =>
  axios.get<HistoricalRiskZone[]>(`${API}/risk/zones`, { params: { well_id: id, radius_km: radius } }).then(r => r.data);

export const getAlerts = (id: string, radius: number, currentDepth?: number) =>
  axios.get<Alert[]>(`${API}/alerts/${id}`, {
    params: { radius_km: radius, ...(currentDepth !== undefined ? { current_depth: currentDepth } : {}) },
  }).then(r => r.data);

export const searchKnowledge = (q: string, activeWellId?: string, radiusKm = 20, limit = 20) =>
  axios.get<SearchResponse>(`${API}/search`, {
    params: { q, active_well_id: activeWellId, radius_km: radiusKm, limit },
  }).then(r => r.data);

export const getAllEvents = (opts?: { severity?: string; event_type?: string; formation?: string; limit?: number }) =>
  axios.get<WellEvent[]>(`${API}/events`, { params: opts }).then(r => r.data);

export const getSystemStats = () =>
  axios.get<SystemStats>(`${API}/stats/summary`).then(r => r.data);

export const getDocuments = (wellId?: string, docType?: string) =>
  axios.get<DocumentSummary[]>(`${API}/documents`, { params: { well_id: wellId, doc_type: docType } }).then(r => r.data);
