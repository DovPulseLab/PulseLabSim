/* Cause → effect map (ported from v1 js/causal.js). Nodes show live values; after an input
   or drug change, nodes pulse ▲/▼ with the direction of change as the inputs ramp, and the
   arrows between changed nodes light up in causal order (inputs first). */
import { CAUSAL_COLUMNS, EDGES, FEEDBACK_EDGE, NODES, causalDepth } from '../config/causal';
import type { BeatResult } from '../model/solve';

const NS = 'http://www.w3.org/2000/svg';
const COLX = [14, 300, 598, 880], COLW = [210, 222, 210, 210];
const RH = 46, TOP = 44;
/** Cascade timing: an edge takes DRAW_MS to draw; a node lights when its first incoming edge arrives. */
const DRAW_MS = 420, HOLD_MS = 60;
const pos = (c: number, r: number) => ({ x: COLX[c], y: TOP + r * RH, w: COLW[c], h: 38 });

export class CausalMap {
  private nodes: Record<string, { g: SVGGElement; inner: SVGGElement; rect: SVGRectElement; val: SVGTextElement; del: SVGTextElement }> = {};
  private edges: { a: string; b: string; p: SVGPathElement; len: number; onSince: number | null; start: number | null }[] = [];
  private depth = causalDepth();
  /** nodes sorted so every edge's source comes before its target */
  private order = [...NODES].sort((x, y) => (this.depth[x.id] ?? 0) - (this.depth[y.id] ?? 0));
  private lit: Record<string, number | null> = {};       // time the node lit up (null = not lit)
  private changedSince: Record<string, number | null> = {};
  private lastRef: BeatResult | null = null;
  private last: { res: BeatResult; ref: BeatResult | null } | null = null;
  private raf = 0;

  constructor(container: HTMLElement, onNode?: (id: string) => void) {
    container.innerHTML = '';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 1104 418'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Cause and effect network of haemodynamic variables');
    container.appendChild(svg);
    const mk = <T extends SVGElement>(tag: string, a: Record<string, string | number>, parent: Element = svg) => {
      const e = document.createElementNS(NS, tag) as T; for (const k in a) e.setAttribute(k, String(a[k])); parent.appendChild(e); return e;
    };
    const defs = mk('defs', {});
    for (const k of ['n', 'up', 'dn']) {
      const m = mk('marker', { id: 'arr-' + k, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, defs);
      mk('path', { d: 'M0 0 L10 5 L0 10 z', fill: k === 'up' ? 'var(--up)' : k === 'dn' ? 'var(--down)' : 'var(--line)' }, m);
    }
    CAUSAL_COLUMNS.forEach((t, i) => { const e = mk('text', { x: COLX[i], y: 22, 'font-size': 11, 'font-weight': 650, fill: 'var(--ink-3)', 'letter-spacing': '0.08em' }); e.textContent = t; });
    const byId = Object.fromEntries(NODES.map(n => [n.id, n]));
    const gE = mk('g', {});
    for (const [a, b] of EDGES) {
      const A = pos(byId[a].c, byId[a].r), B = pos(byId[b].c, byId[b].r);
      let d: string;
      if (byId[a].c === byId[b].c) { const x = A.x + A.w, y1 = A.y + A.h / 2, y2 = B.y + B.h / 2; d = `M${x} ${y1} C ${x + 34} ${y1}, ${x + 34} ${y2}, ${x + 2} ${y2}`; }
      else { const x1 = A.x + A.w, y1 = A.y + A.h / 2, x2 = B.x - 2, y2 = B.y + B.h / 2, mx = (x1 + x2) / 2; d = `M${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`; }
      const p = mk<SVGPathElement>('path', { d, fill: 'none', stroke: 'var(--line)', 'stroke-width': 1.3, 'marker-end': 'url(#arr-n)' }, gE);
      this.edges.push({ a, b, p, len: 0, onSince: null, start: null });
    }
    const M = pos(byId[FEEDBACK_EDGE[0]].c, byId[FEEDBACK_EDGE[0]].r), Ca = pos(byId[FEEDBACK_EDGE[1]].c, byId[FEEDBACK_EDGE[1]].r);
    const fb = mk<SVGPathElement>('path', { d: `M${M.x + 40} ${M.y} C ${M.x + 20} ${M.y - 30}, ${Ca.x + Ca.w + 40} ${Ca.y - 40}, ${Ca.x + Ca.w - 30} ${Ca.y}`, fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 1.2, 'stroke-dasharray': '4 3', 'marker-end': 'url(#arr-n)', opacity: 0.8 }, gE);
    mk('title', {}, fb).textContent = 'Passive feedback: higher MAP stiffens the elastic arteries (dashed)';
    const lab = mk('text', { x: (M.x + Ca.x + Ca.w) / 2 + 10, y: Math.min(M.y, Ca.y) - 14, 'font-size': 10.5, fill: 'var(--ink-3)', 'text-anchor': 'middle' }); lab.textContent = 'passive feedback: MAP → aortic stiffness';
    for (const n of NODES) {
      const P = pos(n.c, n.r);
      // The outer <g> carries the position via the SVG transform attribute. The pulse animation
      // (a CSS transform: scale) runs on the inner <g>: a CSS transform on the outer group would
      // override the translate and drop the node at the SVG origin (top-left corner).
      const g = mk<SVGGElement>('g', { transform: `translate(${P.x} ${P.y})`, style: 'cursor:pointer', tabindex: 0, role: 'button', 'aria-label': n.l });
      const inner = mk<SVGGElement>('g', { style: 'transform-box:fill-box;transform-origin:center' }, g);
      const rect = mk<SVGRectElement>('rect', { width: P.w, height: P.h, rx: 8, fill: 'var(--panel)', stroke: 'var(--line)', 'stroke-width': 1.3, class: 'node-rect' }, inner);
      mk('text', { x: 10, y: 15, 'font-size': 11.5, fill: 'var(--ink-2)', 'font-weight': 550 }, inner).textContent = n.l;
      const val = mk<SVGTextElement>('text', { x: 10, y: 31, 'font-size': 12.5, fill: 'var(--ink)', 'font-family': 'ui-monospace, Menlo, monospace' }, inner);
      const del = mk<SVGTextElement>('text', { x: P.w - 10, y: 31, 'font-size': 12, 'text-anchor': 'end', 'font-weight': 650, 'font-family': 'ui-monospace, Menlo, monospace' }, inner);
      if (onNode) { g.addEventListener('click', () => onNode(n.id)); g.addEventListener('keydown', e => { if (e.key === 'Enter') onNode(n.id); }); }
      this.nodes[n.id] = { g, inner, rect, val, del };
    }
  }

  /** res: current beat; ref: beat before the last change (null = no comparison).
      After a change the effect spreads left to right: changed inputs light first, each arrow
      draws from cause to effect, and a node lights (and pulses) when an arrow reaches it. */
  update(res: BeatResult, ref: BeatResult | null): void {
    this.last = { res, ref };
    const now = performance.now();
    if (ref !== this.lastRef) {          // a new change (or "Clear changes"): start a fresh cascade
      this.lastRef = ref;
      for (const n of NODES) { this.lit[n.id] = null; this.changedSince[n.id] = null; this.nodes[n.id].inner.classList.remove('pulse'); }
      for (const E of this.edges) { E.onSince = null; E.start = null; }
    }
    const dirs: Record<string, number> = {}, dvs: Record<string, number> = {};
    for (const n of NODES) {
      const e = this.nodes[n.id], v = n.v(res);
      e.val.textContent = `${Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(n.f)} ${n.u}`;
      let dir = 0;
      if (ref) {
        const v0 = n.v(ref), dv = v - v0, scale = Math.max(Math.abs(v0), n.abs ? 5 : 1e-9);
        if (Math.abs(dv) / scale > 0.004) dir = Math.sign(dv);
        dvs[n.id] = dv;
      }
      dirs[n.id] = dir;
      if (dir && this.changedSince[n.id] == null) this.changedSince[n.id] = now;
      if (!dir) { this.changedSince[n.id] = null; this.lit[n.id] = null; }
    }
    // walk in causal order: inputs light as soon as they change; an edge starts drawing once its
    // source is lit; a node lights when the first of its incoming edges has finished drawing
    let busy = false;
    for (const n of this.order) {
      if (dirs[n.id] && this.lit[n.id] == null) {
        if ((this.depth[n.id] ?? 0) === 0) this.lit[n.id] = now;
        else {
          let arrive = Infinity;
          for (const E of this.edges) if (E.b === n.id && E.start != null) arrive = Math.min(arrive, E.start + DRAW_MS);
          if (arrive <= now) this.lit[n.id] = now;
          else if (arrive < Infinity || this.changedSince[n.id] != null) busy = true;
          // a changed node none of whose sources changed would never light: light it after a beat
          if (arrive === Infinity && this.edges.every(E => E.b !== n.id || !dirs[E.a]) && now - (this.changedSince[n.id] ?? now) > HOLD_MS) this.lit[n.id] = now;
        }
        if (this.lit[n.id] != null) { const g = this.nodes[n.id].inner; g.classList.remove('pulse'); void g.getBoundingClientRect(); g.classList.add('pulse'); }
      }
      for (const E of this.edges) {
        if (E.a !== n.id) continue;
        const on = !!dirs[E.a] && !!dirs[E.b];
        if (!on) { E.onSince = null; E.start = null; continue; }
        if (E.onSince == null) E.onSince = now;
        if (E.start == null && this.lit[E.a] != null) E.start = now;
      }
    }
    for (const n of NODES) {
      const e = this.nodes[n.id], shown = this.lit[n.id] != null, dir = shown ? dirs[n.id] : 0, dv = dvs[n.id] ?? 0;
      e.del.textContent = dir ? `${dir > 0 ? '▲ +' : '▼ '}${Math.abs(dv) >= 1000 ? dv.toFixed(0) : dv.toFixed(n.f)}` : '';
      e.del.setAttribute('fill', dir > 0 ? 'var(--up)' : 'var(--down)');
      e.rect.setAttribute('stroke', dir > 0 ? 'var(--up)' : dir < 0 ? 'var(--down)' : 'var(--line)');
      e.rect.setAttribute('stroke-width', dir ? '2.2' : '1.3');
      e.rect.setAttribute('fill', dir ? 'var(--panel-2)' : 'var(--panel)');
    }
    for (const E of this.edges) {
      const c = dirs[E.b] > 0 ? 'up' : 'down';
      if (E.start == null) {
        E.p.setAttribute('stroke', 'var(--line)'); E.p.setAttribute('stroke-width', '1.3'); E.p.setAttribute('marker-end', 'url(#arr-n)');
        E.p.style.strokeDasharray = ''; E.p.style.strokeDashoffset = ''; E.p.style.opacity = '';
        continue;
      }
      const t = Math.min(1, (now - E.start) / DRAW_MS), k = 1 - (1 - t) * (1 - t);   // ease-out
      if (!(E.len > 0)) { try { E.len = E.p.getTotalLength(); } catch { E.len = 0; } }
      E.p.setAttribute('stroke', `var(--${c})`); E.p.setAttribute('stroke-width', '2.2');
      if (t < 1 && E.len > 0) {
        busy = true;
        // a coloured dash the length of the path, slid in from the cause end
        E.p.style.strokeDasharray = `${E.len} ${E.len}`; E.p.style.strokeDashoffset = `${E.len * (1 - k)}`;
        E.p.style.opacity = String(0.35 + 0.65 * k);
        E.p.setAttribute('marker-end', 'none');            // arrowhead appears when the line arrives
      } else {
        E.p.style.strokeDasharray = ''; E.p.style.strokeDashoffset = ''; E.p.style.opacity = '';
        E.p.setAttribute('marker-end', `url(#arr-${c === 'up' ? 'up' : 'dn'})`);
      }
    }
    // keep animating even if the simulation stops sending beats (e.g. paused)
    cancelAnimationFrame(this.raf);
    if (busy && typeof requestAnimationFrame === 'function')
      this.raf = requestAnimationFrame(() => { if (this.last) this.update(this.last.res, this.last.ref); });
  }
}
