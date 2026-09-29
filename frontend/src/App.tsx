import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import {
  Activity, BookOpen, ChevronDown, Database, FileText,
  Globe, Layers, MapPin, RefreshCw, Search,
  Shield, TriangleAlert, Gauge, Navigation,
  Zap,
} from 'lucide-react';

import {
  getActiveWells, getNearbyWells, getCurrentRisk, getSystemStats,
  getAllEvents, getAlerts, getRiskZones, searchKnowledge,
  getAnomalies, getAuditReport, getLatestTelemetry,
  type Well, type NearbyWell, type RiskPrediction, type Alert,
  type WellEvent, type SystemStats, type HistoricalRiskZone,
  type SearchResponse, type AnomalyReport, type AuditReport,
  type DrillingParameter,
} from './api';

// ── Leaflet icon fix ──────────────────────────────────────────────────
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

// ── Types ─────────────────────────────────────────────────────────────
type Section = 'overview' | 'map' | 'risk' | 'wells' | 'knowledge' | 'search' | 'anomaly' | 'audit';

// ── Helpers ───────────────────────────────────────────────────────────
const fmtN = (d: number) => d.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtDepth = (d: number) => `${fmtN(d)} m`;
const fmtVal = (v: number | null | undefined, dec = 1) =>
  v == null ? '—' : v.toFixed(dec);

function sevBadge(s: string) {
  const m: Record<string, string> = {
    CRITICAL: 'badge b-red', HIGH: 'badge b-orange',
    MEDIUM: 'badge b-amber', LOW: 'badge b-green',
  };
  return m[s] ?? 'badge b-gray';
}
function statusBadge(s: string) {
  const m: Record<string, string> = {
    ACTIVE: 'badge b-green', COMPLETED: 'badge b-cyan', SUSPENDED: 'badge b-amber',
  };
  return m[s] ?? 'badge b-gray';
}
function eventTypeBadge(et: string) {
  const m: Record<string, string> = {
    MUD_LOSS: 'badge b-teal', STUCK_PIPE: 'badge b-amber',
    KICK: 'badge b-red', TORQUE_SPIKE: 'badge b-purple',
    CEMENTING_ISSUE: 'badge b-blue',
  };
  return m[et] ?? 'badge b-gray';
}
function riskColor(level: string) {
  return level === 'CRITICAL' ? 'var(--red)' : level === 'HIGH' ? 'var(--orange)' : level === 'MEDIUM' ? 'var(--amber)' : 'var(--green)';
}
function riskBadgeClass(level: string) {
  return level === 'CRITICAL' ? 'badge b-red' : level === 'HIGH' ? 'badge b-orange' : level === 'MEDIUM' ? 'badge b-amber' : 'badge b-green';
}
function eventColor(et: string) {
  const m: Record<string, string> = {
    MUD_LOSS: 'var(--teal)', STUCK_PIPE: 'var(--amber)',
    KICK: 'var(--red)', TORQUE_SPIKE: 'var(--purple)',
    CEMENTING_ISSUE: 'var(--cyan)',
  };
  return m[et] ?? 'var(--text-4)';
}

// ── Map fly-to ────────────────────────────────────────────────────────
function FlyTo({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  useEffect(() => { map.flyTo([lat, lon], 12, { duration: 1 }); }, [lat, lon, map]);
  return null;
}

// ── Shared UI primitives ──────────────────────────────────────────────
const Spinner = ({ label = 'Loading…' }: { label?: string }) => (
  <div className="spinner-wrap">
    <div className="spinner" />
    <span style={{ fontSize: 11 }}>{label}</span>
  </div>
);

const EmptyState = ({ icon: Icon, msg }: { icon: React.ComponentType<{ size?: number }>; msg: string }) => (
  <div className="empty-state">
    <Icon size={32} />
    <span style={{ fontSize: 12 }}>{msg}</span>
  </div>
);

const SectionTitle = ({ icon: Icon, children }: { icon?: React.ComponentType<{ size?: number; style?: React.CSSProperties }>; children: React.ReactNode }) => (
  <div className="section-title">
    {Icon && <Icon size={11} style={{ color: 'var(--cyan)' }} />}
    {children}
  </div>
);

// ══════════════════════════════════════════════════════════════════════
// NAVIGATION CONFIG
// ══════════════════════════════════════════════════════════════════════
const NAV: { id: Section; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'overview',  label: 'Overview',          Icon: Gauge },
  { id: 'map',       label: 'Geospatial',        Icon: Globe },
  { id: 'risk',      label: 'Risk Intelligence', Icon: Shield },
  { id: 'wells',     label: 'Well Explorer',     Icon: Database },
  { id: 'knowledge', label: 'Knowledge Base',    Icon: BookOpen },
  { id: 'search',    label: 'Search',            Icon: Search },
  { id: 'anomaly',   label: 'Anomaly Detect',    Icon: Activity },
  { id: 'audit',     label: 'Audit Report',      Icon: FileText },
];

// ══════════════════════════════════════════════════════════════════════
// EVIDENCE DRAWER
// ══════════════════════════════════════════════════════════════════════
function EvidenceDrawer({ events, risk, onClose }: {
  events: WellEvent[];
  risk: RiskPrediction;
  onClose: () => void;
}) {
  const matching = events.filter(e =>
    e.event_type === risk.risk_type &&
    risk.supporting_events.includes(e.event_id)
  );

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-header">
          <div>
            <div className="drawer-title">Evidence — {risk.risk_type.replace(/_/g, ' ')}</div>
            <div style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 2 }}>
              {matching.length} source event{matching.length !== 1 ? 's' : ''} · Zone {fmtN(risk.interval_start)}–{fmtN(risk.interval_end)} m
            </div>
          </div>
          <button className="drawer-close" onClick={onClose}>×</button>
        </div>
        <div className="drawer-body">
          {/* Risk summary */}
          <div className="evidence-item" style={{ borderLeft: `3px solid ${riskColor(risk.risk_level)}` }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
              <span className={riskBadgeClass(risk.risk_level)}>{risk.risk_level}</span>
              <span className="badge b-gray">Score: {risk.risk_score}/100</span>
              {risk.ml_probability != null && <span className="badge b-purple">ML: {risk.ml_probability}%</span>}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6 }}>{risk.explanation}</div>
          </div>
          {/* Contributing factors */}
          <div>
            <SectionTitle icon={Activity}>Contributing Factors</SectionTitle>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {risk.contributing_factors.map((f, i) => (
                <div key={i} className="factor-row">
                  <div className="factor-dot" />
                  <div><span className="factor-name">{f.factor}: </span><span className="factor-detail">{f.detail}</span></div>
                </div>
              ))}
            </div>
          </div>
          {/* Source events */}
          <div>
            <SectionTitle icon={FileText}>Source Events ({matching.length})</SectionTitle>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {matching.map(e => (
                <div key={e.event_id} className="evidence-item" style={{ borderLeft: `3px solid ${eventColor(e.event_type)}` }}>
                  <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
                    <span className={eventTypeBadge(e.event_type)}>{e.event_type.replace(/_/g, ' ')}</span>
                    <span className={sevBadge(e.severity)}>{e.severity}</span>
                    <span className="mono text-xs" style={{ color: 'var(--cyan)' }}>{e.well_id}</span>
                  </div>
                  {[
                    ['Depth', fmtDepth(e.depth)],
                    ['Formation', e.formation],
                    ['Observation', e.description],
                    ['Cause', e.cause],
                    ['Mitigation', e.mitigation],
                    ['Outcome', e.outcome],
                  ].map(([k, v]) => v && (
                    <div key={k} className="evidence-row">
                      <div className="evidence-row-key">{k}</div>
                      <div className="evidence-row-val">{v}</div>
                    </div>
                  ))}
                  <div style={{ marginTop: 8 }}>
                    <span className="source-ref">📄 {e.source_document}{e.source_page != null ? ` p.${e.source_page}` : ''}</span>
                  </div>
                </div>
              ))}
              {matching.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-4)', padding: 12 }}>
                  Supporting event records are available in the risk engine for event IDs: {risk.supporting_events.slice(0,5).join(', ')}{risk.supporting_events.length > 5 ? '…' : ''}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════
// OVERVIEW SECTION
// ══════════════════════════════════════════════════════════════════════
function OverviewSection({
  activeWell, simDepth, stats, risks, alerts, nearbyWells, riskZones, events,
}: {
  activeWell: Well | null; simDepth: number; stats: SystemStats | null;
  risks: RiskPrediction[]; alerts: Alert[];
  nearbyWells: NearbyWell[]; riskZones: HistoricalRiskZone[];
  events: WellEvent[];
}) {
  const [telemetry, setTelemetry] = useState<DrillingParameter | null>(null);
  const [drawerRisk, setDrawerRisk] = useState<RiskPrediction | null>(null);

  useEffect(() => {
    if (!activeWell) return;
    getLatestTelemetry(activeWell.well_id, simDepth)
      .then(rows => { if (rows.length > 0) setTelemetry(rows[0]); })
      .catch(() => {});
  }, [activeWell, simDepth]);

  if (!activeWell) return <Spinner label="Loading active well…" />;

  const topRisk = risks[0];

  // Build risk horizon rows: combine riskZones + current depth marker
  const allDepths = [
    ...riskZones.map(z => z.interval_start),
    ...riskZones.map(z => z.interval_end),
    simDepth,
  ];
  const depthMax = Math.max(...allDepths) + 60;

  // Merge riskZones that share start depth for horizon
  const horizonItems = [
    { depth: simDepth, label: 'CURRENT BIT POSITION', interval: '', severity: 'active', type: '', color: 'var(--cyan)' },
    ...riskZones.map(z => ({
      depth: z.interval_start,
      label: z.risk_type.replace(/_/g, ' '),
      interval: `${fmtN(z.interval_start)}–${fmtN(z.interval_end)} m`,
      severity: '',
      type: z.risk_type,
      color: eventColor(z.risk_type),
    })),
  ].sort((a, b) => a.depth - b.depth);

  return (
    <div className="section-enter" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ── Alerts ── */}
      {alerts.slice(0, 1).map(a => (
        <div key={a.alert_id} className={`alert-strip ${a.severity === 'CRITICAL' ? 'critical' : ''}`}>
          <TriangleAlert size={16} className="alert-strip-icon" />
          <div style={{ flex: 1 }}>
            <div className="alert-strip-title">{a.title}</div>
            <div className="alert-strip-body">{a.body}</div>
            {a.recommended_mitigation && (
              <div className="alert-mitigation"><strong style={{ color: 'var(--green)' }}>Mitigation: </strong>{a.recommended_mitigation}</div>
            )}
          </div>
          <span className="badge b-gray" style={{ alignSelf: 'flex-start', flexShrink: 0 }}>{a.distance_to_zone_m} m to zone</span>
        </div>
      ))}

      {/* ── Telemetry strip ── */}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title"><Zap size={11} className="panel-title-icon" style={{ color: 'var(--cyan)' }} />Live Drilling Parameters</div>
          <div className="flex items-center gap-2">
            <div className="feed-dot" />
            <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Simulated</span>
          </div>
        </div>
        <div className="telem-grid">
          {[
            { label: 'Depth', val: fmtN(simDepth), unit: 'm', color: 'var(--cyan)' },
            { label: 'ROP', val: fmtVal(telemetry?.rop), unit: 'm/hr' },
            { label: 'WOB', val: fmtVal(telemetry?.wob), unit: 'kN' },
            { label: 'RPM', val: fmtVal(telemetry?.rpm, 0), unit: 'rpm' },
            { label: 'Torque', val: fmtVal(telemetry?.torque), unit: 'kN·m' },
            { label: 'SPP', val: fmtVal(telemetry?.pressure, 0), unit: 'psi' },
            { label: 'Mud Wt', val: fmtVal(telemetry?.mud_weight, 2), unit: 'SG' },
          ].map(({ label, val, unit, color }) => (
            <div key={label} className="telem-cell">
              <div className="telem-label">{label}</div>
              <div className="telem-value" style={color ? { color } : {}}>{val}</div>
              <div className="telem-unit">{unit}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Main 2-col: Risk Horizon + Primary Risk ── */}
      <div className="g2" style={{ gridTemplateColumns: '1fr 360px', alignItems: 'start' }}>

        {/* Risk Horizon */}
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title"><Layers size={11} className="panel-title-icon" style={{ color: 'var(--orange)' }} />Risk Horizon — Depth Ahead</div>
            <span className="badge b-gray">{riskZones.length} zones</span>
          </div>
          <div className="panel-body" style={{ paddingBottom: 20 }}>
            {riskZones.length === 0 ? (
              <EmptyState icon={Layers} msg="No historical risk zones in current radius" />
            ) : (
              <div className="risk-horizon">
                <div className="rh-spine" />
                {horizonItems.map((item, i) => (
                  <div key={i} className="rh-row">
                    <div className="rh-depth">{fmtN(item.depth)}</div>
                    <div className="rh-dot" style={{
                      background: item.color,
                      ...(item.severity === 'active' ? { color: item.color } : {}),
                    }} />
                    <div className="rh-card" style={{
                      borderLeft: `2px solid ${item.color}`,
                      ...(item.severity === 'active' ? { background: 'rgba(34,211,238,0.06)', borderLeftColor: 'var(--cyan)' } : {}),
                    }}>
                      <div className="rh-event-type" style={{ color: item.color }}>{item.label}</div>
                      {item.interval && <div className="rh-interval">{item.interval}</div>}
                    </div>
                  </div>
                ))}
                <div className="rh-row">
                  <div className="rh-depth" style={{ color: 'var(--text-5)' }}>{fmtN(depthMax)}</div>
                  <div className="rh-dot" style={{ background: 'var(--border-2)' }} />
                  <div className="rh-card" style={{ opacity: 0.4 }}>
                    <div className="rh-event-type" style={{ color: 'var(--text-4)' }}>End of Horizon</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right column: Primary Risk + Analog Wells */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Primary Risk */}
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title"><Shield size={11} style={{ color: 'var(--red)' }} />Primary Risk</div>
            </div>
            {topRisk ? (
              <div>
                <div style={{
                  padding: '14px 16px',
                  background: `${riskColor(topRisk.risk_level)}0f`,
                  borderBottom: '1px solid var(--border)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <div className="risk-card-type" style={{ color: riskColor(topRisk.risk_level), fontSize: 14 }}>
                      {topRisk.risk_type.replace(/_/g, ' ')}
                    </div>
                    <div style={{ display: 'flex', gap: 5 }}>
                      <span className={riskBadgeClass(topRisk.risk_level)}>{topRisk.risk_level}</span>
                      {topRisk.ml_probability != null && <span className="badge b-purple">ML {topRisk.ml_probability}%</span>}
                    </div>
                  </div>
                  <div className="mono" style={{ fontSize: 28, fontWeight: 700, color: riskColor(topRisk.risk_level), lineHeight: 1 }}>
                    {topRisk.risk_score}<span style={{ fontSize: 14, color: 'var(--text-4)', fontWeight: 400 }}>/100</span>
                  </div>
                </div>
                <div className="panel-body-sm">
                  {[
                    ['Zone', `${fmtN(topRisk.interval_start)}–${fmtN(topRisk.interval_end)} m`],
                    ['Supporting Wells', String(topRisk.supporting_wells.length)],
                    ['Evidence', topRisk.evidence_strength],
                  ].map(([k, v]) => (
                    <div key={k} className="risk-row">
                      <span className="risk-row-label">{k}</span>
                      <span className="risk-row-val">{v}</span>
                    </div>
                  ))}
                  <div className="risk-explanation">{topRisk.explanation}</div>
                  <button className="btn btn-primary" style={{ width: '100%', marginTop: 10, justifyContent: 'center' }}
                    onClick={() => setDrawerRisk(topRisk)}>
                    View Evidence
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ padding: 20 }}>
                <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)' }} />
                  <span style={{ color: 'var(--green)', fontWeight: 600, fontSize: 12 }}>No Major Risks Identified</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-4)' }}>Nominal historical risk patterns at current depth and radius.</div>
              </div>
            )}
          </div>

          {/* Analog Wells */}
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title"><Navigation size={11} style={{ color: 'var(--cyan)' }} />Analog Wells</div>
              <span className="badge b-cyan">{nearbyWells.length} in radius</span>
            </div>
            <div className="panel-body-sm" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {nearbyWells.length === 0
                ? <EmptyState icon={MapPin} msg="No offset wells in radius" />
                : nearbyWells.slice(0, 6).map(nw => {
                    const pct = Math.round(nw.relevance.overall * 100);
                    const col = nw.relevance.label === 'HIGH' ? 'var(--amber)' : nw.relevance.label === 'MEDIUM' ? 'var(--cyan)' : 'var(--text-4)';
                    const tags = [
                      nw.relevance.formation_score > 0.6 && 'FORMATION',
                      nw.relevance.depth_score > 0.6 && 'DEPTH',
                      nw.relevance.spatial_score > 0.6 && 'SPATIAL',
                      nw.relevant_events.length > 0 && 'EVENTS',
                    ].filter(Boolean) as string[];
                    return (
                      <div key={nw.well.well_id} className="analog-row">
                        <div className="analog-id">{nw.well.well_id}</div>
                        <div className="analog-bar-track">
                          <div className="analog-bar-fill" style={{ width: `${pct}%`, background: col }} />
                        </div>
                        <div className="analog-pct" style={{ color: col }}>{pct}%</div>
                        <div className="analog-tags">
                          {tags.slice(0, 2).map(t => <span key={t} className="analog-tag">{t}</span>)}
                        </div>
                      </div>
                    );
                  })
              }
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom row: Map preview + Stats ── */}
      <div className="g2" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
        {/* Mini map */}
        <div className="panel" style={{ overflow: 'hidden' }}>
          <div className="panel-header">
            <div className="panel-title"><Globe size={11} style={{ color: 'var(--cyan)' }} />Geospatial Context</div>
            <span className="badge b-gray">{(nearbyWells[0]?.distance_km ?? 0).toFixed(0)}–{(nearbyWells[nearbyWells.length - 1]?.distance_km ?? 10).toFixed(0)} km span</span>
          </div>
          <div style={{ height: 220 }}>
            <MapContainer center={[activeWell.latitude, activeWell.longitude]} zoom={11} style={{ width: '100%', height: '100%' }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="" />
              <FlyTo lat={activeWell.latitude} lon={activeWell.longitude} />
              <Circle center={[activeWell.latitude, activeWell.longitude]} radius={10 * 1000}
                pathOptions={{ color: 'rgba(34,211,238,0.5)', fillColor: 'rgba(34,211,238,0.05)', dashArray: '5 4' }} />
              <Marker position={[activeWell.latitude, activeWell.longitude]} icon={ACTIVE_ICON} />
              {nearbyWells.slice(0, 8).map(nw => (
                <Marker key={nw.well.well_id} position={[nw.well.latitude, nw.well.longitude]}
                  icon={nw.relevance.label === 'HIGH' ? HIGH_ICON : nw.relevance.label === 'MEDIUM' ? MED_ICON : LOW_ICON} />
              ))}
            </MapContainer>
          </div>
        </div>

        {/* System knowledge stats */}
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title"><Database size={11} style={{ color: 'var(--cyan)' }} />Evidence Store</div>
          </div>
          <div className="panel-body-sm">
            {stats ? (
              <>
                <div className="g2" style={{ gap: 8, marginBottom: 12 }}>
                  {[
                    { label: 'Total Wells', val: stats.total_wells, color: 'var(--cyan)' },
                    { label: 'Active', val: stats.active_wells, color: 'var(--green)' },
                    { label: 'Historical Events', val: stats.total_events, color: 'var(--text)' },
                    { label: 'High/Critical', val: stats.high_severity_events, color: 'var(--orange)' },
                  ].map(({ label, val, color }) => (
                    <div key={label} className="metric-card">
                      <div className="metric-label">{label}</div>
                      <div className="metric-value" style={{ color, fontSize: 20 }}>{val}</div>
                    </div>
                  ))}
                </div>
                <SectionTitle icon={Activity}>Event Distribution</SectionTitle>
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {Object.entries(stats.event_type_breakdown).map(([k, v]) => {
                    const pct = Math.round((v / stats.total_events) * 100);
                    return (
                      <div key={k} className="flex items-center gap-2">
                        <div style={{ width: 80, fontSize: 10, color: 'var(--text-4)', flexShrink: 0 }}>
                          {k.replace(/_/g, ' ')}
                        </div>
                        <div style={{ flex: 1, height: 4, background: 'var(--border)', borderRadius: 2 }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: eventColor(k), borderRadius: 2 }} />
                        </div>
                        <div className="mono" style={{ fontSize: 10, color: 'var(--text-3)', width: 24, textAlign: 'right' }}>{v}</div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : <Spinner />}
          </div>
        </div>
      </div>

      {/* Evidence drawer */}
      {drawerRisk && <EvidenceDrawer events={events} risk={drawerRisk} onClose={() => setDrawerRisk(null)} />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// GEOSPATIAL SECTION
// ══════════════════════════════════════════════════════════════════════
function GeospatialSection({ activeWell, nearbyWells, radius, onRadiusChange }: {
  activeWell: Well | null; nearbyWells: NearbyWell[];
  radius: number; onRadiusChange: (r: number) => void;
}) {
  const [selected, setSelected] = useState<NearbyWell | null>(null);
  if (!activeWell) return <Spinner />;

  return (
    <div className="section-enter" style={{ display: 'flex', gap: 14, height: 'calc(100vh - 120px)', minHeight: 540 }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Radius controls */}
        <div className="panel" style={{ padding: '10px 16px' }}>
          <div className="flex items-center gap-4">
            <SectionTitle icon={Globe}>Spatial Analysis</SectionTitle>
            <div className="flex items-center gap-3" style={{ marginLeft: 'auto' }}>
              <span className="text-xs text-muted">Analysis Radius</span>
              <input type="range" min={5} max={30} value={radius} onChange={e => onRadiusChange(+e.target.value)}
                className="sim-slider" style={{ width: 120, margin: 0 }} />
              <span className="mono text-cyan font-bold" style={{ fontSize: 13, width: 50 }}>{radius} km</span>
            </div>
            <span className="badge b-cyan">{nearbyWells.length} offset wells</span>
          </div>
        </div>
        <MapContainer center={[activeWell.latitude, activeWell.longitude]} zoom={12}
          style={{ flex: 1, borderRadius: 'var(--r-lg)', zIndex: 1 }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="" />
          <FlyTo lat={activeWell.latitude} lon={activeWell.longitude} />
          <Circle center={[activeWell.latitude, activeWell.longitude]} radius={radius * 1000}
            pathOptions={{ color: 'rgba(34,211,238,0.6)', fillColor: 'rgba(34,211,238,0.04)', dashArray: '6 4' }} />
          <Marker position={[activeWell.latitude, activeWell.longitude]} icon={ACTIVE_ICON}>
            <Popup>
              <div style={{ fontFamily: 'Inter, sans-serif' }}>
                <div style={{ fontWeight: 700, color: 'var(--red)', marginBottom: 4 }}>● {activeWell.well_id}</div>
                <div style={{ fontSize: 12 }}><b>Status:</b> ACTIVE</div>
                <div style={{ fontSize: 12 }}><b>Depth:</b> {fmtDepth(activeWell.current_depth)}</div>
                <div style={{ fontSize: 12 }}><b>Formation:</b> {activeWell.current_formation}</div>
              </div>
            </Popup>
          </Marker>
          {nearbyWells.map(nw => (
            <Marker key={nw.well.well_id} position={[nw.well.latitude, nw.well.longitude]}
              icon={nw.relevance.label === 'HIGH' ? HIGH_ICON : nw.relevance.label === 'MEDIUM' ? MED_ICON : LOW_ICON}
              eventHandlers={{ click: () => setSelected(nw) }}>
              <Popup>
                <div style={{ fontFamily: 'Inter, sans-serif' }}>
                  <div style={{ fontWeight: 700, color: 'var(--cyan)', marginBottom: 4 }}>{nw.well.well_id}</div>
                  <div style={{ fontSize: 12 }}><b>Distance:</b> {nw.distance_km.toFixed(2)} km</div>
                  <div style={{ fontSize: 12 }}><b>Relevance:</b> {nw.relevance.label} ({Math.round(nw.relevance.overall * 100)}%)</div>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {/* Side panel */}
      <div style={{ width: 300, flexShrink: 0 }}>
        {selected ? (
          <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div className="panel-header">
              <div>
                <div className="mono text-cyan font-bold" style={{ fontSize: 14 }}>{selected.well.well_id}</div>
                <div style={{ fontSize: 10, color: 'var(--text-4)' }}>{selected.distance_km.toFixed(2)} km · {selected.well.field}</div>
              </div>
              <button className="drawer-close" onClick={() => setSelected(null)}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span className={`badge ${selected.relevance.label === 'HIGH' ? 'b-amber' : selected.relevance.label === 'MEDIUM' ? 'b-cyan' : 'b-gray'}`}>
                {selected.relevance.label} RELEVANCE
              </span>
              <div className="g2" style={{ gap: 8 }}>
                <div className="metric-card">
                  <div className="metric-label">Distance</div>
                  <div className="metric-value cyan" style={{ fontSize: 16 }}>{selected.distance_km.toFixed(1)}<span className="metric-unit">km</span></div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">Formation</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--teal)', marginTop: 4 }}>{selected.well.formation}</div>
                </div>
              </div>
              <div>
                <SectionTitle icon={Activity}>Relevance Breakdown</SectionTitle>
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[
                    ['Spatial', selected.relevance.spatial_score],
                    ['Depth', selected.relevance.depth_score],
                    ['Formation', selected.relevance.formation_score],
                    ['Event Density', selected.relevance.event_density],
                  ].map(([l, v]) => (
                    <div key={l as string}>
                      <div className="flex justify-between" style={{ fontSize: 10, marginBottom: 3 }}>
                        <span style={{ color: 'var(--text-4)' }}>{l as string}</span>
                        <span className="mono" style={{ color: 'var(--text-3)' }}>{Math.round((v as number)*100)}%</span>
                      </div>
                      <div style={{ height: 3, background: 'var(--border)', borderRadius: 2 }}>
                        <div style={{ height: '100%', background: 'var(--cyan)', width: `${(v as number)*100}%`, borderRadius: 2 }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {selected.relevant_events.length > 0 && (
                <div>
                  <SectionTitle icon={FileText}>Historical Events ({selected.relevant_events.length})</SectionTitle>
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {selected.relevant_events.map(e => (
                      <div key={e.event_id} style={{ padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 'var(--r-md)', borderLeft: `2px solid ${eventColor(e.event_type)}` }}>
                        <div className="flex justify-between" style={{ marginBottom: 4 }}>
                          <span className={eventTypeBadge(e.event_type)}>{e.event_type.replace(/_/g, ' ')}</span>
                          <span className={sevBadge(e.severity)}>{e.severity}</span>
                        </div>
                        <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>{fmtDepth(e.depth)}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 3 }}>{e.description}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="panel" style={{ height: '100%' }}>
            <EmptyState icon={MapPin} msg="Click a well marker to view its profile and relevance analysis" />
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// RISK INTELLIGENCE SECTION
// ══════════════════════════════════════════════════════════════════════
function RiskSection({ activeWell, risks, alerts, nearbyWells, events }: {
  activeWell: Well | null; risks: RiskPrediction[]; alerts: Alert[];
  nearbyWells: NearbyWell[]; events: WellEvent[];
}) {
  const [drawerRisk, setDrawerRisk] = useState<RiskPrediction | null>(null);
  if (!activeWell) return <Spinner />;

  return (
    <div className="section-enter" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Alerts */}
      {alerts.map(a => (
        <div key={a.alert_id} className={`alert-strip ${a.severity === 'CRITICAL' ? 'critical' : ''}`}>
          <TriangleAlert size={15} className="alert-strip-icon" />
          <div style={{ flex: 1 }}>
            <div className="alert-strip-title">{a.title}</div>
            <div className="alert-strip-body">{a.body}</div>
            {a.recommended_mitigation && (
              <div className="alert-mitigation"><strong style={{ color: 'var(--green)' }}>Mitigation: </strong>{a.recommended_mitigation}</div>
            )}
          </div>
        </div>
      ))}

      {/* Risk Reasoning Chain */}
      {risks.length > 0 && (
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title"><Shield size={11} style={{ color: 'var(--orange)' }} />Risk Reasoning Chain</div>
            <span className="badge b-gray">{activeWell.well_id} → 10 km radius → {nearbyWells.length} wells → {risks.length} risks identified</span>
          </div>
          <div className="panel-body-sm">
            {/* Chain nodes */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {/* Node: Active Well */}
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '8px 0' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--cyan)', boxShadow: '0 0 6px var(--cyan)', flexShrink: 0 }} />
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  <span className="mono text-cyan font-bold">{activeWell.well_id}</span>
                  <span style={{ color: 'var(--text-4)' }}> · {fmtDepth(activeWell.current_depth)} · {activeWell.current_formation}</span>
                </div>
              </div>
              <div style={{ width: 8, height: 20, borderLeft: '1px dashed var(--border-2)', marginLeft: 4 }} />
              {/* Node: Wells */}
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '8px 0' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--teal)', flexShrink: 0 }} />
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  <span style={{ fontWeight: 700, color: 'var(--teal)' }}>{nearbyWells.length} offset wells</span> within {' '}
                  <span className="mono" style={{ color: 'var(--purple)' }}>10 km</span> analysed by formation, depth, spatial proximity
                </div>
              </div>
              <div style={{ width: 8, height: 20, borderLeft: '1px dashed var(--border-2)', marginLeft: 4 }} />
              {/* Risks */}
              {risks.map((r, i) => (
                <React.Fragment key={i}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '8px 0' }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: riskColor(r.risk_level), flexShrink: 0, marginTop: 4, boxShadow: `0 0 5px ${riskColor(r.risk_level)}` }} />
                    <div style={{ flex: 1, background: 'var(--surface-2)', border: `1px solid ${riskColor(r.risk_level)}33`, borderRadius: 'var(--r-md)', padding: '8px 12px' }}>
                      <div className="flex justify-between items-center" style={{ marginBottom: 4 }}>
                        <span style={{ fontWeight: 700, fontSize: 12, color: riskColor(r.risk_level) }}>{r.risk_type.replace(/_/g, ' ')}</span>
                        <div className="flex gap-1">
                          <span className={riskBadgeClass(r.risk_level)}>{r.risk_level}</span>
                          <span className="badge b-gray">{r.risk_score}/100</span>
                        </div>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-4)', marginBottom: 6 }}>
                        Zone {fmtN(r.interval_start)}–{fmtN(r.interval_end)} m · {r.supporting_wells.length} wells · {r.evidence_strength}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>{r.explanation}</div>
                    </div>
                  </div>
                  {i < risks.length - 1 && <div style={{ width: 8, height: 16, borderLeft: '1px dashed var(--border-2)', marginLeft: 4 }} />}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Detailed Risk Cards */}
      <div>
        <div className="section-header">
          <SectionTitle icon={Shield}>Detailed Risk Intelligence</SectionTitle>
          <span className="text-xs text-muted">{risks.length} risk categories identified</span>
        </div>
        <div className="g2">
          {risks.map((r, i) => (
            <div key={i} className="risk-card">
              <div className="risk-card-header" style={{ borderTop: `2px solid ${riskColor(r.risk_level)}` }}>
                <div>
                  <div className="risk-card-type" style={{ color: riskColor(r.risk_level) }}>{r.risk_type.replace(/_/g, ' ')}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 2 }}>Zone: {fmtN(r.interval_start)}–{fmtN(r.interval_end)} m</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="risk-card-score" style={{ color: riskColor(r.risk_level) }}>{r.risk_score}</div>
                  <div style={{ fontSize: 9, color: 'var(--text-4)' }}>/ 100</div>
                </div>
              </div>
              <div className="risk-card-body">
                {[
                  ['Supporting Wells', String(r.supporting_wells.length)],
                  ['Evidence', r.evidence_strength],
                  ['Formation', nearbyWells[0]?.well.formation ?? '—'],
                ].map(([k, v]) => (
                  <div key={k} className="risk-row">
                    <span className="risk-row-label">{k}</span>
                    <span className="risk-row-val">{v}</span>
                  </div>
                ))}
                <div className="flex gap-2" style={{ marginTop: 6 }}>
                  <span className={riskBadgeClass(r.risk_level)}>{r.risk_level}</span>
                  {r.ml_probability != null && <span className="badge b-purple">ML: {r.ml_probability}%</span>}
                </div>
                <div className="risk-explanation">{r.explanation}</div>
                {r.contributing_factors.slice(0, 3).map((f, j) => (
                  <div key={j} className="factor-row">
                    <div className="factor-dot" />
                    <div><span className="factor-name">{f.factor}: </span><span className="factor-detail">{f.detail}</span></div>
                  </div>
                ))}
                <button className="btn btn-primary" style={{ width: '100%', marginTop: 10, justifyContent: 'center' }}
                  onClick={() => setDrawerRisk(r)}>
                  View Evidence
                </button>
              </div>
            </div>
          ))}
          {risks.length === 0 && <EmptyState icon={Shield} msg="No active risks at current depth and radius" />}
        </div>
      </div>

      {drawerRisk && <EvidenceDrawer events={events} risk={drawerRisk} onClose={() => setDrawerRisk(null)} />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// WELL EXPLORER
// ══════════════════════════════════════════════════════════════════════
function WellsSection({ wells }: { wells: Well[] }) {
  const [filter, setFilter] = useState('');
  const filtered = useMemo(() =>
    wells.filter(w =>
      !filter || w.well_id.toLowerCase().includes(filter.toLowerCase()) ||
      w.field.toLowerCase().includes(filter.toLowerCase()) ||
      w.current_formation?.toLowerCase().includes(filter.toLowerCase())
    ), [wells, filter]);

  return (
    <div className="section-enter" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title"><Database size={11} style={{ color: 'var(--cyan)' }} />Well Explorer</div>
          <span className="badge b-gray">{wells.length} wells</span>
        </div>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
          <div className="search-bar">
            <Search size={13} style={{ color: 'var(--text-4)' }} />
            <input className="search-input" placeholder="Filter by well ID, field, formation…" value={filter} onChange={e => setFilter(e.target.value)} />
            {filter && <button className="drawer-close" onClick={() => setFilter('')}>×</button>}
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Well ID</th>
                <th>Field</th>
                <th>Status</th>
                <th>Formation</th>
                <th>Current Depth</th>
                <th>Total Depth</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(w => (
                <tr key={w.well_id}>
                  <td className="mono text-cyan font-bold">{w.well_id}</td>
                  <td>{w.field}</td>
                  <td><span className={statusBadge(w.status)}>{w.status}</span></td>
                  <td style={{ color: 'var(--teal)' }}>{w.current_formation}</td>
                  <td className="mono">{fmtN(w.current_depth)} m</td>
                  <td className="mono text-muted">{fmtN(w.total_depth)} m</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6}><EmptyState icon={Database} msg="No wells match your filter" /></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// KNOWLEDGE BASE
// ══════════════════════════════════════════════════════════════════════
function KnowledgeSection({ events }: { events: WellEvent[] }) {
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [expanded, setExpanded] = useState<number | null>(null);

  const types = ['ALL', ...Array.from(new Set(events.map(e => e.event_type)))];
  const filtered = typeFilter === 'ALL' ? events : events.filter(e => e.event_type === typeFilter);

  return (
    <div className="section-enter" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title"><BookOpen size={11} style={{ color: 'var(--cyan)' }} />Institutional Drilling Memory</div>
          <span className="badge b-gray">{filtered.length} events</span>
        </div>
        {/* Filters */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {types.map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              style={{
                padding: '3px 10px', borderRadius: 'var(--r-sm)',
                border: `1px solid ${typeFilter === t ? 'var(--cyan-mid)' : 'var(--border-2)'}`,
                background: typeFilter === t ? 'var(--cyan-dim)' : 'transparent',
                color: typeFilter === t ? 'var(--cyan)' : 'var(--text-4)',
                fontSize: 10, fontWeight: 700, cursor: 'pointer',
                textTransform: 'uppercase', letterSpacing: 0.5,
                fontFamily: 'Inter, sans-serif',
              }}>
              {t.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Well</th>
                <th>Depth</th>
                <th>Formation</th>
                <th>Severity</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 40).map(e => (
                <React.Fragment key={e.event_id}>
                  <tr style={{ cursor: 'pointer' }} onClick={() => setExpanded(expanded === e.event_id ? null : e.event_id)}>
                    <td><span className={eventTypeBadge(e.event_type)}>{e.event_type.replace(/_/g, ' ')}</span></td>
                    <td className="mono text-cyan">{e.well_id}</td>
                    <td className="mono">{fmtN(e.depth)} m</td>
                    <td style={{ color: 'var(--teal)' }}>{e.formation}</td>
                    <td><span className={sevBadge(e.severity)}>{e.severity}</span></td>
                    <td><span className="source-ref">{e.source_document}</span></td>
                  </tr>
                  {expanded === e.event_id && (
                    <tr>
                      <td colSpan={6} style={{ background: 'var(--surface-2)', padding: 0 }}>
                        <div style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, borderLeft: `3px solid ${eventColor(e.event_type)}` }}>
                          {[['Observation', e.description], ['Cause', e.cause], ['Mitigation', e.mitigation]].map(([k, v]) => (
                            <div key={k}>
                              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{k}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.6 }}>{v}</div>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// SEARCH
// ══════════════════════════════════════════════════════════════════════
const SUGGESTED = [
  'mud loss Barail formation',
  'torque spike 2800m',
  'stuck pipe mitigation',
  'kick history nearby wells',
  'cementing issue offset',
];

function SearchSection({ activeWellId }: { activeWellId: string }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async (q = query) => {
    if (!q.trim()) return;
    setLoading(true);
    try {
      const r = await searchKnowledge(q, activeWellId);
      setResults(r);
    } finally { setLoading(false); }
  };

  return (
    <div className="section-enter" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title"><Search size={11} style={{ color: 'var(--cyan)' }} />Technical Query Console</div>
        </div>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <div className="search-bar">
            <Search size={14} style={{ color: 'var(--text-4)', flexShrink: 0 }} />
            <input className="search-input" placeholder="Query the historical drilling intelligence…"
              value={query} onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && run()} />
            <button className="btn btn-primary" onClick={() => run()} disabled={loading || !query.trim()}>
              {loading ? <div className="spinner" style={{ width: 12, height: 12, borderWidth: 1 }} /> : 'Query'}
            </button>
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9, color: 'var(--text-5)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, alignSelf: 'center' }}>Suggested:</span>
            {SUGGESTED.map(s => (
              <button key={s} onClick={() => { setQuery(s); run(s); }}
                style={{ padding: '2px 8px', borderRadius: 'var(--r-sm)', background: 'var(--surface-2)', border: '1px solid var(--border-2)', color: 'var(--text-4)', fontSize: 10, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>
                {s}
              </button>
            ))}
          </div>
        </div>
        {results && (
          <div>
            <div style={{ padding: '8px 16px', fontSize: 10, color: 'var(--text-4)', borderBottom: '1px solid var(--border)' }}>
              {results.total_results} results for "<span style={{ color: 'var(--cyan)' }}>{results.query}</span>"
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Well</th>
                  <th>Score</th>
                  <th>Match</th>
                </tr>
              </thead>
              <tbody>
                {results.results.map((r, i) => (
                  <tr key={i}>
                    <td><span className="badge b-gray">{r.result_type}</span></td>
                    <td className="mono text-cyan">{r.well_id}</td>
                    <td className="mono" style={{ color: r.relevance_score > 0.7 ? 'var(--green)' : 'var(--text-3)' }}>
                      {Math.round(r.relevance_score * 100)}%
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--text-3)', maxWidth: 360 }}>{r.highlight}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!results && !loading && (
          <div style={{ padding: '32px 16px' }}>
            <EmptyState icon={Search} msg="Enter a query to search the historical drilling knowledge base" />
          </div>
        )}
        {loading && <div style={{ padding: 32 }}><Spinner label="Querying intelligence store…" /></div>}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// ANOMALY SECTION
// ══════════════════════════════════════════════════════════════════════
function AnomalySection({ activeWellId }: { activeWellId: string }) {
  const [report, setReport] = useState<AnomalyReport | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getAnomalies(activeWellId)
      .then(r => setReport(r))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeWellId]);

  if (loading) return <Spinner label="Running anomaly detection…" />;

  return (
    <div className="section-enter" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title"><Activity size={11} style={{ color: 'var(--orange)' }} />Parameter Anomaly Detection</div>
          {report && <span className="badge b-gray">{report.total_anomalies} anomalies</span>}
        </div>
        {report ? (
          <>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--text-3)' }}>
              {report.summary}
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Parameter</th>
                  <th>Anomaly</th>
                  <th>Depth</th>
                  <th>Value</th>
                  <th>Z-Score</th>
                  <th>Severity</th>
                  <th>Narrative</th>
                </tr>
              </thead>
              <tbody>
                {report.anomalies.map((a, i) => (
                  <tr key={i}>
                    <td className="mono" style={{ color: 'var(--cyan)', fontWeight: 700 }}>{a.parameter}</td>
                    <td><span className="badge b-gray">{a.anomaly_type.replace(/_/g, ' ')}</span></td>
                    <td className="mono">{fmtN(a.depth_m)} m</td>
                    <td className="mono">{a.value.toFixed(2)}</td>
                    <td className="mono" style={{ color: Math.abs(a.z_score) > 3 ? 'var(--red)' : 'var(--amber)' }}>{a.z_score.toFixed(1)}σ</td>
                    <td><span className={sevBadge(a.severity)}>{a.severity}</span></td>
                    <td style={{ fontSize: 11, color: 'var(--text-3)' }}>{a.narrative}</td>
                  </tr>
                ))}
                {report.anomalies.length === 0 && (
                  <tr><td colSpan={7}><EmptyState icon={Activity} msg="No anomalies detected" /></td></tr>
                )}
              </tbody>
            </table>
          </>
        ) : <EmptyState icon={Activity} msg="No anomaly data available" />}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// AUDIT SECTION
// ══════════════════════════════════════════════════════════════════════
function AuditSection({ activeWellId, radius, simDepth }: { activeWellId: string; radius: number; simDepth: number }) {
  const [report, setReport] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getAuditReport(activeWellId, radius, simDepth)
      .then(r => setReport(r))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeWellId, radius, simDepth]);

  if (loading) return <Spinner label="Generating audit report…" />;

  return (
    <div className="section-enter" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title"><FileText size={11} style={{ color: 'var(--cyan)' }} />Decision Audit Report</div>
          {report && <span className="mono" style={{ fontSize: 10, color: 'var(--text-4)' }}>{report.report_id}</span>}
        </div>
        {report ? (
          <>
            <div className="g4" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', gap: 10 }}>
              {[
                { label: 'Wells Analysed', val: report.offset_wells_analysed },
                { label: 'Events Examined', val: report.total_events_examined },
                { label: 'ML Active', val: report.ml_model_active ? 'YES' : 'NO' },
                { label: 'Integrity', val: report.overall_integrity_status.replace(/_/g, ' ') },
              ].map(({ label, val }) => (
                <div key={label} className="metric-card">
                  <div className="metric-label">{label}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginTop: 4 }}>{val}</div>
                </div>
              ))}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Risk Type</th>
                    <th>Evidence</th>
                    <th>ML</th>
                    <th>Level</th>
                    <th>Integrity</th>
                    <th>Rationale</th>
                  </tr>
                </thead>
                <tbody>
                  {report.audit_entries.map((e, i) => (
                    <tr key={i}>
                      <td><span className="badge b-gray">{e.risk_type.replace(/_/g, ' ')}</span></td>
                      <td className="mono">{e.evidence_score}/100</td>
                      <td className="mono" style={{ color: 'var(--purple)' }}>
                        {e.ml_probability != null ? `${e.ml_probability}%` : '—'}
                      </td>
                      <td><span className={riskBadgeClass(e.final_risk_level)}>{e.final_risk_level}</span></td>
                      <td>
                        <span className={`badge ${e.integrity_check === 'CONSISTENT' ? 'b-green' : e.integrity_check.includes('ML') ? 'b-amber' : 'b-gray'}`}>
                          {e.integrity_check.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--text-3)' }}>{e.decision_rationale}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '8px 16px', fontSize: 10, color: 'var(--text-5)', borderTop: '1px solid var(--border)' }}>
              {report.disclaimer}
            </div>
          </>
        ) : <EmptyState icon={FileText} msg="No audit data available" />}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// ROOT APP
// ══════════════════════════════════════════════════════════════════════
export default function App() {
  const [section, setSection] = useState<Section>('overview');
  const [activeWells, setActiveWells] = useState<Well[]>([]);
  const [activeWellId, setActiveWellId] = useState<string>('ACTIVE-001');
  const [activeWell, setActiveWell] = useState<Well | null>(null);

  const [simDepth, setSimDepth]   = useState<number>(2850);
  const [simMin, setSimMin]       = useState<number>(2600);
  const [simMax, setSimMax]       = useState<number>(3200);

  const [radius, setRadius]       = useState<number>(10);
  const [nearbyWells, setNearbyWells]   = useState<NearbyWell[]>([]);
  const [risks, setRisks]               = useState<RiskPrediction[]>([]);
  const [alerts, setAlerts]             = useState<Alert[]>([]);
  const [riskZones, setRiskZones]       = useState<HistoricalRiskZone[]>([]);
  const [events, setEvents]             = useState<WellEvent[]>([]);
  const [stats, setStats]               = useState<SystemStats | null>(null);
  const [allWells, setAllWells]         = useState<Well[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);

  // Load active wells
  useEffect(() => {
    getActiveWells().then(ws => {
      setActiveWells(ws);
      if (ws.length > 0 && !ws.find(w => w.well_id === activeWellId)) setActiveWellId(ws[0].well_id);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync active well object
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
      if (!partial) { setEvents(res[4]); setStats(res[5]); setAllWells(res[6]); }
    } catch (e: any) {
      setError(e.message || 'Failed to communicate with the intelligence feed.');
    } finally { setLoading(false); }
  }, [activeWellId, radius, simDepth]);

  useEffect(() => { refresh(simDepth); }, [activeWellId, radius, refresh, simDepth]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDepthChange = (d: number) => {
    setSimDepth(d);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => refresh(d, true), 400);
  };

  const sectionLabel = NAV.find(n => n.id === section)?.label ?? '';

  return (
    <div className="nwis-shell">
      {/* ── GLOBAL TOPBAR ── */}
      <header className="nwis-topbar">
        <div className="topbar-brand">
          <div className="brand-icon">
            <Zap size={14} style={{ color: 'var(--cyan)' }} />
          </div>
          <div>
            <div className="brand-name">NWIS</div>
            <div className="brand-sub">Operations Intelligence</div>
          </div>
        </div>

        {/* Section breadcrumb */}
        <div className="topbar-section-label">{sectionLabel}</div>
        <div className="topbar-vdiv" />

        {/* Active well selector */}
        <div className="well-pill" style={{ marginLeft: 12 }}>
          <div className="flex flex-col gap-1">
            <div className="well-pill-label">Active Well</div>
            <select value={activeWellId} onChange={e => setActiveWellId(e.target.value)} className="well-pill-id" style={{ background: 'transparent', border: 'none', outline: 'none', cursor: 'pointer' }}>
              {activeWells.map(w => <option key={w.well_id} value={w.well_id}>{w.well_id}</option>)}
            </select>
          </div>
          <ChevronDown size={12} style={{ color: 'var(--cyan)' }} />
        </div>

        <div className="topbar-vdiv" style={{ marginLeft: 12 }} />

        {/* Global context strip */}
        <div className="topbar-ctx">
          <div className="tctx-item">
            <div className="tctx-label">Depth</div>
            <div className="tctx-val cyan">{fmtN(simDepth)} m</div>
          </div>
          <div className="tctx-item">
            <div className="tctx-label">Formation</div>
            <div className="tctx-val teal">{activeWell?.current_formation ?? '—'}</div>
          </div>
          <div className="tctx-item">
            <div className="tctx-label">Radius</div>
            <div className="tctx-val">{radius} km</div>
          </div>
        </div>

        {/* Actions */}
        <div className="topbar-actions">
          {alerts.length > 0 && (
            <span className="badge b-red" style={{ fontSize: 10 }}>
              <TriangleAlert size={10} style={{ marginRight: 3 }} />{alerts.length} Alert{alerts.length > 1 ? 's' : ''}
            </span>
          )}
          <div className="feed-status">
            <div className="feed-dot" />
            Simulated
          </div>
          <button className="btn" onClick={() => refresh(simDepth)} disabled={loading} style={{ marginLeft: 6 }}>
            <RefreshCw size={12} style={{ animation: loading ? 'spin 0.8s linear infinite' : 'none' }} />
            Refresh
          </button>
        </div>
      </header>

      {/* ── SIDEBAR ── */}
      <aside className="nwis-sidebar">
        <nav className="sidebar-nav">
          <div className="nav-group">
            <div className="nav-group-label">Navigation</div>
            {NAV.map(({ id, label, Icon }) => (
              <button key={id} className={`nav-item ${section === id ? 'active' : ''}`} onClick={() => setSection(id)}>
                <Icon size={14} />
                {label}
                {id === 'risk' && alerts.length > 0 && <span className="nav-badge">{alerts.length}</span>}
              </button>
            ))}
          </div>
        </nav>

        {/* System status */}
        <div className="sidebar-status">
          <div className="status-label">System Status</div>
          {[
            'Well Data Feed', 'Spatial Engine', 'Risk Engine', 'Evidence Store',
          ].map(s => (
            <div key={s} className="status-row">
              <div className="status-dot ok" />
              <span>{s}</span>
            </div>
          ))}
        </div>

        {/* Depth simulation */}
        <div className="sidebar-sim">
          <div className="sim-header">
            <Activity size={10} style={{ color: 'var(--cyan)' }} />
            POC Simulation
          </div>
          <div className="sim-depth-readout">
            <div className="sim-depth-label">Target Depth</div>
            <div className="sim-depth-value">{fmtN(simDepth)} m</div>
          </div>
          <input type="range" className="sim-slider" min={simMin} max={simMax} step={25}
            value={simDepth} onChange={e => onDepthChange(+e.target.value)} />
          <div className="sim-range">
            <span>{fmtN(simMin)}</span>
            <span>{fmtN(simMax)}</span>
          </div>
        </div>
      </aside>

      {/* ── MAIN WORKSPACE ── */}
      <main className="nwis-workspace">
        {error ? (
          <div className="workspace-scroll">
            <div className="workspace-inner">
              <div className="panel" style={{ padding: 32 }}>
                <EmptyState icon={TriangleAlert} msg={`System Error: ${error}`} />
              </div>
            </div>
          </div>
        ) : (
          <div className="workspace-scroll">
            <div className="workspace-inner">
              {section === 'overview' && (
                <OverviewSection
                  activeWell={activeWell} simDepth={simDepth} stats={stats}
                  risks={risks} alerts={alerts} nearbyWells={nearbyWells}
                  riskZones={riskZones} events={events} />
              )}
              {section === 'map' && (
                <GeospatialSection activeWell={activeWell} nearbyWells={nearbyWells}
                  radius={radius} onRadiusChange={setRadius} />
              )}
              {section === 'risk' && (
                <RiskSection activeWell={activeWell} risks={risks} alerts={alerts}
                  nearbyWells={nearbyWells} events={events} />
              )}
              {section === 'wells'     && <WellsSection wells={allWells} />}
              {section === 'knowledge' && <KnowledgeSection events={events} />}
              {section === 'search'    && <SearchSection activeWellId={activeWellId} />}
              {section === 'anomaly'   && <AnomalySection activeWellId={activeWellId} />}
              {section === 'audit'     && <AuditSection activeWellId={activeWellId} radius={radius} simDepth={simDepth} />}
            </div>
          </div>
        )}
      </main>

      {/* Global keyframes */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
