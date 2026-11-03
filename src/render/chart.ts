/* Line charts on canvas (ported from v1 js/charts.js): axes, legend, shading,
   reference lines, markers, brackets, filled areas, second y axis,
   crosshair hover readout and optional drag-to-zoom. No libraries. */
import { col, FONT, baseFontSize, setupCanvas } from './theme';

export interface Series {
  x: number[];
  y: number[];
  color: string;
  width?: number;
  dash?: number[];
  label?: string;
  hidden?: boolean;
  alpha?: number;
  y2?: boolean;
  /** fill down to a constant */
  fill?: string;
  fillBase?: number;
  /** fill between this series and another curve (same x) */
  fillTo?: number[];
  fillToColor?: string;
  points?: boolean;
  pointsOnly?: boolean;
  r?: number;
  noHover?: boolean;
  /** identifier passed back by onPick */
  key?: string;
}
export interface Mark { x: number; y: number; label?: string; color?: string; pos?: 'above' | 'below' | 'left' | 'right'; hollow?: boolean; }
export interface VLine { x: number; color?: string; label?: string; dash?: number[]; dy?: number; align?: 'left' | 'right'; }
export interface HLine { y: number; color?: string; label?: string; dash?: number[]; }
export interface Bracket { x: number; y0: number; y1: number; label: string; color?: string; align?: 'left' | 'right'; }
export interface Shade { x0: number; x1: number; color?: string; label?: string; }

export interface ChartConfig {
  series: Series[];
  xLabel?: string;
  yLabel?: string;
  xMin?: number; xMax?: number; yMin?: number; yMax?: number;
  headroom?: number;
  /** smallest visible span of the left axis when it is auto-scaled (e.g. 40 mmHg) */
  yMinSpan?: number;
  y2?: { color?: string; min?: number; max?: number; label?: string; minSpan?: number };
  marks?: Mark[];
  vlines?: VLine[];
  hlines?: HLine[];
  brackets?: Bracket[];
  shades?: Shade[];
  notes?: { x: number; text: string }[];
  legend?: boolean;
  hover?: boolean;
  hoverX?: (v: number) => string;
  hoverFmt?: (v: number) => string;
  xFmt?: (v: number) => string;
  /** enable drag-to-zoom on x; called with the new range, or null on double-click reset */
  onZoom?: (range: [number, number] | null) => void;
  /** click on (or near) a curve: called with the nearest visible labelled series */
  onPick?: (s: Series) => void;
  /** extra drawing on top (e.g. stacked event labels) */
  overlay?: (ctx: CanvasRenderingContext2D, map: ChartMap) => void;
  ariaLabel?: string;
}

export interface ChartMap {
  X: (v: number) => number; Y: (v: number) => number;
  xMin: number; xMax: number; yMin: number; yMax: number;
  pad: { l: number; r: number; t: number; b: number }; pw: number; ph: number; small: number;
}

interface Bound { cfg: ChartConfig; map?: ChartMap; hoverX?: number; drag?: { x0: number; x1: number } }
const bound = new WeakMap<HTMLCanvasElement, Bound>();

function niceStep(range: number, target: number): number {
  const raw = range / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}
export function ticks(lo: number, hi: number, target: number): { list: number[]; step: number } {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return { list: [], step: 1 };
  // a step below the floating-point resolution at these values would never advance
  const s = Math.max(niceStep(hi - lo, target), Math.max(Math.abs(lo), Math.abs(hi)) * 1e-9), out: number[] = [];
  const first = Math.ceil(lo / s);
  for (let i = 0; i < 200; i++) { const v = (first + i) * s; if (v > hi + s * 1e-6) break; out.push(+v.toFixed(10)); }
  return { list: out, step: s };
}

/** Widen [lo, hi] about its centre to at least minSpan; near-flat data counts as flat. */
export function spanRange(lo: number, hi: number, minSpan = 0): [number, number] {
  const flat = Math.max(1e-9, Math.max(Math.abs(lo), Math.abs(hi)) * 1e-9);
  const need = Math.max(minSpan, hi - lo <= flat ? 1 : 0);
  if (hi - lo >= need) return [lo, hi];
  const mid = (lo + hi) / 2;
  return [mid - need / 2, mid + need / 2];
}
const fmtTick = (v: number, step: number) => v.toFixed(step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step))));

export function lineChart(canvas: HTMLCanvasElement, cfg: ChartConfig): void {
  let b = bound.get(canvas);
  if (!b) { b = { cfg }; bound.set(canvas, b); if (cfg.hover !== false) bindHover(canvas); }
  b.cfg = cfg;
  if (cfg.ariaLabel) canvas.setAttribute('aria-label', cfg.ariaLabel);
  canvas.setAttribute('role', 'img');
  draw(canvas);
}

export function redrawChart(canvas: HTMLCanvasElement): void { if (bound.get(canvas)) draw(canvas); }

function draw(canvas: HTMLCanvasElement): void {
  const b = bound.get(canvas); if (!b) return;
  const cfg = b.cfg;
  const { ctx, w, h } = setupCanvas(canvas);
  const small = Math.round(baseFontSize() * 0.8);
  const font = (s: number, wt = '') => `${wt} ${s}px ${FONT}`.trim();
  const legendH = cfg.legend === false ? 0 : small + 10;
  const pad = { l: small * 3.6 + (cfg.yLabel ? small + 4 : 0), r: cfg.y2 ? small * 3.8 : 14, t: 10 + legendH, b: small * 2.2 + (cfg.xLabel ? small + 4 : 0) };
  const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
  const prim = cfg.series.filter(s => !s.y2 && !s.hidden && s.x.length);
  let xMin = cfg.xMin, xMax = cfg.xMax, yMin = cfg.yMin, yMax = cfg.yMax;
  if (xMin == null) xMin = prim.length ? Math.min(...prim.map(s => Math.min(...s.x))) : 0;
  if (xMax == null) xMax = prim.length ? Math.max(...prim.map(s => Math.max(...s.x))) : 1;
  if (xMax <= xMin) xMax = xMin + 1;
  if (yMin == null || yMax == null) {
    let lo = Infinity, hi = -Infinity;
    for (const s of prim) for (let i = 0; i < s.y.length; i++) {
      if (s.x[i] < xMin || s.x[i] > xMax) continue;
      const v = s.y[i]; if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
    for (const l of cfg.hlines ?? []) { lo = Math.min(lo, l.y); hi = Math.max(hi, l.y); }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    [lo, hi] = spanRange(lo, hi, cfg.yMinSpan);
    const span = hi - lo;
    if (yMin == null) yMin = lo - span * 0.08;
    if (yMax == null) yMax = hi + span * (cfg.headroom ?? 0.14);
  }
  const X = (v: number) => pad.l + (v - xMin!) / (xMax! - xMin!) * pw;
  const Y = (v: number) => pad.t + (1 - (v - yMin!) / (yMax! - yMin!)) * ph;
  let Y2: ((v: number) => number) | null = null, y2Min = 0, y2Max = 1;
  if (cfg.y2) {
    let lo = Infinity, hi = -Infinity;
    for (const s of cfg.series) if (s.y2 && !s.hidden) for (const v of s.y) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    [lo, hi] = spanRange(lo, hi, cfg.y2.minSpan);
    const sp = hi - lo;
    y2Min = cfg.y2.min ?? lo - sp * 0.08; y2Max = cfg.y2.max ?? hi + sp * 0.14;
    Y2 = v => pad.t + (1 - (v - y2Min) / (y2Max - y2Min)) * ph;
  }
  const map: ChartMap = { X, Y, xMin, xMax, yMin, yMax, pad, pw, ph, small };
  b.map = map;

  ctx.save();
  ctx.beginPath(); ctx.rect(pad.l, pad.t, pw, ph); ctx.clip();
  for (const s of cfg.shades ?? []) {
    ctx.fillStyle = col(s.color ?? '--shade');
    const x0 = X(Math.max(xMin, s.x0)), x1 = X(Math.min(xMax, s.x1));
    ctx.fillRect(x0, pad.t, x1 - x0, ph);
    if (s.label) { ctx.fillStyle = col('--ink-3'); ctx.font = font(small); ctx.textAlign = 'center'; ctx.fillText(s.label, (x0 + x1) / 2, pad.t + small + 2); }
  }
  ctx.restore();
  for (const n of cfg.notes ?? []) {
    ctx.fillStyle = col('--ink-3'); ctx.font = font(small); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(n.text, X(n.x), pad.t + ph - 4);
  }

  // grid & axes
  ctx.font = font(small); ctx.lineWidth = 1;
  const yt = ticks(yMin, yMax, Math.max(3, Math.round(ph / 48)));
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (const v of yt.list) {
    const y = Math.round(Y(v)) + 0.5;
    ctx.strokeStyle = col('--line-2'); ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + pw, y); ctx.stroke();
    ctx.fillStyle = col('--ink-3'); ctx.fillText(fmtTick(v, yt.step), pad.l - 6, y);
  }
  const xt = ticks(xMin, xMax, Math.max(3, Math.round(pw / 80)));
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const v of xt.list) {
    const x = Math.round(X(v)) + 0.5;
    ctx.strokeStyle = col('--line-2'); ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + ph); ctx.stroke();
    ctx.fillStyle = col('--ink-3'); ctx.fillText(cfg.xFmt ? cfg.xFmt(v) : fmtTick(v, xt.step), x, pad.t + ph + 5);
  }
  ctx.strokeStyle = col('--line'); ctx.strokeRect(pad.l + 0.5, pad.t + 0.5, pw, ph);
  if (cfg.y2 && Y2) {
    const t2 = ticks(y2Min, y2Max, Math.max(3, Math.round(ph / 48)));
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const v of t2.list) { ctx.fillStyle = col(cfg.y2.color ?? '--ink-3'); ctx.fillText(fmtTick(v, t2.step), pad.l + pw + 6, Y2(v)); }
  }
  if (cfg.xLabel) { ctx.fillStyle = col('--ink-2'); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(cfg.xLabel, pad.l + pw / 2, h - 2); }
  if (cfg.yLabel) { ctx.save(); ctx.translate(small * 0.9, pad.t + ph / 2); ctx.rotate(-Math.PI / 2); ctx.fillStyle = col('--ink-2'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(cfg.yLabel, 0, 0); ctx.restore(); }
  if (cfg.y2?.label) { ctx.save(); ctx.translate(w - small * 0.7, pad.t + ph / 2); ctx.rotate(Math.PI / 2); ctx.fillStyle = col(cfg.y2.color ?? '--ink-2'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(cfg.y2.label, 0, 0); ctx.restore(); }

  // reference lines
  const dashLine = (x0: number, y0: number, x1: number, y1: number, c: string, dash?: number[]) => {
    ctx.save(); ctx.strokeStyle = col(c); ctx.setLineDash(dash ?? [4, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.restore();
  };
  for (const l of cfg.hlines ?? []) {
    if (l.y < yMin || l.y > yMax) continue;
    const y = Y(l.y); dashLine(pad.l, y, pad.l + pw, y, l.color ?? '--ink-3', l.dash);
    if (l.label) { ctx.fillStyle = col(l.color ?? '--ink-3'); ctx.font = font(small); ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(l.label, pad.l + pw - 4, y - 2); }
  }
  for (const l of cfg.vlines ?? []) {
    if (l.x < xMin || l.x > xMax) continue;
    const x = X(l.x); dashLine(x, pad.t, x, pad.t + ph, l.color ?? '--ink-3', l.dash);
    if (l.label) { ctx.fillStyle = col(l.color ?? '--ink-3'); ctx.font = font(small); ctx.textAlign = l.align ?? 'left'; ctx.textBaseline = 'top'; ctx.fillText(l.label, x + (l.align === 'right' ? -4 : 4), pad.t + (l.dy ?? 4)); }
  }

  // series
  ctx.save();
  ctx.beginPath(); ctx.rect(pad.l, pad.t, pw, ph); ctx.clip();
  for (const s of cfg.series) {
    if (s.hidden || !s.x.length) continue;
    const YY = s.y2 && Y2 ? Y2 : Y;
    ctx.save();
    ctx.globalAlpha = s.alpha ?? 1;
    if (s.fillTo) {
      ctx.beginPath();
      for (let i = 0; i < s.x.length; i++) { const px = X(s.x[i]), py = YY(s.y[i]); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
      for (let i = s.x.length - 1; i >= 0; i--) ctx.lineTo(X(s.x[i]), YY(s.fillTo[i]));
      ctx.closePath(); ctx.fillStyle = col(s.fillToColor ?? '--shade'); ctx.fill();
    }
    if (s.fill) {
      const base = YY(s.fillBase ?? yMin);
      ctx.beginPath(); ctx.moveTo(X(s.x[0]), base);
      for (let i = 0; i < s.x.length; i++) if (Number.isFinite(s.y[i])) ctx.lineTo(X(s.x[i]), YY(s.y[i]));
      ctx.lineTo(X(s.x[s.x.length - 1]), base); ctx.closePath();
      ctx.fillStyle = col(s.fill); ctx.fill();
    }
    ctx.strokeStyle = col(s.color); ctx.lineWidth = s.width ?? 2; ctx.setLineDash(s.dash ?? []); ctx.lineJoin = 'round';
    if (s.points) {
      ctx.fillStyle = col(s.color);
      for (let i = 0; i < s.x.length; i++) { ctx.beginPath(); ctx.arc(X(s.x[i]), YY(s.y[i]), s.r ?? 3, 0, Math.PI * 2); ctx.fill(); }
    }
    if (!s.pointsOnly) {
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < s.x.length; i++) {
        if (!Number.isFinite(s.y[i])) { started = false; continue; }
        const px = X(s.x[i]), py = YY(s.y[i]);
        if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();

  for (const br of cfg.brackets ?? []) {
    const x = X(br.x), y0 = Y(br.y0), y1 = Y(br.y1), c = col(br.color ?? '--ink-2');
    ctx.save(); ctx.strokeStyle = c; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x - 4, y0); ctx.lineTo(x, y0); ctx.lineTo(x, y1); ctx.lineTo(x - 4, y1); ctx.stroke();
    ctx.fillStyle = c; ctx.font = font(small); ctx.textAlign = br.align ?? 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(br.label, x + (br.align === 'right' ? -7 : 6), (y0 + y1) / 2);
    ctx.restore();
  }
  for (const m of cfg.marks ?? []) {
    if (m.x < xMin || m.x > xMax) continue;
    const x = X(m.x), y = Y(m.y), c = col(m.color ?? '--ink');
    ctx.save(); ctx.fillStyle = m.hollow ? col('--panel') : col('--panel'); ctx.strokeStyle = c; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (m.label) {
      ctx.font = font(small, '600'); ctx.fillStyle = c;
      const pos = m.pos ?? 'above';
      ctx.textAlign = pos === 'right' ? 'left' : pos === 'left' ? 'right' : 'center';
      ctx.textBaseline = pos === 'below' ? 'top' : pos === 'above' ? 'bottom' : 'middle';
      const dx = pos === 'right' ? 8 : pos === 'left' ? -8 : 0, dy = pos === 'above' ? -7 : pos === 'below' ? 7 : 0;
      ctx.fillText(m.label, x + dx, y + dy);
    }
    ctx.restore();
  }
  cfg.overlay?.(ctx, map);

  if (cfg.legend !== false) {
    ctx.font = font(small); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    let lx = pad.l; const ly = 4 + small / 2 + 2;
    for (const s of cfg.series) {
      if (!s.label || s.hidden) continue;
      const tw = ctx.measureText(s.label).width;
      if (lx + 23 + tw > w - 4 && lx > pad.l) break;      // no room: stop rather than overflow
      ctx.save(); ctx.strokeStyle = col(s.color); ctx.lineWidth = Math.max(2, s.width ?? 2); ctx.setLineDash(s.dash ?? []);
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + 18, ly); ctx.stroke(); ctx.restore();
      ctx.fillStyle = col('--ink-2'); ctx.fillText(s.label, lx + 23, ly);
      lx += 23 + tw + 16;
    }
  }

  // zoom brush
  if (b.drag) {
    const x0 = Math.min(b.drag.x0, b.drag.x1), x1 = Math.max(b.drag.x0, b.drag.x1);
    ctx.fillStyle = col('--shade-strong'); ctx.fillRect(x0, pad.t, x1 - x0, ph);
  }

  // hover crosshair + readout
  const hx = b.hoverX;
  if (hx != null && hx >= xMin && hx <= xMax && !b.drag) {
    const x = X(hx);
    ctx.save(); ctx.strokeStyle = col('--ink-3'); ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + ph); ctx.stroke(); ctx.restore();
    const rows: [string, number, string][] = [];
    for (const s of cfg.series) {
      if (s.hidden || !s.label || s.noHover || !s.x.length) continue;
      let best = 0, bd = Infinity;
      for (let i = 0; i < s.x.length; i++) { const dd = Math.abs(s.x[i] - hx); if (dd < bd) { bd = dd; best = i; } }
      if (!Number.isFinite(s.y[best])) continue;
      const YY = s.y2 && Y2 ? Y2 : Y;
      ctx.fillStyle = col(s.color); ctx.beginPath(); ctx.arc(X(s.x[best]), YY(s.y[best]), 3.5, 0, Math.PI * 2); ctx.fill();
      rows.push([s.label, s.y[best], s.color]);
    }
    if (rows.length) {
      ctx.font = font(small);
      const head = cfg.hoverX ? cfg.hoverX(hx) : hx.toFixed(2);
      const lines = [head, ...rows.map(r => `${r[0]}: ${cfg.hoverFmt ? cfg.hoverFmt(r[1]) : r[1].toFixed(1)}`)];
      const bw = Math.max(...lines.map(l => ctx.measureText(l).width)) + 18, bh = lines.length * (small + 5) + 8;
      let bx = x + 12; if (bx + bw > pad.l + pw) bx = x - 12 - bw;
      const by = pad.t + 6;
      ctx.fillStyle = col('--panel'); ctx.strokeStyle = col('--line'); ctx.globalAlpha = 0.96;
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 6); ctx.fill(); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      lines.forEach((l, i) => { ctx.fillStyle = i === 0 ? col('--ink') : col(rows[i - 1][2]); ctx.fillText(l, bx + 9, by + 5 + i * (small + 5)); });
    }
  }
}

function bindHover(canvas: HTMLCanvasElement): void {
  const toX = (e: PointerEvent) => {
    const b = bound.get(canvas)!, m = b.map; if (!m) return null;
    const px = e.clientX - canvas.getBoundingClientRect().left;
    return { px, xv: m.xMin + (px - m.pad.l) / m.pw * (m.xMax - m.xMin), inside: px >= m.pad.l && px <= m.pad.l + m.pw };
  };
  canvas.addEventListener('pointermove', e => {
    const b = bound.get(canvas)!; const p = toX(e); if (!p) return;
    if (b.drag) { b.drag.x1 = Math.max(b.map!.pad.l, Math.min(b.map!.pad.l + b.map!.pw, p.px)); }
    b.hoverX = p.inside ? p.xv : undefined;
    draw(canvas);
  });
  canvas.addEventListener('pointerleave', () => { const b = bound.get(canvas)!; b.hoverX = undefined; if (!b.drag) draw(canvas); });
  canvas.addEventListener('pointerdown', e => {
    const b = bound.get(canvas)!; if (!b.cfg.onZoom) return; const p = toX(e); if (!p?.inside) return;
    b.drag = { x0: p.px, x1: p.px }; canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerup', () => {
    const b = bound.get(canvas)!; if (!b.drag || !b.map) return;
    const m = b.map, d = b.drag; b.drag = undefined;
    if (Math.abs(d.x1 - d.x0) > 6) {
      const v = (px: number) => m.xMin + (px - m.pad.l) / m.pw * (m.xMax - m.xMin);
      b.cfg.onZoom?.([v(Math.min(d.x0, d.x1)), v(Math.max(d.x0, d.x1))]);
    } else draw(canvas);
  });
  canvas.addEventListener('dblclick', () => bound.get(canvas)!.cfg.onZoom?.(null));
  canvas.addEventListener('click', e => {
    const b = bound.get(canvas)!, m = b.map; if (!b.cfg.onPick || !m) return;
    const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    const xv = m.xMin + (px - m.pad.l) / m.pw * (m.xMax - m.xMin);
    let best: Series | null = null, bd = 24;                     // within 24 px
    for (const s of b.cfg.series) {
      if (s.hidden || !s.label || s.y2 || !s.x.length) continue;
      let bi = 0, bx = Infinity;
      for (let i = 0; i < s.x.length; i++) { const d = Math.abs(s.x[i] - xv); if (d < bx) { bx = d; bi = i; } }
      const d = Math.abs(m.Y(s.y[bi]) - py);
      if (d < bd) { bd = d; best = s; }
    }
    if (best) b.cfg.onPick(best);
  });
}
