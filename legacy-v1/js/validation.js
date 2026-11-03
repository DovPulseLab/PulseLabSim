/* =====================================================================
   Validation: recomputes published numbers and checks model trends.
   ===================================================================== */
(function (global) {
  'use strict';
  function html() {
    const pct = (a, b) => Math.abs(a - b) / Math.abs(b) * 100;
    const verdict = e => e <= 3 ? '<span class="pass">✓ match</span>' : e <= 12 ? '<span class="near">≈ close</span>' : '<span class="fail">✗ off</span>';
    const ew = (dtr, ap) => dtr / 1000 * ap * Math.PI / 2 * 1333.22 / 1000;
    const A = [
      ['N&S 2002 Fig. 2 (83 y): ΔEw = 0.228 s × 34 mmHg × π/2', ew(228, 34), 16.3, '×10³ dyn·s/cm²'],
      ['N&S 2002 Fig. 5 baseline: 0.211 s × 24 mmHg × π/2', ew(211, 24), 10.7, '×10³'],
      ['N&S 2002 Fig. 5 lisinopril: 0.175 s × 8 mmHg × π/2', ew(175, 8), 2.9, '×10³'],
      ['N&S 2002 Fig. 3 baseline (AP ≈ 0.35 × 44 mmHg, Δtr 247 ms)', ew(247, 0.35 * 44), 7.2, '×10³'],
      ['N&S 2002 Fig. 3 atorvastatin (AP ≈ 0.25 × 34, Δtr 163 ms)', ew(163, 0.25 * 34), 3.1, '×10³'],
      ['Townsend 2015 (DeBakey) AIx example: 4 / 33', 4 / 33 * 100, 12, '%'],
      ['Townsend 2015 (DeBakey) LSPTI/ESPTI: 10628 / 19592', 10628 / 19592, 0.54, ''],
      ['N&S 2002 Fig. 2 amplification, age 19: radial PP 40 / aortic PP 24', 40 / 24, 1.7, '×'],
      ['N&S 2002 Fig. 2 amplification, age 83: 82 / 75', 82 / 75, 1.1, '×'],
      ['N&S 2002 Fig. 5 amplification after lisinopril: 67 / 48', 67 / 48, 1.4, '×']
    ];
    const cases = [
      ['Case 1 (ramipril)', 144, 74, 114, 75, 79], ['Case 2 initial', 142, 64, 109, 65, 77], ['Case 2 after exercise', 124, 62, 99, 62, 68],
      ['Case 3 initial', 151, 78, 142, 79, 16], ['Case 3 follow-up', 145, 82, 128, 83, 40], ['Case 4 initial', 174, 104, 154, 106, 46],
      ['Case 4 + atenolol', 158, 86, 147, 87, 20], ['Case 4 + amlodipine', 136, 84, 124, 85, 33], ['Case 5 initial', 220, 103, 202, 104, 19],
      ['Case 5 follow-up', 123, 74, 111, 74, 32], ['Case 6 initial', 177, 56, 171, 56, 5], ['Case 6 + amlodipine', 152, 50, 145, 50, 7]
    ];
    // model vs published age trend (N&S Fig. 2)
    const sim = n => PWA.simulate(Object.assign({}, PWA.DEFAULTS, PWA.PRESETS[n])).m;
    const yng = sim('Young adult (20 y)'), mid = sim('Middle-aged (45 y)'), old = sim('Isolated systolic HTN (80 y)');
    const ageRows = [
      ['Aortic AIx (%)', -19, 25, 46, yng.AIx, mid.AIx, old.AIx],
      ['Aortic pulse pressure (mmHg)', 24, 39, 75, yng.PP, mid.PP, old.PP],
      ['Amplification (peripheral/aortic PP)', 1.7, 1.3, 1.1, yng.ppa, mid.ppa, old.ppa],
      ['Round-trip time Δtp (ms)', 332, null, 126, yng.dtp, mid.dtp, old.dtp],
      ['Wasted energy ΔEw (×10³)', 0, null, 16.3, yng.Ew / 1000, mid.Ew / 1000, old.Ew / 1000]
    ];
    const mono = a => (a[1] <= a[2] && a[2] <= a[3]) || (a[1] >= a[2] && a[2] >= a[3]);
    const trendOK = r => { const same = Math.sign(r[3] - r[1]) === Math.sign(r[6] - r[4]); if (!same) return 0; return mono([0, r[4], r[5], r[6]]) ? 2 : 1; };
    // drug directions vs Townsend Table 1 (applied to essential-HTN patient)
    const htnBase = Object.assign({}, PWA.DEFAULTS, PWA.PRESETS['Essential HTN (55 y)']);
    const b0 = PWA.simulate(htnBase).m;
    const exp = { arb: ['↓↓', '↓↓'], acei: ['↓↓', '↓↓'], bb: ['↓ or ↔', '↑'], ccb: ['↓↓', '↓↓'], diur: ['↓', '↓'], nitrate: ['↓↓', '↓↓↓↓'] };
    const drugRows = Object.entries(exp).map(([k, e]) => {
      const m = PWA.simulate(PWA.applyDrugs(htnBase, [k])).m; const dS = m.Ps - b0.Ps, dA = m.AIx - b0.AIx, dB = m.bSBP - b0.bSBP;
      const okS = e[0] === '↓ or ↔' ? dS <= 0.5 : dS < 0; const okA = e[1] === '↑' ? dA > 0 : dA < 0;
      return [PWA.DRUGS[k].label, e[0], dS, e[1], dA, dB, okS && okA];
    });
    const nitAix = drugRows.find(r => r[0].startsWith('Organic')).slice(4, 5)[0], otherMax = Math.min(...drugRows.filter(r => !r[0].startsWith('Organic') && r[4] < 0).map(r => r[4]));
    // mechanism checks
    const base = PWA.simulate(PWA.DEFAULTS).m;
    const stiff = PWA.simulate(Object.assign({}, PWA.DEFAULTS, { cAo: 11 })).m;
    const vc = PWA.simulate(Object.assign({}, PWA.DEFAULTS, { radius: 95 })).m;
    const tall = PWA.simulate(Object.assign({}, PWA.DEFAULTS, { height: 195 })).m, short = PWA.simulate(Object.assign({}, PWA.DEFAULTS, { height: 155 })).m;
    const fast = PWA.simulate(Object.assign({}, PWA.DEFAULTS, { hr: 90, sv: PWA.DEFAULTS.sv * 70 / 90 })).m;
    const nit = PWA.simulate(PWA.applyDrugs(PWA.DEFAULTS, ['nitrate'])).m;
    const mech = [
      ['Stiffer aorta (PWV 7.5 → 11 m/s): SBP ↑, PP ↑, DBP ↓, MAP unchanged', 'N&E 2001 Fig. 3 & Eqs. 10–11', stiff.Ps > base.Ps && stiff.PP > base.PP && stiff.Pd < base.Pd && Math.abs(stiff.map - base.map) < 1.5 * Math.abs(stiff.cMAP - base.cMAP) + 0.5, `SBP ${base.Ps.toFixed(0)}→${stiff.Ps.toFixed(0)}, DBP ${base.Pd.toFixed(0)}→${stiff.Pd.toFixed(0)}, MAP ${base.map.toFixed(0)}→${stiff.map.toFixed(0)}`],
      ['Stiffer aorta returns reflection earlier (Δtp ↓) and raises AIx', 'N&S 2002', stiff.dtp < base.dtp && stiff.AIx > base.AIx, `Δtp ${base.dtp.toFixed(0)}→${stiff.dtp.toFixed(0)} ms, AIx ${base.AIx.toFixed(0)}→${stiff.AIx.toFixed(0)} %`],
      ['Arteriolar constriction (radius −5 %) raises MAP and DBP', 'N&E 2001 Eqs. 1, 5', vc.map > base.map && vc.Pd > base.Pd, `MAP ${base.map.toFixed(0)}→${vc.map.toFixed(0)}, DBP ${base.Pd.toFixed(0)}→${vc.Pd.toFixed(0)}`],
      ['Taller stature lowers AIx (inverse relation with height)', 'N&S 2002; Marchais 1993', tall.AIx < base.AIx && short.AIx > base.AIx, `155 cm ${short.AIx.toFixed(1)} %, 175 cm ${base.AIx.toFixed(1)} %, 195 cm ${tall.AIx.toFixed(1)} %`],
      ['Higher heart rate lowers AIx (pacing: cardiac output held constant)', 'Wilkinson 2000', fast.AIx < base.AIx, `HR 70 → 90 (SV 72 → 56 mL): AIx ${base.AIx.toFixed(1)} → ${fast.AIx.toFixed(1)} %`],
      ['Nitrate: central SBP falls more than brachial SBP', 'N&E 2001; N&S 2002 Fig. 5', (base.Ps - nit.Ps) > (base.bSBP - nit.bSBP), `central −${(base.Ps - nit.Ps).toFixed(1)}, brachial −${(base.bSBP - nit.bSBP).toFixed(1)} mmHg`],
      ['Vasodilator raises pulse-pressure amplification', 'N&S 2002 Fig. 5', nit.ppa > base.ppa, `PPA ${base.ppa.toFixed(2)} → ${nit.ppa.toFixed(2)}`],
      ['MAP = CO × SVR holds exactly', 'N&E 2001 Eq. 1', Math.abs(base.map - base.cMAP) < 0.01, `MAP ${base.map.toFixed(2)} vs CO×SVR ${base.cMAP.toFixed(2)}`]
    ];
    const pass = b => b ? '<span class="pass">✓ reproduced</span>' : '<span class="fail">✗ not reproduced</span>';
    const f = (v, d = 1) => v == null ? '—' : v.toFixed(d);
    return `
      <div class="card prose" style="max-width:none">
        <h2>1 · Formula checks against published numbers</h2>
        <p>Arithmetic re-computation of values reported in the source papers, using the same equations the simulator uses.</p>
        <table class="vt"><tr><th>Check</th><th>Computed</th><th>Reported</th><th>Unit</th><th></th></tr>
        ${A.map(r => `<tr><td>${r[0]}</td><td class="n">${f(r[1], r[2] < 2 ? 2 : 1)}</td><td class="n">${r[2]}</td><td>${r[3]}</td><td>${verdict(pct(r[1], r[2]))}</td></tr>`).join('')}</table>
        <p class="fine">Fig. 3 does not report Ps − Pi directly; it is derived as AIx × aortic PP, which explains the small mismatch.</p>
        <h3>Townsend et al. 2015 — pulse pressure amplification for all six clinical cases</h3>
        <table class="vt"><tr><th>Case</th><th>Brachial BP</th><th>Central BP</th><th>Computed (bPP/cPP − 1)</th><th>Reported</th><th></th></tr>
        ${cases.map(c => { const v = ((c[1] - c[2]) / (c[3] - c[4]) - 1) * 100; return `<tr><td>${c[0]}</td><td class="n">${c[1]}/${c[2]}</td><td class="n">${c[3]}/${c[4]}</td><td class="n">${v.toFixed(1)} %</td><td class="n">${c[5]} %</td><td>${Math.abs(v - c[5]) <= 1.5 ? '<span class="pass">✓ match</span>' : '<span class="fail">✗</span>'}</td></tr>`; }).join('')}</table>
      </div>

      <div class="card prose" style="max-width:none">
        <h2>2 · Model vs published age trends</h2>
        <p>Nichols &amp; Singh 2002, Fig. 2 (healthy subjects aged 19, 42 and 83) compared with the simulator's Young (20 y), Middle-aged (45 y) and ISH (80 y) presets. The goal is the <b>direction and shape</b> of the trend; a single-reflection model will not match every absolute value.</p>
        <table class="vt"><tr><th>Variable</th><th>Paper 19 y</th><th>42 y</th><th>83 y</th><th>Model 20 y</th><th>45 y</th><th>80 y</th><th>Trend</th></tr>
        ${ageRows.map(r => `<tr><td>${r[0]}</td>${[1, 2, 3].map(i => `<td class="n">${f(r[i], r[0].includes('Ampl') ? 1 : 0)}</td>`).join('')}${[4, 5, 6].map(i => `<td class="n">${f(r[i], r[0].includes('Ampl') ? 2 : 0)}</td>`).join('')}<td>${['<span class="fail">✗ opposite</span>', '<span class="near">◐ partial</span>', '<span class="pass">✓ same direction</span>'][trendOK(r)]}</td></tr>`).join('')}</table>
        <div class="note">Known limitation: invasive Δtp in youth (332 ms) is longer than the model's, because a single effective reflection site cannot capture the distal shift of reflection in young, compliant arteries. Pulse-pressure amplification falls from youth to middle age as published, but then plateaus near 1.2 instead of reaching 1.1: the model uses one fixed upper-limb transfer function, whereas the published decline also reflects changes in aortic–brachial transmission. Use the reflection-site position slider to explore the distal shift.</div>
      </div>

      <div class="card prose" style="max-width:none">
        <h2>3 · Drug effects vs Townsend et al. 2015, Table 1</h2>
        <p>Each drug applied alone to the Essential-HTN (55 y) patient.</p>
        <table class="vt"><tr><th>Drug</th><th>Expected central SBP</th><th>Model ΔcSBP</th><th>Expected AIx</th><th>Model ΔAIx</th><th>Model Δ cuff SBP</th><th></th></tr>
        ${drugRows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td class="n">${f(r[2])}</td><td>${r[3]}</td><td class="n">${f(r[4])}</td><td class="n">${f(r[5])}</td><td>${r[6] ? '<span class="pass">✓ direction</span>' : '<span class="fail">✗</span>'}</td></tr>`).join('')}</table>
        <p class="fine">Nitrates should have the largest AIx effect (↓↓↓↓): model nitrate ΔAIx ${f(nitAix)} vs next-largest ${f(otherMax)} — ${nitAix < otherMax ? '<span class="pass">✓ largest</span>' : '<span class="near">not the largest</span>'}.</p>
      </div>

      <div class="card prose" style="max-width:none">
        <h2>4 · Mechanistic predictions from the papers</h2>
        <table class="vt"><tr><th>Prediction</th><th>Source</th><th>Model result</th><th></th></tr>
        ${mech.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[3]}</td><td>${pass(r[2])}</td></tr>`).join('')}</table>
      </div>`;
  }

  global.Validation = { html };
})(window);
