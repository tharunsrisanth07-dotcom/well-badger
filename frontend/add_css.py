import os

css_additions = """
/* ══════════════════════════════════════════════════════════════════════
   WORKSPACE HEADER
   ══════════════════════════════════════════════════════════════════════ */
.workspace-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  padding: 0 0 16px 0;
  border-bottom: 1px solid var(--border-2);
  margin-bottom: 4px;
}
.workspace-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: 1px;
  margin-bottom: 4px;
}
.workspace-subtitle {
  font-size: 11px;
  color: var(--text-4);
  font-family: 'JetBrains Mono', monospace;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.workspace-context {
  display: flex;
  align-items: center;
  background: var(--surface-2);
  border: 1px solid var(--border-2);
  border-radius: var(--r-sm);
  padding: 6px 12px;
  gap: 12px;
}
.wc-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wc-label {
  font-size: 8px;
  color: var(--text-5);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.wc-val {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}
.wc-div {
  width: 1px;
  height: 20px;
  background: var(--border-2);
}

/* ══════════════════════════════════════════════════════════════════════
   TELEMETRY TRENDS
   ══════════════════════════════════════════════════════════════════════ */
.telem-trend {
  font-size: 12px;
  font-weight: 900;
  line-height: 1;
  margin-bottom: 2px;
}
.trend-up { color: var(--amber); }
.trend-down { color: var(--cyan); }
.trend-flat { color: var(--text-4); }

/* ══════════════════════════════════════════════════════════════════════
   RISK HORIZON V2 (Depth-Aligned Bands)
   ══════════════════════════════════════════════════════════════════════ */
.risk-horizon-v2 {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 10px 0 10px 40px;
  gap: 16px;
}
.rh2-axis {
  position: absolute;
  top: 0; bottom: 0; left: 80px;
  width: 2px;
  background: var(--border-2);
  border-left: 1px dashed var(--border-3);
}
.rh2-row {
  display: flex;
  align-items: center;
  position: relative;
  z-index: 2;
  gap: 16px;
}
.rh2-depth {
  width: 40px;
  text-align: right;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--text-3);
}
.rh2-tick {
  width: 12px;
  height: 2px;
  background: var(--border-3);
  margin-left: -8px;
}
.rh2-tick.active {
  background: var(--cyan);
  box-shadow: 0 0 6px var(--cyan);
}
.rh2-event {
  display: flex;
  align-items: center;
  background: var(--surface-2);
  border: 1px solid var(--border-2);
  border-radius: var(--r-sm);
  overflow: hidden;
  height: 28px;
  min-width: 160px;
}
.rh2-band {
  width: 8px;
  height: 100%;
}
.rh2-event-label {
  padding: 0 12px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.rh2-bit-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  font-weight: 700;
  color: var(--cyan);
  text-transform: uppercase;
  letter-spacing: 1px;
  background: rgba(34, 211, 238, 0.1);
  padding: 4px 12px;
  border-radius: var(--r-sm);
  border: 1px solid var(--cyan-mid);
}
.rh2-bit-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--cyan);
  box-shadow: 0 0 0 2px var(--cyan-dim);
  animation: bitPulse 2s ease-in-out infinite;
}
@keyframes bitPulse {
  0%, 100% { box-shadow: 0 0 0 2px var(--cyan-dim); }
  50%       { box-shadow: 0 0 0 6px transparent; }
}

/* ══════════════════════════════════════════════════════════════════════
   EVIDENCE RECORD
   ══════════════════════════════════════════════════════════════════════ */
.evidence-record {
  background: var(--surface-2);
  border: 1px solid var(--border-2);
  border-radius: var(--r-sm);
  overflow: hidden;
  margin-bottom: 12px;
}
.evidence-record-header {
  background: var(--surface-3);
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-2);
  display: flex;
  align-items: center;
  gap: 8px;
}
.evidence-record-body {
  padding: 12px;
}

/* ══════════════════════════════════════════════════════════════════════
   STATUS DOT MODS
   ══════════════════════════════════════════════════════════════════════ */
.status-dot.warn { background: var(--amber); box-shadow: 0 0 5px var(--amber-dim); }
.status-dot.err { background: var(--red); box-shadow: 0 0 5px var(--red-dim); }

"""

with open('src/index.css', 'a', encoding='utf-8') as f:
    f.write(css_additions)
print('Done appending to index.css')
