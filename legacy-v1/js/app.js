/* =====================================================================
   Pulse Lab Simulator — app controller.
   Two patients (A and B), each with its own physiology, preset and drugs.
   The sidebar edits the active patient; the Compare tab shows both.
   ===================================================================== */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const { CONTROLS, METRICS, KPIS, EQUATIONS } = Content;
  const { LESSONS, GLOSSARY } = Lessons;
  const ALL_CTRL = CONTROLS.flatMap(g => g.items);
  const PT_COLOR = { A: '--pa', B: '--pb' };

  // ------------------------------------------------------------ state
  const newPatient = (preset, over, drugs) => ({ preset, base: Object.assign({}, PWA.DEFAULTS, PWA.PRESETS[preset] || {}, over || {}), drugs: new Set(drugs || []) });
  const state = {
    patients: { A: newPatient('Default adult (45 y)'), B: newPatient('Older adult (70 y)') },
    active: 'A',
    res: { A: null, B: null },
    baseline: null, committed: null, prevCommitted: null, dragging: false,
    tab: 'sim', lesson: 0, scenario: null
  };
  const pt = () => state.patients[state.active];
  const effOf = id => PWA.applyDrugs(state.patients[id].base, Array.from(state.patients[id].drugs));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }
  };
  const drugText = p => p.drugs.size ? Array.from(p.drugs).map(k => PWA.DRUGS[k].short).join(' + ') : 'no medication';
  const presetShort = p => p.preset.replace(/\s*\(.*\)/, '') + (p.preset.match(/\((.*)\)/) ? ', ' + p.preset.match(/\((.*)\)/)[1] : '');

  // ------------------------------------------------------------ sidebar
  const ctrlEls = {};
  function buildControls() {
    const root = $('#controls');
    root.innerHTML = '';
    CONTROLS.forEach((grp, gi) => {
      const g = document.createElement('details'); g.className = 'group'; g.open = gi < 4;
      g.innerHTML = `<summary><span class="dot" style="background:${grp.color}"></span>${grp.group}<span class="chev" aria-hidden="true">▾</span></summary>`;
      grp.items.forEach(c => {
        const row = document.createElement('div'); row.className = 'ctrl';
        row.innerHTML = `
          <div class="ctrl-top"><label for="in-${c.key}" data-tip="${c.tip.replace(/"/g, '&quot;')}">${c.label}</label>
          <span class="ctrl-val"><span class="num"></span><span class="unit">${c.unit}</span></span></div>
          <input type="range" id="in-${c.key}" min="${c.min}" max="${c.max}" step="${c.step}">
          <div class="ctrl-eff"></div><div class="ctrl-derived"></div>`;
        g.appendChild(row);
        const input = row.querySelector('input');
        input.addEventListener('pointerdown', () => { state.dragging = true; });
        input.addEventListener('input', () => { pt().base[c.key] = parseFloat(input.value); render(); });
        input.addEventListener('change', () => { state.dragging = false; commit(); render(); });
        ctrlEls[c.key] = { input, num: row.querySelector('.num'), eff: row.querySelector('.ctrl-eff'), der: row.querySelector('.ctrl-derived'), c };
      });
      root.appendChild(g);
    });
  }
  function syncControls(eff, res) {
    Object.values(ctrlEls).forEach(({ input, num, eff: effEl, der, c }) => {
      const v = pt().base[c.key];
      if (!(state.dragging && document.activeElement === input)) input.value = v;
      num.textContent = (+v).toFixed(c.f);
      const ev = eff[c.key];
      effEl.textContent = Math.abs(ev - v) > 1e-6 ? `→ ${(+ev).toFixed(c.f)} ${c.unit} with medication` : '';
      const m = res.m;
      der.textContent = ({
        hr: `ejection ${m.et.toFixed(0)} ms · cycle ${(60000 / eff.hr).toFixed(0)} ms`,
        sv: `cardiac output ${m.co.toFixed(2)} L/min`,
        etScale: `ejection ${m.et.toFixed(0)} ms`,
        radius: `SVR ${m.svrDyn.toFixed(0)} dyn·s·cm⁻⁵`,
        cAo: `operating ${m.cAoOp.toFixed(1)} m/s at MAP ${m.map.toFixed(0)}`,
        diam: `compliance ${m.ctot.toFixed(2)} mL/mmHg`,
        cMus: `reflected-wave path ${m.cPath.toFixed(1)} m/s`,
        gamma: `echo amplitude ${m.bwdAmp.toFixed(1)} mmHg`,
        lpScale: `Lp ${m.lp.toFixed(0)} cm · Δtp ${m.dtp.toFixed(0)} ms`,
        height: `Lp ${m.lp.toFixed(0)} cm`
      })[c.key] || '';
    });
  }
  function buildPatientSwitch() {
    $('#ptSwitch').addEventListener('click', e => { const b = e.target.closest('[data-pt]'); if (b) setActive(b.dataset.pt); });
  }
  function renderPatientSwitch() {
    $('#ptSwitch').innerHTML = ['A', 'B'].map(id => {
      const p = state.patients[id];
      return `<button class="pt ${state.active === id ? 'on' : ''}" data-pt="${id}" role="tab" aria-selected="${state.active === id}">
        <span class="pt-name"><span class="pt-dot"></span>Patient ${id}</span><span class="pt-sub">${presetShort(p)} · ${drugText(p)}</span></button>`;
    }).join('');
    const sb = $('#sidebar'); sb.classList.toggle('ptA', state.active === 'A'); sb.classList.toggle('ptB', state.active === 'B');
  }
  function setActive(id) {
    if (state.active === id) return;
    state.active = id; state.baseline = null; state.committed = null; state.prevCommitted = null;
    syncPresetAndDrugs(); commit(); render();
  }
  function buildPresets() {
    const sel = $('#preset');
    sel.innerHTML = Object.keys(PWA.PRESETS).map(k => `<option>${k}</option>`).join('');
    sel.addEventListener('change', () => {
      const p = pt(); p.preset = sel.value; p.base = Object.assign({}, PWA.DEFAULTS, PWA.PRESETS[sel.value]);
      commit(); render();
    });
  }
  function buildDrugs() {
    const root = $('#drugs');
    root.innerHTML = Object.entries(PWA.DRUGS).map(([k, d]) => `<button class="chip" data-drug="${k}" data-tip="${d.label}">${d.short}</button>`).join('');
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-drug]'); if (!b) return;
      const k = b.dataset.drug, s = pt().drugs;
      s.has(k) ? s.delete(k) : s.add(k);
      syncPresetAndDrugs(); commit(); render();
    });
  }
  function syncPresetAndDrugs() {
    $('#preset').value = pt().preset;
    $$('[data-drug]').forEach(b => b.classList.toggle('on', pt().drugs.has(b.dataset.drug)));
  }
  function commit() {
    const r = PWA.simulate(effOf(state.active));
    state.prevCommitted = state.committed || r;
    state.committed = r;
  }

  // ------------------------------------------------------------ render
  function render() {
    state.res.A = PWA.simulate(effOf('A'));
    state.res.B = PWA.simulate(effOf('B'));
    const res = state.res[state.active];
    renderPatientSwitch();
    syncControls(effOf(state.active), res);
    switch (state.tab) {
      case 'sim': renderSim(res); break;
      case 'cmp': renderCompare(); break;
      case 'learn': renderLesson(); break;
      case 'cause': { const ref = state.dragging ? state.committed : state.prevCommitted; Causal.update(res, ref && ref !== res ? ref : null); break; }
      case 'sweep': renderSweep(); break;
      case 'imp': renderImp(res); break;
      case 'valid': renderValidation(); break;
    }
  }

  const ms = arr => arr.map(v => v * 1000);
  function renderSim(res) {
    const p = pt();
    $('#viewing').innerHTML = `<span class="badge ${state.active}">Patient ${state.active}</span><span>${p.preset} · ${drugText(p)}</span>` +
      (state.baseline ? `<span class="muted">· compared with pinned baseline</span>` : `<span class="muted">· press Pin baseline, then change something to see the difference</span>`);
    renderKPIs(res);
    renderCentral(res);
    renderPeriph(res);
    renderFlow(res);
    drawBudget($('#cBudget'), (state.baseline ? [['Baseline', state.baseline.m, '--base']] : []).concat([['Now', res.m, PT_COLOR[state.active]]]));
    renderMetrics(res);
    Schematic.update(res);
  }

  function renderKPIs(res) {
    const m = res.m, b = state.baseline && state.baseline.m;
    $('#kpis').innerHTML = KPIS.map(k => {
      let d = '<div class="d same">&nbsp;</div>';
      if (b) {
        const dv = k.d(m, b), f = k.f != null ? k.f : 0;
        const cls = Math.abs(dv) < Math.pow(10, -f) / 2 ? 'same' : dv > 0 ? 'up' : 'dn';
        d = `<div class="d ${cls}" title="change vs pinned baseline">${cls === 'same' ? '±0' : (dv > 0 ? '▲ +' : '▼ ') + dv.toFixed(f)}</div>`;
      }
      return `<div class="kpi ${k.st ? k.st(m) : ''}" data-tip="${k.tip}"><div class="k">${k.l}</div><div class="v">${k.v(m)}<small>${k.u}</small></div>${d}</div>`;
    }).join('');
  }

  function renderCentral(res) {
    const m = res.m, t = ms(res.t), P0 = res.p[0];
    const pf = res.pf.map(v => v - res.pf[0] + P0), pb = res.pb.map(v => v - res.pb[0] + P0);
    const series = [];
    if ($('#tgBase').checked && state.baseline) series.push({ x: ms(state.baseline.t), y: state.baseline.p, color: '--base', width: 2, dash: [6, 4], label: 'Baseline', alpha: 0.9 });
    series.push({ x: t, y: pf, color: '--fwd', width: 1.8, dash: [7, 4], label: 'Forward wave', hidden: !$('#tgFwd').checked });
    series.push({ x: t, y: pb, color: '--bwd', width: 1.8, dash: [2, 3], label: 'Reflected wave', hidden: !$('#tgBwd').checked });
    series.push({ x: t, y: res.p, color: '--comp', width: 2.8, label: 'Measured aortic pressure' });
    const cfg = { series, xLabel: 'Time (ms)', yLabel: 'Pressure (mmHg)', xMin: 0, xMax: res.d.T * 1000, headroom: 0.22,
      hoverX: v => `${v.toFixed(0)} ms`, hoverFmt: v => `${v.toFixed(1)} mmHg`, shades: [{ x0: 0, x1: m.et }],
      notes: [{ x: m.et / 2, text: `systole · ${m.et.toFixed(0)} ms` }] };
    if ($('#tgAnn').checked) {
      const tPk = t[m.iPk], t1 = t[m.i1], t2 = t[m.i2], typeC = m.type === 'C', xr = res.d.T * 1000;
      cfg.vlines = [{ x: m.dtp, color: '--bwd', label: `echo arrives · Δtp ${m.dtp.toFixed(0)} ms`, dy: 4 }];
      cfg.hlines = [{ y: 124, color: '--ink-3', label: 'central SBP limit 124', dash: [2, 4] }];
      cfg.marks = [
        { x: tPk, y: m.Ps, label: `Ps ${m.Ps.toFixed(0)}`, color: '--accent', pos: 'above' },
        typeC ? { x: t2, y: m.P2, label: `P2 ${m.P2.toFixed(0)}`, color: '--bwd', pos: 'above' } : { x: t1, y: m.P1, label: `Pi ${m.P1.toFixed(0)}`, color: '--bwd', pos: 'left' },
        { x: t[t.length - 1] * 0.985, y: m.Pd, label: `Pd ${m.Pd.toFixed(0)}`, color: '--fwd', pos: 'above' }
      ];
      cfg.brackets = [{ x: xr * 0.94, y0: m.Pd, y1: m.Ps, label: `PP ${m.PP.toFixed(0)}`, color: '--ink-2', align: 'right' }];
      if (Math.abs(m.AP) > 1) cfg.brackets.push({ x: Math.max(t1, t2) + 26, y0: Math.min(m.P1, m.P2), y1: Math.max(m.P1, m.P2), label: `AP ${m.AP.toFixed(0)} · AIx ${m.AIx.toFixed(0)} %`, color: '--bwd' });
    }
    Charts.line($('#cCentral'), cfg);
    $('#capCentral').innerHTML = m.type === 'C'
      ? `<b>Type C wave.</b> The echo returns at ${m.dtp.toFixed(0)} ms, after the systolic peak, so it adds little to the heart's load (AIx ${m.AIx.toFixed(0)} %).`
      : `<b>Type ${m.type} wave.</b> The echo returns at ${m.dtp.toFixed(0)} ms, while the heart is still ejecting (${m.et.toFixed(0)} ms), adding ${m.AP.toFixed(0)} mmHg (AIx ${m.AIx.toFixed(0)} %) for ${m.dtr.toFixed(0)} ms. Wasted LV energy ${(m.Ew / 1000).toFixed(1)}×10³ dyn·s/cm².`;
  }

  function renderPeriph(res) {
    const t = ms(res.t), series = [];
    if (state.baseline && $('#tgBase').checked) series.push({ x: ms(state.baseline.t), y: state.baseline.brachial, color: '--base', dash: [6, 4], width: 1.6, label: 'Baseline arm' });
    series.push({ x: t, y: res.p, color: '--comp', width: 2.2, label: 'Aorta' });
    series.push({ x: t, y: res.brachial, color: '--brach', width: 2.2, label: 'Brachial' });
    series.push({ x: t, y: res.radial, color: '--radial', width: 1.6, dash: [5, 3], label: 'Radial' });
    Charts.line($('#cPeriph'), { series, xLabel: 'Time (ms)', yLabel: 'mmHg', xMin: 0, xMax: res.d.T * 1000, hoverX: v => `${v.toFixed(0)} ms`, hoverFmt: v => v.toFixed(1) + ' mmHg',
      marks: [{ x: t[res.brachial.indexOf(Math.max(...res.brachial))], y: res.m.bSBP, label: `×${res.m.ppa.toFixed(2)}`, color: '--brach', pos: 'right' }] });
  }

  function renderFlow(res) {
    const t = ms(res.t), zc = res.d.zc;
    const qf = res.pf.map((v, i) => i <= res.m.iET + 2 ? (v - res.pf[0]) / zc : NaN);
    const series = [];
    if (state.baseline && $('#tgBase').checked) series.push({ x: ms(state.baseline.t), y: state.baseline.q, color: '--base', dash: [6, 4], width: 1.6, label: 'Baseline' });
    series.push({ x: t, y: qf, color: '--fwd', dash: [6, 4], width: 1.6, label: 'Forward flow wave' });
    series.push({ x: t, y: res.q, color: '--flow', width: 2.4, label: 'Aortic flow', fill: 'rgba(180,35,47,0.10)', fillBase: 0 });
    Charts.line($('#cFlow'), { series, xLabel: 'Time (ms)', yLabel: 'mL/s', xMin: 0, xMax: res.d.T * 1000, yMin: Math.min(0, ...qf.filter(isFinite)) - 20,
      hoverX: v => `${v.toFixed(0)} ms`, hoverFmt: v => v.toFixed(0) + ' mL/s', vlines: [{ x: res.m.dtp, color: '--bwd', dash: [3, 3] }] });
  }

  // stacked bars: [name, metrics, nameColor]
  function drawBudget(cv, bars) {
    const dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect();
    if (!r.width) return;
    cv.width = r.width * dpr; cv.height = r.height * dpr;
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = r.width, H = r.height, col = Charts.col;
    ctx.clearRect(0, 0, W, H);
    const fs = Math.round((parseFloat(getComputedStyle(document.body).fontSize) || 14) * 0.8);
    ctx.font = `${fs}px -apple-system, Arial, sans-serif`;
    const stacks = bars.map(([name, m, nc]) => {
      const fwd = m.type === 'C' ? m.PP : m.P1 - m.Pd, aug = m.type === 'C' ? 0 : m.AP, amp = Math.max(0, m.bSBP - m.Ps);
      return { name, nc, top: m.Ps + amp, segs: [
        { v: m.Pd, c: '--line', l: `diastolic ${m.Pd.toFixed(0)}`, dark: true },
        { v: fwd, c: '--fwd', l: `forward ${fwd.toFixed(0)}` },
        { v: aug, c: '--bwd', l: aug > 1.5 ? `echo ${aug.toFixed(0)}` : '' },
        { v: amp, c: '--brach', l: `arm +${amp.toFixed(0)}` }] };
    });
    const yMax = Math.max(...stacks.map(b => b.top)) * 1.12;
    const pl = 36, pr = 8, pt = 18, pb = 30, ph = H - pt - pb, pw = W - pl - pr;
    const Y = v => pt + (1 - v / yMax) * ph;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = 0; v <= yMax; v += 40) { ctx.strokeStyle = col('--line-2'); ctx.beginPath(); ctx.moveTo(pl, Y(v)); ctx.lineTo(pl + pw, Y(v)); ctx.stroke(); ctx.fillStyle = col('--ink-3'); ctx.fillText(v, pl - 6, Y(v)); }
    const bw = Math.min(130, pw / (stacks.length * 1.7)), gap = (pw - bw * stacks.length) / (stacks.length + 1);
    stacks.forEach((b, i) => {
      const x = pl + gap + i * (bw + gap); let acc = 0;
      b.segs.forEach(s => {
        if (s.v <= 0.2) return;
        const y0 = Y(acc), y1 = Y(acc + s.v);
        ctx.fillStyle = col(s.c); ctx.globalAlpha = s.dark ? 1 : 0.88; ctx.fillRect(x, y1, bw, y0 - y1); ctx.globalAlpha = 1;
        if (s.l && y0 - y1 > fs + 2) { ctx.fillStyle = s.dark ? col('--ink-2') : '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(s.l, x + bw / 2, (y0 + y1) / 2); }
        acc += s.v;
      });
      ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = col(b.nc); ctx.font = `600 ${fs}px -apple-system, Arial, sans-serif`;
      ctx.fillText(b.name, x + bw / 2, pt + ph + 7);
      ctx.font = `${fs}px -apple-system, Arial, sans-serif`; ctx.textBaseline = 'bottom'; ctx.fillStyle = col('--ink-2');
      ctx.fillText(`cuff SBP ${b.top.toFixed(0)}`, x + bw / 2, Y(b.top) - 3);
    });
  }

  function renderMetrics(res) {
    const m = res.m, b = state.baseline && state.baseline.m;
    $('#baseNote').textContent = b ? '· Δ = change vs pinned baseline' : '· 40 measures, grouped';
    $('#metricsTable').innerHTML = METRICS.map(g => `<div class="mgroup"><h4>${g.g}</h4>${g.items.map(it => {
      const v = m[it.k], val = it.txt ? v : (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(it.f));
      let dl = '';
      if (b && !it.txt) { const dv = v - b[it.k], th = Math.pow(10, -it.f) / 2; dl = Math.abs(dv) < th ? '<span class="d same">±0</span>' : `<span class="d ${dv > 0 ? 'up' : 'dn'}">${dv > 0 ? '+' : ''}${Math.abs(dv) >= 1000 ? dv.toFixed(0) : dv.toFixed(it.f)}</span>`; }
      return `<div class="mrow"><span class="nm" data-tip="${it.tip}">${it.l}</span><span class="vl ${it.st ? it.st(v) : ''}">${val} <span class="muted">${it.u}</span></span><span class="dl">${dl}</span></div>`;
    }).join('')}</div>`).join('');
  }

  // ------------------------------------------------------------ compare
  const CMP_ROWS = [
    ['Blood pressure', [['bSBP', 'Cuff SBP', 'mmHg', 0], ['bDBP', 'Cuff DBP', 'mmHg', 0], ['Ps', 'Central SBP', 'mmHg', 0], ['Pd', 'Central DBP', 'mmHg', 0], ['PP', 'Central pulse pressure', 'mmHg', 0], ['map', 'Mean arterial pressure', 'mmHg', 0]]],
    ['Wave reflection', [['AIx', 'Augmentation index', '%', 1], ['AIx75', 'AIx at HR 75', '%', 1], ['AP', 'Augmentation pressure', 'mmHg', 1], ['ppa', 'PP amplification', '×', 2], ['dtp', 'Echo return time Δtp', 'ms', 0], ['rm', 'Reflection magnitude', '%', 0]]],
    ['Arteries & flow', [['cAoOp', 'Aortic PWV', 'm/s', 1], ['co', 'Cardiac output', 'L/min', 2], ['svrDyn', 'SVR', 'dyn·s·cm⁻⁵', 0], ['ctot', 'Compliance', 'mL/mmHg', 2], ['zcDyn', 'Characteristic impedance', 'dyn·s·cm⁻⁵', 0]]],
    ['Load on the heart', [['Ew', 'Wasted LV energy ΔEw', 'dyn·s/cm²', 0], ['lsEs', 'Late/early systolic load', '', 2], ['tti', 'Tension-time index', 'mmHg·s', 1], ['sevr', 'SEVR (supply/demand)', '%', 0]]]
  ];
  function renderCompare() {
    const A = state.res.A, B = state.res.B, pA = state.patients.A, pB = state.patients.B;
    // scenario
    const sc = state.scenario;
    $('#scenario').innerHTML = sc ? `<div class="scenario"><div class="sh"><b>${sc.title}</b><button class="btn sm" id="scClose">Dismiss</button></div><p><b>What to look for:</b> ${sc.look}</p></div>` : '';
    if (sc) $('#scClose').addEventListener('click', () => { state.scenario = null; render(); });
    // patient cards
    const card = (id, p, r) => `<div class="pcard ${id}"><div class="ph"><span class="badge ${id}">Patient ${id}</span><button class="btn sm" data-edit="${id}">Edit in sidebar</button></div>
      <div class="pmeta">${p.preset}<br>${drugText(p)}</div>
      <div class="pbp">cuff ${r.m.bSBP.toFixed(0)}/${r.m.bDBP.toFixed(0)} · central ${r.m.Ps.toFixed(0)}/${r.m.Pd.toFixed(0)} · AIx ${r.m.AIx.toFixed(0)} %</div></div>`;
    $('#cmpHead').innerHTML = card('A', pA, A) + `<div class="cmp-actions"><button class="btn sm" data-act="ab">Copy A → B</button><button class="btn sm" data-act="ba">Copy B → A</button><button class="btn sm" data-act="swap">Swap A ↔ B</button></div>` + card('B', pB, B);
    // charts
    const showR = $('#tgCmpRefl').checked;
    const wave = (r, id, key, label) => ({ x: ms(r.t), y: r[key], color: PT_COLOR[id], width: 2.8, label });
    const reflS = (r, id) => ({ x: ms(r.t), y: r.pb.map(v => v - r.pb[0] + r.p[0]), color: PT_COLOR[id], width: 1.4, dash: [2, 3], label: `${id} echo`, alpha: 0.85 });
    const xMax = Math.max(A.d.T, B.d.T) * 1000;
    Charts.line($('#cCmpCentral'), { series: [wave(A, 'A', 'p', 'Patient A'), wave(B, 'B', 'p', 'Patient B')].concat(showR ? [reflS(A, 'A'), reflS(B, 'B')] : []),
      xLabel: 'Time (ms)', yLabel: 'mmHg', xMin: 0, xMax, hoverX: v => `${v.toFixed(0)} ms`, hoverFmt: v => v.toFixed(1) + ' mmHg',
      marks: [{ x: A.t[A.m.iPk] * 1000, y: A.m.Ps, label: A.m.Ps.toFixed(0), color: '--pa' }, { x: B.t[B.m.iPk] * 1000, y: B.m.Ps, label: B.m.Ps.toFixed(0), color: '--pb' }],
      vlines: [{ x: A.m.dtp, color: '--pa', dash: [3, 3] }, { x: B.m.dtp, color: '--pb', dash: [3, 3] }] });
    Charts.line($('#cCmpBrach'), { series: [wave(A, 'A', 'brachial', 'Patient A arm'), wave(B, 'B', 'brachial', 'Patient B arm'),
      { x: ms(A.t), y: A.p, color: '--pa', width: 1.3, dash: [5, 4], label: 'A central', alpha: 0.7 }, { x: ms(B.t), y: B.p, color: '--pb', width: 1.3, dash: [5, 4], label: 'B central', alpha: 0.7 }],
      xLabel: 'Time (ms)', yLabel: 'mmHg', xMin: 0, xMax, hoverX: v => `${v.toFixed(0)} ms`, hoverFmt: v => v.toFixed(1) + ' mmHg' });
    drawBudget($('#cCmpBudget'), [['Patient A', A.m, '--pa'], ['Patient B', B.m, '--pb']]);
    // table
    const fmt = (v, f) => Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(f);
    $('#cmpTable').innerHTML = `<div class="table-wrap"><table class="ct"><thead><tr><th>Measure</th><th class="A">A</th><th class="B">B</th><th>B − A</th></tr></thead><tbody>` +
      CMP_ROWS.map(([g, rows]) => `<tr class="grp"><td colspan="4">${g}</td></tr>` + rows.map(([k, l, u, f]) => {
        const a = A.m[k], b = B.m[k], d = b - a, rel = Math.abs(d) / Math.max(Math.abs(a), 1e-9);
        const cls = Math.abs(d) < Math.pow(10, -f) / 2 ? 'same' : d > 0 ? 'up' : 'dn';
        const w = Math.min(46, rel * 120);
        return `<tr><td>${l} <span class="muted">${u}</span></td><td class="mono">${fmt(a, f)}</td><td class="mono">${fmt(b, f)}</td>
          <td class="mono"><span class="d ${cls}">${cls === 'same' ? '±0' : (d > 0 ? '+' : '') + fmt(d, f)}</span>${cls === 'same' ? '' : `<span class="bar-d" style="width:${w.toFixed(0)}px;background:var(${cls === 'up' ? '--up' : '--down'});opacity:.55"></span>`}</td></tr>`;
      }).join('')).join('') + '</tbody></table></div>';
    // input differences
    const eA = effOf('A'), eB = effOf('B');
    const diffs = ALL_CTRL.filter(c => Math.abs(eA[c.key] - eB[c.key]) > 1e-6);
    const dDrug = ['A', 'B'].map(id => drugText(state.patients[id]));
    $('#cmpInputs').innerHTML = (diffs.length || dDrug[0] !== dDrug[1])
      ? `<div class="table-wrap"><table class="ct"><thead><tr><th>Input (after medication)</th><th class="A">A</th><th class="B">B</th></tr></thead><tbody>` +
        diffs.map(c => `<tr><td>${c.label} <span class="muted">${c.unit}</span></td><td class="mono">${(+eA[c.key]).toFixed(c.f)}</td><td class="mono">${(+eB[c.key]).toFixed(c.f)}</td></tr>`).join('') +
        `<tr><td>Medication</td><td>${dDrug[0]}</td><td>${dDrug[1]}</td></tr></tbody></table></div>`
      : '<p class="muted">The two patients are identical. Change Patient B in the sidebar, or load a lesson scenario from the Learn tab.</p>';
  }
  function wireCompare() {
    $('#tab-cmp').addEventListener('click', e => {
      const ed = e.target.closest('[data-edit]'); if (ed) { setActive(ed.dataset.edit); return; }
      const ac = e.target.closest('[data-act]'); if (!ac) return;
      const cp = p => ({ preset: p.preset, base: Object.assign({}, p.base), drugs: new Set(p.drugs) });
      const { A, B } = state.patients;
      if (ac.dataset.act === 'ab') state.patients.B = cp(A);
      if (ac.dataset.act === 'ba') state.patients.A = cp(B);
      if (ac.dataset.act === 'swap') { state.patients.A = cp(B); state.patients.B = cp(A); }
      syncPresetAndDrugs(); commit(); render();
    });
    $('#tgCmpRefl').addEventListener('change', render);
  }

  // ------------------------------------------------------------ learn
  function buildLessonNav() {
    $('#lessonNav').innerHTML = LESSONS.map((l, i) => `<button data-lesson="${i}"><span class="n">${i + 1}</span><span>${l.title}</span></button>`).join('') +
      `<button data-lesson="${LESSONS.length}"><span class="n">≡</span><span>Glossary</span></button>`;
    $('#lessonNav').addEventListener('click', e => { const b = e.target.closest('[data-lesson]'); if (!b) return; state.lesson = +b.dataset.lesson; render(); $('#lesson').scrollIntoView({ block: 'nearest' }); });
    $('#lesson').addEventListener('click', e => {
      const nav = e.target.closest('[data-go]'); if (nav) { state.lesson = Math.max(0, Math.min(LESSONS.length, state.lesson + +nav.dataset.go)); render(); return; }
      if (e.target.closest('#tryBtn')) runTry(LESSONS[state.lesson]);
    });
  }
  function renderLesson() {
    $$('#lessonNav button').forEach(b => b.classList.toggle('on', +b.dataset.lesson === state.lesson));
    const i = state.lesson;
    const pager = `<div class="lesson-pager"><button class="btn" data-go="-1" ${i === 0 ? 'disabled' : ''}>← Previous</button><button class="btn" data-go="1" ${i === LESSONS.length ? 'disabled' : ''}>Next →</button></div>`;
    if (i === LESSONS.length) {
      $('#lesson').innerHTML = `<div class="eyebrow">Reference</div><h2>Glossary</h2><p class="lead">Every term used in the simulator, in one or two plain sentences.</p>
        <dl class="gloss">${GLOSSARY.map(([t, d]) => `<div><dt>${t}</dt><dd>${d}</dd></div>`).join('')}</dl>${pager}`;
      return;
    }
    const L = LESSONS[i], fig = L.fig();
    $('#lesson').innerHTML = `<div class="eyebrow">Lesson ${i + 1} of ${LESSONS.length}</div><h2>${L.title}</h2><p class="lead">${L.lead}</p>
      <div class="lesson-body"><div>${L.body.map(p => `<p>${p}</p>`).join('')}
        <div class="boxes"><div class="box analogy"><div class="bh">Analogy</div><div class="bt">${L.analogy}</div></div>
        <div class="box eqn"><div class="bh">The equation in words</div><div class="bt">${L.eq}</div></div></div></div>
      <figure class="lesson-fig"><div class="canvas-wrap tall"><canvas id="cLesson"></canvas></div><figcaption>${fig.cap}</figcaption></figure></div>
      <div class="try"><button class="btn primary" id="tryBtn">Try it: ${L.tryIt.label}</button><span class="look">${L.tryIt.look}</span></div>${pager}`;
    Charts.line($('#cLesson'), fig.cfg);
  }
  function runTry(L) {
    const t = L.tryIt;
    const make = s => newPatient(s.preset, s.over, s.drugs);
    state.patients.A = make(t.A);
    if (t.B) state.patients.B = make(t.B);
    state.active = 'A'; state.baseline = null; state.committed = null;
    state.scenario = t.B ? { title: `Lesson ${state.lesson + 1}: ${L.tryIt.label}`, look: t.look } : null;
    syncPresetAndDrugs(); commit();
    switchTab(t.tab || 'cmp');
  }

  // ------------------------------------------------------------ sweep
  const SWEEP_P = [
    { k: 'Ps', l: 'Central SBP', c: '--accent', on: true }, { k: 'bSBP', l: 'Cuff SBP', c: '--brach', on: true },
    { k: 'map', l: 'MAP', c: '--ink', on: true }, { k: 'Pd', l: 'DBP', c: '--fwd', on: true }, { k: 'PP', l: 'Central PP', c: '--bwd', on: false }, { k: 'AP', l: 'Augmentation P', c: '--radial', on: false }
  ];
  const SWEEP_I = [
    { k: 'AIx', l: 'AIx (%)' }, { k: 'ppa', l: 'PP amplification' }, { k: 'dtp', l: 'Δtp (ms)' }, { k: 'sevr', l: 'SEVR (%)' },
    { k: 'Ew', l: 'ΔEw (dyn·s/cm²)' }, { k: 'lsEs', l: 'LSPTI/ESPTI' }, { k: 'ctot', l: 'Compliance (mL/mmHg)' }, { k: 'zcDyn', l: 'Zc (dyn·s·cm⁻⁵)' }, { k: 'svrDyn', l: 'SVR (dyn·s·cm⁻⁵)' }, { k: 'co', l: 'CO (L/min)' }
  ];
  function buildSweep() {
    $('#sweepVar').innerHTML = ALL_CTRL.map(c => `<option value="${c.key}" ${c.key === 'cAo' ? 'selected' : ''}>${c.label}${c.unit ? ' (' + c.unit + ')' : ''}</option>`).join('');
    $('#sweepOuts').innerHTML = SWEEP_P.map(o => `<button class="chip sm ${o.on ? 'on' : ''}" data-out="${o.k}">${o.l}</button>`).join('') +
      `<label class="sel" style="margin-left:10px">Index <select id="sweepI1">${SWEEP_I.map(o => `<option value="${o.k}">${o.l}</option>`).join('')}</select></label>` +
      `<label class="sel">and <select id="sweepI2">${SWEEP_I.map((o, i) => `<option value="${o.k}" ${i === 1 ? 'selected' : ''}>${o.l}</option>`).join('')}</select></label>`;
    $('#sweepOuts').addEventListener('click', e => { const b = e.target.closest('[data-out]'); if (!b) return; const o = SWEEP_P.find(x => x.k === b.dataset.out); o.on = !o.on; b.classList.toggle('on', o.on); renderSweep(); });
    ['#sweepVar', '#sweepI1', '#sweepI2'].forEach(s => $(s).addEventListener('change', renderSweep));
  }
  function renderSweep() {
    const key = $('#sweepVar').value, c = ALL_CTRL.find(x => x.key === key);
    const eff = effOf(state.active), n = 41, xs = [], rs = [];
    for (let i = 0; i < n; i++) { const x = c.min + (c.max - c.min) * i / (n - 1); xs.push(x); rs.push(PWA.simulate(Object.assign({}, eff, { [key]: x })).m); }
    const cur = eff[key];
    Charts.line($('#cSweepP'), { series: SWEEP_P.filter(o => o.on).map(o => ({ x: xs, y: rs.map(m => m[o.k]), color: o.c, width: 2.2, label: o.l })),
      xLabel: `${c.label} (${c.unit})`, yLabel: 'mmHg', hoverX: v => `${v.toFixed(c.f)} ${c.unit}`, hoverFmt: v => v.toFixed(1), vlines: [{ x: cur, color: PT_COLOR[state.active], label: `Patient ${state.active}`, dash: [3, 3] }] });
    const i1 = SWEEP_I.find(o => o.k === $('#sweepI1').value), i2 = SWEEP_I.find(o => o.k === $('#sweepI2').value);
    Charts.line($('#cSweepI'), { series: [
      { x: xs, y: rs.map(m => m[i1.k]), color: '--bwd', width: 2.4, label: i1.l },
      { x: xs, y: rs.map(m => m[i2.k]), color: '--fwd', width: 2.4, dash: [6, 3], label: i2.l + ' (right axis)', y2: true }
    ], y2: { color: '--fwd' }, xLabel: `${c.label} (${c.unit})`, yLabel: i1.l, hoverX: v => `${v.toFixed(c.f)} ${c.unit}`, hoverFmt: v => Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2),
      vlines: [{ x: cur, color: PT_COLOR[state.active], dash: [3, 3] }] });
    const fam = [];
    for (let i = 0; i < 6; i++) { const x = c.min + (c.max - c.min) * i / 5, r = PWA.simulate(Object.assign({}, eff, { [key]: x })); fam.push({ x: ms(r.t), y: r.p, color: `hsl(${220 - 210 * i / 5}, 70%, 46%)`, width: 2, label: `${x.toFixed(c.f)} ${c.unit}` }); }
    Charts.line($('#cFamily'), { series: fam, xLabel: 'Time (ms)', yLabel: 'Central pressure (mmHg)', hoverX: v => `${v.toFixed(0)} ms`, hoverFmt: v => v.toFixed(1) });
    const a = rs[0], z = rs[n - 1], d = (k2, f = 0) => `${a[k2].toFixed(f)} → ${z[k2].toFixed(f)}`;
    $('#capSweep').innerHTML = `Patient ${state.active}, ${c.label.toLowerCase()} ${c.min}–${c.max} ${c.unit}: central SBP ${d('Ps')}, DBP ${d('Pd')}, MAP ${d('map')} mmHg; AIx ${d('AIx')} %; amplification ${d('ppa', 2)}.`;
  }

  // ------------------------------------------------------------ impedance
  function renderImp(res) {
    const toDyn = v => v * PWA.DYN, z = res.zin.filter(h => h.f <= 12);
    const series = [];
    if (state.baseline) { const zb = state.baseline.zin.filter(h => h.f <= 12); series.push({ x: zb.map(h => h.f), y: zb.map(h => toDyn(h.mod)), color: '--base', dash: [6, 4], width: 1.6, points: true, r: 2.5, label: 'Baseline' }); }
    series.push({ x: z.map(h => h.f), y: z.map(h => toDyn(h.mod)), color: PT_COLOR[state.active], width: 2.2, points: true, r: 3.5, label: `Patient ${state.active} |Zin|` });
    const zcD = res.m.zcDyn;
    Charts.line($('#cImp'), { series, xLabel: 'Frequency (Hz)', yLabel: '|Z| (dyn·s·cm⁻⁵)', xMin: 0, xMax: 12, yMin: 0, yMax: Math.max(zcD * 4, toDyn(res.zin[1].mod) * 1.4),
      hlines: [{ y: zcD, color: '--fwd', label: `Zc ≈ ${zcD.toFixed(0)}` }], hoverX: v => `${v.toFixed(2)} Hz`, hoverFmt: v => v.toFixed(0),
      marks: [{ x: z[1].f, y: toDyn(z[1].mod), label: `Z₁ ${toDyn(z[1].mod).toFixed(0)}`, color: '--bwd', pos: 'right' }] });
    let iMin = 1; for (let i = 1; i < z.length - 1; i++) { if (z[i].mod < z[i - 1].mod && z[i].mod <= z[i + 1].mod) { iMin = i; break; } }
    const hi = z.filter(h => h.f >= 2), hiMean = hi.reduce((a, h) => a + toDyn(h.mod), 0) / hi.length;
    $('#impStats').innerHTML = [
      ['Z₀ = peripheral resistance (SVR)', res.m.svrDyn.toFixed(0) + ' dyn·s·cm⁻⁵'], ['Characteristic impedance Zc (model)', zcD.toFixed(0) + ' dyn·s·cm⁻⁵'],
      ['Mean modulus 2–12 Hz (≈ Zc)', hiMean.toFixed(0) + ' dyn·s·cm⁻⁵'], ['First harmonic Z₁ (reflectance)', toDyn(z[1].mod).toFixed(0) + ' dyn·s·cm⁻⁵'],
      ['Frequency of first minimum', z[iMin].f.toFixed(2) + ' Hz'], ['Predicted 1 / (2·Δtp)', (1 / (2 * res.d.dtp)).toFixed(2) + ' Hz']
    ].map(r => `<div class="mrow"><span class="nm">${r[0]}</span><span class="vl">${r[1]}</span><span></span></div>`).join('');
    const m = res.m;
    $('#afterload').innerHTML = `<svg viewBox="0 0 400 300" role="img" aria-label="Three components of afterload">
      <circle cx="150" cy="115" r="92" fill="var(--ink-3)" opacity="0.13" stroke="var(--ink-3)"/>
      <circle cx="250" cy="115" r="92" fill="var(--fwd)" opacity="0.13" stroke="var(--fwd)"/>
      <circle cx="200" cy="195" r="92" fill="var(--bwd)" opacity="0.13" stroke="var(--bwd)"/>
      <text x="108" y="92" text-anchor="middle" font-size="13" font-weight="650" fill="var(--ink)">Resistance</text>
      <text x="108" y="110" text-anchor="middle" font-size="11.5" fill="var(--ink-2)">static · arterioles</text>
      <text x="108" y="128" text-anchor="middle" font-size="12" font-family="Menlo, monospace" fill="var(--ink)">SVR ${m.svrDyn.toFixed(0)}</text>
      <text x="292" y="92" text-anchor="middle" font-size="13" font-weight="650" fill="var(--ink)">Elastance</text>
      <text x="292" y="110" text-anchor="middle" font-size="11.5" fill="var(--ink-2)">pulsatile · aorta</text>
      <text x="292" y="128" text-anchor="middle" font-size="12" font-family="Menlo, monospace" fill="var(--ink)">Zc ${m.zcDyn.toFixed(0)}</text>
      <text x="200" y="232" text-anchor="middle" font-size="13" font-weight="650" fill="var(--ink)">Reflectance</text>
      <text x="200" y="250" text-anchor="middle" font-size="11.5" fill="var(--ink-2)">pulsatile · muscular arteries</text>
      <text x="200" y="268" text-anchor="middle" font-size="12" font-family="Menlo, monospace" fill="var(--ink)">Γ ${res.d.g.toFixed(2)} · AIx ${m.AIx.toFixed(0)}%</text>
      <text x="200" y="152" text-anchor="middle" font-size="12" font-weight="650" fill="var(--accent)">LV afterload</text></svg>`;
  }

  // ------------------------------------------------------------ validation
  let validationDone = false;
  function renderValidation() {
    if (validationDone) return;      // independent of patient state
    validationDone = true;
    $('#validation').innerHTML = Validation.html();
  }

  // ------------------------------------------------------------ export
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = typeof text === 'string' && text.startsWith('data:') ? text : URL.createObjectURL(new Blob([text], { type }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }
  function exportAs(kind) {
    const r = state.res[state.active], stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    if (kind === 'png') {
      const src = state.tab === 'cmp' ? $('#cCmpCentral') : $('#cCentral');
      const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
      const ctx = c.getContext('2d'); ctx.fillStyle = Charts.css('--panel') || '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(src, 0, 0);
      download(`pulse-lab-central-${stamp}.png`, c.toDataURL('image/png'));
    } else if (kind === 'csv') {
      const A = state.res.A, B = state.res.B;
      const rows = ['time_A_ms,aortic_A,forward_A,reflected_A,flow_A,brachial_A,time_B_ms,aortic_B,forward_B,reflected_B,flow_B,brachial_B'];
      A.t.forEach((t, i) => rows.push([(t * 1000).toFixed(2), A.p[i], A.pf[i], A.pb[i], A.q[i], A.brachial[i], (B.t[i] * 1000).toFixed(2), B.p[i], B.pf[i], B.pb[i], B.q[i], B.brachial[i]].map(v => typeof v === 'number' ? v.toFixed(3) : v).join(',')));
      download(`pulse-lab-waveforms-${stamp}.csv`, rows.join('\n'), 'text/csv');
    } else if (kind === 'metrics') {
      const rows = ['group,metric,unit,patient_A,patient_B'];
      METRICS.forEach(g => g.items.forEach(it => rows.push([g.g, it.l, it.u, it.txt ? state.res.A.m[it.k] : state.res.A.m[it.k].toFixed(4), it.txt ? state.res.B.m[it.k] : state.res.B.m[it.k].toFixed(4)].map(v => `"${v}"`).join(','))));
      download(`pulse-lab-metrics-${stamp}.csv`, rows.join('\n'), 'text/csv');
    } else if (kind === 'json') {
      const dump = id => ({ preset: state.patients[id].preset, patient: state.patients[id].base, drugs: Array.from(state.patients[id].drugs), effective: effOf(id) });
      download(`pulse-lab-parameters-${stamp}.json`, JSON.stringify({ A: dump('A'), B: dump('B') }, null, 2), 'application/json');
    }
  }

  // ------------------------------------------------------------ wiring
  function switchTab(tab) {
    state.tab = tab;
    $$('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
    $$('.tabpane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
    render();
    window.scrollTo({ top: 0 });
  }
  function wire() {
    $$('.tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
    $('#pinBtn').addEventListener('click', pin);
    $('#clearPin').addEventListener('click', () => { state.baseline = null; render(); });
    $('#resetBtn').addEventListener('click', () => { state.patients[state.active] = newPatient('Default adult (45 y)'); syncPresetAndDrugs(); commit(); render(); });
    ['#tgFwd', '#tgBwd', '#tgBase', '#tgAnn'].forEach(s => $(s).addEventListener('change', render));
    $('#tgAnim').addEventListener('change', e => Schematic.setRunning(e.target.checked));
    if ($('#exportBtn')) {
      $('#exportBtn').addEventListener('click', e => { e.stopPropagation(); $('#exportMenu').classList.toggle('open'); });
      document.addEventListener('click', () => $('#exportMenu').classList.remove('open'));
      $('#exportMenu').addEventListener('click', e => { const b = e.target.closest('[data-exp]'); if (b) exportAs(b.dataset.exp); });
    }
    $('#themeBtn').addEventListener('click', () => {
      const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      setTheme(dark ? 'light' : 'dark');
    });
    $('#presentBtn').addEventListener('click', togglePresent);
    document.addEventListener('keydown', e => {
      if (['SELECT', 'INPUT'].includes(e.target.tagName) && e.target.type !== 'range') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'b' || e.key === 'B') pin();
      if (e.key === 'p' || e.key === 'P') togglePresent();
    });
    const tip = $('#tooltip');
    document.addEventListener('mouseover', e => {
      const t = e.target.closest('[data-tip]'); if (!t) { tip.classList.remove('show'); return; }
      tip.textContent = t.dataset.tip; tip.classList.add('show');
      const r = t.getBoundingClientRect(); tip.style.left = Math.min(window.innerWidth - 330, Math.max(8, r.left)) + 'px';
      tip.style.top = (r.bottom + 8 + 120 < window.innerHeight ? r.bottom + 8 : r.top - 8 - tip.offsetHeight) + 'px';
    });
    document.addEventListener('scroll', () => tip.classList.remove('show'), true);
    let raf = null;
    new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); }).observe($('.main'));
    wireCompare();
  }
  function pin() { state.baseline = state.res[state.active]; $('#tgBase').checked = true; render(); }
  function togglePresent() { document.body.classList.toggle('present'); $('#presentBtn').classList.toggle('on', document.body.classList.contains('present')); requestAnimationFrame(render); }
  function setTheme(t) { document.documentElement.dataset.theme = t; store.set('pulselab-theme', t); requestAnimationFrame(render); }

  function boot() {
    const saved = store.get('pulselab-theme');
    if (saved) document.documentElement.dataset.theme = saved;
    buildPatientSwitch(); buildControls(); buildPresets(); buildDrugs(); buildSweep(); buildLessonNav();
    $('#equations').innerHTML = EQUATIONS;
    Schematic.init($('#schematic'));
    Causal.init($('#causal'));
    wire();
    syncPresetAndDrugs(); commit(); render();
    window.__app = { state, render, switchTab };
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();
})();
