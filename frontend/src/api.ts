import axios from 'axios';

const API_URL = 'http://localhost:8000/api';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Well {
  well_id: string;
  name: string;
  field: string;
  latitude: number;
  longitude: number;
  status: string;
  total_depth: number;
  formation: string;
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
}

export interface RiskPrediction {
  risk_type: string;
  score: number;
  level: string;
  interval_start: number;
  interval_end: number;
  confidence: number;
  evidence: string[];
  supporting_wells: string[];
}

export interface NearbyWell {
  well: Well;
  distance_km: number;
  relevant_events: WellEvent[];
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

// ── API calls ─────────────────────────────────────────────────────────────────

export const getWells = async (status?: string): Promise<Well[]> => {
  const params = status ? { status } : {};
  const response = await axios.get(`${API_URL}/wells`, { params });
  return response.data;
};

export const getWell = async (wellId: string): Promise<Well> => {
  const response = await axios.get(`${API_URL}/wells/${wellId}`);
  return response.data;
};

export const getNearbyWells = async (wellId: string, radius: number): Promise<NearbyWell[]> => {
  const response = await axios.get(`${API_URL}/wells/${wellId}/nearby`, {
    params: { radius_km: radius },
  });
  return response.data;
};

export const getCurrentRisk = async (wellId: string, radius: number): Promise<RiskPrediction[]> => {
  const response = await axios.get(`${API_URL}/risk/current`, {
    params: { well_id: wellId, radius_km: radius },
  });
  return response.data;
};

export const getWellEvents = async (wellId: string): Promise<WellEvent[]> => {
  const response = await axios.get(`${API_URL}/wells/${wellId}/events`);
  return response.data;
};

export const getDrillingParameters = async (wellId: string, limit = 100): Promise<DrillingParameter[]> => {
  const response = await axios.get(`${API_URL}/wells/${wellId}/parameters`, {
    params: { limit },
  });
  return response.data;
};

export const getSystemStats = async (): Promise<SystemStats> => {
  const response = await axios.get(`${API_URL}/stats/summary`);
  return response.data;
};

export const getAllEvents = async (options?: {
  severity?: string;
  event_type?: string;
  limit?: number;
}): Promise<WellEvent[]> => {
  const response = await axios.get(`${API_URL}/events`, { params: options });
  return response.data;
};
