/* Sweep: one input across its range at 6 or 12 points with everything else held at the
   patient's current (after-drug) values. Waveform family + any index vs the swept input.
   [ and ] step the highlighted point. */
import { ALL_CONTROLS, type Control, type Params, type ParamKey } from '../../config/physiology';
import type { Indices } from '../../model/indices';
import { simulate, type BeatResult } from '../../model/solve';
import { lineChart, type Series } from '../../render/chart';
import type { Ctx } from '../context';
import { $, esc } from '../dom';

const SWEEP_P: { k: keyof Indices; l: string; c: string; on: boolean }[] = [
  { k: 'Ps', l: 'Central SBP', c: '--accent', on: true }, { k: 'bSBP', l: 'Cuff SBP', c: '--brach', on: true },
  { k: 'map', l: 'MAP', c: '--comp', on: true }, { k: 'Pd', l: 'DBP', c: '--fwd', on: true },
  { k: 'PP', l: 'Central PP', c: '--bwd', on: false }, { k: 'AP', l: 'Augmentation P', c: '--radial', on: false }
];
const SWEEP_I: { k: keyof Indices; l: string }[] = [
  { k: 'AIx', l: 'AIx (%)' }, { k: 'ppa', l: 'PP amplification' }, { k: 'dtp', l: 'Δtp (ms)' }, { k: 'sevr', l: 'SEVR (%)' },
  { k: 'Ew', l: 'ΔEw (dyn·s/cm²)' }, { k: 'lsEs', l: 'LSPTI/ESPTI' }, { k: 'ctot', l: 'Compliance (mL/mmHg)' },
  { k: 'zcDyn', l: 'Zc (dyn·s·cm⁻⁵)' }, { k: 'svrDyn', l: 'SVR (dyn·s·cm⁻⁵)' }, { k: 'co', l: 'CO (L/min)' }, { k: 'cAoOp', l: 'Aortic PWV (m/s)' }
];
const SEQ = ['#56b4e9', '#3a9bd4', '#0072b2', '#5b6fb0', '#8d6aa8', '#b8679a', '#cc79a7', '#d97a6a', '#e08a3c', '#e69f00', '#d97a00', '#d55e00'];

let key: ParamKey = 'cAo', nPts: 6 | 12 = 6, sel = 0, idx: keyof Indices = 'AIx';
let cache: { sig: string; dense: { x: number[]; m: Indices[] }; fam: { x: number; r: BeatResult }[] } | null = null;

const ctrl = (): Control => ALL_CONTROLS.find(c => c.key === key)!;

export function buildSweep(ctx: Ctx): void {
  $('#pane-sweep').innerHTML = `
  <div class="card">
    <div class="sweep-controls">
      <label class="field">Sweep <select id="sweepVar">${ALL_CONTROLS.map(c => `<option value="${c.key}" ${c.key === key ? 'selected' : ''}>${esc(c.label)}${c.unit ? ' (' + c.unit + ')' : ''}</option>`).join('')}</select></label>
      <div class="seg" role="group" aria-label="Number of points" id="sweepN"><button data-n="6" aria-pressed="true">6 points</button><button data-n="12" aria-pressed="false">12 points</button></div>
      <span class="muted" id="sweepSel"></span>
      <button class="btn sm" id="sweepPrev" aria-label="Previous point ([)">[ prev</button><button class="btn sm" id="sweepNext" aria-label="Next point (])">next ]</button>
      <button class="btn sm" id="sweepApply" title="Set the patient's input to the highlighted value">Use this value</button>
    </div>
    <p class="caption" id="capSweep"></p>
  </div>
  <div class="grid g-two">
    <div class="card"><div class="card-h"><h2>Central waveforms <span class="muted">one per point · highlighted = selected</span></h2></div>
      <div class="canvas-wrap tall"><canvas id="cFamily"></canvas></div></div>
    <div class="card"><div class="card-h"><h2>Index vs input</h2>
      <label class="field">Index <select id="sweepIdx">${SWEEP_I.map(o => `<option value="${o.k}" ${o.k === idx ? 'selected' : ''}>${o.l}</option>`).join('')}</select></label></div>
      <div class="canvas-wrap tall"><canvas id="cSweepI"></canvas></div></div>
  </div>
  <div class="card"><div class="card-h"><h2>Pressures vs input</h2><div class="trend-tools" id="sweepOuts">
    ${SWEEP_P.map((o, i) => `<button class="chip" data-out="${i}" aria-pressed="${o.on}"><i style="background:var(${o.c})"></i>${o.l}</button>`).join('')}</div></div>
    <div class="canvas-wrap"><canvas id="cSweepP"></canvas></div></div>`;
  $('#sweepVar').addEventListener('change', e => { key = (e.target as HTMLSelectElement).value as ParamKey; sel = 0; cache = null; renderSweep(ctx); });
  $('#sweepIdx').addEventListener('change', e => { idx = (e.target as HTMLSelectElement).value as keyof Indices; renderSweep(ctx); });
  $('#sweepN').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-n]'); if (!b) return;
    nPts = Number(b.dataset.n) as 6 | 12; sel = Math.min(sel, nPts - 1); cache = null;
    $('#sweepN').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); renderSweep(ctx);
  });
  $('#sweepOuts').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-out]'); if (!b) return;
    const o = SWEEP_P[Number(b.dataset.out)]; o.on = !o.on; b.setAttribute('aria-pressed', String(o.on)); renderSweep(ctx);
  });
  $('#sweepPrev').addEventListener('click', () => stepSweep(ctx, -1));
  $('#sweepNext').addEventListener('click', () => stepSweep(ctx, 1));
  $('#sweepApply').addEventListener('click', () => { if (cache) ctx.store.dispatch({ type: 'setInput', key, value: Number(cache.fam[sel].x.toFixed(4)) }); });
}

export function stepSweep(ctx: Ctx, d: 1 | -1): void { sel = (sel + d + nPts) % nPts; renderSweep(ctx); }

function compute(eff: Params) {
  const c = ctrl();
  const sig = `${key}|${nPts}|` + ALL_CONTROLS.filter(x => x.key !== key).map(x => eff[x.key].toFixed(3)).join(',');
  if (cache?.sig === sig) return cache;
  const dense = { x: [] as number[], m: [] as Indices[] };
  for (let i = 0; i < 41; i++) { const x = c.min + (c.max - c.min) * i / 40; dense.x.push(x); dense.m.push(simulate({ ...eff, [key]: x }).m); }
  const fam = Array.from({ length: nPts }, (_, i) => { const x = c.min + (c.max - c.min) * i / (nPts - 1); return { x, r: simulate({ ...eff, [key]: x }) }; });
  cache = { sig, dense, fam };
  return cache;
}

export function renderSweep(ctx: Ctx): void {
  const beat = ctx.live.beats[ctx.active()]; if (!beat) return;
  const eff = beat.effect.params, c = ctrl(), { dense, fam } = compute(eff), cur = eff[key];
  const ptc = ctx.active() === 'A' ? '--pa' : '--pb';
  const fmtX = (v: number) => `${v.toFixed(c.f)} ${c.unit}`;
  const step = Math.max(1, Math.round((SEQ.length - 1) / Math.max(1, nPts - 1)));
  const famS: Series[] = fam.map((f, i) => ({ x: f.r.t.map(v => v * 1000), y: f.r.p, color: SEQ[Math.min(SEQ.length - 1, i * step)], width: i === sel ? 3.6 : 1.5, alpha: i === sel ? 1 : 0.55, label: fmtX(f.x) }));
  lineChart($<HTMLCanvasElement>('#cFamily'), { series: famS, xLabel: 'Time (ms)', yLabel: 'Central pressure (mmHg)', hoverX: v => `${v.toFixed(0)} ms`, hoverFmt: v => v.toFixed(1), legend: nPts <= 6, ariaLabel: `Central waveforms across ${c.label}` });
  const io = SWEEP_I.find(o => o.k === idx)!;
  const sx = fam[sel].x;
  lineChart($<HTMLCanvasElement>('#cSweepI'), {
    series: [{ x: dense.x, y: dense.m.map(m => m[idx] as number), color: '--bwd', width: 2.4, label: io.l },
      { x: fam.map(f => f.x), y: fam.map(f => f.r.m[idx] as number), color: '--bwd', pointsOnly: true, points: true, r: 3.5, noHover: true }],
    xLabel: `${c.label} (${c.unit})`, yLabel: io.l, hoverX: fmtX, hoverFmt: v => Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2),
    marks: [{ x: sx, y: fam[sel].r.m[idx] as number, label: `${(fam[sel].r.m[idx] as number).toFixed(Math.abs(fam[sel].r.m[idx] as number) >= 100 ? 0 : 2)}`, color: '--ink', pos: 'above' }],
    vlines: [{ x: cur, color: ptc, label: `Patient ${ctx.active()}`, dash: [3, 3] }, { x: sx, color: '--ink-3', dash: [1, 3] }] });
  lineChart($<HTMLCanvasElement>('#cSweepP'), {
    series: SWEEP_P.filter(o => o.on).map(o => ({ x: dense.x, y: dense.m.map(m => m[o.k] as number), color: o.c, width: 2.2, label: o.l })),
    xLabel: `${c.label} (${c.unit})`, yLabel: 'mmHg', hoverX: fmtX, hoverFmt: v => v.toFixed(1), legend: false,
    vlines: [{ x: cur, color: ptc, label: `Patient ${ctx.active()}`, dash: [3, 3] }, { x: sx, color: '--ink-3', dash: [1, 3] }] });
  const m = fam[sel].r.m;
  $('#sweepSel').textContent = `point ${sel + 1}/${nPts}: ${fmtX(sx)} · central ${m.Ps.toFixed(0)}/${m.Pd.toFixed(0)} · AIx ${m.AIx.toFixed(0)} %`;
  const a = dense.m[0], z = dense.m[dense.m.length - 1], d = (k: keyof Indices, f = 0) => `${(a[k] as number).toFixed(f)} → ${(z[k] as number).toFixed(f)}`;
  $('#capSweep').innerHTML = `Patient ${ctx.active()}, ${c.label.toLowerCase()} ${c.min}–${c.max} ${c.unit}, other inputs held at their current values (after drugs): central SBP ${d('Ps')}, DBP ${d('Pd')}, MAP ${d('map')} mmHg; AIx ${d('AIx')} %; amplification ${d('ppa', 2)}.`;
}
