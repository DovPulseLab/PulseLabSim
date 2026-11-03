/* Impedance: modulus and phase of input impedance 0–10 Hz from the current beat
   (FFT of pressure / FFT of flow), with the model's continuous curve. Marks Zc (mean
   modulus 2–10 Hz), Z1 and the first minimum next to the predicted 1/(2·Δtp). */
import { PHYS } from '../../config/physiology';
import { abs } from '../../model/complex';
import { impedanceFromBeat, summarizeImpedance, type ImpedanceSummary } from '../../model/impedance';
import { inputImpedance, type BeatResult } from '../../model/solve';
import { lineChart, type Series } from '../../render/chart';
import type { Ctx } from '../context';
import { $ } from '../dom';

const DYN = PHYS.DYN, FMAX = 10;
let cache: { res: BeatResult; harm: ReturnType<typeof impedanceFromBeat>; fine: { f: number; mod: number; ph: number }[]; sum: ImpedanceSummary } | null = null;

export function buildImp(ctx: Ctx): void {
  void ctx;
  $('#pane-imp').innerHTML = `
  <div class="grid g-two">
    <div class="card"><div class="card-h"><h2>Input impedance modulus <span class="muted">dots = harmonics of this beat · line = model curve</span></h2></div>
      <div class="canvas-wrap tall"><canvas id="cImp"></canvas></div>
      <div class="card-h" style="margin-top:8px"><h2>Phase</h2></div>
      <div class="canvas-wrap"><canvas id="cImpPh"></canvas></div>
      <p class="caption">Below about 2 Hz the reflected wave makes |Z| dip and the phase go negative (flow leads pressure). Above it, |Z| settles around the aorta's characteristic impedance Zc. The first minimum sits near 1/(2·Δtp), where the echo arrives half a cycle out of step.</p></div>
    <div>
      <div class="card"><div class="card-h"><h2>Values</h2></div><div id="impStats" class="mtable compact"></div></div>
      <div class="card"><div class="card-h"><h2>Three parts of afterload</h2></div><div id="afterload" class="afterload"></div></div>
    </div>
  </div>`;
}

function analyse(res: BeatResult) {
  if (cache?.res === res) return cache;
  const harm = impedanceFromBeat(res, FMAX);
  const fine: { f: number; mod: number; ph: number }[] = [];
  for (let f = 0.05; f <= FMAX + 1e-9; f += 0.02) { const z = inputImpedance(res.d, f); fine.push({ f, mod: abs(z), ph: Math.atan2(z.i, z.r) }); }
  cache = { res, harm, fine, sum: summarizeImpedance(res.d, harm.map(h => ({ f: h.f, mod: h.mod }))) };
  return cache;
}

export function renderImp(ctx: Ctx): void {
  const beat = ctx.live.beats[ctx.active()]; if (!beat) return;
  const res = beat.res, { harm, fine, sum } = analyse(res), base = ctx.live.pinned;
  const ptc = ctx.active() === 'A' ? '--pa' : '--pb';
  const h1 = harm.filter(h => h.f > 0);
  const series: Series[] = [];
  if (base) { const zb = impedanceFromBeat(base, FMAX).filter(h => h.f > 0); series.push({ x: zb.map(h => h.f), y: zb.map(h => h.mod * DYN), color: '--base', dash: [6, 4], width: 1.4, points: true, r: 2.5, label: 'Baseline' }); }
  series.push({ x: fine.map(p => p.f), y: fine.map(p => p.mod * DYN), color: '--ink-3', width: 1.4, label: 'Model |Zin(f)|', noHover: true });
  series.push({ x: h1.map(h => h.f), y: h1.map(h => h.mod * DYN), color: ptc, width: 2, points: true, r: 3.5, label: `Patient ${ctx.active()} harmonics` });
  const yMax = Math.max(sum.zcEstimate * 4, sum.z1 * 1.4);
  lineChart($<HTMLCanvasElement>('#cImp'), {
    series, xLabel: 'Frequency (Hz)', yLabel: '|Z| (dyn·s·cm⁻⁵)', xMin: 0, xMax: FMAX, yMin: 0, yMax,
    hlines: [{ y: sum.zcEstimate, color: '--fwd', label: `Zc ≈ ${sum.zcEstimate.toFixed(0)} (mean 2–10 Hz)` }],
    vlines: [{ x: sum.firstMinHz, color: '--bwd', label: `first min ${sum.firstMinHz.toFixed(2)} Hz`, dash: [3, 3] },
      { x: sum.predictedMinHz, color: '--ink-3', label: `1/(2Δtp) ${sum.predictedMinHz.toFixed(2)} Hz`, dash: [1, 3], dy: 16 }],
    marks: h1.length ? [{ x: h1[0].f, y: h1[0].mod * DYN, label: `Z₁ ${(h1[0].mod * DYN).toFixed(0)}`, color: '--bwd', pos: 'right' }] : [],
    hoverX: v => `${v.toFixed(2)} Hz`, hoverFmt: v => v.toFixed(0), ariaLabel: 'Input impedance modulus versus frequency' });
  const deg = (r: number) => r * 180 / Math.PI;
  lineChart($<HTMLCanvasElement>('#cImpPh'), {
    series: [{ x: fine.map(p => p.f), y: fine.map(p => deg(p.ph)), color: '--ink-3', width: 1.4, label: 'Model phase', noHover: true },
      { x: h1.map(h => h.f), y: h1.map(h => deg(h.phase)), color: ptc, width: 2, points: true, r: 3.5, label: 'Harmonics' }],
    xLabel: 'Frequency (Hz)', yLabel: 'Phase (°)', xMin: 0, xMax: FMAX, yMin: -90, yMax: 90, legend: false,
    hlines: [{ y: 0, color: '--ink-3' }], hoverX: v => `${v.toFixed(2)} Hz`, hoverFmt: v => v.toFixed(0) + '°', ariaLabel: 'Input impedance phase versus frequency' });
  const err = (sum.firstMinHz / sum.predictedMinHz - 1) * 100;
  $('#impStats').innerHTML = ([
    ['Z₀ = peripheral resistance (SVR)', sum.z0.toFixed(0) + ' dyn·s·cm⁻⁵', 'svrDyn'],
    ['Characteristic impedance Zc = ρc/A (model)', sum.zcModel.toFixed(0) + ' dyn·s·cm⁻⁵', 'zcDyn'],
    ['Mean modulus 2–10 Hz (≈ Zc)', sum.zcEstimate.toFixed(0) + ' dyn·s·cm⁻⁵', 'zcDyn'],
    ['First harmonic Z₁', sum.z1.toFixed(0) + ' dyn·s·cm⁻⁵', ''],
    ['First minimum (model curve)', sum.firstMinHz.toFixed(2) + ' Hz', ''],
    ['First minimum (harmonics)', sum.firstMinHarmonicHz.toFixed(2) + ' Hz', ''],
    ['Predicted 1 / (2·Δtp)', `${sum.predictedMinHz.toFixed(2)} Hz (curve ${err >= 0 ? '+' : ''}${err.toFixed(0)} %)`, 'dtp']
  ] as [string, string, string][]).map(r => `<div class="mrow">${r[2] ? `<button class="nm" data-explain="${r[2]}">${r[0]}</button>` : `<span class="nm">${r[0]}</span>`}<span class="vl">${r[1]}</span><span></span></div>`).join('');
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
