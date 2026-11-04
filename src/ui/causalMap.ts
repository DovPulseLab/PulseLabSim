/* Cause → effect map (ported from v1 js/causal.js). Nodes show live values; after an input
   or drug change, nodes pulse ▲/▼ with the direction of change as the inputs ramp, and the
   arrows between changed nodes light up in causal order (inputs first). */
import { CAUSAL_COLUMNS, EDGES, FEEDBACK_EDGE, NODES } from '../config/causal';
import type { BeatResult } from '../model/solve';

const NS = 'http://www.w3.org/2000/svg';
const COLX = [14, 300, 598, 880], COLW = [210, 222, 210, 210];
const RH = 46, TOP = 44;
/** After a change the effect sweeps across the map one column at a time: column c lights at
    c × COL_MS, and each arrow draws from its cause's column time to its effect's column time.
    Arrows within one column (e.g. MAP → central SBP) take SAME_COL_MS. */
const COL_MS = 750, SAME_COL_MS = 350;
const pos = (c: number, r: number) => ({ x: COLX[c], y: TOP + r * RH, w: COLW[c], h: 38 });

export class CausalMap {
  private nodes: Record<string, { g: SVGGElement; inner: SVGGElement; rect: SVGRectElement; val: SVGTextElement; del: SVGTextElement }> = {};
  private edges: { a: string; b: string; p: SVGPathElement; len: number; start: number | null; end: number }[] = [];
  private col: Record<string, number> = Object.fromEntries(NODES.map(n => [n.id, n.c]));
  private t0: number | null = null;                       // start of the current sweep (first visible change)
  private lit: Record<string, number | null> = {};        // time the node lights (null = not scheduled)
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
      this.edges.push({ a, b, p, len: 0, start: null, end: 0 });
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

  /** res: current beat; ref: beat before the last change (null = no comparison). */
  update(res: BeatResult, ref: BeatResult | null): void {
    this.last = { res, ref };
    const now = performance.now();
    if (ref !== this.lastRef) {          // a new change (or "Clear changes"): start a fresh sweep
      this.lastRef = ref; this.t0 = null;
      for (const n of NODES) { this.lit[n.id] = null; this.nodes[n.id].inner.classList.remove('pulse'); }
      for (const E of this.edges) E.start = null;
    }
    const colAt = (id: string) => (this.t0 ?? now) + this.col[id] * COL_MS;
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
      // the inputs ramp in, so the sweep starts when the first value actually moves, not at the click
      if (dir && this.t0 == null) this.t0 = now;
      // schedule the node for its column's turn; one that only starts changing later lights a
      // little after it starts, so its incoming arrows still visibly arrive first
      if (dir && this.lit[n.id] == null) this.lit[n.id] = Math.max(colAt(n.id), n.c === 0 ? now : now + SAME_COL_MS);
      if (!dir) this.lit[n.id] = null;
    }
    let busy = false;
    for (const E of this.edges) {
      const on = !!dirs[E.a] && !!dirs[E.b];
      if (!on) { E.start = null; continue; }
      if (E.start == null) {
        const la = this.lit[E.a]!, lb = this.lit[E.b]!;
        E.start = la; E.end = lb > la ? lb : la + SAME_COL_MS;
      }
    }
    for (const n of NODES) {
      const e = this.nodes[n.id], at = this.lit[n.id], shown = at != null && now >= at;
      if (at != null && !shown) busy = true;
      const dir = shown ? dirs[n.id] : 0, dv = dvs[n.id] ?? 0;
      if (shown && !e.inner.classList.contains('pulse')) e.inner.classList.add('pulse');
      if (!shown) e.inner.classList.remove('pulse');
      e.del.textContent = dir ? `${dir > 0 ? '▲ +' : '▼ '}${Math.abs(dv) >= 1000 ? dv.toFixed(0) : dv.toFixed(n.f)}` : '';
      e.del.setAttribute('fill', dir > 0 ? 'var(--up)' : 'var(--down)');
      e.rect.setAttribute('stroke', dir > 0 ? 'var(--up)' : dir < 0 ? 'var(--down)' : 'var(--line)');
      e.rect.setAttribute('stroke-width', dir ? '2.2' : '1.3');
      e.rect.setAttribute('fill', dir ? 'var(--panel-2)' : 'var(--panel)');
    }
    for (const E of this.edges) {
      const c = dirs[E.b] > 0 ? 'up' : 'down';
      if (E.start == null || now < E.start) {
        if (E.start != null) busy = true;
        E.p.setAttribute('stroke', 'var(--line)'); E.p.setAttribute('stroke-width', '1.3'); E.p.setAttribute('marker-end', 'url(#arr-n)');
        E.p.style.strokeDasharray = ''; E.p.style.strokeDashoffset = ''; E.p.style.opacity = '';
        continue;
      }
      const t = Math.min(1, (now - E.start) / Math.max(1, E.end - E.start));
      if (!(E.len > 0)) { try { E.len = E.p.getTotalLength(); } catch { E.len = 0; } }
      E.p.setAttribute('stroke', `var(--${c})`); E.p.setAttribute('stroke-width', '2.2');
      if (t < 1 && E.len > 0) {
        busy = true;
        // a coloured dash the length of the path, slid in from the cause end
        E.p.style.strokeDasharray = `${E.len} ${E.len}`; E.p.style.strokeDashoffset = `${E.len * (1 - t)}`;
        E.p.style.opacity = '';
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
