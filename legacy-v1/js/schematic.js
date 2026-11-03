/* =====================================================================
   Animated arterial-tree schematic (SVG).
   Forward wave travels heart -> effective reflection site (Lp) in dtp/2,
   reflected wave returns in dtp/2.  The arm wave travels to the radial
   artery at muscular PWV.  Time is slowed by SLOW for visibility.
   ===================================================================== */
(function (global) {
  'use strict';
  const SLOW = 6;
  const NS = 'http://www.w3.org/2000/svg';
  let svg, el = {}, state = null, t0 = performance.now(), running = true, lenMain = 0, lenArm = 0;

  const MAIN = 'M232 140 C 228 110, 236 92, 250 102 C 257 108, 256 124, 256 142 L 256 300 C 256 316, 266 322, 268 342 L 274 448';
  const LEG2 = 'M256 300 C 256 316, 246 322, 244 342 L 238 448';
  const ARM  = 'M240 100 C 222 88, 186 88, 164 104 L 132 204 L 104 296';
  const CAROTID = 'M246 98 C 246 86, 240 74, 236 62';

  function mk(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); (parent || svg).appendChild(e); return e; }

  function init(container) {
    container.innerHTML = '';
    svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 440 528');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Schematic of the arterial tree showing forward and reflected pressure waves');
    container.appendChild(svg);

    // body silhouette
    const g = mk('g', { fill: 'var(--panel-2)', stroke: 'var(--line)', 'stroke-width': 1.5 });
    mk('circle', { cx: 236, cy: 38, r: 25 }, g);
    mk('path', { d: 'M178 84 Q236 66 296 84 L 306 120 L 300 300 Q 296 318 286 326 L 292 456 L 256 456 L 254 336 L 252 336 L 248 456 L 214 456 L 222 326 Q 210 318 206 300 L 196 160 L 170 210 L 116 312 L 92 304 L 140 196 L 162 104 Z' }, g);

    // static vessels
    el.leg2 = mk('path', { d: LEG2, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 5, 'stroke-linecap': 'round', opacity: 0.45 });
    el.carotid = mk('path', { d: CAROTID, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 4, 'stroke-linecap': 'round', opacity: 0.5 });
    el.arm = mk('path', { d: ARM, fill: 'none', stroke: 'var(--brach)', 'stroke-width': 4, 'stroke-linecap': 'round', opacity: 0.8 });
    el.main = mk('path', { d: MAIN, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 9, 'stroke-linecap': 'round' });
    lenMain = el.main.getTotalLength(); lenArm = el.arm.getTotalLength();

    // heart
    el.heart = mk('path', { d: 'M232 162 C 210 148, 214 126, 228 128 C 232 128, 234 132, 234 134 C 236 128, 250 124, 252 138 C 254 150, 242 158, 232 162 Z', fill: 'var(--accent)', stroke: 'var(--panel)', 'stroke-width': 1.5 });

    // arteriolar bed at reflection site
    el.bed = mk('g', {});
    // reflection site ring
    el.site = mk('circle', { r: 9, fill: 'none', stroke: 'var(--bwd)', 'stroke-width': 2.5, 'stroke-dasharray': '3 2' });
    // radial sensor
    const pt = el.arm.getPointAtLength(lenArm);
    mk('rect', { x: pt.x - 11, y: pt.y - 6, width: 22, height: 12, rx: 3, fill: 'var(--radial)', opacity: 0.85 });

    // pulses
    el.fwd = mk('circle', { r: 7, fill: 'var(--fwd)', opacity: 0.9 });
    el.bwd = mk('circle', { r: 6, fill: 'var(--bwd)', opacity: 0.9 });
    el.armP = mk('circle', { r: 5, fill: 'var(--brach)', opacity: 0.9 });

    // labels
    const lab = (x, y, txt, anchor, cls) => { const t = mk('text', { x, y, 'text-anchor': anchor || 'start', 'font-size': 11.5, fill: 'var(--ink-2)' }); t.textContent = txt; if (cls) t.setAttribute('font-weight', 600); return t; };
    lab(262, 96, 'Ascending aorta / arch', 'start');
    el.lblAo = lab(266, 190, '', 'start', true);
    el.lblAo2 = lab(266, 205, '', 'start');
    el.lblSite = lab(0, 0, '', 'start', true);
    el.lblSite2 = lab(0, 0, '', 'start');
    lab(66, 150, 'Arm (muscular)', 'middle');
    el.lblArm = lab(66, 165, '', 'middle');
    lab(104, 322, 'Radial · tonometer', 'middle');
    el.lblBed = lab(0, 0, '', 'start');

    // timeline
    const tl = mk('g', { transform: 'translate(24 476)' });
    mk('text', { x: 0, y: -6, 'font-size': 11, fill: 'var(--ink-3)', 'font-weight': 600 }, tl).textContent = 'ONE CARDIAC CYCLE';
    el.tlBg = mk('rect', { x: 0, y: 2, width: 392, height: 14, rx: 4, fill: 'var(--line-2)' }, tl);
    el.tlSys = mk('rect', { x: 0, y: 2, width: 100, height: 14, rx: 4, fill: 'var(--accent)', opacity: 0.22 }, tl);
    el.tlRet = mk('line', { x1: 0, x2: 0, y1: -2, y2: 20, stroke: 'var(--bwd)', 'stroke-width': 3 }, tl);
    el.tlNow = mk('line', { x1: 0, x2: 0, y1: 0, y2: 18, stroke: 'var(--ink)', 'stroke-width': 1.5 }, tl);
    el.tlTxt = mk('text', { x: 0, y: 36, 'font-size': 11.5, fill: 'var(--ink-2)' }, tl);
    el.tlSysTxt = mk('text', { x: 4, y: 13, 'font-size': 10, fill: 'var(--ink-2)' }, tl);

    requestAnimationFrame(tick);
  }

  function lerpColor(a, b, t) {
    const pa = a.match(/\w\w/g).map(h => parseInt(h, 16)), pb = b.match(/\w\w/g).map(h => parseInt(h, 16));
    return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }

  function update(res) {
    if (!svg) return;
    const m = res.m, p = res.params, d = res.d;
    state = { T: d.T, ET: d.ET, dtp: d.dtp, tArm: (d.armLen / 100) / d.cMusOp, fwdAmp: m.fwdAmp, bwdAmp: m.bwdAmp };
    // aorta: width ~ diameter, colour elastic (blue) -> stiff (red)
    const s = Math.min(1, Math.max(0, (d.cAoOp - 5) / 10));
    el.main.setAttribute('stroke', lerpColor('3b82c4', 'c0262d', s));
    el.main.setAttribute('stroke-width', (4 + p.diam * 2.2).toFixed(1));
    el.arm.setAttribute('stroke-width', (2.5 + 2.5 * (1.2 - Math.min(1.2, (d.cMusOp - 6) / 8))).toFixed(1));
    // reflection site along the main path, proportional to Lp
    const frac = Math.min(0.97, Math.max(0.38, 0.30 + (d.lp - 25) / 75 * 0.62));
    state.siteLen = frac * lenMain;
    const sp = el.main.getPointAtLength(state.siteLen);
    el.site.setAttribute('cx', sp.x); el.site.setAttribute('cy', sp.y);
    el.site.setAttribute('r', (6 + 10 * d.g).toFixed(1));
    // arteriolar bed: branch width ~ radius
    el.bed.innerHTML = '';
    const rw = Math.max(0.6, 2.6 * Math.pow(p.radius / 100, 2));
    for (let i = -2; i <= 2; i++) {
      mk('path', { d: `M${sp.x} ${sp.y} q ${18 + 4 * Math.abs(i)} ${i * 7} ${36} ${i * 13}`, stroke: 'var(--accent)', 'stroke-width': rw, fill: 'none', opacity: 0.55, 'stroke-linecap': 'round' }, el.bed);
    }
    el.lblSite.setAttribute('x', sp.x + 44); el.lblSite.setAttribute('y', sp.y - 4);
    el.lblSite.textContent = `Reflection site Γ ≈ ${d.g.toFixed(2)}`;
    el.lblSite2.setAttribute('x', sp.x + 44); el.lblSite2.setAttribute('y', sp.y + 11);
    el.lblSite2.textContent = `Lp = ${d.lp.toFixed(0)} cm`;
    el.lblBed.setAttribute('x', sp.x + 44); el.lblBed.setAttribute('y', sp.y + 26);
    el.lblBed.textContent = `arterioles r = ${p.radius.toFixed(0)} %`;
    el.lblAo.textContent = `Aortic PWV ${d.cAoOp.toFixed(1)} m/s`;
    el.lblAo2.textContent = `Δtp = ${(d.dtp * 1000).toFixed(0)} ms`;
    el.lblArm.textContent = `PWV ${d.cMusOp.toFixed(1)} m/s`;
    // timeline
    const W = 392, x = v => v / d.T * W;
    el.tlSys.setAttribute('width', x(d.ET));
    el.tlSysTxt.textContent = 'systole';
    el.tlRet.setAttribute('x1', x(d.dtp)); el.tlRet.setAttribute('x2', x(d.dtp));
    const inSys = d.dtp < d.ET;
    el.tlTxt.textContent = inSys
      ? `Reflected wave returns at ${(d.dtp * 1000).toFixed(0)} ms — in SYSTOLE (augments LV load)`
      : `Reflected wave returns at ${(d.dtp * 1000).toFixed(0)} ms — in DIASTOLE (supports coronary perfusion)`;
    el.tlTxt.setAttribute('fill', inSys ? 'var(--bwd)' : 'var(--ok)');
  }

  function tick(now) {
    requestAnimationFrame(tick);
    if (!state || !svg) return;
    if (!running) { hidePulses(); return; }
    const period = state.T * SLOW;
    const tt = ((now - t0) / 1000 % period) / SLOW;            // real-time seconds within beat
    // heart beat
    const ej = tt < state.ET ? Math.sin(Math.PI * tt / state.ET) : 0;
    el.heart.setAttribute('transform', `translate(232 145) scale(${1 - 0.1 * ej}) translate(-232 -145)`);
    // forward wave
    const half = state.dtp / 2;
    const show = (c, len, path, r) => { const p = path.getPointAtLength(len); c.setAttribute('cx', p.x); c.setAttribute('cy', p.y); c.setAttribute('r', r); c.setAttribute('opacity', 0.92); };
    const rf = 4 + Math.min(8, state.fwdAmp / 7), rb = 3 + Math.min(8, state.bwdAmp / 7);
    if (tt < half) show(el.fwd, tt / half * state.siteLen, el.main, rf); else el.fwd.setAttribute('opacity', 0);
    if (tt >= half && tt < state.dtp) show(el.bwd, (1 - (tt - half) / half) * state.siteLen, el.main, rb); else el.bwd.setAttribute('opacity', 0);
    if (tt < state.tArm) show(el.armP, tt / state.tArm * lenArm, el.arm, 5); else el.armP.setAttribute('opacity', 0);
    el.tlNow.setAttribute('x1', tt / state.T * 392); el.tlNow.setAttribute('x2', tt / state.T * 392);
  }
  function hidePulses() { ['fwd', 'bwd', 'armP'].forEach(k => el[k] && el[k].setAttribute('opacity', 0)); }

  global.Schematic = { init, update, setRunning: v => { running = v; }, SLOW };
})(window);
