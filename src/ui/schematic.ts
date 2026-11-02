/* Animated arterial-tree schematic (ported from v1 js/schematic.js). The forward wave
   travels heart → reflection site in Δtp/2 and the echo returns in Δtp/2; the arm wave
   travels at muscular PWV. Shown slowed ×6 so it can be followed. */
import type { BeatResult } from '../model/solve';

const SLOW = 6;
const NS = 'http://www.w3.org/2000/svg';
const MAIN = 'M232 140 C 228 110, 236 92, 250 102 C 257 108, 256 124, 256 142 L 256 300 C 256 316, 266 322, 268 342 L 274 448';
const LEG2 = 'M256 300 C 256 316, 246 322, 244 342 L 238 448';
const ARM = 'M240 100 C 222 88, 186 88, 164 104 L 132 204 L 104 296';
const CAROTID = 'M246 98 C 246 86, 240 74, 236 62';

interface AnimState { T: number; ET: number; dtp: number; tArm: number; fwdAmp: number; bwdAmp: number; siteLen: number; }

export class Schematic {
  private svg: SVGSVGElement;
  private el: Record<string, SVGElement & { getTotalLength?: () => number }> = {};
  private lenMain = 0; private lenArm = 0;
  private st: AnimState | null = null;
  private t0 = performance.now();
  running = true;

  constructor(container: HTMLElement) {
    container.innerHTML = '';
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('viewBox', '0 0 440 528');
    this.svg.setAttribute('role', 'img');
    this.svg.setAttribute('aria-label', 'Schematic of the arterial tree showing forward and reflected pressure waves');
    container.appendChild(this.svg);
    const mk = (tag: string, a: Record<string, string | number>, parent: Element = this.svg) => {
      const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, String(a[k])); parent.appendChild(e); return e as SVGElement;
    };
    const g = mk('g', { fill: 'var(--panel-2)', stroke: 'var(--line)', 'stroke-width': 1.5 });
    mk('circle', { cx: 236, cy: 38, r: 25 }, g);
    mk('path', { d: 'M178 84 Q236 66 296 84 L 306 120 L 300 300 Q 296 318 286 326 L 292 456 L 256 456 L 254 336 L 252 336 L 248 456 L 214 456 L 222 326 Q 210 318 206 300 L 196 160 L 170 210 L 116 312 L 92 304 L 140 196 L 162 104 Z' }, g);
    const el = this.el;
    el.leg2 = mk('path', { d: LEG2, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 5, 'stroke-linecap': 'round', opacity: 0.45 });
    el.carotid = mk('path', { d: CAROTID, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 4, 'stroke-linecap': 'round', opacity: 0.5 });
    el.arm = mk('path', { d: ARM, fill: 'none', stroke: 'var(--brach)', 'stroke-width': 4, 'stroke-linecap': 'round', opacity: 0.8 });
    el.main = mk('path', { d: MAIN, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 9, 'stroke-linecap': 'round' });
    this.lenMain = (el.main as SVGPathElement).getTotalLength(); this.lenArm = (el.arm as SVGPathElement).getTotalLength();
    el.heart = mk('path', { d: 'M232 162 C 210 148, 214 126, 228 128 C 232 128, 234 132, 234 134 C 236 128, 250 124, 252 138 C 254 150, 242 158, 232 162 Z', fill: 'var(--accent)', stroke: 'var(--panel)', 'stroke-width': 1.5 });
    el.bed = mk('g', {});
    el.site = mk('circle', { r: 9, fill: 'none', stroke: 'var(--bwd)', 'stroke-width': 2.5, 'stroke-dasharray': '3 2' });
    const pt = (el.arm as SVGPathElement).getPointAtLength(this.lenArm);
    mk('rect', { x: pt.x - 11, y: pt.y - 6, width: 22, height: 12, rx: 3, fill: 'var(--radial)', opacity: 0.85 });
    el.fwd = mk('circle', { r: 7, fill: 'var(--fwd)', opacity: 0 });
    el.bwd = mk('circle', { r: 6, fill: 'var(--bwd)', opacity: 0 });
    el.armP = mk('circle', { r: 5, fill: 'var(--brach)', opacity: 0 });
    const lab = (x: number, y: number, txt: string, anchor = 'start', bold = false) => {
      const t = mk('text', { x, y, 'text-anchor': anchor, 'font-size': 11.5, fill: 'var(--ink-2)' }); t.textContent = txt; if (bold) t.setAttribute('font-weight', '600'); return t;
    };
    lab(262, 96, 'Ascending aorta / arch');
    el.lblAo = lab(266, 190, '', 'start', true); el.lblAo2 = lab(266, 205, '');
    el.lblSite = lab(0, 0, '', 'start', true); el.lblSite2 = lab(0, 0, ''); el.lblBed = lab(0, 0, '');
    lab(66, 150, 'Arm (muscular)', 'middle'); el.lblArm = lab(66, 165, '', 'middle');
    lab(104, 322, 'Radial · tonometer', 'middle');
    const tl = mk('g', { transform: 'translate(24 476)' });
    mk('text', { x: 0, y: -6, 'font-size': 11, fill: 'var(--ink-3)', 'font-weight': 600 }, tl).textContent = 'ONE CARDIAC CYCLE (slowed ×6)';
    mk('rect', { x: 0, y: 2, width: 392, height: 14, rx: 4, fill: 'var(--line-2)' }, tl);
    el.tlSys = mk('rect', { x: 0, y: 2, width: 100, height: 14, rx: 4, fill: 'var(--accent)', opacity: 0.22 }, tl);
    el.tlRet = mk('line', { x1: 0, x2: 0, y1: -2, y2: 20, stroke: 'var(--bwd)', 'stroke-width': 3 }, tl);
    el.tlNow = mk('line', { x1: 0, x2: 0, y1: 0, y2: 18, stroke: 'var(--ink)', 'stroke-width': 1.5 }, tl);
    el.tlTxt = mk('text', { x: 0, y: 36, 'font-size': 11.5, fill: 'var(--ink-2)' }, tl);
    mk('text', { x: 4, y: 13, 'font-size': 10, fill: 'var(--ink-2)' }, tl).textContent = 'systole';
  }

  update(res: BeatResult): void {
    const m = res.m, p = res.params, d = res.d, el = this.el;
    const s = Math.min(1, Math.max(0, (d.cAoOp - 5) / 10));
    const lerp = (a: number[], b: number[]) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * s)).join(',')})`;
    el.main.setAttribute('stroke', lerp([0, 114, 178], [192, 38, 45]));
    el.main.setAttribute('stroke-width', (4 + p.diam * 2.2).toFixed(1));
    el.arm.setAttribute('stroke-width', (2.5 + 2.5 * (1.2 - Math.min(1.2, (d.cMusOp - 6) / 8))).toFixed(1));
    const frac = Math.min(0.97, Math.max(0.38, 0.30 + (d.lp - 25) / 75 * 0.62));
    const siteLen = frac * this.lenMain;
    const sp = (el.main as SVGPathElement).getPointAtLength(siteLen);
    el.site.setAttribute('cx', String(sp.x)); el.site.setAttribute('cy', String(sp.y)); el.site.setAttribute('r', (6 + 10 * d.g).toFixed(1));
    el.bed.innerHTML = '';
    const rw = Math.max(0.6, 2.6 * Math.pow(p.radius / 100, 2));
    for (let i = -2; i <= 2; i++) {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', `M${sp.x} ${sp.y} q ${18 + 4 * Math.abs(i)} ${i * 7} 36 ${i * 13}`);
      path.setAttribute('stroke', 'var(--accent)'); path.setAttribute('stroke-width', String(rw)); path.setAttribute('fill', 'none'); path.setAttribute('opacity', '0.55'); path.setAttribute('stroke-linecap', 'round');
      el.bed.appendChild(path);
    }
    const place = (e: SVGElement, dy: number, txt: string) => { e.setAttribute('x', String(sp.x + 44)); e.setAttribute('y', String(sp.y + dy)); e.textContent = txt; };
    place(el.lblSite, -4, `Reflection site Γ ≈ ${d.g.toFixed(2)}`); place(el.lblSite2, 11, `Lp = ${d.lp.toFixed(0)} cm`); place(el.lblBed, 26, `arterioles r = ${p.radius.toFixed(0)} %`);
    el.lblAo.textContent = `Aortic PWV ${d.cAoOp.toFixed(1)} m/s`;
    el.lblAo2.textContent = `Δtp = ${(d.dtp * 1000).toFixed(0)} ms`;
    el.lblArm.textContent = `PWV ${d.cMusOp.toFixed(1)} m/s`;
    const W = 392, x = (v: number) => v / d.T * W;
    el.tlSys.setAttribute('width', String(x(d.ET)));
    el.tlRet.setAttribute('x1', String(x(d.dtp))); el.tlRet.setAttribute('x2', String(x(d.dtp)));
    const inSys = d.dtp < d.ET;
    el.tlTxt.textContent = inSys ? `Echo returns at ${(d.dtp * 1000).toFixed(0)} ms — in SYSTOLE (adds to LV load)` : `Echo returns at ${(d.dtp * 1000).toFixed(0)} ms — in DIASTOLE (supports coronary perfusion)`;
    el.tlTxt.setAttribute('fill', inSys ? 'var(--bwd)' : 'var(--ok)');
    this.st = { T: d.T, ET: d.ET, dtp: d.dtp, tArm: (d.armLen / 100) / d.cMusOp, fwdAmp: m.fwdAmp, bwdAmp: m.bwdAmp, siteLen };
  }

  tick(now: number, paused: boolean): void {
    const st = this.st, el = this.el; if (!st) return;
    if (!this.running || paused) { for (const k of ['fwd', 'bwd', 'armP']) el[k].setAttribute('opacity', '0'); if (paused) this.t0 = now; return; }
    const period = st.T * SLOW;
    const tt = ((now - this.t0) / 1000 % period) / SLOW;
    const ej = tt < st.ET ? Math.sin(Math.PI * tt / st.ET) : 0;
    el.heart.setAttribute('transform', `translate(232 145) scale(${1 - 0.1 * ej}) translate(-232 -145)`);
    const half = st.dtp / 2;
    const show = (c: SVGElement, len: number, path: SVGElement, r: number) => { const p = (path as SVGPathElement).getPointAtLength(len); c.setAttribute('cx', String(p.x)); c.setAttribute('cy', String(p.y)); c.setAttribute('r', String(r)); c.setAttribute('opacity', '0.92'); };
    const rf = 4 + Math.min(8, st.fwdAmp / 7), rb = 3 + Math.min(8, st.bwdAmp / 7);
    if (tt < half) show(el.fwd, tt / half * st.siteLen, el.main, rf); else el.fwd.setAttribute('opacity', '0');
    if (tt >= half && tt < st.dtp) show(el.bwd, (1 - (tt - half) / half) * st.siteLen, el.main, rb); else el.bwd.setAttribute('opacity', '0');
    if (tt < st.tArm) show(el.armP, tt / st.tArm * this.lenArm, el.arm, 5); else el.armP.setAttribute('opacity', '0');
    el.tlNow.setAttribute('x1', String(tt / st.T * 392)); el.tlNow.setAttribute('x2', String(tt / st.T * 392));
  }
}
