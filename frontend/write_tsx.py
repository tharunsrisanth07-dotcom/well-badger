import os

APP_TSX = """import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import {
  Activity, BookOpen, ChevronDown, Database, FileText,
  Globe, Layers, MapPin, RefreshCw, Search,
  Shield, TriangleAlert, Gauge, Navigation,
  Zap, Settings, Map, Clock, AlertTriangle
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
type Section = 'overview' | 'map' | 'risk' | 'wells' | 'knowledge' | 'search';

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
    <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{label}</span>
  </div>
);

const EmptyState = ({ icon: Icon, msg }: { icon: React.ComponentType<{ size?: number; className?: string }>; msg: string }) => (
  <div className="empty-state">
    <Icon size={32} className="empty-state-icon" />
    <span>{msg}</span>
  </div>
);

const SectionTitle = ({ icon: Icon, children }: { icon?: React.ComponentType<{ size?: number; style?: React.CSSProperties }>; children: React.ReactNode }) => (
  <div className="section-title">
    {Icon && <Icon size={12} style={{ color: 'var(--cyan)' }} />}
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
            <div className="drawer-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileText size={14} style={{ color: 'var(--cyan)' }} />
              EVIDENCE RECORD
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
              {risk.risk_type.replace(/_/g, ' ')} · {matching.length} source event{matching.length !== 1 ? 's' : ''}
            </div>
          </div>
          <button className="drawer-close" onClick={onClose}>×</button>
        </div>
        <div className="drawer-body">
          <div className="evidence-item" style={{ borderLeft: `3px solid ${riskColor(risk.risk_level)}` }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
              <span className={riskBadgeClass(risk.risk_level)}>{risk.risk_level}</span>
              <span className="badge b-gray">Score: {risk.risk_score}/100</span>
              {risk.ml_probability != null && <span className="badge b-purple">ML: {risk.ml_probability}%</span>}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6 }}>{risk.explanation}</div>
          </div>
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
          <div>
            <SectionTitle icon={FileText}>Source Events ({matching.length})</SectionTitle>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {matching.map(e => (
                <div key={e.event_id} className="evidence-record">
                  <div className="evidence-record-header">
                    <span className="source-ref"><FileText size={10} style={{ display: 'inline', marginRight: 4, verticalAlign: '-1px' }} />{e.source_document}{e.source_page != null ? ` p.${e.source_page}` : ''}</span>
                  </div>
                  <div className="evidence-record-body">
                    {[
                      ['EVENT', e.event_type.replace(/_/g, ' ')],
                      ['WELL', e.well_id],
                      ['DEPTH', fmtDepth(e.depth)],
                      ['FORMATION', e.formation],
                      ['OBSERVATION', e.description],
                      ['CAUSE', e.cause],
                      ['MITIGATION', e.mitigation],
                      ['OUTCOME', e.outcome],
                    ].map(([k, v]) => v && (
                      <div key={k} className="evidence-row">
                        <div className="evidence-row-key">{k}</div>
                        <div className="evidence-row-val">{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {matching.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-4)', padding: 12, border: '1px solid var(--border-2)', borderRadius: 'var(--r-sm)' }}>
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
  activeWell, simDepth, stats, risks, alerts, nearbyWells, riskZones, events, onNavigateSearch
}: {
  activeWell: Well | null; simDepth: number; stats: SystemStats | null;
  risks: RiskPrediction[]; alerts: Alert[];
  nearbyWells: NearbyWell[]; riskZones: HistoricalRiskZone[];
  events: WellEvent[];
  onNavigateSearch: () => void;
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

  // Build risk horizon rows
  const allDepths = [
    ...riskZones.map(z => z.interval_start),
    ...riskZones.map(z => z.interval_end),
    simDepth,
  ];
  const depthMax = Math.max(...allDepths, simDepth + 150);

  const horizonItems = [
    { depth: simDepth, label: 'CURRENT BIT', severity: 'active', color: 'var(--cyan)' },
    ...riskZones.map(z => ({
      depth: z.interval_start,
      label: z.risk_type.replace(/_/g, ' '),
      severity: '',
      color: eventColor(z.risk_type),
    })),
  ].sort((a, b) => a.depth - b.depth);

  return (
    <div className="section-enter section-overview">
      {/* ── Main Hero / Command Center ── */}
      <div className="hero-panel">
        <div className="hero-bg-effect">
          <div className="hero-formation-lines" />
          <div className="hero-particles" />
          <div className="hero-depth-scan" />
        </div>
        <div className="hero-content">
          <h1 className="hero-title">DRILLING INTELLIGENCE COMMAND CENTER</h1>
          <p className="hero-subtitle">
            Correlate the active well with nearby historical wells, depth-aligned events, formation context and live drilling parameters to surface evidence-backed risk ahead of the bit.
          </p>
          
          <div className="hero-search-area">
            <div className="hero-search-box">
              <span className="hero-search-prompt">ASK NWIS</span>
              <div className="hero-search-input-wrap" onClick={onNavigateSearch} style={{ cursor: 'pointer' }}>
                <Search size={16} className="hero-search-icon" />
                <span className="hero-search-placeholder">What risks are ahead over the next 150 m?</span>
                <button className="hero-search-btn">ANALYZE</button>
              </div>
            </div>
          </div>

          <div className="hero-chips">
            <div className="hero-chip">
              <span className="hero-chip-lbl">ACTIVE WELL</span>
              <span className="hero-chip-val text-cyan">{activeWell.well_id}</span>
            </div>
            <div className="hero-chip">
              <span className="hero-chip-lbl">CURRENT DEPTH</span>
              <span className="hero-chip-val mono">{fmtN(simDepth)} m</span>
            </div>
            <div className="hero-chip">
              <span className="hero-chip-lbl">FORMATION</span>
              <span className="hero-chip-val text-teal">{activeWell.current_formation || 'UNKNOWN'}</span>
            </div>
            <div className="hero-chip">
              <span className="hero-chip-lbl">RISK HORIZON</span>
              <span className="hero-chip-val mono">{fmtN(simDepth)}–{fmtN(simDepth + 150)} m</span>
            </div>
            <div className="hero-chip">
              <span className="hero-chip-lbl">SUPPORTING WELLS</span>
              <span className="hero-chip-val">{nearbyWells.length}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Dashboard Content ── */}
      <div className="dashboard-grid">
        
        {/* TELEMETRY STRIP */}
        <div className="dash-panel span-full">
          <div className="dash-panel-header">
            <div className="dash-panel-title">LIVE DRILLING PARAMETERS</div>
            <div className="flex items-center gap-2">
               <div className="feed-dot" />
               <span className="text-xs text-green font-bold tracking-wider">SIMULATED</span>
            </div>
          </div>
          <div className="telem-strip">
            {[
              { label: 'ROP', val: fmtVal(telemetry?.rop), unit: 'm/hr', trend: '↓' },
              { label: 'WOB', val: fmtVal(telemetry?.wob), unit: 'kN' },
              { label: 'RPM', val: fmtVal(telemetry?.rpm, 0), unit: 'rpm' },
              { label: 'TORQUE', val: fmtVal(telemetry?.torque), unit: 'kN·m', trend: '↑', color: 'var(--cyan)' },
              { label: 'SPP', val: fmtVal(telemetry?.pressure, 0), unit: 'psi', trend: '→' },
              { label: 'FLOW', val: fmtVal(telemetry?.flow, 0), unit: 'gpm' },
              { label: 'MUD WT', val: fmtVal(telemetry?.mud_weight, 2), unit: 'SG' },
              { label: 'DEPTH', val: fmtN(simDepth), unit: 'm' },
            ].map(({ label, val, unit, color, trend }) => (
              <div key={label} className="telem-item">
                <div className="telem-lbl">{label}</div>
                <div className="telem-val-row">
                  <span className="telem-val" style={color ? { color } : {}}>{val}</span>
                  {trend && <span className={`telem-trend trend-${trend === '↑' ? 'up' : trend === '↓' ? 'down' : 'flat'}`}>{trend}</span>}
                </div>
                <div className="telem-unit">{unit}</div>
              </div>
            ))}
          </div>
        </div>

        {/* RISK HORIZON */}
        <div className="dash-panel col-span-8">
          <div className="dash-panel-header">
            <div className="dash-panel-title">RISK HORIZON</div>
            <span className="text-xs text-muted">Depth-aligned historical risk ahead of the bit</span>
          </div>
          <div className="risk-horizon-view">
            {horizonItems.length === 1 ? (
              <EmptyState icon={Layers} msg="No historical risks identified ahead" />
            ) : (
              <div className="rh-timeline">
                {horizonItems.map((item, i) => (
                  <div key={i} className={`rh-line ${item.severity === 'active' ? 'rh-active' : ''}`}>
                    <div className="rh-depth-lbl">{fmtN(item.depth)}</div>
                    <div className="rh-track-pt">
                      {item.severity === 'active' ? <div className="rh-bit" /> : <div className="rh-tick" />}
                    </div>
                    <div className="rh-event-lbl" style={{ color: item.color }}>{item.label}</div>
                  </div>
                ))}
                <div className="rh-line">
                  <div className="rh-depth-lbl text-muted">{fmtN(depthMax)}</div>
                  <div className="rh-track-pt"><div className="rh-tick" style={{ background: 'var(--border-3)' }} /></div>
                  <div className="rh-event-lbl text-muted">END HORIZON</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* PRIMARY RISK */}
        <div className="dash-panel col-span-4">
          <div className="dash-panel-header">
            <div className="dash-panel-title">PRIMARY RISK</div>
          </div>
          {topRisk ? (
             <div className="primary-risk-card">
               <div className="pr-type" style={{ color: riskColor(topRisk.risk_level) }}>{topRisk.risk_type.replace(/_/g, ' ')}</div>
               <div className="pr-score">
                 <span className="pr-num" style={{ color: riskColor(topRisk.risk_level) }}>{topRisk.risk_score}</span>
                 <span className="pr-den"> / 100</span>
               </div>
               <div className="pr-badge"><span className={riskBadgeClass(topRisk.risk_level)}>{topRisk.risk_level}</span></div>
               
               <div className="pr-details">
                 <div className="pr-row"><span>RISK ZONE</span><span className="mono">{fmtN(topRisk.interval_start)}–{fmtN(topRisk.interval_end)} m</span></div>
                 <div className="pr-row"><span>SUPPORTING WELLS</span><span>{topRisk.supporting_wells.length}</span></div>
                 <div className="pr-row"><span>EVIDENCE</span><span className="badge b-gray">{topRisk.evidence_strength}</span></div>
               </div>

               <div className="pr-why">
                 <div className="pr-why-lbl">WHY THIS MATTERS</div>
                 <p>{topRisk.explanation}</p>
               </div>
               <button className="btn btn-primary btn-full mt-2" onClick={() => setDrawerRisk(topRisk)}>VIEW EVIDENCE</button>
             </div>
          ) : (
            <div className="p-4"><EmptyState icon={Shield} msg="No immediate risks detected" /></div>
          )}
        </div>

        {/* GEOSPATIAL CONTEXT */}
        <div className="dash-panel col-span-6" style={{ minHeight: 300 }}>
          <div className="dash-panel-header">
            <div className="dash-panel-title">SPATIAL CONTEXT</div>
            <span className="text-xs text-muted">Active + Analog Wells</span>
          </div>
          <div style={{ height: '100%', width: '100%', position: 'relative' }}>
             <MapContainer center={[activeWell.latitude, activeWell.longitude]} zoom={11} style={{ position: 'absolute', inset: 0 }}>
               <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="" />
               <FlyTo lat={activeWell.latitude} lon={activeWell.longitude} />
               <Marker position={[activeWell.latitude, activeWell.longitude]} icon={ACTIVE_ICON} />
               {nearbyWells.slice(0, 10).map(nw => (
                 <Marker key={nw.well.well_id} position={[nw.well.latitude, nw.well.longitude]}
                   icon={nw.relevance.label === 'HIGH' ? HIGH_ICON : nw.relevance.label === 'MEDIUM' ? MED_ICON : LOW_ICON} />
               ))}
             </MapContainer>
          </div>
        </div>

        {/* ANALOG WELLS */}
        <div className="dash-panel col-span-3">
          <div className="dash-panel-header">
             <div className="dash-panel-title">ANALOG WELLS</div>
          </div>
          <div className="p-3 flex-col gap-2">
            {nearbyWells.length === 0 ? <EmptyState icon={Database} msg="No analogs" /> : nearbyWells.slice(0,4).map(nw => (
              <div key={nw.well.well_id} className="analog-card">
                <div className="ac-top">
                  <span className="ac-id">{nw.well.well_id}</span>
                  <span className={`badge ${nw.relevance.label === 'HIGH' ? 'b-amber' : nw.relevance.label === 'MEDIUM' ? 'b-cyan' : 'b-gray'}`}>{nw.relevance.label}</span>
                </div>
                <div className="ac-details">
                  <div className="ac-row"><span>FORMATION</span><span className="text-teal">{nw.well.formation || 'BARAIL'}</span></div>
                  <div className="ac-row"><span>SPATIAL</span><span>{nw.distance_km.toFixed(1)} km</span></div>
                  <div className="ac-row"><span>EVENT SUPPORT</span><span>{nw.relevant_events.length}</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* EVIDENCE / HISTORICAL MEMORY */}
        <div className="dash-panel col-span-3">
          <div className="dash-panel-header">
             <div className="dash-panel-title">HISTORICAL INTELLIGENCE</div>
          </div>
          <div className="p-4 flex-col justify-between" style={{ height: 'calc(100% - 40px)' }}>
             <div className="flex-col gap-3">
               <div className="hi-stat"><span className="hi-val">{stats?.total_events || events.length}</span> <span className="hi-lbl">depth-aligned events</span></div>
               <div className="hi-stat"><span className="hi-val">{stats?.active_wells || nearbyWells.length}</span> <span className="hi-lbl">supporting offset wells</span></div>
               <div className="hi-stat"><span className="hi-val">{stats?.total_wells || allDepths.length}</span> <span className="hi-lbl">source documents</span></div>
             </div>
             <div className="flex-col gap-2 mt-4">
               <button className="btn btn-secondary btn-full">VIEW KNOWLEDGE BASE</button>
               <button className="btn btn-secondary btn-full">VIEW RISK EVIDENCE</button>
             </div>
          </div>
        </div>

      </div>

      {drawerRisk && <EvidenceDrawer events={events} risk={drawerRisk} onClose={() => setDrawerRisk(null)} />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// GEOSPATIAL SECTION
// ══════════════════════════════════════════════════════════════════════
function GeospatialSection({ activeWell, nearbyWells, risks, radius, onRadiusChange }: any) {
  if (!activeWell) return <Spinner />;
  return (
    <div className="section-enter section-full">
      <div className="dash-panel span-full" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div className="dash-panel-header">
          <div className="dash-panel-title">GEOSPATIAL SPATIAL ENGINE</div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted">Analysis Radius:</span>
            <span className="mono text-cyan font-bold">{radius} km</span>
          </div>
        </div>
        <div style={{ flex: 1, position: 'relative' }}>
          <MapContainer center={[activeWell.latitude, activeWell.longitude]} zoom={11} style={{ position: 'absolute', inset: 0 }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="" />
            <FlyTo lat={activeWell.latitude} lon={activeWell.longitude} />
            <Circle center={[activeWell.latitude, activeWell.longitude]} radius={radius * 1000}
              pathOptions={{ color: 'rgba(34,211,238,0.6)', fillColor: 'rgba(34,211,238,0.04)', dashArray: '6 4' }} />
            <Marker position={[activeWell.latitude, activeWell.longitude]} icon={ACTIVE_ICON} />
            {nearbyWells.map((nw: any) => (
              <Marker key={nw.well.well_id} position={[nw.well.latitude, nw.well.longitude]}
                icon={nw.relevance.label === 'HIGH' ? HIGH_ICON : nw.relevance.label === 'MEDIUM' ? MED_ICON : LOW_ICON} />
            ))}
          </MapContainer>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// RISK INTELLIGENCE SECTION
// ══════════════════════════════════════════════════════════════════════
function RiskSection({ activeWell, risks, events }: any) {
  const [drawerRisk, setDrawerRisk] = useState<RiskPrediction | null>(null);
  if (!activeWell) return <Spinner />;
  return (
    <div className="section-enter">
      <div className="dash-panel">
        <div className="dash-panel-header">
          <div className="dash-panel-title">RISK INTELLIGENCE REPOSITORY</div>
          <span className="badge b-gray">{risks.length} active risks</span>
        </div>
        <div className="p-4 grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {risks.map((r: any, i: number) => (
            <div key={i} className="primary-risk-card">
               <div className="pr-type" style={{ color: riskColor(r.risk_level) }}>{r.risk_type.replace(/_/g, ' ')}</div>
               <div className="pr-score">
                 <span className="pr-num" style={{ color: riskColor(r.risk_level) }}>{r.risk_score}</span>
                 <span className="pr-den"> / 100</span>
               </div>
               <div className="pr-badge"><span className={riskBadgeClass(r.risk_level)}>{r.risk_level}</span></div>
               <div className="pr-details mt-2">
                 <div className="pr-row"><span>RISK ZONE</span><span className="mono">{fmtN(r.interval_start)}–{fmtN(r.interval_end)} m</span></div>
                 <div className="pr-row"><span>SUPPORTING WELLS</span><span>{r.supporting_wells.length}</span></div>
               </div>
               <button className="btn btn-primary mt-3 btn-full" onClick={() => setDrawerRisk(r)}>VIEW EVIDENCE</button>
            </div>
          ))}
          {risks.length === 0 && <EmptyState icon={Shield} msg="No risks identified" />}
        </div>
      </div>
      {drawerRisk && <EvidenceDrawer events={events} risk={drawerRisk} onClose={() => setDrawerRisk(null)} />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// WELL EXPLORER
// ══════════════════════════════════════════════════════════════════════
function WellsSection({ wells }: any) {
  return (
    <div className="section-enter">
      <div className="dash-panel">
        <div className="dash-panel-header"><div className="dash-panel-title">WELL EXPLORER</div></div>
        <div className="p-4 overflow-auto">
          <table className="data-table">
            <thead><tr><th>Well ID</th><th>Field</th><th>Status</th><th>Formation</th><th>Depth</th></tr></thead>
            <tbody>
              {wells.map((w: any) => (
                <tr key={w.well_id}>
                  <td className="text-cyan font-bold mono">{w.well_id}</td>
                  <td>{w.field}</td>
                  <td><span className={statusBadge(w.status)}>{w.status}</span></td>
                  <td className="text-teal">{w.current_formation}</td>
                  <td className="mono">{fmtN(w.current_depth)} m</td>
                </tr>
              ))}
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
function KnowledgeSection({ events }: any) {
  return (
    <div className="section-enter">
      <div className="dash-panel">
        <div className="dash-panel-header"><div className="dash-panel-title">KNOWLEDGE BASE</div></div>
        <div className="p-4 overflow-auto">
          <table className="data-table">
            <thead><tr><th>Type</th><th>Well</th><th>Depth</th><th>Formation</th><th>Severity</th></tr></thead>
            <tbody>
              {events.slice(0, 50).map((e: any) => (
                <tr key={e.event_id}>
                  <td><span className={eventTypeBadge(e.event_type)}>{e.event_type.replace(/_/g, ' ')}</span></td>
                  <td className="text-cyan mono">{e.well_id}</td>
                  <td className="mono">{fmtN(e.depth)} m</td>
                  <td className="text-teal">{e.formation}</td>
                  <td><span className={sevBadge(e.severity)}>{e.severity}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// SEARCH SECTION
// ══════════════════════════════════════════════════════════════════════
function SearchSection({ activeWellId }: any) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const r = await searchKnowledge(query, activeWellId);
      setResults(r);
    } finally { setLoading(false); }
  };

  return (
    <div className="section-enter">
      <div className="dash-panel">
        <div className="dash-panel-header"><div className="dash-panel-title">SEARCH & ASK NWIS</div></div>
        <div className="p-4">
           <div className="hero-search-box" style={{ maxWidth: 800 }}>
              <span className="hero-search-prompt">QUERY</span>
              <div className="hero-search-input-wrap">
                <Search size={16} className="hero-search-icon" />
                <input style={{ background: 'transparent', border: 'none', color: 'var(--text)', outline: 'none', flex: 1, fontSize: 16 }}
                  placeholder="What risks are ahead?" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()} />
                <button className="hero-search-btn" onClick={run}>ANALYZE</button>
              </div>
           </div>
           {loading && <div className="mt-4"><Spinner /></div>}
           {results && (
             <div className="mt-4">
               <div className="text-xs text-muted mb-2">{results.total_results} results found</div>
               <table className="data-table">
                  <thead><tr><th>Type</th><th>Well</th><th>Match</th></tr></thead>
                  <tbody>
                    {results.results.map((r: any, i: number) => (
                      <tr key={i}>
                        <td><span className="badge b-gray">{r.result_type}</span></td>
                        <td className="text-cyan mono">{r.well_id}</td>
                        <td className="text-muted text-sm">{r.highlight}</td>
                      </tr>
                    ))}
                  </tbody>
               </table>
             </div>
           )}
        </div>
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
  const [radius, setRadius]       = useState<number>(10);
  
  const [nearbyWells, setNearbyWells]   = useState<NearbyWell[]>([]);
  const [risks, setRisks]               = useState<RiskPrediction[]>([]);
  const [alerts, setAlerts]             = useState<Alert[]>([]);
  const [riskZones, setRiskZones]       = useState<HistoricalRiskZone[]>([]);
  const [events, setEvents]             = useState<WellEvent[]>([]);
  const [stats, setStats]               = useState<SystemStats | null>(null);
  const [allWells, setAllWells]         = useState<Well[]>([]);
  const [loading, setLoading]           = useState(true);

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
    }
  }, [activeWellId, activeWells]);

  const refresh = useCallback(async (depth = simDepth, partial = false) => {
    setLoading(true);
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
    } catch (e) {
      console.error(e);
    } finally { setLoading(false); }
  }, [activeWellId, radius, simDepth]);

  useEffect(() => { refresh(simDepth); }, [activeWellId, radius, refresh, simDepth]);

  return (
    <div className="nwis-app">
      {/* ── LAYER 1: ORGANIZATION / SYSTEM STRIP ── */}
      <div className="top-org-strip">
        <div className="org-left">
          <span className="org-text font-bold">OIL INDIA LIMITED</span>
          <span className="org-div">|</span>
          <span className="org-text">DRILLING INTELLIGENCE</span>
          <span className="org-div">|</span>
          <span className="org-text text-cyan">eRTMAC-NWIS</span>
          <span className="org-div">|</span>
          <span className="org-text">OPERATIONS CONSOLE</span>
        </div>
        <div className="org-right">
          <span className="org-status-lbl">SYSTEM</span>
          <span className="org-status-val">● NOMINAL</span>
          <span className="org-div">|</span>
          <span className="org-text mono">{new Date().toISOString().slice(11,19)} UTC</span>
        </div>
      </div>

      {/* ── LAYER 2: BRAND / ACTIVE WELL HEADER ── */}
      <header className="brand-header">
        <div className="brand-left">
          <div className="brand-mark">
            <Zap size={24} style={{ color: 'var(--brand-dark)' }} />
          </div>
          <div className="brand-text">
            <div className="brand-title">NWIS</div>
            <div className="brand-subtitle">Nearby Wells Intelligence System</div>
            <div className="brand-subtext">OIL INDIA LIMITED · DRILLING OPERATIONS</div>
          </div>
        </div>

        <div className="brand-center">
          <div className="active-well-selector">
            <span className="aws-label">ACTIVE WELL ▼</span>
            <select value={activeWellId} onChange={e => setActiveWellId(e.target.value)} className="aws-select">
              {activeWells.map(w => <option key={w.well_id} value={w.well_id}>{w.well_id}</option>)}
            </select>
          </div>
        </div>

        <div className="brand-right">
          <div className="bh-metric">
            <span className="bhm-label">CURRENT DEPTH</span>
            <span className="bhm-val">{fmtN(simDepth)} m</span>
          </div>
          <div className="bh-metric">
            <span className="bhm-label">FORMATION</span>
            <span className="bhm-val">{activeWell?.current_formation || '—'}</span>
          </div>
          <div className="bh-metric">
            <span className="bhm-label">FEED</span>
            <span className="bhm-val feed-val">● SIMULATED</span>
          </div>
          <button className="bh-refresh" onClick={() => refresh(simDepth)} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> REFRESH FEED
          </button>
        </div>
      </header>

      {/* ── LAYER 3: PRIMARY NAVIGATION BAR ── */}
      <nav className="primary-nav">
        {NAV.map(({ id, label }) => (
          <button key={id} className={`nav-btn ${section === id ? 'active' : ''}`} onClick={() => setSection(id)}>
            {label}
          </button>
        ))}
      </nav>

      {/* ── LAYER 4: LIVE OPERATIONAL STATUS STRIP ── */}
      <div className="status-strip">
        <div className="status-item"><span className="status-dot green" /> ERTMAC FEED: ACTIVE</div>
        <div className="status-div" />
        <div className="status-item"><span className="status-dot green" /> WELL STATE: {activeWellId} · {fmtN(simDepth)} m · {activeWell?.current_formation}</div>
        <div className="status-div" />
        <div className="status-item"><span className="status-dot cyan" /> SPATIAL ENGINE: {nearbyWells.length} OFFSET WELLS</div>
        <div className="status-div" />
        <div className="status-item"><span className={`status-dot ${risks.length > 0 ? 'orange' : 'green'}`} /> RISK ENGINE: {risks.length > 0 ? risks[0].risk_level : 'NOMINAL'}</div>
        <div className="status-div" />
        <div className="status-item"><span className="status-dot green" /> EVIDENCE STORE: OK</div>
        
        <div className="status-time">UPDATED {new Date().toLocaleTimeString()}</div>
      </div>

      {/* ── MAIN WORKSPACE ── */}
      <main className="main-workspace">
        <div className="workspace-scrollable">
          {section === 'overview' && (
            <OverviewSection 
              activeWell={activeWell} simDepth={simDepth} stats={stats} 
              risks={risks} alerts={alerts} nearbyWells={nearbyWells} 
              riskZones={riskZones} events={events} onNavigateSearch={() => setSection('search')}
            />
          )}
          {section === 'map' && <GeospatialSection activeWell={activeWell} nearbyWells={nearbyWells} risks={risks} radius={radius} onRadiusChange={setRadius} />}
          {section === 'risk' && <RiskSection activeWell={activeWell} risks={risks} events={events} />}
          {section === 'wells' && <WellsSection wells={allWells} />}
          {section === 'knowledge' && <KnowledgeSection events={events} />}
          {section === 'search' && <SearchSection activeWellId={activeWellId} />}
        </div>
      </main>

    </div>
  );
}
