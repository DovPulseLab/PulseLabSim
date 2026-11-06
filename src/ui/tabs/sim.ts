/* Simulator tab: live central waveform (forward / reflected / pinned baseline, feature
   points, shaded augmentation), arterial-tree schematic, arm and flow plots, pressure
   budget and the full index table. */
import { METRICS } from '../../config/metrics';
import type { Beat } from '../../engine/patient';
import type { BeatResult } from '../../model/solve';
import { lineChart, type ChartConfig, type Mark, type Series } from '../../render/chart';
import { drawBudget, type BudgetBar } from '../budget';
import type { Ctx } from '../context';
import { $, esc, fmt } from '../dom';
import { Schematic } from '../schematic';

const ms = (a: number[]) => a.map(v => v * 1000);
const PT = { A: '--pa', B: '--pb' } as const;
const tg = { fwd: true, bwd: true, base: true, ann: true, decay: true };
let schematic: Schematic | null = null;

export function buildSim(ctx: Ctx): void {
  $('#pane-sim').innerHTML = `
  <div class="viewing" id="viewing"></div>
  <div class="card">
    <div class="card-h">
      <h2>Central aortic pressure <span class="muted">forward + reflected = measured · click a curve to explain it</span></h2>
      <div class="toggles" id="simToggles">
        <label title="Model components from wave separation, not measured signals"><input type="checkbox" data-tg="fwd" checked> Forward (model)</label>
        <label title="Model components from wave separation, not measured signals"><input type="checkbox" data-tg="bwd" checked> Reflected (model)</label>
        <label><input type="checkbox" data-tg="base" checked> Baseline</label>
        <label><input type="checkbox" data-tg="decay" checked> Diastolic decay fit</label>
        <label><input type="checkbox" data-tg="ann" checked> Labels</label>
      </div>
    </div>
    <div class="canvas-wrap main-plot"><canvas id="cCentral"></canvas></div>
    <p class="caption" id="capCentral"></p>
  </div>
  <div class="sim-secondary">
    <div class="grid g-two">
      <div class="card">
        <div class="card-h"><h2>Arterial tree <span class="muted">wave travel, slowed ×6</span></h2>
          <div class="toggles"><label><input type="checkbox" id="tgAnim" checked> Animate</label></div></div>
        <div id="schematic" class="schematic"></div>
      </div>
      <div>
        <div class="card"><div class="card-h"><h2>Central vs arm <span class="muted">amplification</span></h2></div>
          <div class="canvas-wrap"><canvas id="cPeriph"></canvas></div></div>
        <div class="card"><div class="card-h"><h2>Aortic flow</h2></div>
          <div class="canvas-wrap"><canvas id="cFlow"></canvas></div></div>
      </div>
    </div>
    <div class="card"><div class="card-h"><h2>Pressure budget <span class="muted">where cuff SBP comes from</span></h2></div>
      <div class="canvas-wrap"><canvas id="cBudget"></canvas></div></div>
    <details class="card fold" id="foldIdx">
      <summary><h2>All indices <span class="muted" id="baseNote"></span></h2><span class="chev" aria-hidden="true">▾</span></summary>
      <div id="metricsTable" class="mtable"></div>
    </details>
  </div>`;
  $('#simToggles').addEventListener('change', e => {
    const i = e.target as HTMLInputElement; tg[i.dataset.tg as keyof typeof tg] = i.checked; renderSim(ctx);
  });
  schematic = new Schematic($('#schematic'));
  $<HTMLInputElement>('#tgAnim').addEventListener('change', e => { schematic!.running = (e.target as HTMLInputElement).checked; });
}

/** Animation frame for the schematic (cheap; called every frame while visible). */
export function tickSim(ctx: Ctx, now: number): void { schematic?.tick(now, ctx.live.clock.paused); }

function centralConfig(beat: Beat, base: BeatResult | null, onPick?: (s: Series) => void): ChartConfig {
  const res = beat.res, m = res.m, t = ms(res.t), P0 = res.p[0], f = beat.features;
  const pf = res.pf.map(v => v - res.pf[0] + P0), pb = res.pb.map(v => v - res.pb[0] + P0);
  const series: Series[] = [];
  if (tg.base && base) series.push({ x: ms(base.t), y: base.p, color: '--base', width: 2, dash: [6, 4], label: 'Baseline', alpha: 0.9, key: 'base' });
  // shaded augmented pressure: the part of the measured wave above P1 after the echo arrives
  if (m.type !== 'C' && m.AP > 0.5) {
    const i0 = Math.min(m.iTi, m.i1), i1 = Math.min(res.p.length - 1, m.iET);
    const xs = t.slice(i0, i1 + 1), ys = res.p.slice(i0, i1 + 1);
    series.push({ x: xs, y: ys, fillTo: ys.map(v => Math.min(v, m.P1)), fillToColor: '--aug', color: '--aug', width: 0, noHover: true });
  }
  series.push({ x: t, y: pf, color: '--fwd', width: 1.8, dash: [7, 4], label: 'Forward wave (model component)', hidden: !tg.fwd, key: 'curve:forward' });
  series.push({ x: t, y: pb, color: '--bwd', width: 1.8, dash: [2, 3], label: 'Reflected wave (model component)', hidden: !tg.bwd, key: 'curve:reflected' });
  series.push({ x: t, y: res.p, color: '--comp', width: 2.8, label: 'Measured aortic pressure', key: 'curve:central' });
  if (tg.decay && Number.isFinite(m.tauFit)) {
    // fitted P0·e^(−t/τ) over the fit window, extended back to end-ejection (thin) for context
    const i0 = m.iDecay, xs = t.slice(m.iET), ys = xs.map((_, j) => m.decayP0 * Math.exp(-((m.iET + j - i0) * res.dt) / m.tauFit));
    series.push({ x: xs, y: ys, color: '--ink-2', width: 1.6, dash: [3, 3], label: `Diastolic decay fit · τ ${m.tauFit.toFixed(2)} s (R·C ${m.tau.toFixed(2)} s)`, key: 'tauFit' });
  }
  const cfg: ChartConfig = {
    series, xLabel: 'Time (ms)', yLabel: 'Pressure (mmHg)', xMin: 0, xMax: Math.max(res.d.T, base?.d.T ?? 0) * 1000, headroom: 0.22,
    hoverX: v => `${v.toFixed(0)} ms`, hoverFmt: v => `${v.toFixed(1)} mmHg`, shades: [{ x0: 0, x1: m.et }],
    notes: [{ x: m.et / 2, text: `systole · ${m.et.toFixed(0)} ms` }], onPick,
    ariaLabel: `Central aortic pressure ${m.Ps.toFixed(0)}/${m.Pd.toFixed(0)} mmHg, AIx ${m.AIx.toFixed(0)} %`
  };
  if (tg.ann) {
    const xr = res.d.T * 1000;
    cfg.vlines = [{ x: m.dtp, color: '--bwd', label: `echo arrives · Δtp ${m.dtp.toFixed(0)} ms`, dy: 4 }];
    cfg.hlines = [{ y: 124, color: '--ink-3', label: 'central SBP limit 124', dash: [2, 4] }];
    const marks: Mark[] = [
      { x: t[f.foot], y: res.p[f.foot], label: 'foot', color: '--ink-3', pos: 'below', hollow: true },
      { x: t[f.peak], y: res.p[f.peak], label: `P2/peak ${res.p[f.peak].toFixed(0)}`, color: '--accent', pos: 'above' },
      f.inflection != null
        ? { x: t[f.inflection], y: res.p[f.inflection], label: `P1 inflection ${res.p[f.inflection].toFixed(0)}`, color: '--bwd', pos: 'left' }
        : { x: t[f.peak], y: res.p[f.peak], label: 'inflection n/a (type C)', color: '--ink-3', pos: 'below', hollow: true },
      { x: t[f.notch], y: res.p[f.notch], label: 'notch', color: '--ink-2', pos: 'right', hollow: true },
      { x: t[t.length - 1] * 0.985, y: m.Pd, label: `Pd ${m.Pd.toFixed(0)}`, color: '--fwd', pos: 'above' }
    ];
    if (f.inflection == null && f.lateShoulder != null) marks.push({ x: t[f.lateShoulder], y: res.p[f.lateShoulder], label: 'late shoulder', color: '--bwd', pos: 'right', hollow: true });
    cfg.marks = marks;
    cfg.brackets = [{ x: xr * 0.94, y0: m.Pd, y1: m.Ps, label: `PP ${m.PP.toFixed(0)}`, color: '--ink-2', align: 'right' }];
    if (Math.abs(m.AP) > 1) cfg.brackets.push({ x: Math.max(t[m.i1], t[m.i2]) + 26, y0: Math.min(m.P1, m.P2), y1: Math.max(m.P1, m.P2), label: `AP ${m.AP.toFixed(0)} · AIx ${m.AIx.toFixed(0)} %`, color: '--bwd' });
  }
  return cfg;
}

export function renderSim(ctx: Ctx): void {
  const id = ctx.active(), beat = ctx.live.beats[id]; if (!beat) return;
  const res = beat.res, m = res.m, base = ctx.live.pinned;
  const p = ctx.store.get().app.patients[id];
  const drugs = [...new Set(p.events.map(e => e.drug))];
  $('#viewing').innerHTML = `<span class="badge ${id}">Patient ${id}</span><span>${esc(p.preset)}${drugs.length ? ' · ' + drugs.length + ' drug' + (drugs.length > 1 ? 's' : '') : ''}</span>` +
    (base ? `<span class="muted">· grey dashed = pinned baseline</span>` : `<span class="muted">· press B to pin a baseline, then change something</span>`);
  lineChart($<HTMLCanvasElement>('#cCentral'), centralConfig(beat, base, s => s.key && s.key !== 'base' && ctx.explain(s.key)));
  $('#capCentral').innerHTML = m.type === 'C'
    ? `<b>Type C wave.</b> The echo returns at ${m.dtp.toFixed(0)} ms, after the systolic peak, so it adds little to the heart's load (AIx ${m.AIx.toFixed(0)} %). The inflection point is not found before the peak (n/a).`
    : `<b>Type ${m.type} wave.</b> The echo returns at ${m.dtp.toFixed(0)} ms, while the heart is still ejecting (${m.et.toFixed(0)} ms), adding ${m.AP.toFixed(0)} mmHg (shaded; AIx ${m.AIx.toFixed(0)} %) for ${m.dtr.toFixed(0)} ms. Wasted LV energy ${(m.Ew / 1000).toFixed(1)}×10³ dyn·s/cm².`;
  if (document.body.classList.contains('present')) return;
  renderSecondary(ctx, res, base);
}

function renderSecondary(ctx: Ctx, res: BeatResult, base: BeatResult | null): void {
  const id = ctx.active(), t = ms(res.t), xMax = res.d.T * 1000, showBase = tg.base && base;
  const pick = (s: Series) => s.key && ctx.explain(s.key);
  const periph: Series[] = [];
  if (showBase) periph.push({ x: ms(base.t), y: base.brachial, color: '--base', dash: [6, 4], width: 1.6, label: 'Baseline arm' });
  periph.push({ x: t, y: res.p, color: '--comp', width: 2.2, label: 'Aorta', key: 'curve:central' });
  periph.push({ x: t, y: res.brachial, color: '--brach', width: 2.2, label: 'Brachial', key: 'curve:brachial' });
  periph.push({ x: t, y: res.radial, color: '--radial', width: 1.6, dash: [5, 3], label: 'Radial', key: 'curve:brachial' });
  lineChart($<HTMLCanvasElement>('#cPeriph'), { series: periph, xLabel: 'Time (ms)', yLabel: 'mmHg', xMin: 0, xMax, onPick: pick,
    hoverX: v => `${v.toFixed(0)} ms`, hoverFmt: v => v.toFixed(1) + ' mmHg',
    marks: [{ x: t[res.brachial.indexOf(Math.max(...res.brachial))], y: res.m.bSBP, label: `×${res.m.ppa.toFixed(2)}`, color: '--brach', pos: 'right' }] });
  const zc = res.d.zc;
  const qf = res.pf.map((v, i) => i <= res.m.iET + 2 ? (v - res.pf[0]) / zc : NaN);
  const flow: Series[] = [];
  if (showBase) flow.push({ x: ms(base.t), y: base.q, color: '--base', dash: [6, 4], width: 1.6, label: 'Baseline' });
  flow.push({ x: t, y: qf, color: '--fwd', dash: [6, 4], width: 1.6, label: 'Forward flow wave', key: 'curve:forward' });
  flow.push({ x: t, y: res.q, color: '--flow', width: 2.4, label: 'Aortic flow', fill: '--flow-soft', fillBase: 0, key: 'curve:flow' });
  lineChart($<HTMLCanvasElement>('#cFlow'), { series: flow, xLabel: 'Time (ms)', yLabel: 'mL/s', xMin: 0, xMax, onPick: pick,
    yMin: Math.min(0, ...qf.filter(Number.isFinite)) - 20, hoverX: v => `${v.toFixed(0)} ms`, hoverFmt: v => v.toFixed(0) + ' mL/s',
    vlines: [{ x: res.m.dtp, color: '--bwd', dash: [3, 3] }] });
  const bars: BudgetBar[] = base ? [['Baseline', base.m, '--base'], ['Now', res.m, PT[id]]] : [['Now', res.m, PT[id]]];
  drawBudget($<HTMLCanvasElement>('#cBudget'), bars);
  if (($('#foldIdx') as HTMLDetailsElement).open) renderIndexTable(res, base);
  else $('#baseNote').textContent = '· every measure, grouped';
}

function renderIndexTable(res: BeatResult, base: BeatResult | null): void {
  const m = res.m, b = base?.m;
  $('#baseNote').textContent = b ? '· Δ = change vs pinned baseline · click a name to explain it' : '· click a name to explain it';
  $('#metricsTable').innerHTML = METRICS.map(g => `<div class="mgroup"><h4>${g.g}</h4>${g.items.map(it => {
    const v = m[it.k] as number | string, num = typeof v === 'number';
    const val = num ? fmt(v, it.f) : String(v);
    let dl = '';
    if (b && num) {
      const dv = v - (b[it.k] as number), th = Math.pow(10, -it.f) / 2;
      dl = Math.abs(dv) < th ? '<span class="d same">±0</span>' : `<span class="d ${dv > 0 ? 'up' : 'dn'}">${dv > 0 ? '▲ +' : '▼ '}${fmt(dv, it.f)}</span>`;
    }
    return `<div class="mrow"><button class="nm" data-explain="${it.k}" title="${esc(it.tip)}">${it.l}</button><span class="vl ${num && it.st ? it.st(v) : ''}">${val} <span class="muted">${it.u}</span></span><span class="dl">${dl}</span></div>`;
  }).join('')}</div>`).join('');
}

/** Schematic only needs a new beat, not every store change. */
export function beatSim(ctx: Ctx): void {
  const beat = ctx.live.beats[ctx.active()]; if (beat && schematic) schematic.update(beat.res);
  renderSim(ctx);
}

export { centralConfig };
