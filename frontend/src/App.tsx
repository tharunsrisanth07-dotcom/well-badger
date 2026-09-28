import React, { useEffect, useState, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import {
  Activity, AlertTriangle, BookOpen, ChevronRight, Database,
  FileText, Gauge, Globe, Info, Layers, MapPin,
  RefreshCw, Search, Shield, Zap,
} from 'lucide-react';

import {
  getWells, getNearbyWells, getCurrentRisk, getSystemStats,
  getAllEvents,
  type Well, type NearbyWell, type RiskPrediction,
  type WellEvent, type SystemStats,
} from './api';

// ── Leaflet icon fix ────────────────────────────────────────────────────────
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const activeIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});

// ── Helpers ─────────────────────────────────────────────────────────────────
type Section = 'dashboard' | 'map' | 'wells' | 'risk' | 'knowledge';

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: '#ef4444',
  HIGH:     '#f59e0b',
  MEDIUM:   '#3b82f6',
  LOW:      '#10b981',
};

const EVENT_COLORS: Record<string, string> = {
  MUD_LOSS:       '#0ea5e9',
  STUCK_PIPE:     '#f59e0b',
  KICK:           '#ef4444',
  TORQUE_SPIKE:   '#8b5cf6',
  CEMENTING_ISSUE:'#10b981',
};

function severityBadge(s: string) {
  const map: Record<string, string> = {
    CRITICAL: 'badge badge-red',
    HIGH:     'badge badge-amber',
    MEDIUM:   'badge badge-sky',
    LOW:      'badge badge-green',
  };
  return map[s] ?? 'badge badge-slate';
}

function statusBadge(s: string) {
  const map: Record<string, string> = {
    ACTIVE:    'badge badge-green',
    COMPLETED: 'badge badge-sky',
    SUSPENDED: 'badge badge-amber',
  };
  return map[s] ?? 'badge badge-slate';
}

function riskLevelClass(level: string) {
  if (level === 'HIGH' || level === 'CRITICAL') return 'text-red-400';
  if (level === 'MEDIUM') return 'text-amber-400';
  return 'text-emerald-400';
}

function riskBgClass(level: string) {
  if (level === 'HIGH' || level === 'CRITICAL')
    return 'border border-red-500/30 bg-red-500/10';
  if (level === 'MEDIUM') return 'border border-amber-500/30 bg-amber-500/10';
  return 'border border-emerald-500/30 bg-emerald-500/10';
}

// ── Custom tooltip ───────────────────────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }: {
  active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 shadow-xl text-xs">
      {label && <p className="text-slate-400 mb-1">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>
          <span className="font-semibold">{p.name}:</span> {p.value}
        </p>
      ))}
    </div>
  );
};

// ╔══════════════════════════════════════════════════════════╗
// ║                  SECTION COMPONENTS                      ║
// ╚══════════════════════════════════════════════════════════╝

// ── Dashboard Section ────────────────────────────────────────────────────────
function DashboardSection({
  stats, wells, events,
}: { stats: SystemStats | null; wells: Well[]; events: WellEvent[] }) {
  if (!stats) return <Spinner label="Loading dashboard…" />;

  const pieData = Object.entries(stats.event_type_breakdown)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name: name.replace('_', ' '), value, color: EVENT_COLORS[name] ?? '#64748b' }));

  const fieldData = wells.reduce<Record<string, number>>((acc, w) => {
    acc[w.field] = (acc[w.field] ?? 0) + 1;
    return acc;
  }, {});
  const fieldChart = Object.entries(fieldData).map(([name, count]) => ({ name, count }));

  const severityData = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(s => ({
    name: s,
    count: events.filter(e => e.severity === s).length,
    color: SEVERITY_COLORS[s],
  }));

  const recentEvents = [...events].slice(0, 8);

  return (
    <div className="space-y-6 fade-in">
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="stat-tile">
          <span className="stat-label">Total Wells</span>
          <span className="stat-value">{stats.total_wells}</span>
          <span className="text-xs text-slate-500 mt-1">In database</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">Active Wells</span>
          <span className="stat-value text-emerald-400">{stats.active_wells}</span>
          <div className="flex items-center gap-1.5 mt-1">
            <div className="pulse-dot" />
            <span className="text-xs text-slate-500">Live operations</span>
          </div>
        </div>
        <div className="stat-tile">
          <span className="stat-label">Total Events</span>
          <span className="stat-value">{stats.total_events}</span>
          <span className="text-xs text-slate-500 mt-1">Historical records</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">High Severity</span>
          <span className="stat-value text-red-400">{stats.high_severity_events}</span>
          <span className="text-xs text-slate-500 mt-1">Critical + High</span>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Event type pie */}
        <div className="card">
          <div className="card-header">
            <span className="card-title"><Zap className="w-4 h-4 text-sky-400" />Event Breakdown</span>
          </div>
          <div className="p-4">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                  innerRadius={55} outerRadius={80} paddingAngle={3}>
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} stroke="transparent" />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
                <Legend iconType="circle" iconSize={8}
                  formatter={(v) => <span className="text-xs text-slate-400">{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Wells by field */}
        <div className="card">
          <div className="card-header">
            <span className="card-title"><Globe className="w-4 h-4 text-sky-400" />Wells by Field</span>
          </div>
          <div className="p-4">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={fieldChart} barSize={30}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" name="Wells" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Severity chart */}
        <div className="card">
          <div className="card-header">
            <span className="card-title"><Shield className="w-4 h-4 text-sky-400" />Severity Distribution</span>
          </div>
          <div className="p-4">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={severityData} barSize={30} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis dataKey="name" type="category" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} width={70} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" name="Events" radius={[0, 4, 4, 0]}>
                  {severityData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Recent events table */}
      <div className="card">
        <div className="card-header">
          <span className="card-title"><FileText className="w-4 h-4 text-sky-400" />Recent Events</span>
          <span className="text-xs text-slate-500">Latest {recentEvents.length} records</span>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Well</th>
                <th>Type</th>
                <th>Depth (m)</th>
                <th>Formation</th>
                <th>Severity</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {recentEvents.map(e => (
                <tr key={e.event_id}>
                  <td className="mono text-sky-400">{e.well_id}</td>
                  <td>{e.event_type.replace('_', ' ')}</td>
                  <td className="mono">{e.depth.toFixed(0)}</td>
                  <td className="text-slate-400">{e.formation}</td>
                  <td><span className={severityBadge(e.severity)}>{e.severity}</span></td>
                  <td className="text-slate-500 text-xs">{new Date(e.date).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Map Section ──────────────────────────────────────────────────────────────
function MapSection({ activeWell, nearbyWells, radius, onRadiusChange }: {
  activeWell: Well | null;
  nearbyWells: NearbyWell[];
  radius: number;
  onRadiusChange: (r: number) => void;
}) {
  if (!activeWell) return <Spinner label="Loading map data…" />;

  return (
    <div className="flex flex-col gap-4 h-full fade-in">
      {/* Controls */}
      <div className="card p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-sky-400" />
          <span className="font-semibold text-slate-100">Geospatial Intelligence</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <label className="text-xs text-slate-400">Analysis Radius</label>
          <select
            id="radius-select"
            value={radius}
            onChange={e => onRadiusChange(Number(e.target.value))}
            className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-sky-500"
          >
            {[2, 5, 10, 20, 50].map(r => (
              <option key={r} value={r}>{r} km</option>
            ))}
          </select>
          <span className="badge badge-sky">{nearbyWells.length} offset wells</span>
        </div>
      </div>

      {/* Map */}
      <div className="card flex-1 overflow-hidden relative" style={{ minHeight: 460 }}>
        <MapContainer
          center={[activeWell.latitude, activeWell.longitude]}
          zoom={13}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {/* Radius circle */}
          <Circle
            center={[activeWell.latitude, activeWell.longitude]}
            radius={radius * 1000}
            pathOptions={{ color: '#0ea5e9', fillColor: '#0ea5e9', fillOpacity: 0.04, weight: 1.5, dashArray: '6 4' }}
          />
          {/* Active well */}
          <Marker position={[activeWell.latitude, activeWell.longitude]} icon={activeIcon}>
            <Popup>
              <div>
                <p className="font-bold">{activeWell.name} <span className="text-emerald-400">[ACTIVE]</span></p>
                <p className="text-xs mt-1">Depth: {activeWell.total_depth} m</p>
                <p className="text-xs">Formation: {activeWell.formation}</p>
                <p className="text-xs">Field: {activeWell.field}</p>
              </div>
            </Popup>
          </Marker>
          {/* Offset wells */}
          {nearbyWells.map(nw => (
            <Marker key={nw.well.well_id} position={[nw.well.latitude, nw.well.longitude]}>
              <Popup>
                <div>
                  <p className="font-bold">{nw.well.name}</p>
                  <p className="text-xs mt-1">Distance: {nw.distance_km.toFixed(2)} km</p>
                  <p className="text-xs">Depth: {nw.well.total_depth.toFixed(0)} m</p>
                  <p className="text-xs">Events: {nw.relevant_events.length}</p>
                  <p className="text-xs">Status: {nw.well.status}</p>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>

        {/* Map legend */}
        <div className="absolute bottom-4 left-4 z-[400] card p-3 text-xs space-y-1.5 backdrop-blur">
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-red-500 inline-block" />Active Well</div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-sky-500 inline-block" />Offset Well</div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded border-2 border-sky-400 border-dashed inline-block" />Analysis Radius</div>
        </div>
      </div>

      {/* Offset well list */}
      {nearbyWells.length > 0 && (
        <div className="card overflow-hidden">
          <div className="card-header">
            <span className="card-title"><Layers className="w-4 h-4 text-sky-400" />Offset Wells in Radius</span>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Well ID</th><th>Name</th><th>Field</th>
                  <th>Distance (km)</th><th>Formation</th><th>Events</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {nearbyWells.map(nw => (
                  <tr key={nw.well.well_id}>
                    <td className="mono text-sky-400">{nw.well.well_id}</td>
                    <td>{nw.well.name}</td>
                    <td className="text-slate-400">{nw.well.field}</td>
                    <td className="mono">{nw.distance_km.toFixed(2)}</td>
                    <td>{nw.well.formation}</td>
                    <td><span className="badge badge-sky">{nw.relevant_events.length}</span></td>
                    <td><span className={statusBadge(nw.well.status)}>{nw.well.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Wells Explorer Section ────────────────────────────────────────────────────
function WellsSection({ wells }: { wells: Well[] }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const filtered = wells.filter(w => {
    const matchSearch = search === '' ||
      w.name.toLowerCase().includes(search.toLowerCase()) ||
      w.well_id.toLowerCase().includes(search.toLowerCase()) ||
      w.field.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'ALL' || w.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div className="space-y-4 fade-in">
      {/* Filters */}
      <div className="card p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-52">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            id="well-search"
            type="text"
            placeholder="Search by ID, name, or field…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-4 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
        </div>
        <div className="flex gap-2">
          {['ALL', 'ACTIVE', 'COMPLETED', 'SUSPENDED'].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                statusFilter === s
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-500 ml-auto">{filtered.length} wells</span>
      </div>

      {/* Wells table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Well ID</th><th>Name</th><th>Field</th>
                <th>Formation</th><th>Total Depth (m)</th>
                <th>Lat / Lon</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(w => (
                <tr key={w.well_id}>
                  <td className="mono text-sky-400 font-medium">{w.well_id}</td>
                  <td className="font-medium text-slate-100">{w.name}</td>
                  <td className="text-slate-400">{w.field}</td>
                  <td>{w.formation}</td>
                  <td className="mono">{w.total_depth.toFixed(0)}</td>
                  <td className="mono text-xs text-slate-500">
                    {w.latitude.toFixed(4)}, {w.longitude.toFixed(4)}
                  </td>
                  <td><span className={statusBadge(w.status)}>{w.status}</span></td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-slate-500 py-10">
                    No wells match your filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Risk Section ─────────────────────────────────────────────────────────────
function RiskSection({ activeWell, risks, nearbyWells }: {
  activeWell: Well | null;
  risks: RiskPrediction[];
  nearbyWells: NearbyWell[];
}) {
  if (!activeWell) return <Spinner label="Loading risk data…" />;

  const radarData = risks.map(r => ({ name: r.risk_type.replace('_', ' '), score: r.score, confidence: r.confidence }));

  return (
    <div className="space-y-6 fade-in">
      {/* Active well banner */}
      <div className="card p-4 flex items-center gap-4 border-sky-800/40 bg-sky-900/10">
        <div className="w-10 h-10 rounded-full bg-sky-600/20 border border-sky-600/30 flex items-center justify-center flex-shrink-0">
          <Activity className="w-5 h-5 text-sky-400" />
        </div>
        <div>
          <p className="text-xs text-slate-400">Analysing active well</p>
          <p className="font-bold text-sky-400">{activeWell.name}</p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-xs text-slate-400">Upcoming interval</p>
          <p className="mono font-semibold">{activeWell.total_depth} – {activeWell.total_depth + 100} m</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-400">Formation</p>
          <p className="font-semibold">{activeWell.formation}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Risk cards */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Predicted Risks</h2>
          {risks.length === 0 ? (
            <div className="card p-8 text-center text-slate-500">
              <Shield className="w-10 h-10 mx-auto mb-3 text-slate-700" />
              No significant risks identified in upcoming interval.
            </div>
          ) : (
            risks.map((risk, idx) => (
              <div key={idx} className={`card p-4 transition-all duration-200 hover:scale-[1.01] ${riskBgClass(risk.level)}`}>
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className={`font-bold text-lg ${riskLevelClass(risk.level)}`}>
                      {risk.risk_type.replace(/_/g, ' ')}
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Zone: {risk.interval_start}m – {risk.interval_end}m
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-3xl font-black text-white">{risk.score}%</div>
                    <span className={`text-xs font-bold ${riskLevelClass(risk.level)}`}>{risk.level}</span>
                  </div>
                </div>

                {/* Score bar */}
                <div className="h-1.5 bg-slate-800 rounded-full mb-3 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${risk.score}%`,
                      background: risk.level === 'HIGH' || risk.level === 'CRITICAL' ? '#ef4444'
                        : risk.level === 'MEDIUM' ? '#f59e0b' : '#10b981',
                    }}
                  />
                </div>

                <div className="flex items-start gap-2 bg-slate-900/60 rounded-lg p-3 text-sm">
                  <Info className="w-4 h-4 text-sky-400 flex-shrink-0 mt-0.5" />
                  <p className="text-slate-300 text-xs">{risk.evidence[0]}</p>
                </div>

                <div className="flex gap-2 flex-wrap mt-2">
                  {risk.supporting_wells.map(w => (
                    <span key={w} className="badge badge-slate mono">{w}</span>
                  ))}
                </div>

                <div className="mt-2 text-xs text-slate-500">
                  Confidence: <span className="text-slate-300">{risk.confidence.toFixed(0)}%</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Risk score chart */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Risk Score Comparison</h2>
          <div className="card p-4">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={radarData} layout="vertical" barSize={22}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis dataKey="name" type="category" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} width={110} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="score" name="Risk Score %" radius={[0, 4, 4, 0]}>
                  {radarData.map((_, i) => {
                    const r = risks[i];
                    const color = r?.level === 'HIGH' || r?.level === 'CRITICAL' ? '#ef4444'
                      : r?.level === 'MEDIUM' ? '#f59e0b' : '#10b981';
                    return <Cell key={i} fill={color} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Supporting wells list */}
          {nearbyWells.filter(nw => nw.relevant_events.length > 0).length > 0 && (
            <div className="card overflow-hidden">
              <div className="card-header">
                <span className="card-title"><Database className="w-4 h-4 text-sky-400" />Evidence Wells</span>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr><th>Well</th><th>Distance</th><th>Events</th></tr>
                  </thead>
                  <tbody>
                    {nearbyWells.filter(nw => nw.relevant_events.length > 0).map(nw => (
                      <tr key={nw.well.well_id}>
                        <td className="mono text-sky-400">{nw.well.well_id}</td>
                        <td className="mono">{nw.distance_km.toFixed(2)} km</td>
                        <td><span className="badge badge-amber">{nw.relevant_events.length}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Knowledge Base Section ────────────────────────────────────────────────────
function KnowledgeSection({ events }: { events: WellEvent[] }) {
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');

  const filtered = events.filter(e => {
    const ms = severityFilter === 'ALL' || e.severity === severityFilter;
    const mt = typeFilter === 'ALL' || e.event_type === typeFilter;
    return ms && mt;
  });

  const EVENT_TYPES = ['ALL', 'MUD_LOSS', 'STUCK_PIPE', 'KICK', 'TORQUE_SPIKE', 'CEMENTING_ISSUE'];
  const SEVERITIES  = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

  return (
    <div className="space-y-4 fade-in">
      {/* Filter bar */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <BookOpen className="w-4 h-4 text-sky-400" />
          <span className="font-semibold">Historical Event Knowledge Base</span>
          <span className="badge badge-sky ml-auto">{filtered.length} records</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-slate-400 self-center">Severity:</span>
          {SEVERITIES.map(s => (
            <button key={s} onClick={() => setSeverityFilter(s)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                severityFilter === s ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >{s}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-slate-400 self-center">Type:</span>
          {EVENT_TYPES.map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                typeFilter === t ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >{t.replace('_', ' ')}</button>
          ))}
        </div>
      </div>

      {/* Event cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {filtered.map(e => (
          <div key={e.event_id} className="card p-4 hover:border-slate-700 transition-colors">
            <div className="flex justify-between items-start mb-2">
              <div>
                <p className="font-semibold text-slate-100">
                  {e.event_type.replace(/_/g, ' ')}
                </p>
                <p className="mono text-xs text-sky-400">{e.well_id}</p>
              </div>
              <span className={severityBadge(e.severity)}>{e.severity}</span>
            </div>

            <p className="text-xs text-slate-400 italic mb-3">"{e.description}"</p>

            <div className="grid grid-cols-2 gap-2 text-xs mb-3">
              <div><span className="text-slate-500">Depth:</span> <span className="mono text-slate-300">{e.depth.toFixed(0)}m</span></div>
              <div><span className="text-slate-500">Formation:</span> <span className="text-slate-300">{e.formation}</span></div>
              <div><span className="text-slate-500">Date:</span> <span className="text-slate-300">{new Date(e.date).toLocaleDateString()}</span></div>
              <div><span className="text-slate-500">Source:</span> <span className="text-slate-300 truncate">{e.source_document}</span></div>
            </div>

            <div className="bg-slate-950 rounded-lg p-3">
              <p className="text-xs text-emerald-400 font-semibold mb-1">MITIGATION APPLIED</p>
              <p className="text-xs text-slate-300">{e.mitigation}</p>
              <p className="text-xs text-slate-500 mt-1">
                <span className="text-sky-400">Outcome:</span> {e.outcome}
              </p>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="col-span-2 card p-12 text-center text-slate-500">
            <Database className="w-12 h-12 mx-auto mb-3 text-slate-700" />
            No events match your filter criteria.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Spinner ───────────────────────────────────────────────────────────────────
function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-slate-400 text-sm">{label}</p>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
const NAV_ITEMS: { id: Section; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Dashboard',       Icon: Gauge },
  { id: 'map',       label: 'Geospatial Map',  Icon: Globe },
  { id: 'wells',     label: 'Wells Explorer',  Icon: Database },
  { id: 'risk',      label: 'Risk Analysis',   Icon: AlertTriangle },
  { id: 'knowledge', label: 'Knowledge Base',  Icon: BookOpen },
];

// ╔══════════════════════════════════════════════════════════╗
// ║                     ROOT APP                             ║
// ╚══════════════════════════════════════════════════════════╝
export default function App() {
  const [section, setSection]       = useState<Section>('dashboard');
  const [activeWell, setActiveWell] = useState<Well | null>(null);
  const [wells, setWells]           = useState<Well[]>([]);
  const [nearbyWells, setNearbyWells] = useState<NearbyWell[]>([]);
  const [risks, setRisks]           = useState<RiskPrediction[]>([]);
  const [stats, setStats]           = useState<SystemStats | null>(null);
  const [events, setEvents]         = useState<WellEvent[]>([]);
  const [radius, setRadius]         = useState(10);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const ACTIVE_WELL_ID = 'ACTIVE-001';

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [allWells, statsData, eventsData] = await Promise.all([
        getWells(),
        getSystemStats(),
        getAllEvents({ limit: 100 }),
      ]);
      setWells(allWells);
      setStats(statsData);
      setEvents(eventsData);

      const active = allWells.find(w => w.well_id === ACTIVE_WELL_ID);
      if (active) {
        setActiveWell(active);
        const [nearby, riskData] = await Promise.all([
          getNearbyWells(active.well_id, radius),
          getCurrentRisk(active.well_id, radius),
        ]);
        setNearbyWells(nearby);
        setRisks(riskData);
      }
    } catch (err) {
      console.error(err);
      setError('Failed to connect to NWIS backend. Make sure the server is running on port 8000.');
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }, [radius]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Error state ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-8">
        <div className="card max-w-md w-full p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-slate-100 mb-2">Connection Error</h2>
          <p className="text-sm text-slate-400 mb-6">{error}</p>
          <button onClick={fetchAll} className="btn-primary">
            <RefreshCw className="w-4 h-4" /> Retry Connection
          </button>
        </div>
      </div>
    );
  }

  // ── Initial loading splash ─────────────────────────────────────────────────
  if (loading && !stats) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-6">
        <div className="flex items-center gap-3">
          <Activity className="w-8 h-8 text-sky-400" />
          <span className="text-2xl font-bold text-white tracking-widest">NWIS</span>
        </div>
        <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-400 text-sm animate-pulse">Initializing NWIS Engine…</p>
      </div>
    );
  }

  // ── Main layout ────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-slate-950 overflow-hidden">
      {/* ── Sidebar ── */}
      <aside className="w-60 flex-shrink-0 flex flex-col bg-slate-900 border-r border-slate-800">
        {/* Logo */}
        <div className="p-5 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-sky-600/20 border border-sky-600/30 flex items-center justify-center">
              <Activity className="w-4 h-4 text-sky-400" />
            </div>
            <div>
              <p className="font-bold text-sm text-white tracking-wider">NWIS</p>
              <p className="text-xs text-slate-500">Intelligence System</p>
            </div>
          </div>
        </div>

        {/* Active well chip */}
        {activeWell && (
          <div className="mx-3 mt-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <div className="flex items-center gap-2">
              <div className="pulse-dot" />
              <p className="text-xs font-semibold text-emerald-400">ACTIVE WELL</p>
            </div>
            <p className="text-sm text-white font-bold mt-1">{activeWell.name}</p>
            <p className="mono text-xs text-slate-400 mt-0.5">{activeWell.total_depth}m · {activeWell.formation}</p>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1 mt-2">
          {NAV_ITEMS.map(({ id, label, Icon }) => (
            <button
              key={id}
              id={`nav-${id}`}
              onClick={() => setSection(id)}
              className={`nav-item w-full text-left ${section === id ? 'active' : ''}`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
              {section === id && <ChevronRight className="w-3 h-3 ml-auto" />}
            </button>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-slate-800">
          <button
            onClick={fetchAll}
            disabled={loading}
            className="nav-item w-full text-left disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh Data
          </button>
          <p className="text-xs text-slate-600 px-3 mt-2">
            {lastRefresh.toLocaleTimeString()}
          </p>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex-shrink-0 h-14 bg-slate-900 border-b border-slate-800 flex items-center px-6 gap-4">
          <div>
            <h1 className="text-sm font-semibold text-slate-100">
              {NAV_ITEMS.find(n => n.id === section)?.label}
            </h1>
            <p className="text-xs text-slate-500">Nearby Wells Intelligence System · Assam Oil Fields</p>
          </div>

          <div className="ml-auto flex items-center gap-3">
            {stats && (
              <>
                <div className="flex items-center gap-1.5">
                  <div className="pulse-dot" />
                  <span className="text-xs text-slate-400">{stats.active_wells} active wells</span>
                </div>
                <div className="w-px h-4 bg-slate-700" />
                <span className="text-xs text-slate-400">{stats.total_events} events in DB</span>
              </>
            )}
            {risks.length > 0 && (
              <>
                <div className="w-px h-4 bg-slate-700" />
                <div className="flex items-center gap-1.5 text-xs text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {risks.length} risks flagged
                </div>
              </>
            )}
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-6">
          {section === 'dashboard' && (
            <DashboardSection stats={stats} wells={wells} events={events} />
          )}
          {section === 'map' && (
            <MapSection
              activeWell={activeWell}
              nearbyWells={nearbyWells}
              radius={radius}
              onRadiusChange={r => { setRadius(r); }}
            />
          )}
          {section === 'wells' && (
            <WellsSection wells={wells} />
          )}
          {section === 'risk' && (
            <RiskSection activeWell={activeWell} risks={risks} nearbyWells={nearbyWells} />
          )}
          {section === 'knowledge' && (
            <KnowledgeSection events={events} />
          )}
        </main>
      </div>
    </div>
  );
}
