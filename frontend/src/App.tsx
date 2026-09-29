import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import {
  Activity, BookOpen, CheckCircle2,
  Database, FileText, Gauge, Globe, MapPin, RefreshCw, Search,
  Shield, TriangleAlert, Layers, Navigation, ChevronDown,
  FlaskConical,
} from 'lucide-react';

import {
  getActiveWells, getNearbyWells, getCurrentRisk, getSystemStats,
  getAllEvents, getAlerts, getRiskZones, searchKnowledge,
  getAnomalies, getAuditReport,
  type Well, type NearbyWell, type RiskPrediction, type Alert,
  type WellEvent, type SystemStats, type HistoricalRiskZone,
  type SearchResponse, type AnomalyReport, type AuditReport,
} from './api';

// ── Leaflet icon fix ──────────────────────────────────────────────────────────
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl:       'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl:     'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const makeIcon = (color: string) => new L.Icon({
  iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${color}.png`,
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});

const ACTIVE_ICON = makeIcon('red');
const HIGH_ICON   = makeIcon('orange');
const MED_ICON    = makeIcon('yellow');
const LOW_ICON    = makeIcon('blue');

// ── Types ─────────────────────────────────────────────────────────────────────
type Section = 'overview' | 'map' | 'risk' | 'wells' | 'knowledge' | 'search' | 'anomaly' | 'audit';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtDepth  = (d: number) => `${d.toLocaleString('en-IN', { maximumFractionDigits: 0 })} m`;
const fmtDepthN = (d: number) => d.toLocaleString('en-IN', { maximumFractionDigits: 0 });

function severityBadge(s: string) {
  const map: Record<string, string> = {
    CRITICAL: 'badge badge-red', HIGH: 'badge badge-orange',
    MEDIUM: 'badge badge-amber', LOW: 'badge badge-green',
  };
  return map[s] ?? 'badge badge-gray';
}

function statusBadge(s: string) {
  const map: Record<string, string> = {
    ACTIVE: 'badge badge-green', COMPLETED: 'badge badge-blue', SUSPENDED: 'badge badge-amber',
  };
  return map[s] ?? 'badge badge-gray';
}

function eventTypeBadge(et: string) {
  const map: Record<string, string> = {
    MUD_LOSS: 'badge badge-teal', STUCK_PIPE: 'badge badge-amber',
    KICK: 'badge badge-red', TORQUE_SPIKE: 'badge badge-purple',
    CEMENTING_ISSUE: 'badge badge-blue',
  };
  return map[et] ?? 'badge badge-gray';
}

// ── Map fly-to helper ─────────────────────────────────────────────────────────
function FlyTo({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  useEffect(() => { map.flyTo([lat, lon], 12, { duration: 1 }); }, [lat, lon, map]);
  return null;
}

// ── Spinner ───────────────────────────────────────────────────────────────────
const Spinner = ({ label = 'Loading data…' }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: 'var(--text-4)' }}>
    <div className="spinner" style={{ width: 24, height: 24, border: '2px solid var(--border)', borderTopColor: 'var(--blue)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
    <span style={{ fontSize: 12 }}>{label}</span>
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
  </div>
);

// ── Empty state ───────────────────────────────────────────────────────────────
const EmptyState = ({ icon: Icon, msg }: { icon: React.ComponentType<{ size?: number; color?: string; className?: string }>; msg: string }) => (
  <div className="empty-state">
    <Icon size={36} color="var(--border-md)" />
    <p style={{ fontSize: 13 }}>{msg}</p>
  </div>
);



// ── Particles ─────────────────────────────────────────────────────────────────
const DrillingParticles = () => {
  const particles = useMemo(() => Array.from({ length: 15 }).map(() => ({
    left: `${Math.random() * 100}%`,
    top: `${Math.random() * 100}%`,
    width: `${Math.random() * 3 + 1}px`,
    height: `${Math.random() * 3 + 1}px`,
    animationDuration: `${Math.random() * 10 + 10}s`,
    animationDelay: `${Math.random() * 5}s`,
  })), []);
  
  return (
    <div className="drilling-particles">
      {particles.map((style, i) => (
        <div key={i} className="particle" style={style} />
      ))}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════════
//  OVERVIEW SECTION (REDESIGNED)
// ════════════════════════════════════════════════════════════════════════════════
function OverviewSection({
  activeWell, simDepth, stats, risks, alerts, nearbyWells, riskZones, radius
}: {
  activeWell: Well | null; simDepth: number; stats: SystemStats | null;
  risks: RiskPrediction[]; alerts: Alert[];
  nearbyWells: NearbyWell[]; riskZones: HistoricalRiskZone[];
  radius: number;
}) {
  if (!activeWell) return <Spinner label="Loading active well…" />;

  const topRisk = risks[0];
  const activeAlert = alerts[0];
  const highRelevance = nearbyWells.filter(n => n.relevance.label === 'HIGH');

  // Timeline scale calculation
  const minZ = Math.min(simDepth, ...(riskZones.map(z => z.interval_start))) - 50;
  const maxZ = Math.max(simDepth, ...(riskZones.map(z => z.interval_end))) + 50;
  const range = maxZ - minZ || 100;

  return (
    <div className="fade-in overview-layout">
      <DrillingParticles />

      {/* Alerts */}
      {activeAlert && (
        <div className={`alert-banner ${activeAlert.severity === 'CRITICAL' ? 'critical' : ''}`}>
          <div className="alert-icon"><TriangleAlert size={20} /></div>
          <div className="alert-content">
            <div className="alert-title">{activeAlert.title}</div>
            <div className="alert-desc">{activeAlert.body}</div>
            {activeAlert.recommended_mitigation && (
              <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 4, borderLeft: '2px solid var(--green)', fontSize: 12, color: 'var(--text-2)' }}>
                <strong style={{ color: 'var(--green)' }}>Mitigation: </strong>{activeAlert.recommended_mitigation}
              </div>
            )}
            <div className="alert-action">
              View full intelligence report <Navigation size={12} style={{ marginLeft: 2 }} />
            </div>
          </div>
        </div>
      )}

      {/* Context Bar */}
      <div className="overview-context glass-panel" style={{ borderRadius: 'var(--r-lg)' }}>
        <div className="ctx-item">
          <span className="ctx-label">Active Well</span>
          <span className="ctx-val mono text-blue">{activeWell.well_id}</span>
        </div>
        <div className="topbar-divider" />
        <div className="ctx-item">
          <span className="ctx-label">Current Depth</span>
          <span className="ctx-val mono" style={{ color: 'var(--text)' }}>{fmtDepthN(simDepth)} m</span>
        </div>
        <div className="topbar-divider" />
        <div className="ctx-item">
          <span className="ctx-label">Formation</span>
          <span className="ctx-val text-teal" style={{ color: 'var(--teal)' }}>{activeWell.current_formation}</span>
        </div>
        <div className="topbar-divider" />
        <div className="ctx-item">
          <span className="ctx-label">Feed Status</span>
          <span className="ctx-val flex-center gap-2" style={{ color: 'var(--green)' }}>
            <div className="pulse-dot" /> SIMULATED
          </span>
        </div>
      </div>

      {/* Main Grid: Map + Risk */}
      <div className="overview-main-grid">
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="card-header">
            <span className="card-title"><Globe size={14} /> Geospatial Context</span>
            <span className="badge badge-blue">{nearbyWells.length} Offset Wells</span>
          </div>
          <div style={{ flex: 1, minHeight: 300, background: 'var(--surface2)' }}>
            <MapContainer center={[activeWell.latitude, activeWell.longitude]} zoom={12} style={{ width: '100%', height: '100%' }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="" />
              <FlyTo lat={activeWell.latitude} lon={activeWell.longitude} />
              <Circle center={[activeWell.latitude, activeWell.longitude]} radius={radius * 1000} pathOptions={{ color: 'var(--blue)', fillColor: 'var(--blue)', fillOpacity: 0.05, dashArray: '6 4' }} />
              <Marker position={[activeWell.latitude, activeWell.longitude]} icon={ACTIVE_ICON} />
              {nearbyWells.map(nw => (
                <Marker key={nw.well.well_id} position={[nw.well.latitude, nw.well.longitude]} icon={nw.relevance.label === 'HIGH' ? HIGH_ICON : nw.relevance.label === 'MEDIUM' ? MED_ICON : LOW_ICON} />
              ))}
            </MapContainer>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="section-title"><Shield size={12} /> Drilling Risk Intelligence</div>
          {topRisk ? (
            <div className="risk-card-large interactive-card">
              <div className="risk-header-large" style={{ background: `var(--${topRisk.risk_level === 'CRITICAL' ? 'red' : topRisk.risk_level === 'HIGH' ? 'orange' : 'amber'}-light)` }}>
                <span className="badge" style={{ alignSelf: 'flex-start', background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' }}>PRIMARY RISK</span>
                <div className={`risk-title-large text-${topRisk.risk_level}`}>{topRisk.risk_type.replace('_', ' ')}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
                  <span className={`risk-score-large text-${topRisk.risk_level}`}>{topRisk.risk_score}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-4)', fontWeight: 600 }}>/ 100</span>
                  <span className={`badge badge-${topRisk.risk_level === 'CRITICAL' ? 'red' : topRisk.risk_level === 'HIGH' ? 'orange' : 'amber'}`}>{topRisk.risk_level}</span>
                  {topRisk.ml_probability != null && (
                    <span className="badge badge-purple" style={{ marginLeft: 8 }}>
                      ML PROBABILITY: {topRisk.ml_probability}%
                    </span>
                  )}
                </div>
              </div>
              <div className="risk-meta-grid">
                <div className="risk-meta-item">
                  <span className="risk-meta-label">Approaching Zone</span>
                  <span className="risk-meta-val mono">{fmtDepthN(topRisk.interval_start)}–{fmtDepthN(topRisk.interval_end)} m</span>
                </div>
                <div className="risk-meta-item">
                  <span className="risk-meta-label">Supporting Evidence</span>
                  <span className="risk-meta-val">{topRisk.supporting_wells.length} wells</span>
                </div>
              </div>
              <div className="risk-evidence-box">
                <span className="why-matters">WHY THIS MATTERS</span>
                <p className="risk-explanation">{topRisk.explanation}</p>
                <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-4)' }}>Evidence Strength: <strong style={{ color: 'var(--text-2)' }}>{topRisk.evidence_strength}</strong></span>
                  <button className="btn" style={{ fontSize: 10, padding: '4px 10px' }}>VIEW EVIDENCE</button>
                </div>
              </div>
            </div>
          ) : (
            <div className="risk-panel-empty interactive-card">
              <CheckCircle2 size={32} style={{ color: 'var(--green)', marginBottom: 12 }} />
              <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>No Major Risks Identified</div>
              <div style={{ fontSize: 12 }}>Current depth and radius show nominal historical risk patterns.</div>
            </div>
          )}
        </div>
      </div>

      {/* Historical Risk Timeline */}
      <div className="section-title"><Layers size={12} /> Historical Risk Zones (Depth Correlation)</div>
      <div className="timeline-card">
        {riskZones.length === 0 ? (
          <EmptyState icon={Layers} msg="No historical risk zones in current radius" />
        ) : (
          <div className="timeline-track">
            <div className="timeline-line" />
            {/* Current depth marker */}
            <div className="timeline-marker" style={{ left: `${((simDepth - minZ) / range) * 100}%`, zIndex: 10 }}>
              <div className="timeline-label" style={{ color: 'var(--blue)' }}>CURRENT {fmtDepth(simDepth)}</div>
              <div className="timeline-dot" style={{ background: 'var(--blue)', width: 16, height: 16, boxShadow: '0 0 10px var(--blue-mid)' }} />
            </div>
            
            {/* Risk zones */}
            {riskZones.map((z, i) => {
              const left = ((z.interval_start - minZ) / range) * 100;
              const width = ((z.interval_end - z.interval_start) / range) * 100;
              const clr = z.risk_type.includes('LOSS') ? 'var(--teal)' : z.risk_type.includes('STUCK') ? 'var(--amber)' : 'var(--orange)';
              return (
                <React.Fragment key={i}>
                  {/* Zone region */}
                  <div style={{ position: 'absolute', left: `${left}%`, width: `${width}%`, top: '50%', transform: 'translateY(-50%)', height: 8, background: clr, opacity: 0.3, borderRadius: 4 }} />
                  {/* Marker */}
                  <div className="timeline-marker" style={{ left: `${left}%` }}>
                    <div className="timeline-label">{z.risk_type.replace('_', ' ')}</div>
                    <div className="timeline-dot" style={{ background: clr }} />
                    <div className="timeline-sub mono">{fmtDepthN(z.interval_start)}m</div>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>

      {/* Relevant Offset Wells */}
      <div className="section-title"><Navigation size={12} /> High-Relevance Offset Wells</div>
      <div className="offset-wells-grid">
        {highRelevance.length === 0 ? (
          <div style={{ gridColumn: '1/-1' }}><EmptyState icon={MapPin} msg="No high-relevance offset wells found" /></div>
        ) : highRelevance.slice(0, 4).map(nw => (
          <div key={nw.well.well_id} className="offset-card interactive-card">
            <div className="offset-header">
              <span className="offset-id">{nw.well.well_id}</span>
              <span className="badge badge-blue">{Math.round(nw.relevance.overall * 100)}% Match</span>
            </div>
            <div className="offset-meta">
              <span>{nw.distance_km.toFixed(1)} km</span>
              <span>•</span>
              <span>{nw.well.formation}</span>
            </div>
            {nw.relevant_events.length > 0 && (
              <div className="offset-events">
                {nw.relevant_events.slice(0, 3).map(e => (
                  <span key={e.event_id} className="event-chip">
                    <div className="event-chip-dot" style={{ background: e.event_type.includes('LOSS') ? 'var(--teal)' : 'var(--orange)' }} />
                    {e.event_type.replace('_', ' ')}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Compact Stats */}
      {stats && (
        <div className="system-overview-compact">
          <div className="sys-stat">
            <span className="sys-stat-label">Total Wells</span>
            <span className="sys-stat-val">{stats.total_wells}</span>
          </div>
          <div className="topbar-divider" />
          <div className="sys-stat">
            <span className="sys-stat-label">Historical Events</span>
            <span className="sys-stat-val">{stats.total_events}</span>
          </div>
          <div className="topbar-divider" />
          <div className="sys-stat">
            <span className="sys-stat-label">High/Critical</span>
            <span className="sys-stat-val text-orange">{stats.high_severity_events}</span>
          </div>
          <div className="topbar-divider" />
          <div className="sys-stat" style={{ flex: 1 }}>
            <span className="sys-stat-label">Primary Event Distribution</span>
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              {Object.entries(stats.event_type_breakdown).slice(0, 3).map(([k, v]) => (
                <span key={k} className="badge badge-gray">{k.replace('_', ' ')}: {v}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
//  MAP SECTION
// ════════════════════════════════════════════════════════════════════════════════
function MapSection({
  activeWell, nearbyWells, radius, onRadiusChange,
}: {
  activeWell: Well | null; nearbyWells: NearbyWell[]; radius: number;
  onRadiusChange: (r: number) => void;
}) {
  const [selectedWell, setSelectedWell] = useState<NearbyWell | null>(null);

  if (!activeWell) return <Spinner />;

  return (
    <div className="fade-in" style={{ display: 'flex', gap: 14, height: 'calc(100vh - 120px)', minHeight: 500 }}>
      {/* Map */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="card" style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)' }}>Analysis Radius</span>
          <input type="range" min={5} max={30} value={radius} onChange={e => onRadiusChange(+e.target.value)}
            className="sim-slider" style={{ width: 140, margin: 0 }} />
          <span className="mono" style={{ color: 'var(--blue)', fontWeight: 700 }}>{radius} km</span>
        </div>

        <MapContainer center={[activeWell.latitude, activeWell.longitude]} zoom={12} style={{ flex: 1, borderRadius: 'var(--r-lg)', zIndex: 1 }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="" />
          <FlyTo lat={activeWell.latitude} lon={activeWell.longitude} />
          <Circle center={[activeWell.latitude, activeWell.longitude]} radius={radius * 1000} pathOptions={{ color: 'var(--blue)', fillColor: 'var(--blue)', fillOpacity: 0.05, dashArray: '6 4' }} />
          <Marker position={[activeWell.latitude, activeWell.longitude]} icon={ACTIVE_ICON}>
            <Popup>
              <div style={{ fontFamily: 'Inter, sans-serif' }}>
                <div style={{ fontWeight: 700, color: 'var(--red)', marginBottom: 6 }}>🔴 {activeWell.well_id}</div>
                <div style={{ fontSize: 12 }}><b>Status:</b> ACTIVE</div>
                <div style={{ fontSize: 12 }}><b>Current Depth:</b> {fmtDepth(activeWell.current_depth)}</div>
              </div>
            </Popup>
          </Marker>
          {nearbyWells.map(nw => (
            <Marker key={nw.well.well_id} position={[nw.well.latitude, nw.well.longitude]} icon={nw.relevance.label === 'HIGH' ? HIGH_ICON : nw.relevance.label === 'MEDIUM' ? MED_ICON : LOW_ICON} eventHandlers={{ click: () => setSelectedWell(nw) }}>
              <Popup>
                <div style={{ fontFamily: 'Inter, sans-serif' }}>
                  <div style={{ fontWeight: 700, color: 'var(--blue)', marginBottom: 4 }}>{nw.well.well_id}</div>
                  <div style={{ fontSize: 12 }}><b>Distance:</b> {nw.distance_km.toFixed(2)} km</div>
                  <div style={{ fontSize: 12 }}><b>Relevance:</b> {nw.relevance.label} ({Math.round(nw.relevance.overall * 100)}%)</div>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {/* Side panel */}
      <div style={{ width: 320, flexShrink: 0 }}>
        {selectedWell ? (
          <div className="card" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div className="card-header">
              <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: 'var(--blue)' }}>{selectedWell.well.well_id}</span>
              <button onClick={() => setSelectedWell(null)} style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: 18 }}>×</button>
            </div>
            <div className="card-body" style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="badge badge-gray" style={{ alignSelf: 'flex-start' }}>{selectedWell.relevance.label} RELEVANCE</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div style={{ background: 'var(--surface2)', padding: 10, borderRadius: 'var(--r-md)' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-4)' }}>DISTANCE</div>
                  <div style={{ fontWeight: 600 }}>{selectedWell.distance_km.toFixed(2)} km</div>
                </div>
                <div style={{ background: 'var(--surface2)', padding: 10, borderRadius: 'var(--r-md)' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-4)' }}>FORMATION</div>
                  <div style={{ fontWeight: 600 }}>{selectedWell.well.formation}</div>
                </div>
              </div>
              <div className="section-title"><Activity size={12}/> Relevance Score</div>
              {/* Progress bars */}
              {[
                ['Spatial', selectedWell.relevance.spatial_score],
                ['Depth', selectedWell.relevance.depth_score],
                ['Formation', selectedWell.relevance.formation_score],
                ['Events', selectedWell.relevance.event_density],
              ].map(([l, v]) => (
                <div key={l as string}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4, color: 'var(--text-3)' }}>
                    <span>{l as string}</span><span>{Math.round((v as number)*100)}%</span>
                  </div>
                  <div style={{ height: 4, background: 'var(--border)', borderRadius: 2 }}>
                    <div style={{ height: '100%', background: 'var(--blue)', width: `${(v as number)*100}%`, borderRadius: 2 }} />
                  </div>
                </div>
              ))}
              <div className="section-title" style={{ marginTop: 8 }}><FileText size={12}/> Historical Events</div>
              {selectedWell.relevant_events.map(e => (
                <div key={e.event_id} style={{ padding: 12, background: 'var(--surface2)', borderRadius: 'var(--r-md)', borderLeft: '2px solid var(--border-md)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span className={eventTypeBadge(e.event_type)}>{e.event_type.replace('_', ' ')}</span>
                    <span className={severityBadge(e.severity)}>{e.severity}</span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{fmtDepth(e.depth)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>{e.description}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="card" style={{ height: '100%' }}>
            <EmptyState icon={MapPin} msg="Click a well to view its profile and relevance score" />
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
//  RISK REASONING CHAIN — the decision pipeline visualised
// ════════════════════════════════════════════════════════════════════════════════
function RiskReasoningChain({
  activeWell, risks, nearbyWells
}: {
  activeWell: Well;
  risks: RiskPrediction[];
  nearbyWells: NearbyWell[];
}) {
  const eventColors: Record<string, string> = {
    MUD_LOSS:        'var(--amber)',
    TORQUE_SPIKE:    'var(--orange)',
    KICK:            'var(--red)',
    STUCK_PIPE:      '#f472b6',
    CEMENTING_ISSUE: 'var(--teal)',
  };

  // Flatten ALL events from nearby wells that are within ±150m of active depth
  const relevantEvents = useMemo(() => {
    const all: { event: typeof nearbyWells[0]['relevant_events'][0]; wellId: string; dist: number }[] = [];
    nearbyWells.forEach(nw => {
      nw.relevant_events.forEach(e => {
        if (Math.abs(e.depth - activeWell.current_depth) <= 150) {
          all.push({ event: e, wellId: nw.well.well_id, dist: nw.distance_km });
        }
      });
    });
    return all.sort((a, b) => a.event.depth - b.event.depth);
  }, [nearbyWells, activeWell.current_depth]);

  const nodeStyle: React.CSSProperties = {
    background: 'var(--surface2)',
    border: '1px solid var(--border-md)',
    borderRadius: 'var(--r-lg)',
    padding: '16px 20px',
    position: 'relative',
  };

  const connectorStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 0,
    margin: '2px 0',
  };

  const ArrowDown = () => (
    <div style={connectorStyle}>
      <div style={{ width: 2, height: 24, background: 'linear-gradient(var(--border-md), var(--blue-mid))' }} />
      <svg width="14" height="8" viewBox="0 0 14 8">
        <path d="M7 8 L0 0 L14 0 Z" fill="var(--blue)" opacity="0.6" />
      </svg>
    </div>
  );

  const NodeLabel = ({ text, sub }: { text: string; sub?: string }) => (
    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6 }}>
      {text}{sub && <span style={{ marginLeft: 8, color: 'var(--text-4)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{sub}</span>}
    </div>
  );

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 0, maxWidth: 780, margin: '0 auto 24px', width: '100%' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Shield size={12} style={{ color: 'var(--blue)' }} /> Risk Reasoning Chain
      </div>

      {/* NODE 1 — Active Well */}
      <div style={{ ...nodeStyle, borderLeft: '3px solid var(--blue)', background: 'linear-gradient(90deg, rgba(56,189,248,0.08), var(--surface2))' }}>
        <NodeLabel text="Active Well" sub="current drilling position" />
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-4)' }}>WELL ID</div>
            <div className="mono" style={{ fontSize: 16, fontWeight: 700, color: 'var(--blue)' }}>{activeWell.well_id}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-4)' }}>DEPTH</div>
            <div className="mono" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{fmtDepth(activeWell.current_depth)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-4)' }}>FORMATION</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--teal)' }}>{activeWell.current_formation}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 6px var(--green)' }} />
            <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>ACTIVE</span>
          </div>
        </div>
      </div>

      <ArrowDown />

      {/* NODE 2 — Analysis Radius */}
      <div style={{ ...nodeStyle, borderLeft: '3px solid var(--purple)' }}>
        <NodeLabel text="Analysis Radius" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: 'var(--purple)' }}>10 km</div>
          <div style={{ flex: 1 }}>
            <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: '100%', background: 'linear-gradient(90deg, var(--purple), var(--blue))', borderRadius: 3, animation: 'pulse 2s infinite' }} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 4 }}>{nearbyWells.length} offset wells found within radius</div>
          </div>
        </div>
      </div>

      <ArrowDown />

      {/* NODE 3 — Nearby Wells */}
      <div style={{ ...nodeStyle, borderLeft: '3px solid var(--teal)' }}>
        <NodeLabel text="Nearby Historical Wells" sub={`${nearbyWells.length} analysed by relevance`} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {nearbyWells.slice(0, 8).map(nw => (
            <div key={nw.well.well_id} style={{
              padding: '5px 10px', borderRadius: 'var(--r-md)',
              background: nw.relevance.label === 'HIGH' ? 'rgba(251,191,36,0.12)' : nw.relevance.label === 'MEDIUM' ? 'rgba(56,189,248,0.08)' : 'var(--surface)',
              border: `1px solid ${nw.relevance.label === 'HIGH' ? 'var(--amber-mid)' : nw.relevance.label === 'MEDIUM' ? 'var(--blue-mid)' : 'var(--border)'}`,
            }}>
              <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: nw.relevance.label === 'HIGH' ? 'var(--amber)' : nw.relevance.label === 'MEDIUM' ? 'var(--blue)' : 'var(--text-4)' }}>{nw.well.well_id}</div>
              <div style={{ fontSize: 10, color: 'var(--text-4)' }}>{nw.distance_km.toFixed(1)} km · {nw.relevance.label}</div>
            </div>
          ))}
          {nearbyWells.length > 8 && <div style={{ padding: '5px 10px', fontSize: 11, color: 'var(--text-4)', alignSelf: 'center' }}>+{nearbyWells.length - 8} more</div>}
        </div>
      </div>

      <ArrowDown />

      {/* NODE 4 — Events in risk horizon */}
      <div style={{ ...nodeStyle, borderLeft: '3px solid var(--orange)', background: 'linear-gradient(90deg, rgba(251,146,60,0.06), var(--surface2))' }}>
        <NodeLabel text="Events in Risk Horizon" sub={`±150 m from ${fmtDepth(activeWell.current_depth)}`} />
        {relevantEvents.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-4)' }}>No historical events in the current risk horizon.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {relevantEvents.map((item, i) => {
              const col = eventColors[item.event.event_type] || 'var(--text-3)';
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '8px 12px', background: 'var(--surface)', borderRadius: 'var(--r-md)', borderLeft: `3px solid ${col}` }}>
                  <div style={{ flexShrink: 0, width: 56, textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: 'var(--text-4)' }}>DEPTH</div>
                    <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: col }}>{fmtDepthN(item.event.depth)} m</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: col, background: `${col}1a`, padding: '2px 6px', borderRadius: 3, border: `1px solid ${col}44` }}>{item.event.event_type.replace('_', ' ')}</span>
                      <span className={severityBadge(item.event.severity)}>{item.event.severity}</span>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--text-4)', padding: '2px 6px', background: 'var(--surface2)', borderRadius: 3 }}>{item.wellId} · {item.dist.toFixed(1)} km</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>{item.event.description}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ArrowDown />

      {/* NODE 5 — Overlapping Risk Horizon */}
      <div style={{ ...nodeStyle, borderLeft: '3px solid var(--red)', background: 'linear-gradient(90deg, rgba(248,113,113,0.08), var(--surface2))' }}>
        <NodeLabel text="Overlapping Risk Horizon" />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {risks.map((r, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 14px', borderRadius: 'var(--r-md)',
              background: r.risk_level === 'CRITICAL' ? 'var(--red-light)' : 'rgba(249,115,22,0.1)',
              border: `1px solid ${r.risk_level === 'CRITICAL' ? 'var(--red-mid)' : 'rgba(249,115,22,0.3)'}`,
            }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: r.risk_level === 'CRITICAL' ? 'var(--red)' : 'var(--orange)', animation: 'pulse 1.5s infinite' }} />
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: r.risk_level === 'CRITICAL' ? 'var(--red)' : 'var(--orange)' }}>{r.risk_type.replace('_', ' ')}</div>
                <div style={{ fontSize: 10, color: 'var(--text-4)' }}>{fmtDepthN(r.interval_start)}–{fmtDepthN(r.interval_end)} m · Score {r.risk_score}/100</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <ArrowDown />

      {/* NODE 6 — Evidence + Source + Mitigation */}
      <div style={{ ...nodeStyle, borderLeft: '3px solid var(--green)', background: 'linear-gradient(90deg, rgba(74,222,128,0.06), var(--surface2))' }}>
        <NodeLabel text="Evidence · Source · Mitigation" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {risks.map((r, i) => (
            <div key={i} style={{ padding: '12px 16px', background: 'var(--surface)', borderRadius: 'var(--r-md)', borderTop: `2px solid ${r.risk_level === 'CRITICAL' ? 'var(--red)' : 'var(--orange)'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{r.risk_type.replace('_', ' ')}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <span className={`badge badge-${r.risk_level === 'CRITICAL' ? 'red' : 'orange'}`}>{r.risk_level}</span>
                  {r.ml_probability != null && <span className="badge badge-purple">ML {r.ml_probability}%</span>}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>📋 Evidence</div>
                  {r.contributing_factors.slice(0, 3).map((f, j) => (
                    <div key={j} style={{ display: 'flex', gap: 6, marginBottom: 5 }}>
                      <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--blue)', marginTop: 5, flexShrink: 0 }} />
                      <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.4 }}><strong style={{ color: 'var(--text-2)' }}>{f.factor}:</strong> {f.detail}</div>
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>🛡 Mitigation</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
                    {relevantEvents.find(e => e.event.event_type === r.risk_type)?.event.mitigation
                      || 'Monitor parameters closely. Consult offset well completion reports for formation-specific procedures.'}
                  </div>
                  {relevantEvents.find(e => e.event.event_type === r.risk_type) && (
                    <div style={{ marginTop: 6 }}>
                      <span className="source-ref">📄 {relevantEvents.find(e => e.event.event_type === r.risk_type)?.event.source_document}</span>
                      {relevantEvents.find(e => e.event.event_type === r.risk_type)?.event.source_page != null && (
                        <span style={{ fontSize: 10, color: 'var(--text-4)', marginLeft: 4 }}>p.{relevantEvents.find(e => e.event.event_type === r.risk_type)?.event.source_page}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RiskSection({ activeWell, risks, alerts, nearbyWells }: { activeWell: Well | null; risks: RiskPrediction[]; alerts: Alert[]; nearbyWells: NearbyWell[]; }) {
  if (!activeWell) return <Spinner />;
  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {alerts.map(a => (
        <div key={a.alert_id} className={`alert-banner ${a.severity === 'CRITICAL' ? 'critical' : ''}`}>
          <div className="alert-icon"><TriangleAlert size={20} /></div>
          <div className="alert-content">
            <div className="alert-title">{a.title}</div>
            <div className="alert-desc">{a.body}</div>
            {a.recommended_mitigation && <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 4, borderLeft: '2px solid var(--green)', fontSize: 12 }}><strong style={{ color: 'var(--green)' }}>Mitigation: </strong>{a.recommended_mitigation}</div>}
          </div>
        </div>
      ))}

      {/* Risk Reasoning Chain */}
      {risks.length > 0 && <RiskReasoningChain activeWell={activeWell} risks={risks} nearbyWells={nearbyWells} />}

      <div className="section-title"><Shield size={12}/> Detailed Risk Intelligence</div>
      <div className="grid-2">
        {risks.map((r, i) => (
          <div key={i} className="card interactive-card" style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className={`badge badge-${r.risk_level === 'CRITICAL' ? 'red' : 'orange'}`}>{r.risk_type.replace('_', ' ')}</span>
                {r.ml_probability != null && (
                  <span className="badge badge-purple">ML: {r.ml_probability}%</span>
                )}
              </div>
              <span className={`mono text-${r.risk_level}`} style={{ fontWeight: 700, fontSize: 16 }}>{r.risk_score}/100</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 12 }}>Zone: {fmtDepthN(r.interval_start)}–{fmtDepthN(r.interval_end)} m</div>
            <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5, marginBottom: 16 }}>{r.explanation}</div>
            {r.contributing_factors.map((f, j) => (
              <div key={j} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--text-4)', marginTop: 6 }} />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{f.factor}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{f.detail}</div>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function WellsSection({ wells }: { wells: Well[] }) {
  return (
    <div className="fade-in card">
      <div className="card-header"><span className="card-title">Well Explorer</span></div>
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead><tr><th>Well ID</th><th>Field</th><th>Status</th><th>Formation</th><th>Depth</th></tr></thead>
          <tbody>
            {wells.map(w => (
              <tr key={w.well_id}>
                <td className="mono" style={{ color: 'var(--blue)', fontWeight: 600 }}>{w.well_id}</td>
                <td>{w.field}</td>
                <td><span className={statusBadge(w.status)}>{w.status}</span></td>
                <td>{w.current_formation}</td>
                <td className="mono">{fmtDepthN(w.current_depth)} m</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KnowledgeSection({ events }: { events: WellEvent[] }) {
  return (
    <div className="fade-in grid-3">
      {events.slice(0, 12).map(e => (
        <div key={e.event_id} className="card interactive-card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <span className={eventTypeBadge(e.event_type)}>{e.event_type.replace('_', ' ')}</span>
            <span className={severityBadge(e.severity)}>{e.severity}</span>
          </div>
          <div className="mono" style={{ color: 'var(--blue)', fontSize: 12, marginBottom: 8 }}>{e.well_id} @ {fmtDepthN(e.depth)}m</div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, marginBottom: 12 }}>"{e.description}"</div>
          <div className="source-ref">{e.source_document}</div>
        </div>
      ))}
    </div>
  );
}

function SearchSection({ activeWellId }: { activeWellId: string }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async (q = query) => {
    if (!q.trim()) return;
    setLoading(true);
    try { const r = await searchKnowledge(q, activeWellId); setResults(r); }
    finally { setLoading(false); }
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="search-bar">
        <Search size={16} style={{ color: 'var(--text-4)' }} />
        <input className="search-input" placeholder='e.g. "mud loss at 2900m"' value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()} />
        <button className="btn btn-primary" onClick={() => run()}>Search</button>
      </div>
      {loading && <Spinner />}
      {results && !loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Found {results.total_results} results</div>
          {results.results.map((r, i) => r.event && (
            <div key={i} className="card interactive-card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', gap: 12, marginBottom: 8, alignItems: 'center' }}>
                <span className={eventTypeBadge(r.event.event_type)}>{r.event.event_type.replace('_', ' ')}</span>
                <span className="mono" style={{ color: 'var(--blue)' }}>{r.well_id}</span>
                <span className="badge badge-gray" style={{ marginLeft: 'auto' }}>Score {Math.round(r.relevance_score * 100)}%</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 12 }}>{r.highlight}</div>
              <div style={{ fontSize: 12, color: 'var(--text-4)' }}><strong style={{ color: 'var(--text-3)' }}>Mitigation: </strong>{r.event.mitigation}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
//  ANOMALY DETECTION SECTION
// ════════════════════════════════════════════════════════════════════════════════
function AnomalySection({ activeWellId }: { activeWellId: string }) {
  const [report, setReport] = useState<AnomalyReport | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getAnomalies(activeWellId).then(r => { setReport(r); setLoading(false); }).catch(() => setLoading(false));
  }, [activeWellId]);

  if (loading) return <Spinner label="Running anomaly detection…" />;
  if (!report) return <EmptyState icon={Activity} msg="No anomaly data" />;

  const sevColor = (s: string) => s === 'CRITICAL' ? 'var(--red)' : s === 'HIGH' ? 'var(--orange)' : s === 'MEDIUM' ? 'var(--amber)' : 'var(--green)';
  const sevBadge = (s: string) => s === 'CRITICAL' ? 'badge badge-red' : s === 'HIGH' ? 'badge badge-orange' : s === 'MEDIUM' ? 'badge badge-amber' : 'badge badge-green';

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ padding: 16, borderLeft: `3px solid ${report.total_anomalies > 0 ? 'var(--orange)' : 'var(--green)'}` }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Anomaly Detection Summary</div>
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{report.summary}</div>
        <div style={{ marginTop: 8 }}>
          <span className="badge badge-gray">{report.total_anomalies} anomalies detected</span>
          <span className="badge badge-blue" style={{ marginLeft: 8 }}>Well: {report.well_id}</span>
        </div>
      </div>

      <div className="section-title"><Activity size={12}/> Parameter Anomalies (Z-Score Analysis)</div>
      {report.anomalies.length === 0 ? (
        <EmptyState icon={CheckCircle2} msg="No anomalies detected — drilling parameters are within normal range." />
      ) : (
        <div className="grid-2">
          {report.anomalies.map((a, i) => (
            <div key={i} className="card interactive-card" style={{ padding: 16, borderLeft: `3px solid ${sevColor(a.severity)}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <span className={sevBadge(a.severity)}>{a.severity}</span>
                  <span className="badge badge-gray">{a.parameter}</span>
                </div>
                <span className="mono" style={{ color: 'var(--text-4)', fontSize: 11 }}>{fmtDepthN(a.depth_m)} m</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>{a.anomaly_type.replace(/_/g, ' ')}</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5, marginBottom: 10 }}>{a.narrative}</div>
              <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-4)' }}>
                <span>Value: <strong style={{ color: 'var(--text)' }}>{a.value}</strong></span>
                <span>Baseline: <strong style={{ color: 'var(--text)' }}>{a.baseline_mean}</strong></span>
                <span>Z-Score: <strong style={{ color: sevColor(a.severity) }}>{a.z_score}</strong></span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
//  AUDIT REPORT SECTION
// ════════════════════════════════════════════════════════════════════════════════
function AuditSection({ activeWellId, radius, simDepth }: { activeWellId: string; radius: number; simDepth: number }) {
  const [report, setReport] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getAuditReport(activeWellId, radius, simDepth)
      .then(r => { setReport(r); setLoading(false); })
      .catch(() => setLoading(false));
  }, [activeWellId, radius, simDepth]);

  if (loading) return <Spinner label="Generating audit report…" />;
  if (!report) return <EmptyState icon={FileText} msg="No audit data" />;

  const integrityColor = (s: string) => s === 'ALL_CONSISTENT' ? 'var(--green)' : s === 'REVIEW_REQUIRED' ? 'var(--orange)' : 'var(--text-4)';
  const integrityBadge = (s: string) => s === 'CONSISTENT' ? 'badge badge-green' : s === 'ML_HIGHER' || s === 'ML_LOWER' ? 'badge badge-orange' : 'badge badge-gray';

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: 1 }}>Audit Report ID</div>
            <div className="mono" style={{ fontSize: 13, color: 'var(--blue)', marginTop: 2 }}>{report.report_id}</div>
          </div>
          <span className="badge" style={{ background: 'var(--surface2)', color: integrityColor(report.overall_integrity_status), border: `1px solid ${integrityColor(report.overall_integrity_status)}` }}>
            {report.overall_integrity_status.replace(/_/g, ' ')}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {[
            ['Generated', new Date(report.generated_at).toLocaleTimeString()],
            ['Depth', `${report.current_depth_m} m`],
            ['Formation', report.current_formation],
            ['Offset Wells', report.offset_wells_analysed],
            ['Events Examined', report.total_events_examined],
            ['Engine', `v${report.engine_version}`],
            ['ML Active', report.ml_model_active ? 'YES' : 'NO'],
            ['Radius', `${report.radius_km} km`],
          ].map(([l, v]) => (
            <div key={l as string} style={{ background: 'var(--surface2)', padding: 10, borderRadius: 'var(--r-md)' }}>
              <div style={{ fontSize: 10, color: 'var(--text-4)', textTransform: 'uppercase' }}>{l as string}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginTop: 2 }}>{v as string}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="section-title"><Shield size={12}/> Per-Risk Decision Trail</div>
      {report.audit_entries.map((entry, i) => (
        <div key={i} className="card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <span className="badge badge-blue">{entry.risk_type.replace(/_/g, ' ')}</span>
              <span className={`badge badge-${entry.final_risk_level === 'CRITICAL' ? 'red' : entry.final_risk_level === 'HIGH' ? 'orange' : 'amber'}`}>{entry.final_risk_level}</span>
              <span className={integrityBadge(entry.integrity_check)}>{entry.integrity_check.replace(/_/g, ' ')}</span>
            </div>
            <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
              <span>Evidence: <strong style={{ color: 'var(--text)' }}>{entry.evidence_score}/100</strong></span>
              {entry.ml_probability != null && <span>ML: <strong style={{ color: 'var(--purple, #9b5de5)' }}>{entry.ml_probability}%</strong></span>}
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 10, padding: '8px 12px', background: 'var(--surface2)', borderRadius: 4 }}>{entry.decision_rationale}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {entry.contributing_factors.map((f, j) => (
              <span key={j} className="badge badge-gray" style={{ fontSize: 10 }}>{f}</span>
            ))}
          </div>
        </div>
      ))}
      <div style={{ fontSize: 11, color: 'var(--text-4)', padding: '8px 12px', borderLeft: '2px solid var(--border-md)', marginTop: 8 }}>{report.disclaimer}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
//  ROOT APP
// ════════════════════════════════════════════════════════════════════════════════
const NAV: { id: Section; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'overview',   label: 'Overview',          Icon: Gauge },
  { id: 'map',        label: 'Geospatial Map',    Icon: Globe },
  { id: 'risk',       label: 'Risk Intelligence', Icon: Shield },
  { id: 'anomaly',    label: 'Anomaly Detect.',   Icon: Activity },
  { id: 'audit',      label: 'Audit Report',      Icon: FileText },
  { id: 'wells',      label: 'Well Explorer',     Icon: Database },
  { id: 'knowledge',  label: 'Knowledge Base',    Icon: BookOpen },
  { id: 'search',     label: 'Search',            Icon: Search },
];

export default function App() {
  const [section, setSection] = useState<Section>('overview');
  const [activeWells, setActiveWells] = useState<Well[]>([]);
  const [activeWellId, setActiveWellId] = useState<string>('ACTIVE-001');
  const [activeWell, setActiveWell] = useState<Well | null>(null);

  const [simDepth, setSimDepth] = useState<number>(2850);
  const [simMin, setSimMin] = useState<number>(2600);
  const [simMax, setSimMax] = useState<number>(3200);

  const [radius, setRadius] = useState<number>(10);
  const [nearbyWells, setNearbyWells] = useState<NearbyWell[]>([]);
  const [risks, setRisks] = useState<RiskPrediction[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [riskZones, setRiskZones] = useState<HistoricalRiskZone[]>([]);
  const [events, setEvents] = useState<WellEvent[]>([]);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [allWells, setAllWells] = useState<Well[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Mouse spotlight tracker
  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      document.documentElement.style.setProperty('--mouse-x', `${e.clientX}px`);
      document.documentElement.style.setProperty('--mouse-y', `${e.clientY}px`);
    };
    window.addEventListener('mousemove', handleMove);
    return () => window.removeEventListener('mousemove', handleMove);
  }, []);

  useEffect(() => {
    getActiveWells().then(ws => {
      setActiveWells(ws);
      if (ws.length > 0 && !ws.find(w => w.well_id === activeWellId)) setActiveWellId(ws[0].well_id);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const w = activeWells.find(w => w.well_id === activeWellId);
    if (w) {
      setActiveWell(w);
      setSimDepth(w.current_depth);
      setSimMin(Math.max(0, w.current_depth - 300));
      setSimMax(w.total_depth);
    }
  }, [activeWellId, activeWells]);

  const refresh = useCallback(async (depth = simDepth, partial = false) => {
    setLoading(true);
    setError(null);
    try {
      const p: Promise<any>[] = [
        getNearbyWells(activeWellId, radius),
        getCurrentRisk(activeWellId, radius, depth),
        getAlerts(activeWellId, radius, depth),
        getRiskZones(activeWellId, radius),
      ];
      if (!partial) {
        p.push(getAllEvents({ limit: 50 }), getSystemStats(), import('./api').then(m => m.getWells()));
      }
      
      const res = await Promise.all(p);
      setNearbyWells(res[0]); setRisks(res[1]); setAlerts(res[2]); setRiskZones(res[3]);
      
      if (!partial) {
        setEvents(res[4]); setStats(res[5]); setAllWells(res[6]);
      }
    } catch (e: any) { 
      console.error(e); 
      setError(e.message || "Failed to communicate with the intelligence feed.");
    }
    finally { setLoading(false); }
  }, [activeWellId, radius, simDepth]);

  useEffect(() => { refresh(simDepth); }, [activeWellId, radius, refresh, simDepth]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDepthChange = (d: number) => {
    setSimDepth(d);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => refresh(d, true), 400);
  };

  return (
    <div className="app-shell">
      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-title">
            <FlaskConical size={18} style={{ color: 'var(--blue)' }} /> NWIS
          </div>
          <div className="sidebar-logo-sub">Operations Intelligence</div>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-group-label">Navigation</div>
          {NAV.map(({ id, label, Icon }) => (
            <button key={id} className={`nav-item ${section === id ? 'active' : ''}`} onClick={() => setSection(id)}>
              <Icon size={16} /> {label}
              {id === 'risk' && alerts.length > 0 && <span className="badge badge-red" style={{ marginLeft: 'auto' }}>{alerts.length}</span>}
            </button>
          ))}
        </nav>
        {/* POC SIMULATION IN SIDEBAR */}
        <div className="sim-panel">
          <div className="sim-label"><Activity size={12} style={{ color: 'var(--blue)' }}/> POC SIMULATION</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-4)' }}>
            <span>Target Depth</span>
            <span className="sim-val">{fmtDepthN(simDepth)} m</span>
          </div>
          <input type="range" className="sim-slider" min={simMin} max={simMax} step={25} value={simDepth} onChange={e => onDepthChange(+e.target.value)} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-4)' }}>
            <span>{fmtDepthN(simMin)}</span><span>{fmtDepthN(simMax)}</span>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <div className="main-content">
        <header className="topbar">
          <span className="topbar-section-title">{NAV.find(n => n.id === section)?.label}</span>
          <div className="topbar-divider" />
          <div className="well-selector">
            <span style={{ fontSize: 11, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>Active Well</span>
            <select value={activeWellId} onChange={e => setActiveWellId(e.target.value)}>
              {activeWells.map(w => <option key={w.well_id} value={w.well_id}>{w.well_id}</option>)}
            </select>
            <ChevronDown size={14} style={{ color: 'var(--blue)' }} />
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={() => refresh(simDepth)} disabled={loading}>
            <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            Refresh Feed
          </button>
        </header>

        <main className="page">
          {error ? (
            <div className="page-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <EmptyState icon={TriangleAlert} msg={`System Error: ${error}`} />
            </div>
          ) : (
            <div className="page-content">
              {section === 'overview' && (
                <OverviewSection activeWell={activeWell} simDepth={simDepth} stats={stats} risks={risks} alerts={alerts} nearbyWells={nearbyWells} riskZones={riskZones} radius={radius} />
              )}
            {section === 'map' && <MapSection activeWell={activeWell} nearbyWells={nearbyWells} radius={radius} onRadiusChange={setRadius} />}
            {section === 'risk' && <RiskSection activeWell={activeWell} risks={risks} alerts={alerts} nearbyWells={nearbyWells} />}
            {section === 'anomaly' && <AnomalySection activeWellId={activeWellId} />}
            {section === 'audit' && <AuditSection activeWellId={activeWellId} radius={radius} simDepth={simDepth} />}
            {section === 'wells' && <WellsSection wells={allWells} />}
            {section === 'knowledge' && <KnowledgeSection events={events} />}
            {section === 'search' && <SearchSection activeWellId={activeWellId} />}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
