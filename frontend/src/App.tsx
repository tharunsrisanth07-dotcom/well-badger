import React, { useEffect, useState, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import {
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, LineChart, Line, ReferenceLine,
} from 'recharts';
import {
  Activity, BookOpen, CheckCircle2,
  Database, FileText, Gauge, Globe, Info, MapPin, RefreshCw, Search,
  Shield, TriangleAlert, Layers, Navigation, ChevronDown,
  FlaskConical,
} from 'lucide-react';

import {
  getActiveWells, getNearbyWells, getCurrentRisk, getSystemStats,
  getAllEvents, getAlerts, getRiskZones, searchKnowledge, getWellEvents,
  getDrillingParameters,
  type Well, type NearbyWell, type RiskPrediction, type Alert,
  type WellEvent, type SystemStats, type HistoricalRiskZone,
  type DrillingParameter, type SearchResponse,
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
type Section = 'overview' | 'map' | 'risk' | 'wells' | 'knowledge' | 'search';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtDepth  = (d: number) => `${d.toLocaleString('en-IN', { maximumFractionDigits: 0 })} m`;
const fmtDepthN = (d: number) => d.toLocaleString('en-IN', { maximumFractionDigits: 0 });

function severityBadge(s: string) {
  const map: Record<string, string> = {
    CRITICAL: 'badge badge-red', HIGH: 'badge badge-amber',
    MEDIUM: 'badge badge-blue', LOW: 'badge badge-green',
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

function riskColor(level: string) {
  if (level === 'CRITICAL' || level === 'HIGH') return '#dc2626';
  if (level === 'MEDIUM') return '#d97706';
  return '#16a34a';
}

function evidenceBg(s: string) {
  if (s === 'Very Strong') return { background: '#f0fdf4', color: '#16a34a' };
  if (s === 'Strong')      return { background: '#eff6ff', color: '#2563eb' };
  if (s === 'Moderate')    return { background: '#fffbeb', color: '#d97706' };
  return { background: '#f1f5f9', color: '#64748b' };
}

// ── Map fly-to helper ─────────────────────────────────────────────────────────
function FlyTo({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  useEffect(() => { map.flyTo([lat, lon], 12, { duration: 1 }); }, [lat, lon]);
  return null;
}

// ── Spinner ───────────────────────────────────────────────────────────────────
const Spinner = ({ label = 'Loading data…' }) => (
  <div className="spinner-wrap">
    <div className="spinner" />
    <span style={{ fontSize: 12 }}>{label}</span>
  </div>
);

// ── Empty state ───────────────────────────────────────────────────────────────
const EmptyState = ({ icon: Icon, msg }: { icon: React.ComponentType<{ size?: number; className?: string }>; msg: string }) => (
  <div className="empty-state">
    <Icon size={36} className="empty-state-icon" />
    <p style={{ fontSize: 13 }}>{msg}</p>
  </div>
);

// ── Chart tooltip ─────────────────────────────────────────────────────────────
const ChartTip = ({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 12px', fontSize: 12, boxShadow: '0 4px 6px -1px rgba(0,0,0,.08)' }}>
      {label && <p style={{ color: '#64748b', marginBottom: 4 }}>{label}</p>}
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color || '#0f172a' }}><b>{p.name}:</b> {p.value}</p>
      ))}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════════
//  OVERVIEW SECTION
// ════════════════════════════════════════════════════════════════════════════════
function OverviewSection({
  activeWell, simDepth, stats, risks, alerts, nearbyWells, riskZones,
}: {
  activeWell: Well | null; simDepth: number; stats: SystemStats | null;
  risks: RiskPrediction[]; alerts: Alert[];
  nearbyWells: NearbyWell[]; riskZones: HistoricalRiskZone[];
}) {
  if (!activeWell) return <Spinner label="Loading active well…" />;

  const topRisk = risks[0];
  const activeAlert = alerts[0];
  const highRelevance = nearbyWells.filter(n => n.relevance.label === 'HIGH');


  // Unused – reserved for future chart implementation
  void simDepth;

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Active Alert */}
      {activeAlert && (
        <div className={`alert-panel ${activeAlert.severity === 'CRITICAL' ? 'alert-panel-critical' : 'alert-panel-warning'}`}>
          <div className={`alert-header ${activeAlert.severity !== 'CRITICAL' ? 'warning' : ''}`}>
            <TriangleAlert size={16} />
            <span className={`alert-title ${activeAlert.severity !== 'CRITICAL' ? 'warning' : ''}`}>{activeAlert.title}</span>
            <span style={{ marginLeft: 'auto' }}>
              <span className="alert-zone-pill">{fmtDepthN(activeAlert.risk_interval_start)}–{fmtDepthN(activeAlert.risk_interval_end)} m</span>
            </span>
          </div>
          <div className="alert-body">
            {activeAlert.body}
            {activeAlert.recommended_mitigation && (
              <div style={{ marginTop: 10, padding: '8px 12px', background: '#f0fdf4', borderRadius: 6, borderLeft: '3px solid #16a34a', fontSize: 12 }}>
                <strong style={{ color: '#16a34a' }}>Recommended action: </strong>{activeAlert.recommended_mitigation}
              </div>
            )}
          </div>
          {activeAlert.source_documents.length > 0 && (
            <div className="alert-footer">
              📄 Sources: {activeAlert.source_documents.map((d, i) => (
                <span key={i} className="source-ref" style={{ marginLeft: 4 }}>{d}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* KPI Row */}
      <div className="grid-4">
        <div className="kpi">
          <span className="kpi-label">Current Depth</span>
          <span className="kpi-value" style={{ color: '#2563eb' }}>{fmtDepthN(simDepth)}</span>
          <span className="kpi-sub">m · Target {fmtDepthN(activeWell.total_depth)} m</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Formation</span>
          <span className="kpi-value" style={{ fontSize: 18 }}>{activeWell.current_formation}</span>
          <span className="kpi-sub">Currently drilling</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Nearby Wells</span>
          <span className="kpi-value">{nearbyWells.length}</span>
          <span className="kpi-sub">{highRelevance.length} high relevance</span>
        </div>
        <div className="kpi" style={{ borderLeft: topRisk ? `3px solid ${riskColor(topRisk.risk_level)}` : undefined }}>
          <span className="kpi-label">Top Risk</span>
          <span className="kpi-value" style={{ fontSize: 18, color: topRisk ? riskColor(topRisk.risk_level) : '#64748b' }}>
            {topRisk ? `${topRisk.risk_score}/100` : '—'}
          </span>
          <span className="kpi-sub">{topRisk ? topRisk.risk_type.replace('_', ' ') : 'No risk identified'}</span>
        </div>
      </div>

      <div className="grid-2">
        {/* Left: Historical Risk Zones */}
        <div className="card">
          <div className="card-header">
            <span className="card-title"><Layers size={14} />Historical Risk Zones</span>
            <span className="badge badge-gray">{riskZones.length} zones</span>
          </div>
          <div style={{ padding: '0 4px' }}>
            {riskZones.length === 0 ? (
              <EmptyState icon={Shield} msg="No historical risk zones in current radius" />
            ) : riskZones.slice(0, 5).map((z, i) => {
              const distM = z.interval_start - simDepth;
              const isApproaching = distM > 0 && distM < 60;
              const isInside = z.interval_start <= simDepth && simDepth <= z.interval_end;
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 14px', borderBottom: '1px solid var(--border)',
                  background: isInside ? '#fef2f2' : isApproaching ? '#fffbeb' : 'white',
                }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: isInside ? '#dc2626' : isApproaching ? '#d97706' : '#94a3b8',
                  }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <span className={eventTypeBadge(z.risk_type)}>{z.risk_type.replace('_', ' ')}</span>
                      {isInside && <span className="badge badge-red">INSIDE ZONE</span>}
                      {isApproaching && !isInside && <span className="badge badge-amber">APPROACHING</span>}
                    </div>
                    <div style={{ fontSize: 12, color: '#334155' }}>
                      <span className="mono">{fmtDepthN(z.interval_start)}–{fmtDepthN(z.interval_end)} m</span>
                      <span style={{ color: '#64748b', marginLeft: 8 }}>· {z.formation} · {z.supporting_well_ids.length} wells</span>
                    </div>
                  </div>
                  {distM > 0 && !isInside && (
                    <span style={{ fontSize: 11, color: isApproaching ? '#d97706' : '#94a3b8', fontFamily: 'JetBrains Mono, monospace' }}>
                      {distM.toFixed(0)} m away
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: High-Relevance Nearby Wells */}
        <div className="card">
          <div className="card-header">
            <span className="card-title"><Navigation size={14} />High-Relevance Offset Wells</span>
          </div>
          <div style={{ padding: '0 4px' }}>
            {highRelevance.length === 0 ? (
              <EmptyState icon={MapPin} msg="No high-relevance offset wells found" />
            ) : highRelevance.slice(0, 5).map((nw, i) => (
              <div key={i} style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span className="mono" style={{ fontWeight: 700, color: '#2563eb', fontSize: 12 }}>{nw.well.well_id}</span>
                    <span className="badge badge-green">HIGH RELEVANCE</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#64748b' }}>{nw.distance_km.toFixed(1)} km</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>
                    {nw.well.formation} · {nw.relevant_events.length} events
                    {nw.relevant_events.slice(0, 2).map((e, j) => (
                      <span key={j} className={`${eventTypeBadge(e.event_type)}`} style={{ marginLeft: 6 }}>
                        {e.event_type.split('_')[0]} @{fmtDepthN(e.depth)}m
                      </span>
                    ))}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
                    {Math.round(nw.relevance.overall * 100)}
                  </div>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>relevance</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* System stats */}
      {stats && (
        <div className="card">
          <div className="card-header">
            <span className="card-title"><Database size={14} />Knowledge Repository</span>
          </div>
          <div className="card-body">
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              {[
                { label: 'Total Wells', v: stats.total_wells },
                { label: 'Historical Events', v: stats.total_events },
                { label: 'High/Critical Events', v: stats.high_severity_events },
                { label: 'Active Wells', v: stats.active_wells },
              ].map(({ label, v }, i) => (
                <div key={i} style={{ minWidth: 120 }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: '#0f172a' }}>{v}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>{label}</div>
                </div>
              ))}
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>Event Type Distribution</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {Object.entries(stats.event_type_breakdown).map(([k, v]) => (
                    <span key={k} className={eventTypeBadge(k)}>{k.replace('_', ' ')}: {v}</span>
                  ))}
                </div>
              </div>
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

  const getMarkerIcon = (nw: NearbyWell) => {
    const label = nw.relevance.label;
    if (label === 'HIGH') return HIGH_ICON;
    if (label === 'MEDIUM') return MED_ICON;
    return LOW_ICON;
  };

  return (
    <div className="fade-in" style={{ display: 'flex', gap: 14, height: 'calc(100vh - 120px)', minHeight: 500 }}>
      {/* Map */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Controls */}
        <div className="card" style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>Analysis Radius</span>
          <input type="range" min={5} max={30} value={radius} onChange={e => onRadiusChange(+e.target.value)}
            className="sim-slider" style={{ width: 140, margin: 0 }} />
          <span className="mono" style={{ color: '#2563eb', fontWeight: 700 }}>{radius} km</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#64748b' }}>
            🔴 Active well &nbsp; 🟠 High relevance &nbsp; 🟡 Medium &nbsp; 🔵 Low
          </span>
        </div>

        <MapContainer center={[activeWell.latitude, activeWell.longitude]} zoom={12}
          style={{ flex: 1, borderRadius: 12 }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap contributors" />
          <FlyTo lat={activeWell.latitude} lon={activeWell.longitude} />

          {/* Radius circle */}
          <Circle center={[activeWell.latitude, activeWell.longitude]}
            radius={radius * 1000}
            pathOptions={{ color: '#2563eb', fillColor: '#2563eb', fillOpacity: 0.05, dashArray: '6 4' }} />

          {/* Active well */}
          <Marker position={[activeWell.latitude, activeWell.longitude]} icon={ACTIVE_ICON}>
            <Popup>
              <div style={{ minWidth: 180, fontFamily: 'Inter, sans-serif' }}>
                <div style={{ fontWeight: 700, color: '#dc2626', marginBottom: 6 }}>🔴 {activeWell.well_id}</div>
                <div style={{ fontSize: 12 }}><b>Status:</b> ACTIVE</div>
                <div style={{ fontSize: 12 }}><b>Current Depth:</b> {fmtDepth(activeWell.current_depth)}</div>
                <div style={{ fontSize: 12 }}><b>Formation:</b> {activeWell.current_formation}</div>
                <div style={{ fontSize: 12 }}><b>Field:</b> {activeWell.field}</div>
              </div>
            </Popup>
          </Marker>

          {/* Nearby wells */}
          {nearbyWells.map(nw => (
            <Marker key={nw.well.well_id}
              position={[nw.well.latitude, nw.well.longitude]}
              icon={getMarkerIcon(nw)}
              eventHandlers={{ click: () => setSelectedWell(nw) }}>
              <Popup>
                <div style={{ minWidth: 200, fontFamily: 'Inter, sans-serif' }}>
                  <div style={{ fontWeight: 700, color: '#2563eb', marginBottom: 4 }}>{nw.well.well_id}</div>
                  <div style={{ fontSize: 12 }}><b>Distance:</b> {nw.distance_km.toFixed(2)} km</div>
                  <div style={{ fontSize: 12 }}><b>Formation:</b> {nw.well.formation}</div>
                  <div style={{ fontSize: 12 }}><b>Events:</b> {nw.relevant_events.length}</div>
                  <div style={{ fontSize: 12 }}><b>Relevance:</b> {nw.relevance.label} ({Math.round(nw.relevance.overall * 100)}%)</div>
                  <button
                    onClick={() => setSelectedWell(nw)}
                    style={{ marginTop: 8, padding: '4px 10px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}>
                    View Detail →
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {/* Side panel */}
      <div style={{ width: 320, flexShrink: 0 }}>
        {selectedWell ? (
          <div className="well-detail-panel">
            <div className="well-detail-header">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="well-id-large">{selectedWell.well.well_id}</span>
                <button onClick={() => setSelectedWell(null)}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#64748b', fontSize: 18 }}>×</button>
              </div>
              <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span className={statusBadge(selectedWell.well.status)}>{selectedWell.well.status}</span>
                <span className={`badge ${selectedWell.relevance.label === 'HIGH' ? 'rel-HIGH' : selectedWell.relevance.label === 'MEDIUM' ? 'rel-MEDIUM' : 'rel-LOW'}`}>
                  {selectedWell.relevance.label} RELEVANCE
                </span>
              </div>
            </div>

            <div style={{ padding: '14px 16px', overflowY: 'auto', flex: 1 }}>
              {/* Well meta */}
              <div style={{ marginBottom: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  ['Field', selectedWell.well.field],
                  ['Distance', `${selectedWell.distance_km.toFixed(2)} km`],
                  ['Formation', selectedWell.well.formation],
                  ['Total Depth', fmtDepth(selectedWell.well.total_depth)],
                ].map(([l, v]) => (
                  <div key={l} style={{ background: '#f8fafc', borderRadius: 6, padding: '8px 10px' }}>
                    <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>{l}</div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{v}</div>
                  </div>
                ))}
              </div>

              {/* Relevance breakdown */}
              <div style={{ marginBottom: 14 }}>
                <div className="section-title"><Activity size={12} />Relevance Score</div>
                {[
                  ['Spatial', selectedWell.relevance.spatial_score],
                  ['Depth', selectedWell.relevance.depth_score],
                  ['Formation', selectedWell.relevance.formation_score],
                  ['Events', selectedWell.relevance.event_density],
                ].map(([label, val]) => (
                  <div key={label as string} style={{ marginBottom: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2, color: '#64748b' }}>
                      <span>{label as string}</span>
                      <span>{Math.round((val as number) * 100)}%</span>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${(val as number) * 100}%`, background: '#2563eb' }} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Historical events */}
              <div className="section-title"><FileText size={12} />Historical Events</div>
              {selectedWell.relevant_events.length === 0 ? (
                <p style={{ fontSize: 12, color: '#94a3b8' }}>No events recorded.</p>
              ) : selectedWell.relevant_events.map(e => (
                <div key={e.event_id} style={{ marginBottom: 10, padding: '10px 12px', background: '#f8fafc', borderRadius: 8, borderLeft: '3px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span className={eventTypeBadge(e.event_type)}>{e.event_type.replace('_', ' ')}</span>
                    <span className={severityBadge(e.severity)}>{e.severity}</span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{fmtDepth(e.depth)} · {e.formation}</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{e.description}</div>
                  <div style={{ fontSize: 11, color: '#16a34a', marginTop: 4 }}>✓ {e.mitigation}</div>
                  <div style={{ marginTop: 4 }}>
                    <span className="source-ref">{e.source_document}{e.source_page ? ` p.${e.source_page}` : ''}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="card" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div className="card-header">
              <span className="card-title"><Info size={14} />Offset Well Details</span>
            </div>
            <EmptyState icon={MapPin} msg="Click a well on the map to view its profile, events, and relevance score" />
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
//  RISK SECTION
// ════════════════════════════════════════════════════════════════════════════════
function RiskSection({
  activeWell, risks, riskZones, simDepth, alerts,
}: {
  activeWell: Well | null; risks: RiskPrediction[]; riskZones: HistoricalRiskZone[];
  simDepth: number; alerts: Alert[];
}) {
  if (!activeWell) return <Spinner />;

  // Depth correlation data
  const depthItems: { depth: number; label: string; type: string; well: string; severity?: string }[] = [
    { depth: simDepth, label: `${activeWell.well_id} (Current)`, type: 'ACTIVE', well: activeWell.well_id },
  ];
  riskZones.forEach(z => {
    z.supporting_well_ids.forEach(wid => {
      depthItems.push({
        depth: z.interval_start,
        label: `${wid} — ${z.risk_type.replace('_', ' ')}`,
        type: z.risk_type,
        well: wid,
      });
    });
  });
  depthItems.sort((a, b) => a.depth - b.depth);

  const minDepth = Math.max(0, simDepth - 100);
  const maxDepth = simDepth + 200;

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Alerts */}
      {alerts.map((a, i) => (
        <div key={i} className={`alert-panel ${a.severity === 'CRITICAL' ? 'alert-panel-critical' : 'alert-panel-warning'}`}>
          <div className={`alert-header ${a.severity !== 'CRITICAL' ? 'warning' : ''}`}>
            <TriangleAlert size={15} />
            <span className={`alert-title ${a.severity !== 'CRITICAL' ? 'warning' : ''}`}>{a.title}</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: a.severity === 'CRITICAL' ? '#dc2626' : '#d97706' }}>
              {a.distance_to_zone_m > 0 ? `${a.distance_to_zone_m.toFixed(0)} m to zone` : 'INSIDE ZONE'}
            </span>
          </div>
          <div className="alert-body">
            {a.body}
            <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {a.supporting_wells.map(w => (
                <span key={w} className="badge badge-blue">{w}</span>
              ))}
            </div>
            {a.recommended_mitigation && (
              <div style={{ marginTop: 8, padding: '8px 12px', background: '#f0fdf4', borderRadius: 6, borderLeft: '3px solid #16a34a', fontSize: 12 }}>
                <b style={{ color: '#16a34a' }}>Recommended: </b>{a.recommended_mitigation}
              </div>
            )}
          </div>
          {a.source_documents.length > 0 && (
            <div className="alert-footer">
              📄 {a.source_documents.map((d, j) => <span key={j} className="source-ref" style={{ marginLeft: 4 }}>{d}</span>)}
            </div>
          )}
        </div>
      ))}

      <div className="grid-2">
        {/* Risk predictions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="section-title"><Shield size={12} />Risk Predictions · Historical Similarity Engine</div>
          {risks.length === 0 ? (
            <div className="card">
              <EmptyState icon={CheckCircle2} msg="No significant risks identified for current depth and radius" />
            </div>
          ) : risks.map((r, i) => {
            const clr = riskColor(r.risk_level);
            const ev = evidenceBg(r.evidence_strength);
            return (
              <div key={i} className="risk-card">
                <div className="risk-card-header" style={{ background: `${clr}08` }}>
                  <div>
                    <div className={`risk-type-label risk-text-${r.risk_level}`}>{r.risk_type.replace('_', ' ')}</div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                      Zone: <span className="mono">{fmtDepthN(r.interval_start)}–{fmtDepthN(r.interval_end)} m</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                    <div className={`risk-score-ring risk-${r.risk_level}`}>
                      <span className="score">{r.risk_score}</span>
                      <span className="max">/100</span>
                    </div>
                  </div>
                </div>

                <div style={{ padding: '12px 14px' }}>
                  {/* Explanation */}
                  <p style={{ fontSize: 12, color: '#334155', lineHeight: 1.5, marginBottom: 10 }}>{r.explanation}</p>

                  {/* Evidence strength */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <span style={{ fontSize: 11, color: '#64748b' }}>Evidence:</span>
                    <span style={{ ...ev, padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>
                      {r.evidence_strength}
                    </span>
                    <span style={{ fontSize: 11, color: '#64748b', marginLeft: 'auto' }}>
                      {r.supporting_wells.length} wells · {r.supporting_events.length} events
                    </span>
                  </div>

                  {/* Contributing factors */}
                  {r.contributing_factors.length > 0 && (
                    <div>
                      {r.contributing_factors.map((f, j) => (
                        <div key={j} className="factor-row">
                          <div className="factor-dot" />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, color: '#334155', fontSize: 12 }}>{f.factor}</div>
                            <div style={{ color: '#64748b', fontSize: 11 }}>{f.detail}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Supporting wells */}
                  {r.supporting_wells.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Supporting wells:</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {r.supporting_wells.map(w => <span key={w} className="badge badge-blue">{w}</span>)}
                      </div>
                    </div>
                  )}

                  {/* Mitigation */}
                  {r.recommended_mitigation && (
                    <div style={{ marginTop: 10, padding: '8px 12px', background: '#f0fdf4', borderRadius: 6, borderLeft: '3px solid #16a34a', fontSize: 12 }}>
                      <b style={{ color: '#16a34a' }}>Mitigation: </b>{r.recommended_mitigation}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Depth correlation */}
        <div>
          <div className="section-title"><Layers size={12} />Depth Correlation — Offset Events vs Active Well</div>
          <div className="card">
            <div style={{ padding: '14px 16px' }}>
              {depthItems.length < 2 ? (
                <EmptyState icon={Layers} msg="Insufficient offset-well data for depth correlation" />
              ) : (
                <>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 12 }}>
                    Showing {fmtDepthN(minDepth)}–{fmtDepthN(maxDepth)} m window
                  </div>
                  <div style={{ position: 'relative', paddingLeft: 50 }}>
                    {/* Axis */}
                    <div style={{
                      position: 'absolute', left: 22, top: 0, bottom: 0, width: 2,
                      background: '#e2e8f0',
                    }} />
                    {depthItems.filter(d => d.depth >= minDepth && d.depth <= maxDepth).map((item, i) => {
                      const isActive = item.type === 'ACTIVE';
                      return (
                        <div key={i} style={{ position: 'relative', marginBottom: 14 }}>
                          {/* Marker */}
                          <div style={{
                            position: 'absolute', left: -32, top: 0,
                            width: 14, height: 14, borderRadius: '50%',
                            border: `2px solid ${isActive ? '#2563eb' : riskColor('HIGH')}`,
                            background: isActive ? '#eff6ff' : '#fef2f2',
                            zIndex: 1,
                          }} />
                          <div style={{
                            paddingLeft: 8,
                            borderLeft: isActive ? '2px solid #2563eb' : `2px solid ${riskColor('HIGH')}`,
                            marginLeft: -4,
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span className="mono" style={{ fontSize: 12, fontWeight: isActive ? 700 : 400, color: isActive ? '#2563eb' : '#0f172a' }}>
                                {fmtDepth(item.depth)}
                              </span>
                              {!isActive && <span className={eventTypeBadge(item.type)}>{item.type.split('_')[0]}</span>}
                              {isActive && <span className="badge badge-blue">CURRENT</span>}
                            </div>
                            <div style={{ fontSize: 11, color: '#64748b' }}>{item.label}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
//  WELLS EXPLORER SECTION
// ════════════════════════════════════════════════════════════════════════════════
function WellsSection({ wells, nearbyWells }: { wells: Well[]; nearbyWells: NearbyWell[] }) {
  const [filter, setFilter] = useState('ALL');
  const [detailWell, setDetailWell] = useState<string | null>(null);
  const [wellEvents, setWellEvents] = useState<WellEvent[]>([]);
  const [wellParams, setWellParams] = useState<DrillingParameter[]>([]);

  const nearbyMap = Object.fromEntries(nearbyWells.map(nw => [nw.well.well_id, nw]));

  const filtered = wells.filter(w => filter === 'ALL' || w.status === filter);

  const openDetail = async (wid: string) => {
    setDetailWell(wid);
    const [evts, params] = await Promise.all([getWellEvents(wid), getDrillingParameters(wid, 60)]);
    setWellEvents(evts);
    setWellParams(params);
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Filters */}
      <div className="card" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>Filter:</span>
        {['ALL', 'ACTIVE', 'COMPLETED', 'SUSPENDED'].map(f => (
          <button key={f} className={`filter-btn ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>{f}</button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{filtered.length} wells</span>
      </div>

      <div className="grid-2">
        {/* Well table */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Well ID</th>
                  <th>Field</th>
                  <th>Status</th>
                  <th>Formation</th>
                  <th>Current / Total Depth</th>
                  <th>Relevance</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(w => {
                  const nw = nearbyMap[w.well_id];
                  return (
                    <tr key={w.well_id} onClick={() => openDetail(w.well_id)}
                      style={{ cursor: 'pointer', background: detailWell === w.well_id ? '#eff6ff' : undefined }}>
                      <td className="mono" style={{ color: '#2563eb', fontWeight: 600 }}>{w.well_id}</td>
                      <td>{w.field}</td>
                      <td><span className={statusBadge(w.status)}>{w.status}</span></td>
                      <td>{w.current_formation}</td>
                      <td className="mono">{fmtDepthN(w.current_depth)} / {fmtDepthN(w.total_depth)} m</td>
                      <td>
                        {nw ? (
                          <span className={`badge ${nw.relevance.label === 'HIGH' ? 'rel-HIGH' : nw.relevance.label === 'MEDIUM' ? 'rel-MEDIUM' : 'rel-LOW'}`}>
                            {nw.relevance.label}
                          </span>
                        ) : <span style={{ color: '#94a3b8', fontSize: 11 }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Well detail */}
        <div>
          {detailWell ? (
            <div className="card" style={{ overflow: 'hidden' }}>
              <div className="well-detail-header">
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="well-id-large">{detailWell}</span>
                  <button onClick={() => setDetailWell(null)}
                    style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 18, color: '#64748b' }}>×</button>
                </div>
              </div>
              <div style={{ padding: 14, overflow: 'auto', maxHeight: 500 }}>
                {/* Drilling params chart */}
                {wellParams.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div className="section-title"><Activity size={12} />Torque vs Depth</div>
                    <ResponsiveContainer width="100%" height={150}>
                      <LineChart data={wellParams}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="depth" tick={{ fontSize: 10 }} tickFormatter={v => `${v}m`} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip content={<ChartTip />} />
                        <ReferenceLine x={wellParams[wellParams.length - 1]?.depth} stroke="#2563eb" strokeDasharray="4 2" label={{ value: 'TD', position: 'top', fontSize: 10 }} />
                        <Line dataKey="torque" stroke="#dc2626" dot={false} name="Torque (kN·m)" strokeWidth={1.5} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Events */}
                <div className="section-title"><FileText size={12} />Historical Events ({wellEvents.length})</div>
                {wellEvents.length === 0 ? (
                  <p style={{ fontSize: 12, color: '#94a3b8' }}>No events recorded for this well.</p>
                ) : wellEvents.map(e => (
                  <div key={e.event_id} style={{ marginBottom: 8, padding: '10px 12px', background: '#f8fafc', borderRadius: 8, borderLeft: '3px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span className={eventTypeBadge(e.event_type)}>{e.event_type.replace('_', ' ')}</span>
                      <span className={severityBadge(e.severity)}>{e.severity}</span>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{fmtDepth(e.depth)} · {e.formation}</div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>{e.description}</div>
                    <div style={{ fontSize: 11, color: '#16a34a', marginTop: 3 }}>Mitigation: {e.mitigation}</div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>Outcome: {e.outcome}</div>
                    <div style={{ marginTop: 4 }}>
                      <span className="source-ref">{e.source_document}{e.source_page ? ` p.${e.source_page}` : ''}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="card" style={{ height: 300 }}>
              <EmptyState icon={Database} msg="Select a well to view drilling parameters and historical events" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
//  KNOWLEDGE BASE SECTION
// ════════════════════════════════════════════════════════════════════════════════
function KnowledgeSection({ events }: { events: WellEvent[] }) {
  const [sevFilter, setSevFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');

  const EVENT_TYPES = ['ALL', 'MUD_LOSS', 'STUCK_PIPE', 'KICK', 'TORQUE_SPIKE', 'CEMENTING_ISSUE'];
  const SEVERITIES  = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

  const filtered = events.filter(e => {
    const ms = sevFilter  === 'ALL' || e.severity   === sevFilter;
    const mt = typeFilter === 'ALL' || e.event_type === typeFilter;
    return ms && mt;
  });

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Filters */}
      <div className="card" style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Historical Event Knowledge Base</span>
          <span className="badge badge-blue">{filtered.length} records</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: '#64748b', alignSelf: 'center' }}>Severity:</span>
          {SEVERITIES.map(s => (
            <button key={s} className={`filter-btn ${sevFilter === s ? 'active' : ''}`} onClick={() => setSevFilter(s)}>{s}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: '#64748b', alignSelf: 'center' }}>Type:</span>
          {EVENT_TYPES.map(t => (
            <button key={t} className={`filter-btn ${typeFilter === t ? 'active' : ''}`} onClick={() => setTypeFilter(t)}>
              {t === 'ALL' ? 'ALL' : t.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      <div className="grid-auto">
        {filtered.map(e => (
          <div key={e.event_id} className="card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div>
                <span className={eventTypeBadge(e.event_type)}>{e.event_type.replace(/_/g, ' ')}</span>
                <div className="mono" style={{ fontSize: 12, color: '#2563eb', marginTop: 4 }}>{e.well_id}</div>
              </div>
              <span className={severityBadge(e.severity)}>{e.severity}</span>
            </div>

            <div style={{ fontSize: 12, color: '#334155', marginBottom: 10, lineHeight: 1.5 }}>
              "{e.description}"
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11, marginBottom: 10 }}>
              <div><span style={{ color: '#94a3b8' }}>Depth:</span> <span className="mono">{fmtDepth(e.depth)}</span></div>
              <div><span style={{ color: '#94a3b8' }}>Formation:</span> {e.formation}</div>
              <div><span style={{ color: '#94a3b8' }}>Date:</span> {new Date(e.date).toLocaleDateString()}</div>
              <div><span style={{ color: '#94a3b8' }}>Cause:</span> {e.cause.substring(0, 40)}…</div>
            </div>

            <div style={{ padding: '8px 10px', background: '#f0fdf4', borderRadius: 6, fontSize: 11, marginBottom: 8 }}>
              <div style={{ fontWeight: 700, color: '#16a34a', marginBottom: 3 }}>MITIGATION APPLIED</div>
              <div style={{ color: '#334155' }}>{e.mitigation}</div>
              <div style={{ color: '#64748b', marginTop: 4 }}>
                <span style={{ color: '#2563eb' }}>Outcome:</span> {e.outcome}
              </div>
            </div>

            <div>
              <span className="source-ref">{e.source_document}{e.source_page ? ` p.${e.source_page}` : ''}</span>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div style={{ gridColumn: '1/-1' }}>
            <div className="card">
              <EmptyState icon={Database} msg="No events match your filter criteria." />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
//  SEARCH SECTION
// ════════════════════════════════════════════════════════════════════════════════
function SearchSection({ activeWellId }: { activeWellId: string }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const EXAMPLES = [
    'mud loss at 2900m',
    'stuck pipe in Barail',
    'kick events WELL-115',
    'torque spike nearby',
    'show CRITICAL severity',
    'cementing issues',
  ];

  const run = async (q = query) => {
    if (!q.trim()) return;
    setLoading(true);
    try {
      const r = await searchKnowledge(q, activeWellId);
      setResults(r);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Search bar */}
      <div className="search-bar">
        <Search size={16} style={{ color: '#94a3b8', flexShrink: 0 }} />
        <input
          className="search-input"
          placeholder='e.g. "mud loss at 2900m" or "stuck pipe in Barail" or "what happened in WELL-103"'
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && run()}
        />
        <button className="search-btn" onClick={() => run()}>Search</button>
      </div>

      {/* Example queries */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>Examples:</span>
        {EXAMPLES.map(ex => (
          <button key={ex} onClick={() => { setQuery(ex); run(ex); }}
            style={{ padding: '3px 10px', border: '1px solid #e2e8f0', borderRadius: 20, background: '#fff', cursor: 'pointer', fontSize: 11, color: '#334155' }}>
            {ex}
          </button>
        ))}
      </div>

      {loading && <Spinner label="Searching knowledge base…" />}

      {/* Results */}
      {results && !loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{results.total_results} results</span>
            <span style={{ fontSize: 12, color: '#64748b' }}>for "{results.query}"</span>
            {Object.keys(results.filters_applied).length > 0 && (
              <div style={{ display: 'flex', gap: 4 }}>
                {Object.entries(results.filters_applied).map(([k, v]) => (
                  <span key={k} className="badge badge-teal">{k}: {String(v)}</span>
                ))}
              </div>
            )}
          </div>

          {results.results.length === 0 ? (
            <div className="card">
              <EmptyState icon={Search} msg="No results found. Try different keywords or broaden your search." />
            </div>
          ) : results.results.map((r, i) => r.event ? (
            <div key={i} className="card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={eventTypeBadge(r.event.event_type)}>{r.event.event_type.replace('_', ' ')}</span>
                  <span className={severityBadge(r.event.severity)}>{r.event.severity}</span>
                  <span className="mono" style={{ color: '#2563eb', fontSize: 12 }}>{r.well_id}</span>
                </div>
                <div style={{ display: 'flex', gap: 8, fontSize: 11, color: '#64748b' }}>
                  {r.distance_km != null && <span>{r.distance_km.toFixed(1)} km from active</span>}
                  <span style={{ color: '#2563eb', fontWeight: 600 }}>Score {Math.round(r.relevance_score * 100)}%</span>
                </div>
              </div>
              <div style={{ fontSize: 12, color: '#334155', marginBottom: 8 }}>{r.highlight}</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>
                <span style={{ fontWeight: 600 }}>Mitigation: </span>{r.event.mitigation}
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: '#64748b' }}>
                <span style={{ fontWeight: 600 }}>Outcome: </span>{r.event.outcome}
              </div>
              <div style={{ marginTop: 6 }}>
                <span className="source-ref">{r.event.source_document}{r.event.source_page ? ` p.${r.event.source_page}` : ''}</span>
              </div>
            </div>
          ) : null)}
        </div>
      )}

      {!results && !loading && (
        <div className="card" style={{ padding: 32 }}>
          <EmptyState icon={BookOpen} msg="Search the knowledge base for historical events, mitigations, and source documents" />
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
//  NAV ITEMS
// ════════════════════════════════════════════════════════════════════════════════
const NAV: { id: Section; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'overview',   label: 'Overview',         Icon: Gauge },
  { id: 'map',        label: 'Geospatial Map',   Icon: Globe },
  { id: 'risk',       label: 'Risk Intelligence', Icon: Shield },
  { id: 'wells',      label: 'Well Explorer',     Icon: Database },
  { id: 'knowledge',  label: 'Knowledge Base',    Icon: BookOpen },
  { id: 'search',     label: 'Search',            Icon: Search },
];

// ════════════════════════════════════════════════════════════════════════════════
//  ROOT APP
// ════════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [section, setSection] = useState<Section>('overview');

  // Active well
  const [activeWells, setActiveWells]   = useState<Well[]>([]);
  const [activeWellId, setActiveWellId] = useState<string>('ACTIVE-001');
  const [activeWell, setActiveWell]     = useState<Well | null>(null);

  // Simulation depth
  const [simDepth, setSimDepth]   = useState<number>(2850);
  const [simMin,   setSimMin]     = useState<number>(2600);
  const [simMax,   setSimMax]     = useState<number>(3200);

  // Radius
  const [radius, setRadius] = useState<number>(10);

  // Data
  const [nearbyWells, setNearbyWells] = useState<NearbyWell[]>([]);
  const [risks,       setRisks]       = useState<RiskPrediction[]>([]);
  const [alerts,      setAlerts]      = useState<Alert[]>([]);
  const [riskZones,   setRiskZones]   = useState<HistoricalRiskZone[]>([]);
  const [events,      setEvents]      = useState<WellEvent[]>([]);
  const [stats,       setStats]       = useState<SystemStats | null>(null);
  const [allWells,    setAllWells]    = useState<Well[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  // Load active wells
  useEffect(() => {
    getActiveWells().then(ws => {
      setActiveWells(ws);
      if (ws.length > 0 && !ws.find(w => w.well_id === activeWellId)) {
        setActiveWellId(ws[0].well_id);
      }
    });
  }, []);

  // When active well changes, update sim range
  useEffect(() => {
    const w = activeWells.find(w => w.well_id === activeWellId);
    if (w) {
      setActiveWell(w);
      setSimDepth(w.current_depth);
      setSimMin(Math.max(0, w.current_depth - 300));
      setSimMax(w.total_depth);
    }
  }, [activeWellId, activeWells]);

  const refresh = useCallback(async (depth = simDepth) => {
    setLoading(true);
    try {
      const [nw, rs, al, rz, evts, st, ws] = await Promise.all([
        getNearbyWells(activeWellId, radius),
        getCurrentRisk(activeWellId, radius, depth),
        getAlerts(activeWellId, radius, depth),
        getRiskZones(activeWellId, radius),
        getAllEvents({ limit: 150 }),
        getSystemStats(),
        import('./api').then(m => m.getWells()),
      ]);
      setNearbyWells(nw);
      setRisks(rs);
      setAlerts(al);
      setRiskZones(rz);
      setEvents(evts);
      setStats(st);
      setAllWells(ws);
      setLastRefresh(new Date());
    } catch (e) {
      console.error('API error:', e);
    } finally {
      setLoading(false);
    }
  }, [activeWellId, radius, simDepth]);

  // Initial load
  useEffect(() => { refresh(simDepth); }, [activeWellId, radius]);

  // Depth simulation — debounced refresh
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDepthChange = (d: number) => {
    setSimDepth(d);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => refresh(d), 600);
  };

  const topAlert = alerts[0];

  return (
    <div className="app-shell">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-title">⛽ NWIS</div>
          <div className="sidebar-logo-sub">Nearby Wells Intelligence System</div>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-group-label">Navigation</div>
          {NAV.map(({ id, label, Icon }) => (
            <button key={id} className={`nav-item ${section === id ? 'active' : ''}`} onClick={() => setSection(id)}>
              <Icon size={15} />
              {label}
              {id === 'risk' && alerts.length > 0 && (
                <span style={{ marginLeft: 'auto', background: '#dc2626', color: '#fff', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 10 }}>
                  {alerts.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Depth simulation */}
        <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
          <div className="sim-panel">
            <div className="sim-label">
              <FlaskConical size={12} />
              POC Simulation
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b', marginTop: 4 }}>
              <span>Depth</span>
              <span className="sim-current" style={{ fontSize: 14 }}>{fmtDepthN(simDepth)} m</span>
            </div>
            <input type="range" className="sim-slider" min={simMin} max={simMax} step={25}
              value={simDepth} onChange={e => onDepthChange(+e.target.value)} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#94a3b8' }}>
              <span>{fmtDepthN(simMin)} m</span>
              <span>{fmtDepthN(simMax)} m</span>
            </div>
          </div>
        </div>

        <div className="sidebar-bottom">
          Last refresh: {lastRefresh.toLocaleTimeString()}
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="main-content">
        {/* Topbar */}
        <header className="topbar">
          <span className="topbar-section-title">{NAV.find(n => n.id === section)?.label}</span>
          <div className="topbar-divider" />

          {/* Active well selector */}
          <div className="well-selector">
            <div className="pulse-dot" />
            <span style={{ fontSize: 11, color: '#64748b' }}>Active Well:</span>
            <select value={activeWellId} onChange={e => setActiveWellId(e.target.value)}>
              {activeWells.map(w => (
                <option key={w.well_id} value={w.well_id}>{w.well_id} — {w.name}</option>
              ))}
            </select>
            <ChevronDown size={12} style={{ color: '#94a3b8' }} />
          </div>

          {/* Context chips */}
          <div className="topbar-divider" />
          <div className="topbar-chip">
            <span>Depth:</span>
            <strong>{fmtDepthN(simDepth)} m</strong>
          </div>
          <div className="topbar-divider" />
          <div className="topbar-chip">
            <span>Formation:</span>
            <strong style={{ color: '#0891b2' }}>{activeWell?.current_formation ?? '—'}</strong>
          </div>

          {/* Alert chip */}
          {topAlert && (
            <>
              <div className="topbar-divider" />
              <button className="alert-badge" onClick={() => setSection('risk')}>
                <TriangleAlert size={12} />
                {alerts.length} alert{alerts.length > 1 ? 's' : ''}
              </button>
            </>
          )}

          <button className="refresh-btn" onClick={() => refresh(simDepth)}>
            <RefreshCw size={13} className={loading ? 'spinning' : ''} />
            Refresh
          </button>
        </header>

        {/* Page content */}
        <main className="page">
          {section === 'overview' && (
            <OverviewSection
              activeWell={activeWell} simDepth={simDepth} stats={stats}
              risks={risks} alerts={alerts} nearbyWells={nearbyWells} riskZones={riskZones}
            />
          )}
          {section === 'map' && (
            <MapSection activeWell={activeWell} nearbyWells={nearbyWells}
              radius={radius} onRadiusChange={r => setRadius(r)} />
          )}
          {section === 'risk' && (
            <RiskSection activeWell={activeWell} risks={risks} riskZones={riskZones}
              simDepth={simDepth} alerts={alerts} />
          )}
          {section === 'wells' && (
            <WellsSection wells={allWells} nearbyWells={nearbyWells} />
          )}
          {section === 'knowledge' && (
            <KnowledgeSection events={events} />
          )}
          {section === 'search' && (
            <SearchSection activeWellId={activeWellId} />
          )}
        </main>
      </div>
    </div>
  );
}
