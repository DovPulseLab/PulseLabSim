/* =====================================================================
   Cause -> effect map.  Every node shows its live value; after a change
   each node lights up with the measured direction of change, and edges
   between two changed nodes are highlighted, tracing the causal path.
   ===================================================================== */
(function (global) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const COLS = [{ x: 14, w: 210, title: 'INPUTS (what you set)' }, { x: 300, w: 222, title: 'MECHANISMS' }, { x: 598, w: 210, title: 'PRESSURES' }, { x: 880, w: 210, title: 'LV LOAD & INDICES' }];
  const RH = 46, TOP = 44;
  const NODES = [
    { id: 'hr', c: 0, r: 0, l: 'Heart rate', v: r => r.params.hr, u: 'bpm', f: 0 },
    { id: 'sv', c: 0, r: 1, l: 'Stroke volume', v: r => r.params.sv, u: 'mL', f: 0 },
    { id: 'rad', c: 0, r: 2, l: 'Arteriolar radius', v: r => r.params.radius, u: '%', f: 0 },
    { id: 'cao', c: 0, r: 3, l: 'Aortic PWV (operating)', v: r => r.m.cAoOp, u: 'm/s', f: 1 },
    { id: 'dia', c: 0, r: 4, l: 'Aortic diameter', v: r => r.params.diam, u: 'cm', f: 1 },
    { id: 'cmus', c: 0, r: 5, l: 'Muscular-artery PWV', v: r => r.m.cMusOp, u: 'm/s', f: 1 },
    { id: 'gam', c: 0, r: 6, l: 'Reflection coeff. Γ', v: r => r.d.g, u: '', f: 2 },
    { id: 'lp', c: 0, r: 7, l: 'Reflection distance Lp', v: r => r.m.lp, u: 'cm', f: 0 },

    { id: 'co', c: 1, r: 0, l: 'Cardiac output', v: r => r.m.co, u: 'L/min', f: 2 },
    { id: 'et', c: 1, r: 1, l: 'Ejection time', v: r => r.m.et, u: 'ms', f: 0 },
    { id: 'svr', c: 1, r: 2, l: 'SVR', v: r => r.m.svrDyn, u: 'dyn·s·cm⁻⁵', f: 0 },
    { id: 'zc', c: 1, r: 3, l: 'Char. impedance Zc', v: r => r.m.zcDyn, u: 'dyn·s·cm⁻⁵', f: 0 },
    { id: 'comp', c: 1, r: 4, l: 'Total compliance C', v: r => r.m.ctot, u: 'mL/mmHg', f: 2 },
    { id: 'dtp', c: 1, r: 5, l: 'Round-trip time Δtp', v: r => r.m.dtp, u: 'ms', f: 0 },
    { id: 'fwd', c: 1, r: 6, l: 'Forward wave amplitude', v: r => r.m.fwdAmp, u: 'mmHg', f: 1 },
    { id: 'bwd', c: 1, r: 7, l: 'Reflected wave amplitude', v: r => r.m.bwdAmp, u: 'mmHg', f: 1 },

    { id: 'map', c: 2, r: 0.5, l: 'Mean arterial pressure', v: r => r.m.map, u: 'mmHg', f: 0 },
    { id: 'sbp', c: 2, r: 2, l: 'Central SBP', v: r => r.m.Ps, u: 'mmHg', f: 0 },
    { id: 'dbp', c: 2, r: 3.5, l: 'Diastolic BP', v: r => r.m.Pd, u: 'mmHg', f: 0 },
    { id: 'pp', c: 2, r: 5, l: 'Central pulse pressure', v: r => r.m.PP, u: 'mmHg', f: 0 },
    { id: 'bsbp', c: 2, r: 6.5, l: 'Brachial (cuff) SBP', v: r => r.m.bSBP, u: 'mmHg', f: 0 },

    { id: 'aix', c: 3, r: 0.5, l: 'Augmentation index', v: r => r.m.AIx, u: '%', f: 1, abs: true },
    { id: 'ew', c: 3, r: 2, l: 'Wasted LV energy ΔEw', v: r => r.m.Ew / 1000, u: '×10³', f: 1, abs: true },
    { id: 'lses', c: 3, r: 3.5, l: 'Late/early systolic load', v: r => r.m.lsEs, u: '', f: 2 },
    { id: 'ppa', c: 3, r: 5, l: 'PP amplification', v: r => r.m.ppa, u: '', f: 2 },
    { id: 'sevr', c: 3, r: 6.5, l: 'SEVR (supply/demand)', v: r => r.m.sevr, u: '%', f: 0 }
  ];
  const EDGES = [
    ['hr', 'co'], ['hr', 'et'], ['sv', 'co'], ['sv', 'fwd'], ['rad', 'svr'],
    ['cao', 'zc'], ['cao', 'comp'], ['cao', 'dtp'], ['dia', 'zc'], ['dia', 'comp'], ['cmus', 'dtp'], ['lp', 'dtp'], ['gam', 'bwd'],
    ['co', 'map'], ['svr', 'map'], ['zc', 'fwd'], ['et', 'fwd'], ['fwd', 'bwd'], ['comp', 'dbp'], ['fwd', 'pp'], ['bwd', 'pp'], ['dtp', 'sbp'],
    ['map', 'sbp'], ['map', 'dbp'], ['pp', 'sbp'], ['pp', 'bsbp'],
    ['bwd', 'aix'], ['dtp', 'aix'], ['et', 'ew'], ['bwd', 'ew'], ['dtp', 'lses'], ['pp', 'ppa'], ['bsbp', 'ppa'],
    ['sbp', 'sevr'], ['dbp', 'sevr'], ['et', 'sevr'], ['sbp', 'aix']
  ];
  let svg, nodeEls = {}, edgeEls = [];

  const pos = n => { const c = COLS[n.c]; return { x: c.x, y: TOP + n.r * RH, w: c.w, h: 38 }; };
  function mk(tag, a, parent) { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); (parent || svg).appendChild(e); return e; }

  function init(container) {
    container.innerHTML = '';
    svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 1104 418');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Cause and effect network of hemodynamic variables');
    container.appendChild(svg);
    const defs = mk('defs', {});
    ['n', 'h'].forEach(k => {
      const m = mk('marker', { id: 'arr-' + k, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, defs);
      mk('path', { d: 'M0 0 L10 5 L0 10 z', fill: k === 'h' ? 'var(--accent)' : 'var(--line)' }, m);
    });
    COLS.forEach(c => { const t = mk('text', { x: c.x, y: 22, 'font-size': 11, 'font-weight': 650, fill: 'var(--ink-3)', 'letter-spacing': '0.08em' }); t.textContent = c.title; });
    const gE = mk('g', {});
    const byId = {}; NODES.forEach(n => byId[n.id] = n);
    EDGES.forEach(([a, b]) => {
      const A = pos(byId[a]), B = pos(byId[b]);
      let d;
      if (byId[a].c === byId[b].c) {   // same column: curve on the right
        const x = A.x + A.w, y1 = A.y + A.h / 2, y2 = B.y + B.h / 2;
        d = `M${x} ${y1} C ${x + 34} ${y1}, ${x + 34} ${y2}, ${x + 2} ${y2}`;
      } else {
        const x1 = A.x + A.w, y1 = A.y + A.h / 2, x2 = B.x - 2, y2 = B.y + B.h / 2, mx = (x1 + x2) / 2;
        d = `M${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
      }
      const p = mk('path', { d, fill: 'none', stroke: 'var(--line)', 'stroke-width': 1.3, 'marker-end': 'url(#arr-n)' }, gE);
      edgeEls.push({ a, b, p });
    });
    // passive feedback MAP -> aortic PWV (dashed)
    const M = pos(byId.map), Ca = pos(byId.cao);
    mk('path', { d: `M${M.x + 40} ${M.y} C ${M.x + 20} ${M.y - 30}, ${Ca.x + Ca.w + 40} ${Ca.y - 40}, ${Ca.x + Ca.w - 30} ${Ca.y}`, fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 1, 'stroke-dasharray': '3 3', 'marker-end': 'url(#arr-n)', opacity: 0.7 }, gE);

    NODES.forEach(n => {
      const P = pos(n), g = mk('g', { transform: `translate(${P.x} ${P.y})`, style: 'cursor:default' });
      const rect = mk('rect', { width: P.w, height: P.h, rx: 8, fill: 'var(--panel)', stroke: 'var(--line)', 'stroke-width': 1.3 }, g);
      const lab = mk('text', { x: 10, y: 15, 'font-size': 11.5, fill: 'var(--ink-2)', 'font-weight': 550 }, g); lab.textContent = n.l;
      const val = mk('text', { x: 10, y: 31, 'font-size': 12.5, fill: 'var(--ink)', 'font-family': 'ui-monospace, Menlo, monospace' }, g);
      const del = mk('text', { x: P.w - 10, y: 31, 'font-size': 12, 'text-anchor': 'end', 'font-weight': 650, 'font-family': 'ui-monospace, Menlo, monospace' }, g);
      nodeEls[n.id] = { rect, val, del, n };
    });
  }

  function fmtNum(v, f) { return (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(f)); }

  function update(res, ref) {
    if (!svg) return;
    const changed = {};
    NODES.forEach(n => {
      const e = nodeEls[n.id], v = n.v(res);
      e.val.textContent = `${fmtNum(v, n.f)} ${n.u}`;
      let dir = 0;
      if (ref) {
        const v0 = n.v(ref), dv = v - v0, scale = Math.max(Math.abs(v0), n.abs ? 5 : 1e-9);
        if (Math.abs(dv) / scale > 0.004) dir = Math.sign(dv);
        e.del.textContent = dir ? `${dir > 0 ? '▲' : '▼'} ${dv > 0 ? '+' : ''}${fmtNum(dv, n.f)}` : '';
      } else e.del.textContent = '';
      e.del.setAttribute('fill', dir > 0 ? 'var(--up)' : 'var(--down)');
      e.rect.setAttribute('stroke', dir > 0 ? 'var(--up)' : dir < 0 ? 'var(--down)' : 'var(--line)');
      e.rect.setAttribute('stroke-width', dir ? 2.2 : 1.3);
      e.rect.setAttribute('fill', dir ? 'var(--panel-2)' : 'var(--panel)');
      changed[n.id] = dir;
    });
    edgeEls.forEach(E => {
      const on = changed[E.a] && changed[E.b];
      E.p.setAttribute('stroke', on ? 'var(--accent)' : 'var(--line)');
      E.p.setAttribute('stroke-width', on ? 2.2 : 1.3);
      E.p.setAttribute('marker-end', on ? 'url(#arr-h)' : 'url(#arr-n)');
      E.p.setAttribute('opacity', on ? 1 : 0.8);
    });
  }

  global.Causal = { init, update };
})(window);
