/* Validation and Methods tabs: static content, rendered once. */
import { methodsHtml } from '../../config/methods';
import { runValidation, type Verdict } from '../../model/validation';
import { runStudyValidation, type StudyCheck } from '../../model/validationStudy';
import { $ } from '../dom';

const f = (v: number | null, d = 1) => v == null ? '—' : v.toFixed(d);
const V: Record<string, Record<Verdict, string>> = {
  formula: { pass: '<span class="pass">✓ match</span>', near: '<span class="near">≈ close</span>', fail: '<span class="fail">✗ off</span>' },
  case: { pass: '<span class="pass">✓ match</span>', near: '<span class="near">≈</span>', fail: '<span class="fail">✗</span>' },
  age: { pass: '<span class="pass">✓ same direction</span>', near: '<span class="near">◐ partial</span>', fail: '<span class="fail">✗ opposite</span>' },
  drug: { pass: '<span class="pass">✓ direction</span>', near: '<span class="near">≈</span>', fail: '<span class="fail">✗</span>' },
  mech: { pass: '<span class="pass">✓ reproduced</span>', near: '<span class="near">≈</span>', fail: '<span class="fail">✗ not reproduced</span>' },
  study: { pass: '<span class="pass">✓ in range</span>', near: '<span class="near">≈ near</span>', fail: '<span class="fail">✗ outside</span>' }
};
const SUMMARY: [string, string, number][] = [
  ['bSBP', 'Cuff SBP (mmHg)', 0], ['bDBP', 'Cuff DBP (mmHg)', 0], ['map', 'MAP (mmHg)', 0], ['Ps', 'Central SBP (mmHg)', 0], ['Pd', 'Central DBP (mmHg)', 0],
  ['PP', 'Central PP (mmHg)', 0], ['bPP', 'Cuff PP (mmHg)', 0], ['amp', 'Cuff − central SBP (mmHg)', 0], ['ppa', 'PP amplification (×)', 2],
  ['AIx', 'AIx (%)', 0], ['AIx75', 'AIx @ 75 bpm (%)', 0], ['pwv', 'Aortic PWV, operating (m/s)', 1], ['dtp', 'Δtp (ms)', 0], ['et', 'LVET (ms)', 0],
  ['co', 'Cardiac output (L/min)', 2], ['ci', 'Cardiac index (L/min/m²)', 2], ['svr', 'SVR (dyn·s·cm⁻⁵)', 0], ['ctot', 'Total compliance (mL/mmHg)', 2],
  ['svpp', 'SV / PP (mL/mmHg)', 2], ['rc', 'Windkessel RC (s)', 2], ['tauFit', 'Decay τ, asymptote 0 (s)', 2], ['tauFree', 'Decay τ, asymptote fitted (s)', 2],
  ['pInf', 'Decay asymptote P∞ (mmHg)', 0], ['decayRate', 'Decay rate (mmHg/s)', 0], ['sevr', 'SEVR (%)', 0], ['Ew', 'Wasted energy ΔEw (×10³ dyn·s/cm²)', 1]
];
const shortName = (n: string) => n.replace('Healthy man (', 'M ').replace('Healthy woman (', 'F ').replace(' y)', '');
const KIND: Record<string, string> = {
  fitted: '<span class="kind k-fit" title="The model or rule was set from this data; the row shows it reproduces it. Not evidence of validity.">fitted to data</span>',
  data: '<span class="kind k-data" title="A prediction compared with published data the model was not set from.">prediction vs data</span>',
  typical: '<span class="kind k-typ" title="Compared with a textbook normal range, not a single cited dataset.">textbook range</span>',
  consistency: '<span class="kind k-con" title="Internal check that the code does what Methods says (definition, mass balance, theory).">consistency</span>'
};
const kindOf = (c: StudyCheck) => c.kind ?? (c.fitted ? 'fitted' : 'data');
const CHECK_HEAD = '<tr><th>Check</th><th>Type</th><th>Model</th><th>Reference</th><th>Source</th><th></th></tr>';
const checkRows = (cs: StudyCheck[]) => cs.map(c => `<tr><td>${c.what}</td><td>${KIND[kindOf(c)]}</td><td class="n">${c.model}</td><td>${c.reference}</td><td>${c.source}</td><td>${c.fitted ? '<span class="muted">target</span>' : V.study[c.verdict]}</td></tr>`).join('');
/** Pass / near / outside counts for the prediction-vs-data rows only. */
const dataScore = (cs: StudyCheck[]) => { const d = cs.filter(c => kindOf(c) === 'data'); const n = (v: string) => d.filter(c => c.verdict === v).length;
  return d.length ? `Predictions vs data: <span class="pass">${n('pass')} in range</span>, <span class="near">${n('near')} near</span>, <span class="fail">${n('fail')} outside</span> (of ${d.length}).` : 'No prediction-vs-data rows in this section.'; };

let validDone = false, eqDone = false;

export function renderValidation(): void {
  if (validDone) return; validDone = true;
  const r = runValidation(), s5 = runStudyValidation();
  $('#pane-valid').innerHTML = `
  <div class="card prose" style="max-width:none">
    <h2>1 · Formula checks against published numbers</h2>
    <p>Arithmetic re-computation of values reported in the source papers, using the same equations the simulator uses.</p>
    <div class="table-wrap"><table class="vt"><tr><th>Check</th><th>Computed</th><th>Reported</th><th>Unit</th><th></th></tr>
    ${r.formulas.map(x => `<tr><td>${x.check}</td><td class="n">${f(x.computed, x.reported < 2 ? 2 : 1)}</td><td class="n">${x.reported}</td><td>${x.unit}</td><td>${V.formula[x.verdict]}</td></tr>`).join('')}</table></div>
    <p class="fine">Fig. 3 does not report Ps − Pi directly; it is derived as AIx × aortic PP, which explains the small mismatch.</p>
    <h3>Townsend et al. 2015 — pulse pressure amplification for all six clinical cases</h3>
    <div class="table-wrap"><table class="vt"><tr><th>Case</th><th>Brachial BP</th><th>Central BP</th><th>Computed (bPP/cPP − 1)</th><th>Reported</th><th></th></tr>
    ${r.cases.map(c => `<tr><td>${c.name}</td><td class="n">${c.brachial.join('/')}</td><td class="n">${c.central.join('/')}</td><td class="n">${c.computed.toFixed(1)} %</td><td class="n">${c.reported} %</td><td>${V.case[c.verdict]}</td></tr>`).join('')}</table></div>
  </div>
  <div class="card prose" style="max-width:none">
    <h2>2 · Model vs published age trends</h2>
    <p>Nichols &amp; Singh 2002, Fig. 2 (healthy subjects aged 19, 42 and 83) compared with the simulator's Young (20 y), Middle-aged (45 y) and ISH (80 y) presets. The goal is the <b>direction and shape</b> of the trend; a single-reflection model will not match every absolute value.</p>
    <div class="table-wrap"><table class="vt"><tr><th>Variable</th><th>Paper 19 y</th><th>42 y</th><th>83 y</th><th>Model 20 y</th><th>45 y</th><th>80 y</th><th>Trend</th></tr>
    ${r.age.map(a => { const amp = a.variable.includes('Ampl'); return `<tr><td>${a.variable}</td>${a.paper.map(v => `<td class="n">${f(v, amp ? 1 : 0)}</td>`).join('')}${a.model.map(v => `<td class="n">${f(v, amp ? 2 : 0)}</td>`).join('')}<td>${V.age[a.verdict]}</td></tr>`; }).join('')}</table></div>
    <div class="note">Known limitation: invasive Δtp in youth (332 ms) is longer than the model's, because a single effective reflection site cannot capture the distal shift of reflection in young, compliant arteries. Pulse-pressure amplification falls from youth to middle age as published, but then plateaus near 1.2 instead of reaching 1.1: the model uses one fixed upper-limb transfer function, whereas the published decline also reflects changes in aortic–brachial transmission. Use the reflection-site position slider to explore the distal shift.</div>
  </div>
  <div class="card prose" style="max-width:none">
    <h2>3 · Drug effects vs Townsend et al. 2015, Table 1</h2>
    <p>Each long-term drug applied alone, at steady state, to the Essential-HTN (55 y) patient.</p>
    <div class="table-wrap"><table class="vt"><tr><th>Drug</th><th>Expected central SBP</th><th>Model ΔcSBP</th><th>Expected AIx</th><th>Model ΔAIx</th><th>Model Δ cuff SBP</th><th></th></tr>
    ${r.drugs.map(d => `<tr><td>${d.drug}</td><td>${d.expSBP}</td><td class="n">${f(d.dSBP)}</td><td>${d.expAIx}</td><td class="n">${f(d.dAIx)}</td><td class="n">${f(d.dCuffSBP)}</td><td>${V.drug[d.verdict]}</td></tr>`).join('')}</table></div>
    <p class="fine">Nitrates should have the largest AIx effect (↓↓↓↓): model nitrate ΔAIx ${f(r.nitrateLargest.nitrateDAIx)} vs next-largest ${f(r.nitrateLargest.nextLargest)} — ${r.nitrateLargest.verdict === 'pass' ? '<span class="pass">✓ largest</span>' : '<span class="near">not the largest</span>'}.</p>
  </div>
  <div class="card prose" style="max-width:none">
    <h2>4 · Mechanistic predictions from the papers</h2>
    <div class="table-wrap"><table class="vt"><tr><th>Prediction</th><th>Source</th><th>Model result</th><th></th></tr>
    ${r.mechanisms.map(m => `<tr><td>${m.prediction}</td><td>${m.source}</td><td>${m.detail}</td><td>${V.mech[m.verdict]}</td></tr>`).join('')}</table></div>
  </div>
  <div class="card prose" style="max-width:none">
    <h2>5 · Healthy study profiles vs reference data (v2.1)</h2>
    <p class="fine"><b>How to read sections 5–8.</b> Each row has a type. Only <i>prediction vs data</i> rows test the model against evidence it was not built from. <i>Fitted to data</i> rows show a rule reproduces the numbers it was set from. <i>Textbook range</i> rows compare with a general normal range. <i>Consistency</i> rows check the code does what Methods says. The verdict for the last three types is not evidence that the model is clinically valid.</p>
    <p>${dataScore(s5.profiles.flatMap(p => p.checks))}</p>
    <p>Each profile is calibrated from sex, age, height and weight (aortic diameter, aortic PWV, stroke volume; see Methods §9). Two inputs were then fitted: SVR to central SBP and Γ to AIx, marked <i>fitted</i>. Every other row is a model prediction compared with healthy-adult data it was not fitted to. "Near" means just outside the reference range.</p>
    <h3>Model outputs, all eight profiles</h3>
    <div class="table-wrap"><table class="vt"><tr><th>Output</th>${s5.profiles.map(p => `<th>${shortName(p.name)}</th>`).join('')}</tr>
    ${SUMMARY.map(([k, l, d]) => `<tr><td>${l}</td>${s5.profiles.map(p => `<td class="n">${(k === 'Ew' ? p.out[k] / 1000 : p.out[k]).toFixed(d)}</td>`).join('')}</tr>`).join('')}
    <tr><td><b>Checks: in range / near / outside</b></td>${s5.profiles.map(p => { const c = p.checks.filter(x => !x.fitted); const n = (v: string) => c.filter(x => x.verdict === v).length;
      return `<td class="n"><span class="pass">${n('pass')}</span> / <span class="near">${n('near')}</span> / <span class="fail">${n('fail')}</span></td>`; }).join('')}</tr></table></div>
    <p class="fine">M = man, F = woman, number = age. Heart rate 70 bpm in every profile. Inputs and the reference tables are on the Methods tab (§9).</p>
    ${s5.profiles.map(p => `<h3>${p.name}</h3><div class="table-wrap"><table class="vt">${CHECK_HEAD}${checkRows(p.checks)}</table></div>`).join('')}
    <div class="note">Known limitations, also listed in Methods: amplification sits at the top of the normal range in the 65- and 80-year-old profiles, and just above the 90th percentile in the 65-year-old woman (one fixed arm transfer function); cuff DBP is ≈ 60–63 mmHg at 65–80 y; the zero-asymptote decay τ is longer than the invasive mean in the young profiles, while the fitted-asymptote τ is a little short at 65–80 y. Use these profiles for trends and comparisons between groups, and enter each subject's own height, weight, heart rate and measured values where you have them.</div>
  </div>
  <div class="card prose" style="max-width:none">
    <h2>6 · Heart rate to 180 bpm and diastolic decay (v2.1)</h2>
    <p>${dataScore([...s5.heartRate, ...s5.decay])}</p>
    <div class="table-wrap"><table class="vt">${CHECK_HEAD}${checkRows([...s5.heartRate, ...s5.decay])}</table></div>
  </div>
  <div class="card prose" style="max-width:none">
    <h2>7 · Cardiac cycle diagram (v2.2)</h2>
    <p>${dataScore(s5.cycle)} The schematic curves are not derived from a dataset, so this section shows consistency and textbook ranges only.</p>
    <p>The Wiggers diagram combines the model's aortic pressure and flow with schematic LV, left-atrial and volume curves (Methods §12). These checks confirm the schematic parts stay consistent with the modelled beat and give normal timings. Default adult at 70 bpm; the last row at 180 bpm with cardiac output held.</p>
    <div class="table-wrap"><table class="vt">${CHECK_HEAD}${checkRows(s5.cycle)}</table></div>
  </div>
  <div class="card prose" style="max-width:none">
    <h2>8 · Physiologic response modes (v2.3)</h2>
    <p>Each mode's coefficients are set from published human data (Methods §13); the <i>fitted to data</i> rows confirm they reproduce those numbers. The <i>prediction vs data</i> rows test what the model then does with them. ${dataScore(s5.response)}</p>
    <p class="fine"><b>Where it misses, and why.</b> With pacing, the model's cuff SBP barely rises (Wilkinson 2000 found it rose) and its aortic PWV rises 0.6 m/s because PWV depends on pressure in the model (Wilkinson 2002 found no change). With exercise, stroke volume follows Pandey (+38 %) but MAP follows Wheatley, whose subjects' stroke volume rose only ≈ 4 %; the model therefore needs a larger fall in SVR than Wheatley measured, and its diastolic pressure falls (−4 to −14 mmHg) where Wheatley's stayed about level. Treat exercise diastolic pressure above ≈ 130 bpm with caution.</p>
    <div class="table-wrap"><table class="vt">${CHECK_HEAD}${checkRows(s5.response)}</table></div>
  </div>`;
}

export function renderMethods(): void {
  if (eqDone) return; eqDone = true;
  $('#pane-eq').innerHTML = methodsHtml();
}
