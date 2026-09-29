import React, { useEffect, useState, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Circle, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import {
  Activity, Database, FileText,
  Globe, Layers, RefreshCw, Search,
  Shield, Zap, TriangleAlert, Play, ArrowRight, ArrowLeft, X
} from 'lucide-react';

import {
  getActiveWells, getNearbyWells, getCurrentRisk, getSystemStats,
  getAllEvents, getAlerts, getRiskZones, searchKnowledge,
  getLatestTelemetry, getWells,
  type Well, type NearbyWell, type RiskPrediction, type Alert,
  type WellEvent, type SystemStats, type HistoricalRiskZone,
  type SearchResponse, type DrillingParameter,
} from './api';

// ── Leaflet icon fix
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

// ── Types
type Section = 'overview' | 'map' | 'risk' | 'wells' | 'knowledge' | 'search';

// ── Helpers
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

// ── Drill Bit Icon
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

// ── MapFlyTo
function MapFlyTo({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  useEffect(() => { map.flyTo([lat, lon], 12, { duration: 1 }); }, [lat, lon, map]);
  return null;
}

// ── Subsurface Canvas Animation ───────────────────────────────────────
function SubsurfaceCanvas({ simDepth, activeWell, riskZones }: { simDepth: number; activeWell: Well | null; riskZones: HistoricalRiskZone[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mouseRef.current = {
        x: (e.clientX / window.innerWidth - 0.5) * 2,
        y: (e.clientY / window.innerHeight - 0.5) * 2
      };
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

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

    const particles = Array.from({ length: 18 }).map(() => ({
      x: width * 0.6 + Math.random() * (width * 0.4),
      y: Math.random() * height,
      r: 0.5 + Math.random() * 1.5,
      speed: 0.15 + Math.random() * 0.3,
      drift: Math.random() * 0.015 - 0.0075,
      opacity: 0.1 + Math.random() * 0.35,
    }));

    let time = 0;
    let scanY = -100;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      if (!prefersReducedMotion) {
        time += 0.016;
        scanY += 0.5;
        if (scanY > height + 200) scanY = -100;
      }

      ctx.save();
      // Parallax
      const px = prefersReducedMotion ? 0 : mouseRef.current.x * -12;
      const py = prefersReducedMotion ? 0 : mouseRef.current.y * -8;
      ctx.translate(px, py);

      // ── Strata ──
      const strataOpacity = 0.04;
      const formations = ['GIRUJAN CLAY', 'TIPAM SANDSTONE', 'BARAIL GROUP', 'KOPILI SHALE'];
      for (let i = 0; i < formations.length; i++) {
        const y = height * (0.2 + i * 0.25) + Math.sin(time * 0.1 + i) * 8;
        ctx.beginPath();
        ctx.strokeStyle = `rgba(34,211,238,${strataOpacity})`;
        ctx.lineWidth = 1;
        ctx.setLineDash([8, 16]);
        ctx.moveTo(width * 0.5, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        ctx.setLineDash([]);
        
        ctx.fillStyle = `rgba(255,255,255,${strataOpacity + 0.03})`;
        ctx.font = '9px "JetBrains Mono"';
        ctx.fillText(formations[i], width * 0.9, y - 6);
      }

      // ── Depth Grid ──
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255,255,255,0.02)';
      ctx.lineWidth = 1;
      const bitX = width * 0.78;
      const bitY = height * 0.55;
      
      for (let x = width * 0.55; x < width; x += 90) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      ctx.stroke();

      // ── Telemetry Trace ──
      ctx.beginPath();
      ctx.strokeStyle = `rgba(34,211,238,${0.08 + Math.sin(time) * 0.03})`;
      ctx.lineWidth = 1;
      for (let x = width * 0.6; x < width; x += 4) {
        const y = bitY - 80 + Math.sin(x * 0.015 + time * 0.6) * 12 + Math.sin(x * 0.07 - time * 1.2) * 3;
        if (x === width * 0.6) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // ── Particles (Drilling Cuttings) ──
      particles.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(34,211,238,${p.opacity})`;
        ctx.fill();
        if (!prefersReducedMotion) {
          p.y -= p.speed;
          p.x += Math.sin(p.y * p.drift) * 0.5;
          if (p.y < -10) {
            p.y = height + 10;
            p.x = width * 0.6 + Math.random() * (width * 0.4);
          }
        }
      });

      // ── Depth Scan ──
      const scanGrad = ctx.createLinearGradient(0, scanY - 30, 0, scanY + 30);
      scanGrad.addColorStop(0, 'rgba(34,211,238,0)');
      scanGrad.addColorStop(0.5, 'rgba(34,211,238,0.05)');
      scanGrad.addColorStop(1, 'rgba(34,211,238,0)');
      ctx.fillStyle = scanGrad;
      ctx.fillRect(width * 0.5, scanY - 30, width * 0.5, 60);

      // ── Risk Markers ──
      riskZones.slice(0, 3).forEach((rz) => {
        const ry = bitY + (rz.interval_start - simDepth) * 0.6; // Scale relative to depth
        if (ry > 0 && ry < height) {
           ctx.beginPath();
           ctx.arc(bitX, ry, 2.5, 0, Math.PI * 2);
           const isCrit = rz.risk_type.includes('KICK') || rz.risk_type.includes('LOSS');
           const rcol = isCrit ? 'rgba(239,68,68,0.6)' : 'rgba(245,158,11,0.6)';
           ctx.fillStyle = rcol;
           ctx.fill();
           ctx.font = '8px "JetBrains Mono"';
           ctx.fillText(`${fmtN(rz.interval_start)}m ${rz.risk_type.replace(/_/g, ' ')}`, bitX + 10, ry + 3);
        }
      });

      // ── Active Bit ──
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(34,211,238,0.4)';
      ctx.lineWidth = 1;
      ctx.moveTo(bitX - 60, bitY);
      ctx.lineTo(bitX, bitY);
      ctx.stroke();

      const pulsePhase = (time * 1.8) % (Math.PI * 2);
      const ringRadius = 4 + Math.sin(pulsePhase) * 5;
      const ringOpacity = Math.max(0, 1 - Math.sin(pulsePhase));
      
      // Expanding ring
      if (!prefersReducedMotion) {
        ctx.beginPath();
        ctx.arc(bitX, bitY, Math.abs(ringRadius), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(34,211,238,${ringOpacity * 0.5})`;
        ctx.stroke();
      }

      // Core dot
      ctx.beginPath();
      ctx.arc(bitX, bitY, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#22d3ee';
      ctx.shadowColor = '#22d3ee';
      ctx.shadowBlur = 8 + Math.sin(time * 3) * 4;
      ctx.fill();
      ctx.shadowBlur = 0; // reset

      // Bit Labels
      ctx.fillStyle = '#22d3ee';
      ctx.font = 'bold 10px "Inter"';
      ctx.fillText('CURRENT BIT', bitX + 12, bitY - 5);
      
      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px "JetBrains Mono"';
      ctx.fillText(`MD ${fmtN(simDepth)} m`, bitX + 12, bitY + 8);
      
      if (activeWell?.current_formation) {
        ctx.fillStyle = '#0d9488';
        ctx.fillText(`FM: ${activeWell.current_formation}`, bitX + 12, bitY + 20);
      }

      ctx.restore();

      // ── Left Side Fade Mask (Ensures text readability) ──
      const grad = ctx.createLinearGradient(0, 0, width * 0.65, 0);
      grad.addColorStop(0, '#080c14');
      grad.addColorStop(0.7, '#080c14');
      grad.addColorStop(1, 'rgba(8,12,20,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width * 0.65, height);

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
  }, [simDepth, activeWell, riskZones]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }}
    />
  );
}

// ── Spinner
const Spinner = ({ label = 'Loading...' }: { label?: string }) => (
  <div className="spinner-wrap">
    <div className="spinner" />
    <span className="spinner-label">{label}</span>
  </div>
);

// ── EmptyState
const EmptyState = ({ msg }: { msg: string }) => (
  <div className="empty-state">{msg}</div>
);

// ── Evidence Drawer
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
          <button className="drawer-close" onClick={onClose}><X size={18} /></button>
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
  { id: 'command-center', title: 'COMMAND CENTER', desc: 'NWIS brings active-well context, historical offset-well intelligence and upcoming drilling-risk evidence into one workspace.', target: '[data-demo="command-center"]' },
  { id: 'active-well', title: 'ACTIVE WELL STATE', desc: 'The system maintains a persistent active-well context across all analysis sections.', target: '[data-demo="active-well"]' },
  { id: 'telemetry', title: 'LIVE TELEMETRY', desc: 'Current drilling parameters provide the live state used alongside historical evidence.', target: '[data-demo="telemetry"]' },
  { id: 'risk-horizon', title: 'RISK HORIZON', desc: 'Historical events are aligned against the current depth to identify risk intervals ahead of the bit.', target: '[data-demo="risk-horizon"]' },
  { id: 'primary-risk', title: 'PRIMARY RISK', desc: 'Risk is shown with supporting wells, depth, formation, evidence strength and explanation.', target: '[data-demo="primary-risk"]' },
  { id: 'analogs', title: 'ANALOG WELLS', desc: 'NWIS compares wells using more than simple geographic distance, including formation, depth and historical event relevance.', target: '[data-demo="analogs"]' },
  { id: 'geospatial', title: 'GEOSPATIAL', desc: 'Spatial context connects the active well to nearby historical evidence.', section: 'map', target: '[data-demo="geospatial"]' },
  { id: 'risk-intel', title: 'RISK INTELLIGENCE', desc: 'Detailed risk analysis shows the supporting evidence, depth zone and historical correlation.', section: 'risk', target: '[data-demo="risk-intelligence"]' },
  { id: 'well-explorer', title: 'WELL EXPLORER', desc: 'Browse structured well history, formation and depth context.', section: 'wells', target: '[data-demo="well-explorer"]' },
  { id: 'knowledge-base', title: 'KNOWLEDGE BASE', desc: 'Historical drilling experience is preserved as structured, source-linked institutional memory.', section: 'knowledge', target: '[data-demo="knowledge-base"]' },
  { id: 'search', title: 'SEARCH', desc: 'Engineers can query well, depth, event and risk context through the search interface.', section: 'search', target: '[data-demo="search"]' }
];

function DemoTour({ isActive, onClose, setSection }: { isActive: boolean, onClose: () => void, setSection: (s: Section) => void }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!isActive) { setStepIdx(0); return; }
    
    // Keyboard navigation
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && stepIdx < DEMO_STEPS.length) setStepIdx(s => s + 1);
      if (e.key === 'ArrowLeft' && stepIdx > 0) setStepIdx(s => s - 1);
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);

    const step = DEMO_STEPS[stepIdx];
    if (step && step.section) {
      setSection(step.section as Section);
    }

    const updateRect = () => {
      if (!step) { setRect(null); return; }
      const el = document.querySelector(step.target);
      if (el) {
        setRect(el.getBoundingClientRect());
      } else {
        setRect(null);
      }
    };
    
    // Auto-scroll when step changes
    const scrollToTarget = () => {
      if (!step) return;
      const el = document.querySelector(step.target);
      if (el) {
        const r = el.getBoundingClientRect();
        const isInView = r.top >= 0 && r.bottom <= window.innerHeight;
        if (!isInView) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    };
    
    const tScroll = setTimeout(scrollToTarget, 50);
    const tUpdate = setInterval(updateRect, 100);
    window.addEventListener('resize', updateRect);
    
    const scrollContainer = document.querySelector('.workspace-scroll');
    if (scrollContainer) scrollContainer.addEventListener('scroll', updateRect);

    return () => { 
      clearInterval(tUpdate); 
      clearTimeout(tScroll);
      window.removeEventListener('resize', updateRect); 
      window.removeEventListener('keydown', onKey);
      if (scrollContainer) scrollContainer.removeEventListener('scroll', updateRect);
    };
  }, [isActive, stepIdx, setSection, onClose]);

  if (!isActive) return null;
  const step = DEMO_STEPS[stepIdx];
  const isEnd = stepIdx >= DEMO_STEPS.length;

  const spotlightStyle: React.CSSProperties = rect && !isEnd ? {
    position: 'fixed',
    top: rect.top - 10, left: rect.left - 10, width: rect.width + 20, height: rect.height + 20,
    boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)',
    border: '2px solid var(--col-cyan)',
    borderRadius: '8px',
    transition: 'all 0.3s cubic-bezier(0.25, 1, 0.5, 1)',
    pointerEvents: 'none',
    zIndex: 9998,
  } : { display: 'none' };

  const expStyle: React.CSSProperties = {
    position: 'fixed',
    zIndex: 9999,
    width: 340,
    transition: 'all 0.3s cubic-bezier(0.25, 1, 0.5, 1)',
    pointerEvents: 'none',
  };
  if (rect && !isEnd) {
    if (rect.bottom + 160 < window.innerHeight) {
      expStyle.top = rect.bottom + 20;
      expStyle.left = Math.max(20, rect.left);
    } else {
      expStyle.top = rect.top - 160;
      expStyle.left = Math.max(20, rect.left);
    }
  } else {
    expStyle.display = 'none';
  }

  return (
    <>
      <div style={spotlightStyle} />
      
      {!isEnd && step && (
        <div className="demo-exp-panel" style={expStyle}>
          <div className="demo-progress">STEP {String(stepIdx + 1).padStart(2, '0')} / {String(DEMO_STEPS.length).padStart(2, '0')}</div>
          <div className="demo-ttl">{step.title}</div>
          <div className="demo-desc">{step.desc}</div>
        </div>
      )}

      {isEnd && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="demo-end-panel" style={{ pointerEvents: 'auto' }}>
            <div className="demo-ttl" style={{ fontSize: 24, color: 'var(--col-cyan)', textAlign: 'center', margin: '0 0 16px 0' }}>DEMO COMPLETE</div>
            <p className="demo-desc" style={{ textAlign: 'center', marginBottom: 24 }}>You have completed the NWIS guided tour.</p>
            <button className="btn btn-primary btn-full" onClick={() => { setSection('overview'); onClose(); }}>RETURN TO COMMAND CENTER</button>
          </div>
        </div>
      )}

      {!isEnd && (
        <div className="demo-controls">
          <button className="btn btn-secondary" onClick={() => { setSection('overview'); onClose(); }}>
            <X size={14} style={{ marginRight: 4 }} /> EXIT DEMO
          </button>
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <button className="btn btn-secondary" disabled={stepIdx === 0} onClick={() => setStepIdx(s => s - 1)}>
              <ArrowLeft size={14} /> BACK
            </button>
            <button className="btn btn-primary" onClick={() => setStepIdx(s => s + 1)}>
              NEXT <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}
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

  const horizonItems = [
    { depth: simDepth, label: 'CURRENT BIT', isActive: true, color: 'var(--col-cyan)', interval: undefined as string | undefined },
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
      
      {/* ── ALERTS STRIP ── */}
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

      {/* ── HERO / COMMAND CENTER ── */}
      <div className="hero-panel" data-demo="command-center">
        <SubsurfaceCanvas simDepth={simDepth} activeWell={activeWell} riskZones={riskZones} />

        <div className="hero-content">
          <div className="hero-main">
            <div className="hero-text-block">
              <h1 className="hero-title">DRILLING INTELLIGENCE<br />COMMAND CENTER</h1>
              <p className="hero-desc">
                Correlate active-well state with nearby historical wells, depth-aligned events, formation context and drilling parameters to surface evidence-backed risk ahead of the bit.
              </p>
            </div>
            
            <div className="hero-demo-ctrls">
               <button className="btn hero-demo-btn" onClick={onStartDemo}>
                 <Play size={12} fill="currentColor" /> START DEMO TOUR
               </button>
            </div>
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
      <div className="panel" data-demo="telemetry">
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
        <div className="panel" data-demo="risk-horizon">
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
                          {'interval' in item && item.interval && <span className="rh-event-interval">{item.interval}</span>}
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

        <div className="panel" data-demo="primary-risk">
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

        <div className="panel" style={{ gridColumn: 'span 3' }} data-demo="analogs">
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
function GeospatialSection({ activeWell, nearbyWells, radius, onRadiusChange }: {
  activeWell: Well | null; nearbyWells: NearbyWell[];
  radius: number; onRadiusChange: (r: number) => void;
}) {
  if (!activeWell) return <Spinner />;

  return (
    <div className="geo-root section-enter">
      <div className="geo-map-wrap" data-demo="geospatial">
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
              return (
                <Marker
                  key={nw.well.well_id}
                  position={[nw.well.latitude, nw.well.longitude]}
                  opacity={1}
                  icon={nw.relevance.label === 'HIGH' ? HIGH_ICON : nw.relevance.label === 'MEDIUM' ? MED_ICON : LOW_ICON}
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
function RiskSection({ activeWell, risks, events }: {
  activeWell: Well | null; risks: RiskPrediction[]; events: WellEvent[];
}) {
  const [drawerRisk, setDrawerRisk] = useState<RiskPrediction | null>(null);

  if (!activeWell) return <Spinner />;

  return (
    <div className="section-enter dash-panel" data-demo="risk-intelligence">
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
    <div className="section-enter dash-panel" data-demo="well-explorer">
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
    <div className="section-enter dash-panel" data-demo="knowledge-base">
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
    <div className="section-enter dash-panel" data-demo="search">
      <div className="panel-hd"><span className="panel-ttl">SEARCH & ASK NWIS</span></div>
      <div className="p-4">
        <div className="hero-search-box" style={{ maxWidth: 800, background: 'var(--surface-2)', border: '1px solid var(--border-3)' }}>
          <span className="hero-search-prompt" style={{ color: 'var(--col-cyan)' }}>QUERY</span>
          <div className="hero-search-input-wrap" style={{ display: 'flex', gap: 10, flex: 1, alignItems: 'center' }}>
            <Search size={16} className="hero-search-icon" style={{ color: 'var(--text-4)' }} />
            <input style={{ background: 'transparent', border: 'none', color: 'var(--text)', outline: 'none', flex: 1, fontSize: 16 }}
              placeholder="What risks are ahead?" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()} />
            <button className="btn btn-primary" onClick={run} style={{ padding: '8px 16px', fontWeight: 'bold' }}>ANALYZE</button>
          </div>
        </div>
        {loading && <div className="mt-4"><Spinner /></div>}
        {results && (
          <div className="mt-4">
            <div className="text-xs text-dim mb-2" style={{ fontWeight: 'bold' }}>{results.total_results} results found</div>
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
      <header className="brand-header" data-demo="active-well">
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
              {section === 'map' && <GeospatialSection activeWell={activeWell} nearbyWells={nearbyWells} radius={radius} onRadiusChange={setRadius} />}
              {section === 'risk' && <RiskSection activeWell={activeWell} risks={risks} events={events} />}
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
