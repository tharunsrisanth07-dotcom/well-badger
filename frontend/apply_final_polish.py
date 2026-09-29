import os

APP_TSX = """import React, { useEffect, useState, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Circle, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import {
  Activity, BookOpen, Database, FileText,
  Globe, Layers, RefreshCw, Search,
  Shield, Zap, TriangleAlert, Play
} from 'lucide-react';

import {
  getActiveWells, getNearbyWells, getCurrentRisk, getSystemStats,
  getAllEvents, getAlerts, getRiskZones, searchKnowledge,
  getLatestTelemetry, getWells,
  type Well, type NearbyWell, type RiskPrediction, type Alert,
  type WellEvent, type SystemStats, type HistoricalRiskZone,
  type SearchResponse, type DrillingParameter,
} from './api';

// ── Leaflet icon fix ──────────────────────────────────────────────────
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const makeIcon = (color: string) => new L.Icon({
  iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${color}.png`,
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [22, 36], iconAnchor: [11, 36], popupAnchor: [1, -30], shadowSize: [36, 36],
});
const ACTIVE_ICON = makeIcon('red');
const HIGH_ICON = makeIcon('orange');
const MED_ICON = makeIcon('yellow');
const LOW_ICON = makeIcon('blue');

// ── Section type ──────────────────────────────────────────────────────
type Section = 'overview' | 'map' | 'risk' | 'wells' | 'knowledge' | 'search';

// ── Helpers ───────────────────────────────────────────────────────────
const fmtN = (d: number) => d.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtDepth = (d: number) => `${fmtN(d)} m`;
const fmtVal = (v: number | null | undefined, dec = 1) => v == null ? '—' : v.toFixed(dec);

function riskColor(level: string) {
  if (level === 'CRITICAL') return 'var(--col-red)';
  if (level === 'HIGH') return 'var(--col-orange)';
  if (level === 'MEDIUM') return 'var(--col-amber)';
  return 'var(--col-green)';
}
function riskBadge(level: string) {
  if (level === 'CRITICAL') return 'badge b-red';
  if (level === 'HIGH') return 'badge b-orange';
  if (level === 'MEDIUM') return 'badge b-amber';
  return 'badge b-green';
}
function eventColor(et: string) {
  const m: Record<string, string> = {
    MUD_LOSS: 'var(--col-teal)', STUCK_PIPE: 'var(--col-amber)',
    KICK: 'var(--col-red)', TORQUE_SPIKE: 'var(--col-purple)',
    CEMENTING_ISSUE: 'var(--col-cyan)',
  };
  return m[et] ?? 'var(--text-4)';
}
function evTypeBadge(et: string) {
  const m: Record<string, string> = {
    MUD_LOSS: 'badge b-teal', STUCK_PIPE: 'badge b-amber',
    KICK: 'badge b-red', TORQUE_SPIKE: 'badge b-purple',
    CEMENTING_ISSUE: 'badge b-cyan',
  };
  return m[et] ?? 'badge b-gray';
}
function sevBadge(s: string) {
  if (s === 'CRITICAL') return 'badge b-red';
  if (s === 'HIGH') return 'badge b-orange';
  if (s === 'MEDIUM') return 'badge b-amber';
  return 'badge b-green';
}
function statusBadge(s: string) {
  if (s === 'ACTIVE') return 'badge b-green';
  if (s === 'COMPLETED') return 'badge b-cyan';
  return 'badge b-gray';
}

// ── Drill Bit Icon ────────────────────────────────────────────────────
const DrillBitIcon = ({ size = 24, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2L12 22" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M8 8L16 8" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M6 14L18 14" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M9 22L15 22" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M10 22L7 14L9 8L11 2" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M14 22L17 14L15 8L13 2" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// ── MapFlyTo ──────────────────────────────────────────────────────────
function MapFlyTo({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  useEffect(() => { map.flyTo([lat, lon], 12, { duration: 1 }); }, [lat, lon, map]);
  return null;
}

// ── Subsurface Canvas Animation ───────────────────────────────────────
function SubsurfaceCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let width = canvas.offsetWidth;
    let height = canvas.offsetHeight;
    canvas.width = width;
    canvas.height = height;

    const particles = Array.from({ length: 40 }).map(() => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: 0.5 + Math.random() * 1.0,
      speed: 0.1 + Math.random() * 0.4,
      opacity: 0.05 + Math.random() * 0.2,
    }));

    const bands = [0.15, 0.35, 0.55, 0.70, 0.88].map(frac => ({
      y: frac * height,
      opacity: 0.03 + Math.random() * 0.04,
    }));

    let scanY = 0;
    let pulseTime = 0;

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      pulseTime += 0.02;

      // Formation strata
      bands.forEach((band, i) => {
        ctx.beginPath();
        ctx.strokeStyle = `rgba(34,211,238,${band.opacity})`;
        ctx.lineWidth = 1;
        ctx.setLineDash(i % 2 === 0 ? [8, 16] : [4, 8]);
        ctx.moveTo(0, band.y);
        ctx.lineTo(width, band.y);
        ctx.stroke();
        ctx.setLineDash([]);
      });

      // Depth lines (faint)
      for (let x = 60; x < width; x += 100) {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255,255,255,0.015)';
        ctx.lineWidth = 1;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      // Telemetry pulse line
      ctx.beginPath();
      ctx.strokeStyle = `rgba(34,211,238,${0.1 + Math.sin(pulseTime) * 0.05})`;
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 10) {
        const y = height * 0.8 + Math.sin(x * 0.05 + pulseTime) * 15;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Depth scan line
      const scanGrad = ctx.createLinearGradient(0, scanY - 60, 0, scanY + 60);
      scanGrad.addColorStop(0, 'rgba(34,211,238,0)');
      scanGrad.addColorStop(0.5, 'rgba(34,211,238,0.08)');
      scanGrad.addColorStop(1, 'rgba(34,211,238,0)');
      ctx.fillStyle = scanGrad;
      ctx.fillRect(0, scanY - 60, width, 120);

      // Cuttings particles moving upward
      particles.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(34,211,238,${p.opacity})`;
        ctx.fill();
        p.y -= p.speed;
        if (p.y < -4) { p.y = height + 4; p.x = Math.random() * width; }
      });

      scanY += 0.5;
      if (scanY > height + 60) scanY = -60;

      animId = requestAnimationFrame(draw);
    };

    draw();

    const onResize = () => {
      width = canvas.offsetWidth;
      height = canvas.offsetHeight;
      canvas.width = width;
      canvas.height = height;
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    />
  );
}

// ── Spinner ───────────────────────────────────────────────────────────
const Spinner = ({ label = 'Loading...' }: { label?: string }) => (
  <div className="spinner-wrap">
    <div className="spinner" />
    <span className="spinner-label">{label}</span>
  </div>
);

// ── EmptyState ────────────────────────────────────────────────────────
const EmptyState = ({ msg }: { msg: string }) => (
  <div className="empty-state">{msg}</div>
);

// ── Evidence Drawer ───────────────────────────────────────────────────
function EvidenceDrawer({ events, risk, onClose }: {
  events: WellEvent[]; risk: RiskPrediction; onClose: () => void;
}) {
  const matching = events.filter(e =>
    e.event_type === risk.risk_type && risk.supporting_events.includes(e.event_id)
  );

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-hd">
          <div>
            <div className="drawer-ttl">
              <FileText size={13} style={{ color: 'var(--col-cyan)', marginRight: 6 }} />
              EVIDENCE RECORD
            </div>
            <div className="drawer-sub">{risk.risk_type.replace(/_/g, ' ')} &middot; {matching.length} source events</div>
          </div>
          <button className="drawer-close" onClick={onClose}>&#x2715;</button>
        </div>

        <div className="drawer-body">
          <div className="ev-summary" style={{ borderLeft: `3px solid ${riskColor(risk.risk_level)}` }}>
            <div className="ev-summary-top">
              <span className={riskBadge(risk.risk_level)}>{risk.risk_level}</span>
              <span className="badge b-gray">Score: {risk.risk_score}/100</span>
              {risk.ml_probability != null && <span className="badge b-purple">ML: {risk.ml_probability}%</span>}
            </div>
            <p className="ev-explain">{risk.explanation}</p>
          </div>

          {risk.contributing_factors.length > 0 && (
            <div>
              <div className="dr-sec-ttl">Contributing Factors</div>
              <div className="dr-factors">
                {risk.contributing_factors.map((f, i) => (
                  <div key={i} className="dr-factor">
                    <div className="dr-factor-dot" />
                    <span className="dr-factor-name">{f.factor}: </span>
                    <span className="dr-factor-detail">{f.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="dr-sec-ttl">Source Evidence Archive ({matching.length})</div>
            <div className="dr-events">
              {matching.length === 0 ? (
                <div className="dr-no-events">
                  Supporting event IDs: {risk.supporting_events.slice(0, 5).join(', ')}{risk.supporting_events.length > 5 ? '...' : ''}
                </div>
              ) : matching.map(e => (
                <div key={e.event_id} className="dr-event-card">
                  <div className="dr-event-src">
                    <FileText size={10} style={{ color: 'var(--col-cyan)', marginRight: 5 }} />
                    {e.source_document}{e.source_page != null ? ` · Page ${e.source_page}` : ''}
                  </div>
                  <div className="dr-event-rows">
                    {[
                      ['EVENT', e.event_type.replace(/_/g, ' ')],
                      ['WELL', e.well_id],
                      ['DEPTH', fmtDepth(e.depth)],
                      ['FORMATION', e.formation],
                      ['OBSERVATION', e.description],
                      ['MITIGATION', e.mitigation],
                      ['OUTCOME', e.outcome],
                    ].filter(([, v]) => v).map(([k, v]) => (
                      <div key={k} className="dr-ev-row">
                        <span className="dr-ev-key">{k}</span>
                        <span className="dr-ev-val">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════
// DEMO TOUR COMPONENT
// ══════════════════════════════════════════════════════════════════════
const DEMO_STEPS = [
  { id: 'command-center', title: 'COMMAND CENTER', desc: 'NWIS brings active-well context, historical offset-well intelligence and upcoming drilling-risk evidence into one workspace.', target: '.hero-main' },
  { id: 'active-well', title: 'ACTIVE WELL STATE', desc: 'The system maintains a persistent active-well context across all analysis sections.', target: '.brand-header' },
  { id: 'telemetry', title: 'LIVE TELEMETRY', desc: 'Current drilling parameters provide the live state used alongside historical evidence.', target: '.telem-strip' },
  { id: 'risk-horizon', title: 'RISK HORIZON', desc: 'Historical events are aligned against the current depth to identify risk intervals ahead of the bit.', target: '.rh-timeline' },
  { id: 'primary-risk', title: 'PRIMARY RISK', desc: 'Risk is shown with supporting wells, depth, formation, evidence strength and explanation.', target: '.panel:has(.pr-body)' },
  { id: 'analogs', title: 'ANALOG WELLS', desc: 'NWIS compares wells using more than simple geographic distance, including formation, depth and historical event relevance.', target: '.analog-list' },
  { id: 'geospatial', title: 'GEOSPATIAL', desc: 'Spatial context connects the active well to nearby historical evidence.', section: 'map', target: '.geo-map-wrap' },
  { id: 'risk-intel', title: 'RISK INTELLIGENCE', desc: 'Detailed risk analysis shows the supporting evidence, depth zone and historical correlation.', section: 'risk', target: '.risk-cards-grid' },
  { id: 'well-explorer', title: 'WELL EXPLORER', desc: 'Browse structured well history, formation and depth context.', section: 'wells', target: '.data-table' },
  { id: 'knowledge-base', title: 'KNOWLEDGE BASE', desc: 'Historical drilling experience is preserved as structured, source-linked institutional memory.', section: 'knowledge', target: '.kb-records' },
  { id: 'search', title: 'SEARCH', desc: 'Engineers can query well, depth, event and risk context through the search interface.', section: 'search', target: '.hero-search-box' }
];

function DemoTour({ isActive, onClose, setSection }: { isActive: boolean, onClose: () => void, setSection: (s: Section) => void }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!isActive) { setStepIdx(0); return; }
    const step = DEMO_STEPS[stepIdx];
    if (step.section) setSection(step.section as Section);

    const updateRect = () => {
      const el = document.querySelector(step.target);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => {
          const r = el.getBoundingClientRect();
          setRect(r);
        }, 300); // Wait for scroll/render
      } else {
        setRect(null);
      }
    };
    
    // Initial delay for render
    const t = setTimeout(updateRect, 350);
    window.addEventListener('resize', updateRect);
    return () => { clearTimeout(t); window.removeEventListener('resize', updateRect); };
  }, [isActive, stepIdx, setSection]);

  if (!isActive) return null;
  const step = DEMO_STEPS[stepIdx];
  const isEnd = stepIdx === DEMO_STEPS.length - 1;

  const spotlightStyle: React.CSSProperties = rect ? {
    position: 'absolute',
    top: rect.top - 10, left: rect.left - 10, width: rect.width + 20, height: rect.height + 20,
    boxShadow: '0 0 0 9999px rgba(0,0,0,0.7)',
    border: '2px solid var(--col-cyan)',
    borderRadius: '8px',
    transition: 'all 0.4s cubic-bezier(0.25, 1, 0.5, 1)',
    pointerEvents: 'none',
    zIndex: 9999,
  } : { display: 'none' };

  return (
    <>
      <div className="demo-overlay-base" />
      <div style={spotlightStyle} />
      
      <div className="demo-panel" style={{
        top: rect ? Math.max(20, rect.bottom + 20) : '50%',
        left: rect ? Math.max(20, rect.left) : '50%',
        transform: rect ? 'none' : 'translate(-50%, -50%)',
      }}>
        <div className="demo-progress">{String(stepIdx + 1).padStart(2, '0')} / {String(DEMO_STEPS.length).padStart(2, '0')}</div>
        <div className="demo-ttl">{step.title}</div>
        <div className="demo-desc">{step.desc}</div>
        <div className="demo-actions">
          <button className="btn btn-secondary" onClick={() => { setSection('overview'); onClose(); }}>EXIT DEMO</button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
             <button className="btn btn-secondary" disabled={stepIdx === 0} onClick={() => setStepIdx(s => s - 1)}>BACK</button>
             {isEnd ? (
               <button className="btn btn-primary" onClick={() => { setSection('overview'); onClose(); }}>END DEMO</button>
             ) : (
               <button className="btn btn-primary" onClick={() => setStepIdx(s => s + 1)}>NEXT</button>
             )}
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
  activeWell, simDepth, stats, risks, alerts, nearbyWells, riskZones, events, onSearch, onStartDemo
}: {
  activeWell: Well | null; simDepth: number; stats: SystemStats | null;
  risks: RiskPrediction[]; alerts: Alert[];
  nearbyWells: NearbyWell[]; riskZones: HistoricalRiskZone[];
  events: WellEvent[];
  onSearch: (q: string) => void;
  onStartDemo: () => void;
}) {
  const [telemetry, setTelemetry] = useState<DrillingParameter | null>(null);
  const [drawerRisk, setDrawerRisk] = useState<RiskPrediction | null>(null);
  const [heroQuery, setHeroQuery] = useState('');

  useEffect(() => {
    if (!activeWell) return;
    getLatestTelemetry(activeWell.well_id, simDepth)
      .then(rows => { if (rows.length > 0) setTelemetry(rows[0]); })
      .catch(() => {});
  }, [activeWell, simDepth]);

  if (!activeWell) return <Spinner label="Loading well data..." />;

  const topRisk = risks[0];

  const horizonItems: { depth: number; label: string; isActive: boolean; color: string; interval?: string }[] = [
    { depth: simDepth, label: 'CURRENT BIT', isActive: true, color: 'var(--col-cyan)' },
    ...riskZones.map(z => ({
      depth: z.interval_start,
      label: z.risk_type.replace(/_/g, ' '),
      isActive: false,
      color: eventColor(z.risk_type),
      interval: `${fmtN(z.interval_start)}–${fmtN(z.interval_end)} m`,
    })),
  ].sort((a, b) => a.depth - b.depth);

  const depthMax = Math.max(simDepth + 180, ...riskZones.map(z => z.interval_end));

  const telemParams = [
    { lbl: 'ROP', val: fmtVal(telemetry?.rop), unit: 'm/hr', trend: telemetry?.rop ? '↓' : null },
    { lbl: 'WOB', val: fmtVal(telemetry?.wob), unit: 'kN', trend: null },
    { lbl: 'RPM', val: fmtVal(telemetry?.rpm, 0), unit: 'rpm', trend: null },
    { lbl: 'TORQUE', val: fmtVal(telemetry?.torque), unit: 'kN·m', trend: telemetry?.torque ? '↑' : null, accent: true },
    { lbl: 'SPP', val: fmtVal(telemetry?.pressure, 0), unit: 'psi', trend: null },
    { lbl: 'FLOW', val: fmtVal(telemetry?.flow_rate, 0), unit: 'gpm', trend: null },
    { lbl: 'MUD WT', val: fmtVal(telemetry?.mud_weight, 2), unit: 'SG', trend: null },
    { lbl: 'DEPTH', val: fmtN(simDepth), unit: 'm', trend: null, accent: true },
  ];

  return (
    <div className="ov-root">
      {/* ── HERO / COMMAND CENTER ── */}
      <div className="hero-panel">
        <SubsurfaceCanvas />
        <div className="hero-overlay" />

        <div className="hero-content">
          <div className="hero-demo-ctrls">
             <button className="btn hero-demo-btn" onClick={onStartDemo}>
               <Play size={12} fill="currentColor" /> START DEMO TOUR
             </button>
          </div>

          {alerts.length > 0 && (
            <div className="hero-alert">
              <TriangleAlert size={14} style={{ flexShrink: 0 }} />
              <div>
                <span className="hero-alert-ttl">{alerts[0].title}</span>
                {' — '}
                <span className="hero-alert-body">{alerts[0].body}</span>
              </div>
              <span className={riskBadge(alerts[0].severity)} style={{ marginLeft: 'auto', flexShrink: 0 }}>{alerts[0].severity}</span>
            </div>
          )}

          <div className="hero-main">
            <div className="hero-text-block">
              <h1 className="hero-title">DRILLING INTELLIGENCE<br />COMMAND CENTER</h1>
              <p className="hero-desc">
                Correlate active-well state with nearby historical wells, depth-aligned events, formation context and drilling parameters to surface evidence-backed risk ahead of the bit.
              </p>
            </div>

            <div className="hero-search-wrap">
              <div className="hero-search-label">ASK NWIS</div>
              <div className="hero-search-row">
                <div className="hero-search-box">
                  <Search size={15} style={{ color: 'var(--text-4)', flexShrink: 0 }} />
                  <input
                    className="hero-search-input"
                    placeholder="What risks are ahead over the next 150 m?"
                    value={heroQuery}
                    onChange={e => setHeroQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && heroQuery.trim()) onSearch(heroQuery); }}
                  />
                </div>
                <button className="hero-analyze-btn" onClick={() => heroQuery.trim() && onSearch(heroQuery)}>
                  ANALYZE
                </button>
              </div>
              <div className="hero-quick-actions">
                {['Risks Ahead', 'Most Analogous Wells', 'Mud Loss Near Current Depth', 'Stuck Pipe History', 'Show Evidence'].map(q => (
                  <button key={q} className="hero-qa-btn" onClick={() => onSearch(q)}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="hero-chips">
            <div className="hero-chip">
              <span className="chip-lbl">ACTIVE WELL</span>
              <span className="chip-val" style={{ color: 'var(--col-cyan)' }}>{activeWell.well_id}</span>
            </div>
            <div className="chip-sep" />
            <div className="hero-chip">
              <span className="chip-lbl">FORMATION</span>
              <span className="chip-val" style={{ color: 'var(--col-teal)' }}>{activeWell.current_formation || '—'}</span>
            </div>
            <div className="chip-sep" />
            <div className="hero-chip">
              <span className="chip-lbl">CURRENT DEPTH</span>
              <span className="chip-val mono">{fmtN(simDepth)} m</span>
            </div>
            <div className="chip-sep" />
            <div className="hero-chip">
              <span className="chip-lbl">RISK HORIZON</span>
              <span className="chip-val mono">{fmtN(simDepth)}–{fmtN(simDepth + 150)} m</span>
            </div>
            <div className="chip-sep" />
            <div className="hero-chip">
              <span className="chip-lbl">SUPPORTING WELLS</span>
              <span className="chip-val">{nearbyWells.length}</span>
            </div>
            <div className="chip-sep" />
            <div className="hero-chip">
              <span className="chip-lbl">PRIMARY RISK</span>
              <span className="chip-val" style={{ color: topRisk ? riskColor(topRisk.risk_level) : 'var(--col-green)' }}>
                {topRisk ? topRisk.risk_type.replace(/_/g, ' ') : 'NOMINAL'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── LIVE DRILLING PARAMETERS ── */}
      <div className="panel">
        <div className="panel-hd">
          <span className="panel-ttl">
            <Zap size={11} style={{ color: 'var(--col-cyan)', marginRight: 6 }} />
            LIVE DRILLING PARAMETERS
          </span>
          <div className="feed-live">
            <span className="feed-dot" />
            <span>SIMULATED</span>
          </div>
        </div>
        <div className="telem-strip">
          {telemParams.map(({ lbl, val, unit, trend, accent }) => (
            <div key={lbl} className={`telem-cell ${accent ? 'telem-accent' : ''}`}>
              <div className="telem-lbl">{lbl}</div>
              <div className="telem-val-row">
                <span className="telem-val">{val}</span>
                {trend && (
                  <span className={`telem-trend ${trend === '↑' ? 'trend-up' : 'trend-dn'}`}>{trend}</span>
                )}
              </div>
              <div className="telem-unit">{unit}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── RISK HORIZON + PRIMARY RISK ── */}
      <div className="ov-row-2col" style={{ gridTemplateColumns: '1fr 340px' }}>
        <div className="panel">
          <div className="panel-hd">
            <span className="panel-ttl">
              <Layers size={11} style={{ color: 'var(--col-orange)', marginRight: 6 }} />
              RISK HORIZON
            </span>
            <span className="text-dim" style={{ fontSize: 10 }}>Depth-aligned historical risk ahead of the bit</span>
          </div>
          <div className="rh-body">
            {horizonItems.length <= 1 ? (
              <EmptyState msg="No historical risk zones detected in current radius." />
            ) : (
              <div className="rh-timeline">
                <div className="rh-spine" />
                {horizonItems.map((item, i) => (
                  <div key={i} className={`rh-row ${item.isActive ? 'rh-row-active' : ''}`}>
                    <div className="rh-depth">{fmtN(item.depth)} m</div>
                    {item.isActive ? (
                      <div className="rh-bit-indicator">
                        <span style={{ fontSize: 10, color: 'var(--col-cyan)', fontFamily: 'JetBrains Mono', marginRight: 8, letterSpacing: -1 }}>─────────</span>
                        <div className="rh-bit-dot" />
                      </div>
                    ) : (
                      <div className="rh-tick-dot" style={{ background: item.color }} />
                    )}
                    <div className="rh-event-block">
                      {item.isActive ? (
                        <span className="rh-current-lbl">CURRENT BIT</span>
                      ) : (
                        <>
                          <span className="rh-event-name" style={{ color: item.color }}>{item.label}</span>
                          {item.interval && <span className="rh-event-interval">{item.interval}</span>}
                        </>
                      )}
                    </div>
                  </div>
                ))}
                <div className="rh-row">
                  <div className="rh-depth rh-depth-dim">{fmtN(depthMax)} m</div>
                  <div className="rh-tick-dot" style={{ background: 'var(--border-3)' }} />
                  <div className="rh-event-block">
                    <span className="rh-event-name" style={{ color: 'var(--text-5)' }}>END HORIZON</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-hd">
            <span className="panel-ttl">
              <Shield size={11} style={{ color: 'var(--col-red)', marginRight: 6 }} />
              PRIMARY RISK
            </span>
          </div>
          {topRisk ? (
            <div className="pr-body">
              <div className="pr-type" style={{ color: riskColor(topRisk.risk_level) }}>{topRisk.risk_type.replace(/_/g, ' ')}</div>
              <div className="pr-score-row">
                <span className="pr-score" style={{ color: riskColor(topRisk.risk_level) }}>{topRisk.risk_score}</span>
                <span className="pr-score-denom"> / 100</span>
                <span className={riskBadge(topRisk.risk_level)} style={{ marginLeft: 'auto' }}>{topRisk.risk_level}</span>
              </div>
              <div className="pr-rows">
                {[
                  ['RISK ZONE', `${fmtN(topRisk.interval_start)}–${fmtN(topRisk.interval_end)} m`],
                  ['SUPPORTING WELLS', String(topRisk.supporting_wells.length)],
                  ['EVIDENCE', topRisk.evidence_strength],
                ].map(([k, v]) => (
                  <div key={k} className="pr-row">
                    <span className="pr-row-lbl">{k}</span>
                    <span className="pr-row-val">{v}</span>
                  </div>
                ))}
              </div>
              <div className="pr-why-ttl">WHY THIS MATTERS</div>
              <p className="pr-why-body">{topRisk.explanation}</p>
              <button className="btn btn-primary btn-full" onClick={() => setDrawerRisk(topRisk)}>VIEW EVIDENCE</button>
            </div>
          ) : (
            <div className="panel-empty">
              <div className="no-risk-dot" />
              <span className="no-risk-lbl">No Major Risks Identified</span>
              <p className="no-risk-sub">Nominal historical risk patterns at current depth and radius.</p>
            </div>
          )}
        </div>
      </div>

      {/* ── GEOSPATIAL + ANALOG WELLS + EVIDENCE ── */}
      <div className="ov-row-geo">
        <div className="panel" style={{ gridColumn: 'span 6', overflow: 'hidden' }}>
          <div className="panel-hd">
            <span className="panel-ttl">
              <Globe size={11} style={{ color: 'var(--col-cyan)', marginRight: 6 }} />
              GEOSPATIAL CONTEXT
            </span>
            <span className="badge b-gray">{nearbyWells.length} offset wells</span>
          </div>
          <div className="geo-map-wrap" style={{ height: 280, position: 'relative' }}>
            <MapContainer center={[activeWell.latitude, activeWell.longitude]} zoom={11} style={{ position: 'absolute', inset: 0 }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="" />
              <MapFlyTo lat={activeWell.latitude} lon={activeWell.longitude} />
              <Circle center={[activeWell.latitude, activeWell.longitude]} radius={10000} pathOptions={{ color: 'rgba(34,211,238,0.5)', fillColor: 'rgba(34,211,238,0.04)', dashArray: '5 4' }} />
              <Marker position={[activeWell.latitude, activeWell.longitude]} icon={ACTIVE_ICON}>
                <Popup><strong style={{ color: '#ef4444' }}>● {activeWell.well_id}</strong><br />ACTIVE</Popup>
              </Marker>
              {nearbyWells.slice(0, 10).map(nw => (
                <Marker key={nw.well.well_id} position={[nw.well.latitude, nw.well.longitude]} icon={nw.relevance.label === 'HIGH' ? HIGH_ICON : nw.relevance.label === 'MEDIUM' ? MED_ICON : LOW_ICON}>
                  <Popup><strong style={{ color: '#22d3ee' }}>{nw.well.well_id}</strong><br />{nw.distance_km.toFixed(1)} km &middot; {nw.relevance.label}</Popup>
                </Marker>
              ))}
            </MapContainer>
          </div>
        </div>

        <div className="panel" style={{ gridColumn: 'span 3' }}>
          <div className="panel-hd">
            <span className="panel-ttl">ANALOG WELLS</span>
            <span className="badge b-cyan">{nearbyWells.length}</span>
          </div>
          <div className="analog-list">
            {nearbyWells.length === 0 ? (
              <EmptyState msg="No offset wells in radius" />
            ) : nearbyWells.slice(0, 5).map(nw => {
              const pct = Math.round(nw.relevance.overall * 100);
              const barCol = nw.relevance.label === 'HIGH' ? 'var(--col-amber)' : nw.relevance.label === 'MEDIUM' ? 'var(--col-cyan)' : 'var(--text-5)';
              const tags = [
                nw.relevance.formation_score > 0.6 && 'FORMATION MATCH',
                nw.relevance.depth_score > 0.6 && 'DEPTH MATCH',
                nw.relevance.spatial_score > 0.6 && 'SPATIAL',
                nw.relevant_events.length > 0 && `${nw.relevant_events.length} EVENTS`,
              ].filter(Boolean) as string[];

              return (
                <div key={nw.well.well_id} className="analog-card">
                  <div className="analog-top">
                    <span className="analog-id">{nw.well.well_id}</span>
                    <span className={`badge ${nw.relevance.label === 'HIGH' ? 'b-amber' : nw.relevance.label === 'MEDIUM' ? 'b-cyan' : 'b-gray'}`}>{nw.relevance.label}</span>
                  </div>
                  <div className="analog-rows">
                    <div className="analog-row-item"><span>FORMATION</span><span style={{ color: 'var(--col-teal)' }}>{nw.well.formation || nw.well.current_formation || '—'}</span></div>
                    <div className="analog-row-item"><span>SPATIAL</span><span>{nw.distance_km.toFixed(1)} km</span></div>
                    <div className="analog-row-item"><span>EVENT SUPPORT</span><span>{nw.relevant_events.length}</span></div>
                  </div>
                  <div className="analog-bar-track">
                    <div className="analog-bar-fill" style={{ width: `${pct}%`, background: barCol }} />
                  </div>
                  <div className="analog-tags">
                    {tags.map(t => <span key={t} className="badge b-gray analog-tag">{t}</span>)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel" style={{ gridColumn: 'span 3' }}>
          <div className="panel-hd">
            <span className="panel-ttl">
              <Database size={11} style={{ color: 'var(--col-cyan)', marginRight: 6 }} />
              HISTORICAL INTELLIGENCE
            </span>
          </div>
          <div className="hi-body">
            <div className="hi-stats">
              {[
                { val: stats?.total_events ?? events.length, lbl: 'depth-aligned events' },
                { val: nearbyWells.length, lbl: 'supporting offset wells' },
                { val: stats?.total_wells ?? '—', lbl: 'total wells in store' },
                { val: stats?.high_severity_events ?? '—', lbl: 'high/critical events' },
              ].map(({ val, lbl }) => (
                <div key={lbl} className="hi-stat-row">
                  <span className="hi-stat-val mono">{val}</span>
                  <span className="hi-stat-lbl">{lbl}</span>
                </div>
              ))}
            </div>
            <div className="hi-actions">
              <button className="btn btn-secondary btn-full">VIEW KNOWLEDGE BASE</button>
              <button className="btn btn-secondary btn-full" onClick={() => topRisk && setDrawerRisk(topRisk)}>
                VIEW RISK EVIDENCE
              </button>
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
function GeospatialSection({ activeWell, nearbyWells, risks, radius, onRadiusChange }: {
  activeWell: Well | null; nearbyWells: NearbyWell[]; risks: RiskPrediction[];
  radius: number; onRadiusChange: (r: number) => void;
}) {
  const [selectedWell, setSelectedWell] = useState<NearbyWell | null>(null);
  const [highlightRisk, setHighlightRisk] = useState<RiskPrediction | null>(null);

  if (!activeWell) return <Spinner />;

  return (
    <div className="geo-root section-enter">
      <div className="geo-map-wrap">
        <div className="panel-hd">
          <span className="panel-ttl">
            <Globe size={11} style={{ color: 'var(--col-cyan)', marginRight: 6 }} />
            SPATIAL ENGINE
          </span>
          <div className="geo-radius-ctrl">
            <span className="text-dim">Radius:</span>
            <input type="range" min={5} max={30} value={radius} onChange={e => onRadiusChange(+e.target.value)} className="geo-slider" />
            <span className="mono" style={{ color: 'var(--col-cyan)', fontWeight: 700 }}>{radius} km</span>
            <span className="badge b-cyan">{nearbyWells.length} offset wells</span>
          </div>
        </div>
        <div style={{ flex: 1, position: 'relative' }}>
          <MapContainer center={[activeWell.latitude, activeWell.longitude]} zoom={11} style={{ position: 'absolute', inset: 0 }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="" />
            <MapFlyTo lat={activeWell.latitude} lon={activeWell.longitude} />
            <Circle center={[activeWell.latitude, activeWell.longitude]} radius={radius * 1000}
              pathOptions={{ color: 'rgba(34,211,238,0.6)', fillColor: 'rgba(34,211,238,0.04)', dashArray: '6 4' }} />
            <Marker position={[activeWell.latitude, activeWell.longitude]} icon={ACTIVE_ICON}>
              <Popup><strong style={{ color: '#ef4444' }}>● {activeWell.well_id}</strong><br />ACTIVE · {fmtDepth(activeWell.current_depth)}</Popup>
            </Marker>
            {nearbyWells.map(nw => {
              const highlighted = highlightRisk ? highlightRisk.supporting_wells.includes(nw.well.well_id) : true;
              return (
                <Marker
                  key={nw.well.well_id}
                  position={[nw.well.latitude, nw.well.longitude]}
                  opacity={highlighted ? 1 : 0.3}
                  icon={nw.relevance.label === 'HIGH' ? HIGH_ICON : nw.relevance.label === 'MEDIUM' ? MED_ICON : LOW_ICON}
                  eventHandlers={{ click: () => setSelectedWell(nw) }}
                >
                  <Popup>
                    <strong style={{ color: '#22d3ee' }}>{nw.well.well_id}</strong><br />
                    {nw.distance_km.toFixed(2)} km &middot; {nw.relevance.label}
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// RISK INTELLIGENCE SECTION
// ══════════════════════════════════════════════════════════════════════
function RiskSection({ activeWell, risks, alerts, nearbyWells, events }: {
  activeWell: Well | null; risks: RiskPrediction[]; alerts: Alert[]; nearbyWells: NearbyWell[]; events: WellEvent[];
}) {
  const [drawerRisk, setDrawerRisk] = useState<RiskPrediction | null>(null);

  if (!activeWell) return <Spinner />;

  return (
    <div className="section-enter dash-panel">
      <div className="panel-hd">
         <span className="panel-ttl">RISK INTELLIGENCE REPOSITORY</span>
         <span className="badge b-gray">{risks.length} active risks</span>
      </div>
      <div className="risk-cards-grid p-4">
        {risks.map((r, i) => (
          <div key={i} className="risk-card">
            <div className="risk-card-hd">
              <div className="risk-card-type" style={{ color: riskColor(r.risk_level) }}>{r.risk_type.replace(/_/g, ' ')}</div>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <div className="flex justify-between items-end border-b border-[var(--border)] pb-3">
                <div>
                  <div className="risk-card-score" style={{ color: riskColor(r.risk_level) }}>{r.risk_score}</div>
                  <div className="risk-card-denom">/ 100</div>
                </div>
                <span className={riskBadge(r.risk_level)}>{r.risk_level}</span>
              </div>
              <div className="pr-row"><span>RISK ZONE</span><span className="mono">{fmtN(r.interval_start)}–{fmtN(r.interval_end)} m</span></div>
              <div className="pr-row"><span>SUPPORTING WELLS</span><span>{r.supporting_wells.length}</span></div>
              <button className="btn btn-primary mt-3 btn-full" onClick={() => setDrawerRisk(r)}>VIEW EVIDENCE</button>
            </div>
          </div>
        ))}
      </div>
      {drawerRisk && <EvidenceDrawer events={events} risk={drawerRisk} onClose={() => setDrawerRisk(null)} />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// WELL EXPLORER SECTION
// ══════════════════════════════════════════════════════════════════════
function WellsSection({ wells, events }: { wells: Well[], events: WellEvent[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="section-enter dash-panel">
      <div className="panel-hd">
        <span className="panel-ttl">WELL EXPLORER DATABASE</span>
      </div>
      <div className="overflow-auto p-4">
        <table className="data-table">
          <thead>
            <tr>
              <th>Well ID</th>
              <th>Field</th>
              <th>Status</th>
              <th>Formation</th>
              <th>Depth Profile</th>
            </tr>
          </thead>
          <tbody>
            {wells.map(w => {
              const wevents = events.filter(e => e.well_id === w.well_id);
              const isEx = expandedId === w.well_id;
              return (
                <React.Fragment key={w.well_id}>
                  <tr className="well-row-hover" onClick={() => setExpandedId(isEx ? null : w.well_id)} style={{ cursor: 'pointer' }}>
                    <td className="text-cyan font-bold mono">{w.well_id}</td>
                    <td>{w.field}</td>
                    <td><span className={statusBadge(w.status)}>{w.status}</span></td>
                    <td className="text-teal">{w.current_formation}</td>
                    <td>
                      <div className="wellbore-vis-container">
                        <span className="mono text-dim">{fmtN(w.current_depth)} m</span>
                        <div className="wellbore-vis-bar">
                          <div className="wellbore-vis-fill" style={{ width: '100%' }} />
                          {wevents.map((e, i) => (
                             <div key={i} className="wellbore-vis-event" style={{ left: `${(e.depth / w.total_depth) * 100}%`, background: eventColor(e.event_type) }} />
                          ))}
                        </div>
                      </div>
                    </td>
                  </tr>
                  {isEx && (
                    <tr className="well-expand-row">
                      <td colSpan={5}>
                        <div className="well-expand-panel">
                          <div className="well-expand-grid">
                            <div>
                              <div className="dr-sec-ttl">WELL PROFILE</div>
                              <div className="dr-ev-row"><span className="dr-ev-key">TOTAL DEPTH</span><span className="dr-ev-val mono">{fmtN(w.total_depth)} m</span></div>
                              <div className="dr-ev-row"><span className="dr-ev-key">EVENTS</span><span className="dr-ev-val">{wevents.length} recorded</span></div>
                            </div>
                            <div>
                               <div className="dr-sec-ttl">HISTORICAL EVENTS</div>
                               <div className="flex gap-2 flex-wrap">
                                  {wevents.map((e, i) => <span key={i} className={evTypeBadge(e.event_type)}>{e.event_type.replace(/_/g, ' ')} ({fmtN(e.depth)}m)</span>)}
                                  {wevents.length === 0 && <span className="text-dim text-xs">No events recorded</span>}
                               </div>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// KNOWLEDGE BASE SECTION
// ══════════════════════════════════════════════════════════════════════
function KnowledgeSection({ events }: { events: WellEvent[] }) {
  const [filter, setFilter] = useState('');
  
  const filtered = events.filter(e => 
    e.event_type.toLowerCase().includes(filter.toLowerCase()) || 
    e.formation.toLowerCase().includes(filter.toLowerCase()) ||
    e.well_id.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="section-enter dash-panel">
      <div className="panel-hd">
        <span className="panel-ttl">INSTITUTIONAL DRILLING MEMORY</span>
        <div className="search-bar">
          <Search size={12} className="text-dim" />
          <input className="search-input" placeholder="Filter evidence..." value={filter} onChange={e => setFilter(e.target.value)} />
        </div>
      </div>
      <div className="kb-records">
        {filtered.slice(0, 30).map(e => (
          <div key={e.event_id} className="kb-record">
            <div className="kb-record-hd">
              <span className={evTypeBadge(e.event_type)}>{e.event_type.replace(/_/g, ' ')}</span>
              <span className={sevBadge(e.severity)}>{e.severity}</span>
            </div>
            <div className="kb-record-sub">
              <span className="mono text-cyan">{e.well_id}</span> &middot; <span className="text-teal">{e.formation}</span> &middot; <span className="mono">{fmtN(e.depth)} m</span>
            </div>
            
            <div className="kb-record-body">
              <div className="dr-sec-ttl">HISTORICAL OBSERVATION</div>
              <p>{e.description}</p>
            </div>
            
            <div className="kb-record-body" style={{ marginTop: 8 }}>
              <div className="dr-sec-ttl">MITIGATION & OUTCOME</div>
              <p>{e.mitigation}</p>
              <div className="kb-outcome mt-1 text-cyan font-semibold">Outcome: {e.outcome}</div>
            </div>
            
            <div className="kb-record-src">
              <FileText size={10} style={{ marginRight: 4 }} />
              {e.source_document} &middot; Page {e.source_page}
            </div>
          </div>
        ))}
        {filtered.length === 0 && <EmptyState msg="No evidence records match the filter." />}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// SEARCH SECTION
// ══════════════════════════════════════════════════════════════════════
function SearchSection({ activeWellId, initialQuery }: { activeWellId: string; initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialQuery) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  const run = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const r = await searchKnowledge(query, activeWellId);
      setResults(r);
    } finally { setLoading(false); }
  };

  return (
    <div className="section-enter dash-panel">
      <div className="panel-hd"><span className="panel-ttl">SEARCH & ASK NWIS</span></div>
      <div className="p-4">
        <div className="hero-search-box" style={{ maxWidth: 800, background: 'var(--surface-2)', border: '1px solid var(--border-3)' }}>
          <span className="hero-search-prompt" style={{ color: 'var(--col-cyan)' }}>QUERY</span>
          <div className="hero-search-input-wrap">
            <Search size={16} className="hero-search-icon" style={{ color: 'var(--text-4)' }} />
            <input style={{ background: 'transparent', border: 'none', color: 'var(--text)', outline: 'none', flex: 1, fontSize: 16 }}
              placeholder="What risks are ahead?" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()} />
            <button className="hero-search-btn" onClick={run} style={{ background: 'var(--col-cyan)', color: '#000', border: 'none', padding: '8px 16px', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>ANALYZE</button>
          </div>
        </div>
        {loading && <div className="mt-4"><Spinner /></div>}
        {results && (
          <div className="mt-4">
            <div className="text-xs text-muted mb-2">{results.total_results} results found</div>
            <table className="data-table">
              <thead><tr><th>Type</th><th>Well</th><th>Match</th></tr></thead>
              <tbody>
                {results.results.map((r, i) => (
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
  );
}

// ══════════════════════════════════════════════════════════════════════
// ROOT APP
// ══════════════════════════════════════════════════════════════════════
const NAV: { id: Section; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'map', label: 'Geospatial' },
  { id: 'risk', label: 'Risk Intelligence' },
  { id: 'wells', label: 'Well Explorer' },
  { id: 'knowledge', label: 'Knowledge Base' },
  { id: 'search', label: 'Search' },
];

export default function App() {
  const [section, setSection] = useState<Section>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [demoActive, setDemoActive] = useState(false);

  const [activeWells, setActiveWells] = useState<Well[]>([]);
  const [activeWellId, setActiveWellId] = useState<string>('ACTIVE-001');
  const [activeWell, setActiveWell] = useState<Well | null>(null);

  const [simDepth, setSimDepth] = useState<number>(2850);
  const [simMin, setSimMin] = useState<number>(2550);
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

  const [utcTime, setUtcTime] = useState(() => new Date().toISOString().slice(11, 19));
  useEffect(() => {
    const t = setInterval(() => setUtcTime(new Date().toISOString().slice(11, 19)), 1000);
    return () => clearInterval(t);
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
      const base: Promise<unknown>[] = [
        getNearbyWells(activeWellId, radius),
        getCurrentRisk(activeWellId, radius, depth),
        getAlerts(activeWellId, radius, depth),
        getRiskZones(activeWellId, radius),
      ];
      if (!partial) {
        base.push(getAllEvents({ limit: 80 }), getSystemStats(), getWells());
      }
      const res = await Promise.all(base);
      setNearbyWells(res[0] as NearbyWell[]);
      setRisks(res[1] as RiskPrediction[]);
      setAlerts(res[2] as Alert[]);
      setRiskZones(res[3] as HistoricalRiskZone[]);
      if (!partial) {
        setEvents(res[4] as WellEvent[]);
        setStats(res[5] as SystemStats);
        setAllWells(res[6] as Well[]);
      }
    } catch (e: unknown) {
      setError((e as Error).message || 'Failed to reach NWIS intelligence feed.');
    } finally { setLoading(false); }
  }, [activeWellId, radius, simDepth]);

  useEffect(() => { refresh(simDepth); }, [activeWellId, radius, refresh, simDepth]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDepthChange = (d: number) => {
    setSimDepth(d);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => refresh(d, true), 400);
  };

  const handleSearch = (q: string) => {
    setSearchQuery(q);
    setSection('search');
  };

  const topRiskLevel = risks[0]?.risk_level ?? 'NOMINAL';

  return (
    <div className="nwis-app">
      {/* ══ LAYER 1: ORGANIZATION STRIP ══ */}
      <div className="org-strip">
        <div className="org-left">
          <span className="org-brand hindi-text">भारत सरकार</span>
          <span className="org-sep">|</span>
          <span className="org-brand">GOVERNMENT OF INDIA</span>
          <span className="org-sep">|</span>
          <span>MINISTRY OF EARTH SCIENCES</span>
          <span className="org-sep">|</span>
          <span className="org-brand">OIL INDIA LIMITED</span>
          <span className="org-sep">|</span>
          <span style={{ color: 'var(--col-cyan)', fontWeight: 'bold' }}>eRTMAC-NWIS</span>
        </div>
        <div className="org-right">
          <span className="org-sys-lbl">SYSTEM</span>
          <span className="org-sys-val">&#9679; NOMINAL</span>
          <span className="org-sep">|</span>
          <span className="mono">{utcTime} UTC</span>
        </div>
      </div>

      {/* ══ LAYER 2: BRAND / ACTIVE WELL HEADER ══ */}
      <header className="brand-header">
        <div className="bh-left">
          <div className="brand-mark">
            <DrillBitIcon size={24} color="var(--col-cyan)" />
          </div>
          <div className="brand-text">
            <div className="brand-name">NWIS</div>
            <div className="brand-full">Nearby Wells Intelligence System</div>
            <div className="brand-org">OIL INDIA LIMITED · DRILLING OPERATIONS</div>
          </div>
        </div>

        <div className="bh-well-selector">
          <div className="bh-ws-label">ACTIVE WELL &#9660;</div>
          <select className="bh-ws-select" value={activeWellId} onChange={e => setActiveWellId(e.target.value)}>
            {activeWells.map(w => <option key={w.well_id} value={w.well_id}>{w.well_id}</option>)}
          </select>
        </div>

        <div className="bh-metrics">
          <div className="bh-metric">
            <span className="bhm-lbl">CURRENT DEPTH</span>
            <span className="bhm-val mono">{fmtN(simDepth)} m</span>
          </div>
          <div className="bh-metric">
            <span className="bhm-lbl">FORMATION</span>
            <span className="bhm-val" style={{ color: '#0d9488' }}>{activeWell?.current_formation || '—'}</span>
          </div>
          <div className="bh-metric">
            <span className="bhm-lbl">FEED</span>
            <span className="bhm-val bh-feed-val">&#9679; SIMULATED</span>
          </div>
        </div>

        <div className="bh-actions">
          {alerts.length > 0 && (
            <span className="badge b-red" style={{ fontSize: 10, padding: '4px 8px' }}>
              <TriangleAlert size={10} style={{ marginRight: 3 }} />
              {alerts.length} ALERT{alerts.length > 1 ? 'S' : ''}
            </span>
          )}
          <button className="bh-refresh-btn" onClick={() => refresh(simDepth)} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
            REFRESH FEED
          </button>
        </div>
      </header>

      {/* ══ LAYER 3: PRIMARY NAVIGATION ══ */}
      <nav className="primary-nav">
        {NAV.map(({ id, label }) => (
          <button key={id} className={`nav-btn ${section === id ? 'nav-btn-active' : ''}`} onClick={() => setSection(id)}>
            {id === 'risk' && alerts.length > 0 && <span className="nav-alert-dot" />}
            {label}
          </button>
        ))}
        <div className="nav-depth-sim">
          <Activity size={10} style={{ color: 'var(--col-cyan)', flexShrink: 0 }} />
          <span className="nav-depth-lbl">SIMULATE DEPTH</span>
          <input type="range" min={simMin} max={simMax} step={25} value={simDepth} onChange={e => onDepthChange(+e.target.value)} className="nav-depth-slider" />
          <span className="mono nav-depth-val">{fmtN(simDepth)} m</span>
        </div>
      </nav>

      {/* ══ LAYER 4: LIVE STATUS STRIP ══ */}
      <div className="status-strip">
        <div className="ss-item">
          <span className={`ss-dot ${activeWell ? 'ok' : 'err'}`} />
          <span>ERTMAC FEED: {activeWell ? 'ACTIVE' : 'UNAVAILABLE'}</span>
        </div>
        <div className="ss-sep" />
        <div className="ss-item">
          <span className="ss-dot ok" />
          <span className="mono">{activeWellId} · {fmtN(simDepth)} m</span>
          <span style={{ color: 'var(--col-teal)', marginLeft: 4 }}>· {activeWell?.current_formation}</span>
        </div>
        <div className="ss-sep" />
        <div className="ss-item">
          <span className={`ss-dot ${nearbyWells.length > 0 ? 'ok' : 'warn'}`} />
          <span>SPATIAL ENGINE: {nearbyWells.length} OFFSET WELLS</span>
        </div>
        <div className="ss-sep" />
        <div className="ss-item">
          <span className={`ss-dot ${risks.length > 0 ? (topRiskLevel === 'CRITICAL' ? 'err' : 'warn') : 'ok'}`} />
          <span>RISK ENGINE: {topRiskLevel}</span>
        </div>
        <div className="ss-sep" />
        <div className="ss-item">
          <span className={`ss-dot ${events.length > 0 ? 'ok' : 'warn'}`} />
          <span>EVIDENCE STORE: {events.length > 0 ? 'READY' : 'LOADING'}</span>
        </div>
        <div className="ss-time mono">UPDATED {utcTime}</div>
      </div>

      {/* ══ MAIN WORKSPACE ══ */}
      <main className="main-workspace">
        {error ? (
          <div className="workspace-inner">
            <div className="panel" style={{ padding: 40, textAlign: 'center' }}>
              <div style={{ color: 'var(--col-red)', fontWeight: 700, marginBottom: 8 }}>SYSTEM ERROR</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{error}</div>
            </div>
          </div>
        ) : (
          <div className="workspace-scroll">
            <div className="workspace-inner">
              {section === 'overview' && (
                <OverviewSection
                  activeWell={activeWell} simDepth={simDepth} stats={stats}
                  risks={risks} alerts={alerts} nearbyWells={nearbyWells}
                  riskZones={riskZones} events={events} onSearch={handleSearch}
                  onStartDemo={() => setDemoActive(true)}
                />
              )}
              {section === 'map' && <GeospatialSection activeWell={activeWell} nearbyWells={nearbyWells} risks={risks} radius={radius} onRadiusChange={setRadius} />}
              {section === 'risk' && <RiskSection activeWell={activeWell} risks={risks} alerts={alerts} nearbyWells={nearbyWells} events={events} />}
              {section === 'wells' && <WellsSection wells={allWells} events={events} />}
              {section === 'knowledge' && <KnowledgeSection events={events} />}
              {section === 'search' && <SearchSection activeWellId={activeWellId} initialQuery={searchQuery} />}
            </div>
          </div>
        )}
      </main>

      <DemoTour isActive={demoActive} onClose={() => setDemoActive(false)} setSection={setSection} />

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
"""

INDEX_CSS = """@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700;800&family=Noto+Sans+Devanagari:wght@400;600;700&display=swap');

:root {
  --bg:           #07090f;
  --surface:      #0d1117;
  --surface-2:    #131920;
  --surface-3:    #182030;
  --surface-hov:  #1e2840;

  --border:    #1c2536;
  --border-2:  #253145;
  --border-3:  #334160;

  --text:   #f0f4f8;
  --text-2: #b8c8dc;
  --text-3: #8098b8;
  --text-4: #506070;
  --text-5: #2e3d54;

  --col-cyan:   #22d3ee;
  --col-teal:   #14b8a6;
  --col-green:  #22c55e;
  --col-amber:  #f59e0b;
  --col-orange: #f97316;
  --col-red:    #ef4444;
  --col-purple: #a78bfa;
  --col-blue:   #3b82f6;

  --cyan-dim:   rgba(34,211,238,0.12);
  --cyan-mid:   rgba(34,211,238,0.35);
  --teal-dim:   rgba(20,184,166,0.12);
  --green-dim:  rgba(34,197,94,0.12);
  --green-mid:  rgba(34,197,94,0.3);
  --amber-dim:  rgba(245,158,11,0.12);
  --amber-mid:  rgba(245,158,11,0.3);
  --orange-dim: rgba(249,115,22,0.12);
  --orange-mid: rgba(249,115,22,0.3);
  --red-dim:    rgba(239,68,68,0.12);
  --red-mid:    rgba(239,68,68,0.3);
  --purple-dim: rgba(167,139,250,0.12);
  --purple-mid: rgba(167,139,250,0.3);

  --shadow-sm: 0 2px 6px rgba(0,0,0,0.4);
  --shadow:    0 4px 16px rgba(0,0,0,0.6);
  --shadow-lg: 0 12px 40px rgba(0,0,0,0.8);

  --r-xs: 2px;
  --r-sm: 4px;
  --r-md: 6px;
  --r-lg: 10px;

  --h-org:    26px;
  --h-brand:  78px;
  --h-nav:    48px;
  --h-status: 30px;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html, body, #root {
  height: 100%;
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-2);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.mono { font-family: 'JetBrains Mono', monospace; }
.hindi-text { font-family: 'Noto Sans Devanagari', sans-serif; }
.text-dim { color: var(--text-4); }
.sec-label {
  font-size: 10px; font-weight: 800; color: var(--text-4);
  text-transform: uppercase; letter-spacing: 1.2px;
}

.nwis-app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--bg);
}

.org-strip {
  height: var(--h-org);
  background: #000;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: var(--text-4);
  flex-shrink: 0;
}
.org-left  { display: flex; align-items: center; gap: 10px; }
.org-right { display: flex; align-items: center; gap: 10px; }
.org-brand { color: var(--text-2); font-weight: 700; }
.org-sep   { color: var(--border-3); }
.org-sys-lbl { color: var(--text-5); }
.org-sys-val { color: var(--col-green); font-weight: 700; }

.brand-header {
  height: var(--h-brand);
  background: #f8fafc;
  border-bottom: 2px solid #e2e8f0;
  display: flex;
  align-items: center;
  padding: 0 24px;
  gap: 24px;
  flex-shrink: 0;
}
.bh-left { display: flex; align-items: center; gap: 14px; flex-shrink: 0; }
.brand-mark {
  width: 44px; height: 44px;
  background: #0d1117;
  border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.brand-text { display: flex; flex-direction: column; }
.brand-name { font-size: 22px; font-weight: 900; color: #0d1117; letter-spacing: -0.5px; line-height: 1; }
.brand-full { font-size: 11px; font-weight: 600; color: #64748b; margin-top: 2px; }
.brand-org  { font-size: 9px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; margin-top: 3px; }

.bh-well-selector {
  display: flex; flex-direction: column; gap: 2px;
  background: #fff; border: 1px solid #e2e8f0;
  padding: 8px 14px; border-radius: 6px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  cursor: pointer; transition: all 0.2s;
}
.bh-well-selector:hover { border-color: var(--col-cyan); box-shadow: 0 2px 8px rgba(34,211,238,0.1); transform: translateY(-1px); }
.bh-ws-label { font-size: 9px; font-weight: 800; color: #94a3b8; letter-spacing: 1.2px; }
.bh-ws-select {
  font-family: 'JetBrains Mono', monospace;
  font-size: 15px; font-weight: 700; color: #0d1117;
  background: transparent; border: none; outline: none; cursor: pointer;
}

.bh-metrics { display: flex; align-items: center; gap: 24px; margin-left: auto; }
.bh-metric  { display: flex; flex-direction: column; gap: 2px; }
.bhm-lbl    { font-size: 9px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; }
.bhm-val    { font-size: 15px; font-weight: 700; color: #0d1117; line-height: 1; }
.bh-feed-val { color: #16a34a; font-size: 12px; font-weight: 800; }

.bh-actions { display: flex; align-items: center; gap: 12px; }
.bh-refresh-btn {
  display: inline-flex; align-items: center; gap: 7px;
  background: #0d1117; color: #fff;
  border: 1px solid transparent; padding: 10px 16px; border-radius: 5px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase;
  cursor: pointer; transition: all 0.2s;
}
.bh-refresh-btn:hover   { background: #1e2836; border-color: var(--col-cyan); transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
.bh-refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.primary-nav {
  height: var(--h-nav);
  background: var(--surface);
  border-bottom: 1px solid var(--border-2);
  display: flex;
  align-items: center;
  padding: 0 20px;
  gap: 2px;
  flex-shrink: 0;
}

.nav-btn {
  height: 32px; padding: 0 15px;
  display: flex; align-items: center; gap: 6px;
  background: transparent; border: 1px solid transparent; border-radius: var(--r-sm);
  color: var(--text-3); font-size: 12px; font-weight: 600;
  cursor: pointer; transition: all 0.15s; position: relative;
  white-space: nowrap;
}
.nav-btn:hover { color: var(--text); background: var(--surface-2); }
.nav-btn-active {
  color: var(--col-cyan);
  background: var(--cyan-dim);
  border-color: var(--cyan-mid);
}
.nav-alert-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--col-red);
  position: absolute; top: 4px; right: 4px;
}

.nav-depth-sim {
  margin-left: auto;
  display: flex; align-items: center; gap: 8px;
  background: var(--surface-2);
  border: 1px solid var(--border-2);
  border-radius: var(--r-sm);
  padding: 4px 12px;
}
.nav-depth-lbl { font-size: 9px; font-weight: 700; color: var(--text-5); letter-spacing: 1px; }
.nav-depth-slider {
  width: 100px; height: 3px; appearance: none;
  background: var(--border-2); border-radius: 2px; outline: none;
}
.nav-depth-slider::-webkit-slider-thumb {
  appearance: none; width: 10px; height: 10px; border-radius: 50%;
  background: var(--col-cyan); cursor: pointer;
  box-shadow: 0 0 5px rgba(34,211,238,0.4);
}
.nav-depth-val { font-size: 12px; font-weight: 700; color: var(--col-cyan); }

.status-strip {
  height: var(--h-status);
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  padding: 0 20px;
  gap: 0;
  font-size: 10px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.8px;
  color: var(--text-3);
  overflow: hidden;
  flex-shrink: 0;
}
.ss-item { display: flex; align-items: center; gap: 6px; padding: 0 12px; }
.ss-dot  { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.ss-dot.ok   { background: var(--col-green); box-shadow: 0 0 5px var(--col-green); }
.ss-dot.warn { background: var(--col-amber); box-shadow: 0 0 5px var(--col-amber); }
.ss-dot.err  { background: var(--col-red);   box-shadow: 0 0 5px var(--col-red); }
.ss-sep  { width: 1px; height: 14px; background: var(--border-3); flex-shrink: 0; }
.ss-time { margin-left: auto; color: var(--text-5); }

.main-workspace {
  flex: 1;
  overflow: hidden;
  position: relative;
  background: var(--bg);
}
.workspace-scroll {
  position: absolute; inset: 0;
  overflow-y: auto; overflow-x: hidden;
}
.workspace-inner {
  padding: 20px 24px;
  min-height: 100%;
}

.section-enter { animation: sectionIn 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94) both; }
@keyframes sectionIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

.ov-root { display: flex; flex-direction: column; gap: 20px; }

.hero-panel {
  position: relative;
  border: 1px solid var(--border-2);
  border-radius: var(--r-lg);
  overflow: hidden;
  background: #080c14;
  min-height: 340px;
}
.hero-overlay {
  position: absolute; inset: 0;
  background: radial-gradient(ellipse at 30% 50%, rgba(34,211,238,0.05) 0%, transparent 60%),
              radial-gradient(ellipse at 80% 80%, rgba(20,184,166,0.03) 0%, transparent 50%),
              linear-gradient(to bottom, rgba(7,9,15,0) 0%, rgba(7,9,15,0.7) 100%);
  pointer-events: none;
  z-index: 1;
}
.hero-content {
  position: relative; z-index: 2;
  display: flex; flex-direction: column;
  padding: 28px 32px;
}

.hero-demo-ctrls {
  position: absolute; top: 28px; right: 32px;
}
.hero-demo-btn {
  background: rgba(34,211,238,0.1);
  border: 1px solid var(--col-cyan);
  color: var(--col-cyan);
  padding: 8px 16px;
  border-radius: 20px;
  font-weight: 800;
  box-shadow: 0 0 15px rgba(34,211,238,0.15);
  animation: pulseDemo 2s infinite;
}
.hero-demo-btn:hover {
  background: var(--col-cyan);
  color: #000;
  box-shadow: 0 0 20px rgba(34,211,238,0.4);
}
@keyframes pulseDemo {
  0%, 100% { box-shadow: 0 0 15px rgba(34,211,238,0.15); }
  50% { box-shadow: 0 0 25px rgba(34,211,238,0.3); }
}

.hero-alert {
  display: flex; align-items: flex-start; gap: 10px;
  background: rgba(239,68,68,0.1);
  border: 1px solid rgba(239,68,68,0.35);
  border-radius: var(--r-md);
  padding: 10px 14px;
  margin-bottom: 20px;
  font-size: 11px; color: var(--text-2);
}
.hero-alert-ttl { font-weight: 700; color: var(--col-red); }
.hero-alert-body { color: var(--text-3); }

.hero-main {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 40px;
  align-items: start;
  margin-bottom: 28px;
}
.hero-text-block {}
.hero-title {
  font-size: 28px; font-weight: 900; color: var(--text);
  line-height: 1.1; letter-spacing: -0.3px;
  margin-bottom: 16px;
}
.hero-desc {
  font-size: 13px; color: var(--text-3); line-height: 1.7;
  max-width: 480px;
}

.hero-search-wrap { display: flex; flex-direction: column; gap: 8px; }
.hero-search-label {
  font-size: 10px; font-weight: 800; color: var(--col-cyan);
  letter-spacing: 2px; text-transform: uppercase;
}
.hero-search-row { display: flex; gap: 8px; }
.hero-search-box {
  flex: 1; display: flex; align-items: center; gap: 10px;
  background: rgba(0,0,0,0.5);
  border: 1px solid var(--border-2);
  border-radius: var(--r-md);
  padding: 10px 14px;
  backdrop-filter: blur(4px);
  transition: border-color 0.2s, box-shadow 0.2s;
}
.hero-search-box:focus-within { border-color: var(--cyan-mid); box-shadow: 0 0 10px rgba(34,211,238,0.1); }
.hero-search-input {
  flex: 1; background: transparent; border: none; outline: none;
  color: var(--text); font-size: 13px; font-family: 'Inter', sans-serif;
}
.hero-search-input::placeholder { color: var(--text-4); }
.hero-analyze-btn {
  background: var(--col-cyan); color: #000;
  border: none; padding: 10px 22px; border-radius: var(--r-sm);
  font-size: 12px; font-weight: 800; letter-spacing: 1px;
  cursor: pointer; white-space: nowrap; transition: all 0.2s;
}
.hero-analyze-btn:hover { background: #67e8f9; transform: translateY(-1px); box-shadow: 0 2px 8px rgba(34,211,238,0.3); }

.hero-quick-actions {
  display: flex; gap: 6px; flex-wrap: wrap;
  margin-top: 8px;
}
.hero-qa-btn {
  padding: 3px 10px;
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--border-2);
  border-radius: var(--r-sm);
  color: var(--text-4); font-size: 10px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.hero-qa-btn:hover { color: var(--col-cyan); border-color: var(--cyan-mid); background: var(--cyan-dim); transform: translateY(-1px); }

.hero-chips {
  display: flex; align-items: center; gap: 0;
  background: rgba(0,0,0,0.4);
  border: 1px solid var(--border-2);
  border-radius: var(--r-md);
  padding: 0;
  overflow: hidden;
  backdrop-filter: blur(4px);
  width: fit-content;
}
.hero-chip {
  display: flex; flex-direction: column;
  padding: 8px 18px;
  gap: 2px;
}
.chip-lbl { font-size: 8px; font-weight: 800; color: var(--text-5); text-transform: uppercase; letter-spacing: 1px; }
.chip-val { font-size: 13px; font-weight: 700; color: var(--text); }
.chip-sep { width: 1px; height: 30px; background: var(--border-2); }

.panel {
  background: var(--surface);
  border: 1px solid var(--border-2);
  border-radius: var(--r-md);
  overflow: hidden;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}
.panel:hover { border-color: var(--border-3); }
.h-full { height: 100%; }

.panel-hd {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: rgba(255,255,255,0.012);
}
.panel-ttl {
  font-size: 11px; font-weight: 800; color: var(--text);
  text-transform: uppercase; letter-spacing: 0.8px;
  display: flex; align-items: center;
}

.feed-live {
  display: flex; align-items: center; gap: 6px;
  font-size: 10px; font-weight: 700; color: var(--col-green);
  text-transform: uppercase; letter-spacing: 0.5px;
}
.feed-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--col-green);
  animation: feedPulse 2s ease-in-out infinite;
}
@keyframes feedPulse {
  0%, 100% { box-shadow: 0 0 0 2px rgba(34,197,94,0.2); }
  50%       { box-shadow: 0 0 0 5px rgba(34,197,94,0); }
}

.panel-empty {
  padding: 32px; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center;
}
.no-risk-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--col-green); box-shadow: 0 0 8px var(--col-green); }
.no-risk-lbl { font-size: 13px; font-weight: 700; color: var(--col-green); }
.no-risk-sub { font-size: 11px; color: var(--text-4); }

.telem-strip {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  background: var(--border);
  gap: 1px;
}
.telem-cell {
  background: var(--surface-2);
  padding: 12px 14px;
  display: flex; flex-direction: column; gap: 4px;
  transition: background 0.2s;
}
.telem-cell:hover { background: var(--surface-3); }
.telem-accent { background: var(--surface-3); }
.telem-lbl { font-size: 9px; font-weight: 800; color: var(--text-4); text-transform: uppercase; letter-spacing: 0.8px; }
.telem-val-row { display: flex; align-items: flex-end; gap: 6px; }
.telem-val { font-family: 'JetBrains Mono', monospace; font-size: 18px; font-weight: 700; color: var(--text); line-height: 1; transition: color 0.3s; }
.telem-unit { font-size: 9px; color: var(--text-4); font-family: 'Inter', sans-serif; font-weight: 600; }
.telem-trend { font-size: 10px; font-weight: 700; }
.trend-up { color: var(--col-red); }
.trend-dn { color: var(--col-green); }

.ov-row-2col {
  display: grid;
  gap: 16px;
  align-items: start;
}
.ov-row-geo {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 16px;
  align-items: start;
}

.rh-body { padding: 20px 24px; }
.rh-timeline {
  position: relative;
  padding-left: 80px;
  display: flex; flex-direction: column; gap: 18px;
}
.rh-spine {
  position: absolute; left: 64px; top: 10px; bottom: 10px;
  width: 2px; background: var(--border-2);
}
.rh-row { position: relative; display: flex; align-items: center; min-height: 30px; transition: transform 0.2s; }
.rh-row:hover { transform: translateX(2px); }
.rh-row-active {}
.rh-depth {
  position: absolute; left: -80px; width: 56px;
  text-align: right;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px; font-weight: 600; color: var(--text-4);
}
.rh-depth-dim { color: var(--text-5); }
.rh-bit-indicator {
  position: absolute; left: -10px;
  display: flex; align-items: center;
}
.rh-bit-dot {
  width: 14px; height: 14px; border-radius: 50%;
  background: var(--col-cyan);
  border: 2px solid var(--bg);
  box-shadow: 0 0 12px var(--col-cyan), 0 0 24px rgba(34,211,238,0.3);
  animation: bitPulse 2s ease-in-out infinite;
}
@keyframes bitPulse {
  0%, 100% { box-shadow: 0 0 12px var(--col-cyan); }
  50%       { box-shadow: 0 0 20px var(--col-cyan), 0 0 36px rgba(34,211,238,0.2); }
}
.rh-tick-dot {
  position: absolute; left: 60px;
  width: 8px; height: 8px; border-radius: 50%;
  border: 1px solid var(--bg);
}
.rh-event-block { margin-left: 16px; display: flex; flex-direction: column; gap: 2px; }
.rh-current-lbl { font-size: 12px; font-weight: 800; color: var(--col-cyan); letter-spacing: 0.5px; }
.rh-event-name  { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
.rh-event-interval { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--text-4); }

.pr-body { padding: 20px; display: flex; flex-direction: column; gap: 0; }
.pr-type {
  font-size: 16px; font-weight: 800; text-transform: uppercase;
  letter-spacing: 0.5px; margin-bottom: 10px;
}
.pr-score-row { display: flex; align-items: baseline; margin-bottom: 10px; }
.pr-score {
  font-family: 'JetBrains Mono', monospace;
  font-size: 38px; font-weight: 800; line-height: 1;
}
.pr-score-denom { font-size: 14px; color: var(--text-4); font-weight: 600; margin-left: 4px; }
.pr-rows { border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); padding: 10px 0; display: flex; flex-direction: column; gap: 8px; margin: 10px 0; }
.pr-row { display: flex; justify-content: space-between; font-size: 11px; }
.pr-row-lbl { color: var(--text-4); font-weight: 700; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; }
.pr-row-val { color: var(--text); font-weight: 600; }
.pr-why-ttl { font-size: 9px; font-weight: 800; color: var(--text-5); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; margin-top: 12px; }
.pr-why-body { font-size: 11px; color: var(--text-3); line-height: 1.6; margin-bottom: 16px; }

.analog-list { padding: 12px; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; max-height: 380px; }
.analog-card {
  background: var(--surface-2); border: 1px solid var(--border-2);
  border-radius: var(--r-md); padding: 10px 12px;
  transition: all 0.2s; cursor: pointer;
}
.analog-card:hover { border-color: var(--col-cyan); background: var(--surface-hov); transform: translateY(-1px); box-shadow: var(--shadow-sm); }
.analog-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.analog-id { font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 700; color: var(--col-cyan); }
.analog-rows { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
.analog-row-item { display: flex; justify-content: space-between; font-size: 10px; font-weight: 600; }
.analog-row-item span:first-child { color: var(--text-4); letter-spacing: 0.5px; }
.analog-row-item span:last-child  { color: var(--text-2); }
.analog-bar-track { height: 3px; background: var(--border); border-radius: 2px; margin-bottom: 6px; }
.analog-bar-fill  { height: 100%; border-radius: 2px; transition: width 0.5s ease; }
.analog-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.analog-tag { font-size: 9px !important; padding: 1px 5px !important; }

.hi-body { padding: 16px; display: flex; flex-direction: column; height: 100%; }
.hi-stats { display: flex; flex-direction: column; gap: 12px; flex: 1; }
.hi-stat-row { display: flex; align-items: baseline; gap: 8px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
.hi-stat-row:last-child { border-bottom: none; }
.hi-stat-val { font-size: 22px; font-weight: 800; color: var(--col-cyan); line-height: 1; }
.hi-stat-lbl { font-size: 10px; color: var(--text-4); font-weight: 600; }
.hi-actions { display: flex; flex-direction: column; gap: 6px; margin-top: 16px; }

.geo-root {
  display: flex; gap: 16px;
  height: calc(100vh - var(--h-org) - var(--h-brand) - var(--h-nav) - var(--h-status) - 40px);
  min-height: 500px;
}
.geo-map-wrap {
  flex: 1; display: flex; flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border-2);
  border-radius: var(--r-md);
  overflow: hidden;
}
.geo-map-wrap .panel-hd { flex-shrink: 0; }
.geo-radius-ctrl { display: flex; align-items: center; gap: 10px; }
.geo-slider {
  width: 100px; height: 3px; appearance: none;
  background: var(--border-2); border-radius: 2px; outline: none;
}
.geo-slider::-webkit-slider-thumb {
  appearance: none; width: 10px; height: 10px; border-radius: 50%;
  background: var(--col-cyan); cursor: pointer;
}

.risk-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
}
.risk-card {
  background: var(--surface); border: 1px solid var(--border-2);
  border-radius: var(--r-md); overflow: hidden;
  transition: all 0.2s;
}
.risk-card:hover { border-color: var(--col-cyan); box-shadow: var(--shadow); transform: translateY(-2px); }
.risk-card-hd { padding: 14px 16px; border-bottom: 1px solid var(--border); background: rgba(255,255,255,0.015); }
.risk-card-type { font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.4px; }
.risk-card-score {
  font-family: 'JetBrains Mono', monospace;
  font-size: 24px; font-weight: 800; margin-top: 8px; line-height: 1;
}
.risk-card-denom { font-size: 13px; color: var(--text-4); font-weight: 400; }

.well-row-hover:hover { background: var(--surface-hov); }
.well-expand-row { background: var(--surface-2); }
.well-expand-panel { padding: 16px; border-bottom: 1px solid var(--border-2); }
.well-expand-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }

.wellbore-vis-container { display: flex; align-items: center; gap: 10px; width: 120px; }
.wellbore-vis-bar { position: relative; height: 6px; flex: 1; background: var(--border-3); border-radius: 3px; overflow: hidden; }
.wellbore-vis-fill { position: absolute; left: 0; top: 0; height: 100%; background: var(--col-cyan); opacity: 0.2; }
.wellbore-vis-event { position: absolute; top: 0; height: 100%; width: 4px; border-radius: 2px; }

.kb-records { display: flex; flex-direction: column; gap: 12px; padding: 16px; overflow-y: auto; }
.kb-record {
  background: var(--surface-2); border: 1px solid var(--border-2);
  border-radius: var(--r-md); padding: 16px;
  transition: all 0.2s;
}
.kb-record:hover { border-color: var(--border-3); transform: translateX(2px); box-shadow: var(--shadow-sm); }
.kb-record-hd { display: flex; justify-content: space-between; margin-bottom: 8px; }
.kb-record-sub { font-size: 11px; font-weight: 600; color: var(--text-3); margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
.kb-record-body { font-size: 11.5px; color: var(--text-2); line-height: 1.6; }
.kb-record-src {
  margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--border-2);
  font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--text-4); display: flex; align-items: center;
}

.data-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.data-table th { text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--border-2); font-size: 10px; color: var(--text-4); text-transform: uppercase; letter-spacing: 1px; }
.data-table td { padding: 12px 14px; border-bottom: 1px solid var(--border); transition: background 0.15s; }

.drawer-overlay {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(0,0,0,0.65);
  backdrop-filter: blur(3px);
  animation: fadeOv 0.2s ease;
}
@keyframes fadeOv { from { opacity: 0; } to { opacity: 1; } }

.drawer {
  position: fixed; right: 0; top: 0; bottom: 0;
  width: 480px; max-width: 90vw;
  background: var(--surface);
  border-left: 1px solid var(--border-2);
  display: flex; flex-direction: column;
  z-index: 201;
  animation: drawerIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: var(--shadow-lg);
}
@keyframes drawerIn {
  from { transform: translateX(100%); }
  to   { transform: translateX(0); }
}
.drawer-hd {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-2);
  display: flex; align-items: center; justify-content: space-between;
  flex-shrink: 0; background: rgba(255,255,255,0.01);
}
.drawer-ttl { font-size: 12px; font-weight: 800; color: var(--text); text-transform: uppercase; letter-spacing: 0.8px; display: flex; align-items: center; }
.drawer-sub { font-size: 10px; color: var(--text-4); text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
.drawer-close {
  background: none; border: none; color: var(--text-4);
  cursor: pointer; padding: 4px; border-radius: var(--r-sm);
  font-size: 18px; line-height: 1;
  transition: color 0.15s;
}
.drawer-close:hover { color: var(--text); }
.drawer-body {
  flex: 1; overflow-y: auto;
  padding: 16px 20px;
  display: flex; flex-direction: column; gap: 16px;
}
.ev-summary {
  background: var(--surface-2); border: 1px solid var(--border-2);
  border-radius: var(--r-md); padding: 14px;
}
.ev-summary-top { display: flex; gap: 6px; margin-bottom: 10px; }
.ev-explain { font-size: 11px; color: var(--text-3); line-height: 1.6; }
.dr-sec-ttl { font-size: 10px; font-weight: 800; color: var(--text-4); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
.dr-factors { display: flex; flex-direction: column; gap: 6px; }
.dr-factor { display: flex; gap: 8px; font-size: 11px; }
.dr-factor-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--col-cyan); margin-top: 5px; flex-shrink: 0; }
.dr-factor-name { font-weight: 700; color: var(--text); }
.dr-factor-detail { color: var(--text-4); }
.dr-events { display: flex; flex-direction: column; gap: 10px; }
.dr-no-events { font-size: 11px; color: var(--text-4); padding: 12px; border: 1px solid var(--border-2); border-radius: var(--r-sm); }
.dr-event-card { border: 1px solid var(--border-2); border-radius: var(--r-md); overflow: hidden; transition: border-color 0.2s; }
.dr-event-card:hover { border-color: var(--border-3); }
.dr-event-src { background: var(--surface-2); padding: 7px 12px; border-bottom: 1px solid var(--border-2); font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--text-4); display: flex; align-items: center; }
.dr-event-rows { padding: 10px 12px; display: flex; flex-direction: column; gap: 5px; }
.dr-ev-row { display: flex; gap: 8px; font-size: 11px; }
.dr-ev-key { width: 90px; color: var(--text-4); font-weight: 700; text-transform: uppercase; font-size: 9px; letter-spacing: 0.5px; flex-shrink: 0; padding-top: 1px; }
.dr-ev-val { color: var(--text-2); line-height: 1.5; }

.demo-overlay-base {
  position: fixed; inset: 0; z-index: 9998;
  background: rgba(0,0,0,0.4); pointer-events: auto;
}
.demo-panel {
  position: fixed; z-index: 10000;
  width: 320px; background: var(--surface);
  border: 1px solid var(--col-cyan);
  border-radius: var(--r-md);
  padding: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.8), 0 0 0 1px rgba(34,211,238,0.2);
  transition: all 0.4s cubic-bezier(0.25, 1, 0.5, 1);
}
.demo-progress { font-size: 10px; font-weight: 800; color: var(--col-cyan); letter-spacing: 1px; margin-bottom: 8px; font-family: 'JetBrains Mono', monospace; }
.demo-ttl { font-size: 14px; font-weight: 800; color: var(--text); margin-bottom: 8px; letter-spacing: 0.5px; }
.demo-desc { font-size: 12px; color: var(--text-3); line-height: 1.6; margin-bottom: 20px; }
.demo-actions { display: flex; gap: 8px; }

.spinner-wrap { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; min-height: 120px; gap: 12px; }
.spinner { width: 22px; height: 22px; border: 2px solid var(--border-3); border-top-color: var(--col-cyan); border-radius: 50%; animation: spinA 0.8s linear infinite; }
@keyframes spinA { to { transform: rotate(360deg); } }
.spin { animation: spinA 0.8s linear infinite; }
.spinner-label { font-size: 11px; color: var(--text-4); text-transform: uppercase; letter-spacing: 0.5px; }

.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; min-height: 100px; padding: 24px; color: var(--text-4); font-size: 12px; text-align: center; gap: 8px; }

.btn {
  display: inline-flex; align-items: center; gap: 7px;
  font-family: 'Inter', sans-serif;
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px;
  padding: 7px 14px; border-radius: var(--r-sm); cursor: pointer;
  border: 1px solid transparent; outline: none;
  transition: all 0.2s; white-space: nowrap;
}
.btn-primary { background: var(--cyan-dim); color: var(--col-cyan); border-color: var(--cyan-mid); }
.btn-primary:hover { background: rgba(34,211,238,0.22); border-color: var(--col-cyan); transform: translateY(-1px); box-shadow: 0 2px 8px rgba(34,211,238,0.15); }
.btn-secondary { background: var(--surface-2); color: var(--text-2); border-color: var(--border-2); }
.btn-secondary:hover { background: var(--surface-3); border-color: var(--border-3); color: var(--text); transform: translateY(-1px); }
.btn-full { width: 100%; justify-content: center; }
.btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }

.badge {
  display: inline-flex; align-items: center;
  padding: 2px 7px;
  border-radius: var(--r-xs);
  font-size: 9px; font-weight: 800;
  text-transform: uppercase; letter-spacing: 0.5px;
  border: 1px solid transparent; white-space: nowrap;
}
.b-cyan   { background: var(--cyan-dim);   color: var(--col-cyan);   border-color: var(--cyan-mid); }
.b-teal   { background: var(--teal-dim);   color: var(--col-teal);   border-color: rgba(20,184,166,0.3); }
.b-green  { background: var(--green-dim);  color: var(--col-green);  border-color: var(--green-mid); }
.b-amber  { background: var(--amber-dim);  color: var(--col-amber);  border-color: var(--amber-mid); }
.b-orange { background: var(--orange-dim); color: var(--col-orange); border-color: var(--orange-mid); }
.b-red    { background: var(--red-dim);    color: var(--col-red);    border-color: var(--red-mid); }
.b-purple { background: var(--purple-dim); color: var(--col-purple); border-color: var(--purple-mid); }
.b-gray   { background: var(--surface-2);  color: var(--text-3);     border-color: var(--border-2); }

.search-bar {
  display: flex; align-items: center; gap: 8px;
  background: var(--surface-2); border: 1px solid var(--border-2);
  border-radius: var(--r-sm); padding: 6px 12px;
  transition: border-color 0.15s;
}
.search-bar:focus-within { border-color: var(--cyan-mid); }
.search-bar.large { padding: 10px 14px; border-radius: var(--r-md); }
.search-input { flex: 1; background: transparent; border: none; outline: none; color: var(--text); font-size: 12px; }
.search-input::placeholder { color: var(--text-4); }

.source-ref {
  display: inline-flex; align-items: center; gap: 4px;
  font-family: 'JetBrains Mono', monospace; font-size: 9px; color: var(--text-4);
}
"""

def main():
    import os
    base_dir = r"c:\Users\tharu\OneDrive\Desktop\backupsih\frontend\src"
    
    app_tsx_path = os.path.join(base_dir, "App.tsx")
    index_css_path = os.path.join(base_dir, "index.css")
    
    with open(app_tsx_path, "w", encoding="utf-8") as f:
        f.write(APP_TSX)
        
    with open(index_css_path, "w", encoding="utf-8") as f:
        f.write(INDEX_CSS)

if __name__ == "__main__":
    main()
