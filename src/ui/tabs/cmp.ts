/* Compare A vs B: two patients on one clock. Overlay, B − A difference plot, "what differs"
   (top 3 inputs by contribution to Δ central SBP, one at a time), measures and inputs tables. */
import { ALL_CONTROLS, ALL_DRUGS, type Params } from '../../config/physiology';
import { sbpContributions, type Contribution } from '../../model/contrib';
import type { BeatResult } from '../../model/solve';
import { lineChart, type Series } from '../../render/chart';
import type { PatientId } from '../../state/types';
import { drawBudget } from '../budget';
import type { Ctx } from '../context';
import { $, esc, fmt } from '../dom';

const ms = (a: number[]) => a.map(v => v * 1000);
let showRefl = false;
let scenario: { title: string; look: string } | null = null;
export const setScenario = (s: typeof scenario) => { scenario = s; };

const CMP_ROWS: [string, [string, string, string, number][]][] = [
  ['Blood pressure', [['bSBP', 'Cuff SBP', 'mmHg', 0], ['bDBP', 'Cuff DBP', 'mmHg', 0], ['Ps', 'Central SBP', 'mmHg', 0], ['Pd', 'Central DBP', 'mmHg', 0], ['PP', 'Central pulse pressure', 'mmHg', 0], ['map', 'Mean arterial pressure', 'mmHg', 0]]],
  ['Wave reflection', [['AIx', 'Augmentation index', '%', 1], ['AIx75', 'AIx at HR 75', '%', 1], ['AP', 'Augmentation pressure', 'mmHg', 1], ['ppa', 'PP amplification', '×', 2], ['dtp', 'Echo return time Δtp', 'ms', 0], ['rm', 'Reflection magnitude', '%', 0]]],
  ['Arteries & flow', [['cAoOp', 'Aortic PWV', 'm/s', 1], ['co', 'Cardiac output', 'L/min', 2], ['svrDyn', 'SVR', 'dyn·s·cm⁻⁵', 0], ['ctot', 'Compliance', 'mL/mmHg', 2], ['zcDyn', 'Characteristic impedance', 'dyn·s·cm⁻⁵', 0]]],
  ['Load on the heart', [['Ew', 'Wasted LV energy ΔEw', 'dyn·s/cm²', 0], ['lsEs', 'Late/early systolic load', '', 2], ['tti', 'Tension-time index', 'mmHg·s', 1], ['sevr', 'SEVR (supply/demand)', '%', 0]]]
];

export function buildCmp(ctx: Ctx): void {
  $('#pane-cmp').innerHTML = `
  <div id="scenario"></div>
  <div class="cmp-head" id="cmpHead"></div>
  <div class="grid g-two">
    <div class="card"><div class="card-h"><h2>Central aortic pressure <span class="muted">A vs B</span></h2>
      <div class="toggles"><label><input type="checkbox" id="tgCmpRefl"> Show reflected waves</label></div></div>
      <div class="canvas-wrap tall"><canvas id="cCmpCentral"></canvas></div></div>
    <div class="card"><div class="card-h"><h2>Difference <span class="muted">B − A, central and arm</span></h2></div>
      <div class="canvas-wrap tall"><canvas id="cCmpDiff"></canvas></div></div>
  </div>
  <div class="grid g-cmp">
    <div class="card"><div class="card-h"><h2>Side by side</h2><span class="muted">difference = B − A</span></div><div id="cmpTable"></div></div>
    <div>
      <div class="card differs"><div class="card-h"><h2>What differs <span class="muted">top 3 inputs by effect on central SBP</span></h2></div><div id="cmpDiffers"></div></div>
      <div class="card"><div class="card-h"><h2>Arm (brachial) pressure <span class="muted">what a cuff sees</span></h2></div>
        <div class="canvas-wrap"><canvas id="cCmpBrach"></canvas></div></div>
      <div class="card"><div class="card-h"><h2>Pressure budget</h2></div><div class="canvas-wrap"><canvas id="cCmpBudget"></canvas></div></div>
      <div class="card"><div class="card-h"><h2>Inputs after drugs</h2></div><div id="cmpInputs"></div></div>
    </div>
  </div>`;
  $('#pane-cmp').addEventListener('click', e => {
    const t = e.target as HTMLElement;
    if (t.id === 'scClose') { scenario = null; renderCmp(ctx); return; }
    const ed = t.closest<HTMLElement>('[data-edit]'); if (ed) { ctx.store.dispatch({ type: 'setActive', patient: ed.dataset.edit as PatientId }); return; }
    const ac = t.closest<HTMLElement>('[data-act]'); if (!ac) return;
    const { A, B } = ctx.store.get().app.patients;
    // copies get fresh event ids so stop/remove stay per patient
    let nid = ctx.store.get().app.nextEventId;
    const cp = (p: typeof A) => ({ preset: p.preset, inputs: { ...p.inputs }, events: p.events.map(ev => ({ ...ev, id: nid++ })) });
    const act = ac.dataset.act;
    ctx.store.dispatch({ type: 'setPatients', patients: act === 'ab' ? { A, B: cp(A) } : act === 'ba' ? { A: cp(B), B } : { A: cp(B), B: cp(A) } });
  });
  $<HTMLInputElement>('#tgCmpRefl').addEventListener('change', e => { showRefl = (e.target as HTMLInputElement).checked; renderCmp(ctx); });
}

const drugText = (ctx: Ctx, id: PatientId) => {
  const n = [...new Set(ctx.store.get().app.patients[id].events.map(e => ALL_DRUGS[e.drug].short))];
  return n.length ? n.join(' + ') : 'no drugs';
};

/** B interpolated onto A's time grid, over the shorter cycle. */
function diffSeries(a: BeatResult, b: BeatResult, key: 'p' | 'brachial'): { x: number[]; y: number[] } {
  const T = Math.min(a.d.T, b.d.T), x: number[] = [], y: number[] = [];
  for (let i = 0; i < a.t.length && a.t[i] <= T; i++) {
    const f = a.t[i] / b.dt, j = Math.min(b.t.length - 2, Math.floor(f)), w = f - j;
    x.push(a.t[i] * 1000); y.push(b[key][j] * (1 - w) + b[key][j + 1] * w - a[key][i]);
  }
  return { x, y };
}

let contribCache: { key: string; total: number; items: Contribution[] } | null = null;
function contributions(a: Params, b: Params) {
  const key = ALL_CONTROLS.map(c => `${a[c.key].toFixed(3)}:${b[c.key].toFixed(3)}`).join('|');
  if (contribCache?.key !== key) contribCache = { key, ...sbpContributions(a, b) };
  return contribCache;
}

export function renderCmp(ctx: Ctx): void {
  const bA = ctx.live.beats.A, bB = ctx.live.beats.B; if (!bA || !bB) return;
  const A = bA.res, B = bB.res, app = ctx.store.get().app;
  $('#scenario').innerHTML = scenario ? `<div class="scenario"><div class="sh"><b>${esc(scenario.title)}</b><button class="btn sm" id="scClose">Dismiss</button></div><p><b>What to look for:</b> ${scenario.look}</p></div>` : '';
  const card = (id: PatientId, r: BeatResult) => `<div class="pcard ${id}"><div class="ph"><span class="badge ${id}">Patient ${id}</span>
      <button class="btn sm" data-edit="${id}" ${app.active === id ? 'disabled' : ''}>${app.active === id ? 'Editing' : 'Edit in rail'}</button></div>
    <div class="pmeta">${esc(app.patients[id].preset)}<br>${esc(drugText(ctx, id))}</div>
    <div class="pbp">cuff ${r.m.bSBP.toFixed(0)}/${r.m.bDBP.toFixed(0)} · central ${r.m.Ps.toFixed(0)}/${r.m.Pd.toFixed(0)} · AIx ${r.m.AIx.toFixed(0)} % · HR ${r.params.hr.toFixed(0)}</div></div>`;
  const head = card('A', A) + `<div class="cmp-actions"><button class="btn sm" data-act="ab">Copy A → B</button><button class="btn sm" data-act="ba">Copy B → A</button><button class="btn sm" data-act="swap">Swap A ↔ B</button></div>` + card('B', B);
  const hEl = $('#cmpHead'); if (hEl.dataset.h !== head) { hEl.innerHTML = head; hEl.dataset.h = head; }

  const xMax = Math.max(A.d.T, B.d.T) * 1000;
  const wave = (r: BeatResult, c: string, key: 'p' | 'brachial', label: string): Series => ({ x: ms(r.t), y: r[key], color: c, width: 2.8, label });
  const refl = (r: BeatResult, c: string, id: string): Series => ({ x: ms(r.t), y: r.pb.map(v => v - r.pb[0] + r.p[0]), color: c, width: 1.4, dash: [2, 3], label: `${id} echo`, alpha: 0.85 });
  lineChart($<HTMLCanvasElement>('#cCmpCentral'), {
    series: [wave(A, '--pa', 'p', 'Patient A'), wave(B, '--pb', 'p', 'Patient B'), ...(showRefl ? [refl(A, '--pa', 'A'), refl(B, '--pb', 'B')] : [])],
    xLabel: 'Time (ms)', yLabel: 'mmHg', xMin: 0, xMax, hoverX: v => `${v.toFixed(0)} ms`, hoverFmt: v => v.toFixed(1) + ' mmHg',
    marks: [{ x: A.t[A.m.iPk] * 1000, y: A.m.Ps, label: A.m.Ps.toFixed(0), color: '--pa' }, { x: B.t[B.m.iPk] * 1000, y: B.m.Ps, label: B.m.Ps.toFixed(0), color: '--pb' }],
    vlines: [{ x: A.m.dtp, color: '--pa', dash: [3, 3] }, { x: B.m.dtp, color: '--pb', dash: [3, 3] }], ariaLabel: 'Central pressure of patients A and B' });
  const dC = diffSeries(A, B, 'p'), dB = diffSeries(A, B, 'brachial');
  lineChart($<HTMLCanvasElement>('#cCmpDiff'), {
    series: [{ ...dC, color: '--comp', width: 2.4, label: 'Central B − A', fill: '--shade-strong', fillBase: 0 }, { ...dB, color: '--brach', width: 1.8, dash: [5, 3], label: 'Arm B − A' }],
    xLabel: 'Time (ms)', yLabel: 'Δ mmHg', xMin: 0, xMax: Math.min(A.d.T, B.d.T) * 1000, hoverX: v => `${v.toFixed(0)} ms`, hoverFmt: v => (v > 0 ? '+' : '') + v.toFixed(1) + ' mmHg',
    hlines: [{ y: 0, color: '--ink-3' }], ariaLabel: 'Pressure difference B minus A over one beat' });
  lineChart($<HTMLCanvasElement>('#cCmpBrach'), {
    series: [wave(A, '--pa', 'brachial', 'A arm'), wave(B, '--pb', 'brachial', 'B arm'),
      { x: ms(A.t), y: A.p, color: '--pa', width: 1.3, dash: [5, 4], label: 'A central', alpha: 0.7 }, { x: ms(B.t), y: B.p, color: '--pb', width: 1.3, dash: [5, 4], label: 'B central', alpha: 0.7 }],
    xLabel: 'Time (ms)', yLabel: 'mmHg', xMin: 0, xMax, hoverX: v => `${v.toFixed(0)} ms`, hoverFmt: v => v.toFixed(1) + ' mmHg' });
  drawBudget($<HTMLCanvasElement>('#cCmpBudget'), [['Patient A', A.m, '--pa'], ['Patient B', B.m, '--pb']]);

  const rows = CMP_ROWS.map(([g, list]) => `<tr class="grp"><td colspan="4">${g}</td></tr>` + list.map(([k, l, u, f]) => {
    const a = (A.m as unknown as Record<string, number>)[k], b = (B.m as unknown as Record<string, number>)[k], d = b - a;
    const rel = Math.abs(d) / Math.max(Math.abs(a), 1e-9);
    const cls = Math.abs(d) < Math.pow(10, -f) / 2 ? 'same' : d > 0 ? 'up' : 'dn';
    return `<tr><td><button class="nm linklike" data-explain="${k}">${l}</button> <span class="muted">${u}</span></td><td class="mono">${fmt(a, f)}</td><td class="mono">${fmt(b, f)}</td>
      <td class="mono"><span class="d ${cls}">${cls === 'same' ? '±0' : (d > 0 ? '▲ +' : '▼ ') + fmt(d, f)}</span>${cls === 'same' ? '' : `<span class="bar-d" style="width:${Math.min(46, rel * 120).toFixed(0)}px;background:var(${cls === 'up' ? '--up' : '--down'});opacity:.55"></span>`}</td></tr>`;
  }).join('')).join('');
  $('#cmpTable').innerHTML = `<div class="table-wrap"><table class="ct"><thead><tr><th>Measure</th><th class="A">A</th><th class="B">B</th><th>B − A</th></tr></thead><tbody>${rows}</tbody></table></div>`;

  const eA = bA.effect.params, eB = bB.effect.params;
  const c = contributions(eA, eB);
  const unit = (k: string) => ALL_CONTROLS.find(x => x.key === k)!;
  $('#cmpDiffers').innerHTML = c.items.length
    ? `<p class="muted" style="margin:0">Central SBP: A ${A.m.Ps.toFixed(0)} → B ${B.m.Ps.toFixed(0)} mmHg (${c.total >= 0 ? '+' : ''}${c.total.toFixed(1)}). Each input changed from A's value to B's on its own:</p>
      <ol>${c.items.slice(0, 3).map(it => { const u = unit(it.key); return `<li><b>${esc(it.label)}</b> ${it.a.toFixed(u.f)} → ${it.b.toFixed(u.f)} ${u.unit}: <span class="d ${it.dSBP >= 0 ? 'up' : 'dn'}">${it.dSBP >= 0 ? '▲ +' : '▼ '}${it.dSBP.toFixed(1)} mmHg</span></li>`; }).join('')}</ol>
      ${c.items.length > 3 ? `<p class="fine">${c.items.length - 3} more input${c.items.length > 4 ? 's' : ''} differ. One-at-a-time effects need not add up to the total, because inputs interact.</p>` : '<p class="fine">One-at-a-time effects need not add up to the total, because inputs interact.</p>'}`
    : '<p class="muted">The two patients have identical inputs after drugs. Change Patient B in the rail, or load a lesson scenario from the Learn tab.</p>';

  const diffs = ALL_CONTROLS.filter(k => Math.abs(eA[k.key] - eB[k.key]) > 1e-6);
  const dd = [drugText(ctx, 'A'), drugText(ctx, 'B')];
  $('#cmpInputs').innerHTML = (diffs.length || dd[0] !== dd[1])
    ? `<div class="table-wrap"><table class="ct"><thead><tr><th>Input (after drugs)</th><th class="A">A</th><th class="B">B</th></tr></thead><tbody>` +
      diffs.map(k => `<tr><td>${k.label} <span class="muted">${k.unit}</span></td><td class="mono">${eA[k.key].toFixed(k.f)}</td><td class="mono">${eB[k.key].toFixed(k.f)}</td></tr>`).join('') +
      `<tr><td>Drugs</td><td>${esc(dd[0])}</td><td>${esc(dd[1])}</td></tr></tbody></table></div>`
    : '<p class="muted">No differences.</p>';
}
