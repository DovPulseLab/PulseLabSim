// Stage 2 demo: the live beat engine with a few inputs and drugs. Replaced by the full UI in stage 3.
import { ACUTE_DRUGS, ALL_CONTROLS, ALL_DRUGS, DRUG_KINETICS, type ParamKey } from './config/physiology';
import { newClock, tick, type Clock, type Warp } from './engine/clock';
import { catchUp, newPatientSim, nextBeat, setEvents, setTargets, type Beat, type PatientSim } from './engine/patient';
import { simulate, type BeatResult } from './model';
import { createStore } from './state/store';
import { decodeHash, encodeState } from './state/url';

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const decoded = decodeHash(location.hash);
const store = createStore(decoded.state);
const msg = (t: string) => { $('#msg').textContent = t; };
if (decoded.error) msg(decoded.error); else if (decoded.warnings.length) msg(decoded.warnings.join(' · '));

const app = () => store.get().app;
let clock: Clock = { ...newClock(app().t), paused: app().paused, warp: app().warp };
let sim: PatientSim = newPatientSim(app().patients.A.inputs, app().patients.A.events, clock.t);
let beat: Beat | null = null;
let pinned: BeatResult | null = app().pinned ? simulate(app().pinned!.params) : null;

store.subscribe((s, a) => {
  const p = s.app.patients.A;
  if (a.type === 'replace') { sim = newPatientSim(p.inputs, p.events, clock.t); return; }
  sim = setEvents(setTargets(sim, p.inputs), p.events);
  if (s.warnings.length) msg(s.warnings.join(' · '));
  syncControls();
});

/* ---------- controls ---------- */
const SHOWN: ParamKey[] = ['hr', 'sv', 'radius', 'cAo', 'gamma', 'lpScale'];
const sliders = $('#sliders');
for (const key of SHOWN) {
  const c = ALL_CONTROLS.find(x => x.key === key)!;
  const l = document.createElement('label');
  l.innerHTML = `${c.label} <input type="range" min="${c.min}" max="${c.max}" step="${c.step}" data-k="${key}" aria-label="${c.label}"> <span data-v="${key}"></span>`;
  l.title = c.tip;
  sliders.appendChild(l);
  let drag = 0;
  const input = l.querySelector('input')!;
  input.addEventListener('pointerdown', () => { drag = Date.now(); });
  input.addEventListener('input', () => store.dispatch({ type: 'setInput', key, value: Number(input.value), coalesce: drag ? `drag-${key}-${drag}` : undefined }));
  input.addEventListener('change', () => { drag = 0; });
}
function syncControls() {
  const p = app().patients.A.inputs;
  for (const key of SHOWN) {
    const c = ALL_CONTROLS.find(x => x.key === key)!;
    const el = sliders.querySelector<HTMLInputElement>(`[data-k="${key}"]`)!;
    if (document.activeElement !== el) el.value = String(p[key]);
    sliders.querySelector(`[data-v="${key}"]`)!.textContent = `${p[key].toFixed(c.f)} ${c.unit}`;
  }
  renderDrugs();
}

const drugs = $('#drugs');
function renderDrugs() {
  const evs = app().patients.A.events;
  drugs.innerHTML = Object.entries(ACUTE_DRUGS).map(([k, d]) => {
    const running = evs.find(e => e.drug === k && e.mode === 'infusion' && e.tStop == null);
    const modes = DRUG_KINETICS[k].modes;
    return `<span>${d.short}: ` +
      (modes.includes('bolus') ? `<button data-give="${k}" data-mode="bolus">bolus</button> ` : '') +
      (running ? `<button data-stop="${running.id}">stop infusion</button>` : `<button data-give="${k}" data-mode="infusion">infusion</button>`) +
      `</span>`;
  }).join('');
}
drugs.addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest('button'); if (!b) return;
  store.dispatch({ type: 'setClock', t: clock.t });
  if (b.dataset.give) store.dispatch({ type: 'giveDrug', drug: b.dataset.give, mode: b.dataset.mode as 'bolus' | 'infusion' });
  if (b.dataset.stop) store.dispatch({ type: 'stopDrug', id: Number(b.dataset.stop) });
});

function setPaused(p: boolean) {
  clock = { ...clock, paused: p };
  store.dispatch({ type: 'setPaused', paused: p });
  $('#status').textContent = p ? '❚❚ paused' : '● live';
}
function stepBeat() {
  if (!clock.paused) return;
  const r = nextBeat(sim); sim = r.sim; beat = r.beat;
  clock = { ...clock, t: r.beat.tStart };
}
function pin() {
  if (!beat) return;
  store.dispatch({ type: 'pin', params: beat.effect.params });
  pinned = beat.res;
}
$('#pause').addEventListener('click', () => setPaused(!clock.paused));
$('#step').addEventListener('click', stepBeat);
$('#pin').addEventListener('click', pin);
$<HTMLSelectElement>('#warp').value = String(clock.warp);
$<HTMLSelectElement>('#warp').addEventListener('change', e => {
  const w = Number((e.target as HTMLSelectElement).value) as Warp;
  clock = { ...clock, warp: w }; store.dispatch({ type: 'setWarp', warp: w });
});
$('#undo').addEventListener('click', () => store.dispatch({ type: 'undo' }));
$('#redo').addEventListener('click', () => store.dispatch({ type: 'redo' }));
$('#copy').addEventListener('click', async () => {
  store.dispatch({ type: 'setClock', t: clock.t });
  const hash = encodeState(app());
  history.replaceState(null, '', hash);
  try { await navigator.clipboard.writeText(location.href); msg('Link copied.'); } catch { msg('Link is in the address bar.'); }
});
document.addEventListener('keydown', e => {
  const tag = (e.target as HTMLElement).tagName;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); store.dispatch({ type: e.shiftKey ? 'redo' : 'undo' }); return; }
  if (tag === 'SELECT' || (tag === 'INPUT' && (e.target as HTMLInputElement).type !== 'range')) return;
  if (e.key === ' ') { e.preventDefault(); setPaused(!clock.paused); }
  else if (e.key === '.') stepBeat();
  else if (e.key === 'b' || e.key === 'B') pin();
});
if (clock.paused) $('#status').textContent = '❚❚ paused';
syncControls();

/* ---------- drawing ---------- */
function setup(c: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1, r = c.getBoundingClientRect();
  if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
  const ctx = c.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, r.width, r.height);
  return { ctx, w: r.width, h: r.height };
}
function line(ctx: CanvasRenderingContext2D, xs: number[], ys: number[], X: (v: number) => number, Y: (v: number) => number, color: string, width = 2, dash: number[] = []) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.beginPath();
  xs.forEach((x, i) => (i ? ctx.lineTo(X(x), Y(ys[i])) : ctx.moveTo(X(x), Y(ys[i])))); ctx.stroke(); ctx.setLineDash([]);
}
function drawWave() {
  const { ctx, w, h } = setup($('#wave'));
  if (!beat) return;
  const r = beat.res, tms = r.t.map(t => t * 1000), P = 40;
  const all = [...r.p, ...r.brachial, ...(pinned ? pinned.p : [])];
  const lo = Math.floor(Math.min(...all) / 10) * 10 - 5, hi = Math.ceil(Math.max(...all) / 10) * 10 + 5;
  const xMax = Math.max(tms[tms.length - 1], pinned ? pinned.t[pinned.t.length - 1] * 1000 : 0);
  const X = (v: number) => P + (w - P - 10) * v / xMax, Y = (v: number) => h - 22 - (h - 32) * (v - lo) / (hi - lo);
  ctx.fillStyle = '#667'; ctx.font = '11px system-ui';
  for (let v = lo; v <= hi; v += 10) { ctx.fillText(String(v), 4, Y(v) + 4); ctx.strokeStyle = '#eef0f3'; ctx.beginPath(); ctx.moveTo(P, Y(v)); ctx.lineTo(w - 10, Y(v)); ctx.stroke(); }
  ctx.fillText('ms →', w - 40, h - 6);
  if (pinned) line(ctx, pinned.t.map(t => t * 1000), pinned.p, X, Y, '#9aa3b2', 2, [6, 4]);
  const p0 = r.p[0];
  line(ctx, tms, r.pf.map(v => v - r.pf[0] + p0), X, Y, '#2a7fb8', 1.5, [6, 3]);
  line(ctx, tms, r.pb.map(v => v - r.pb[0] + p0), X, Y, '#d1781c', 1.5, [2, 3]);
  line(ctx, tms, r.brachial, X, Y, '#7a4fb5', 1.5);
  line(ctx, tms, r.p, X, Y, '#1d2433', 2.6);
  const f = beat.features;
  const mark = (i: number | null, label: string) => {
    if (i == null) return;
    ctx.fillStyle = '#c0262d'; ctx.beginPath(); ctx.arc(X(tms[i]), Y(r.p[i]), 4, 0, 7); ctx.fill();
    ctx.fillText(label, X(tms[i]) + 6, Y(r.p[i]) - 6);
  };
  mark(f.foot, 'foot'); mark(f.peak, 'peak'); mark(f.inflection, 'inflection'); mark(f.lateShoulder, 'late shoulder'); mark(f.notch, 'notch');
  ctx.fillStyle = '#334';
  ctx.fillText(`central (black) · cuff (purple) · forward (blue) · reflected (orange)${pinned ? ' · pinned (grey)' : ''} · inflection: ${f.inflection == null ? 'n/a (type C)' : `${tms[f.inflection].toFixed(0)} ms`}`, P, 14);
}
function drawTrend() {
  const { ctx, w, h } = setup($('#trend'));
  const tr = sim.trend.window();
  if (tr.length < 2) return;
  const t0 = tr[0].t, t1 = Math.max(tr[tr.length - 1].t, t0 + 30), P = 40;
  const X = (t: number) => P + (w - P - 10) * (t - t0) / (t1 - t0);
  const Y = (v: number) => h - 18 - (h - 28) * (v - 40) / (200 - 40);
  ctx.fillStyle = '#667'; ctx.font = '11px system-ui';
  for (let v = 40; v <= 200; v += 40) ctx.fillText(String(v), 4, Y(v) + 4);
  for (const e of app().patients.A.events) {
    if (e.t0 < t0 || e.t0 > t1) continue;
    ctx.strokeStyle = '#c3c8d0'; ctx.beginPath(); ctx.moveTo(X(e.t0), 10); ctx.lineTo(X(e.t0), h - 18); ctx.stroke();
    ctx.fillText(`${ALL_DRUGS[e.drug].short} ${e.mode}`, X(e.t0) + 3, 12);
  }
  const ts = tr.map(s => s.t);
  line(ctx, ts, tr.map(s => s.cSBP), X, Y, '#1d2433');
  line(ctx, ts, tr.map(s => s.sbp), X, Y, '#7a4fb5');
  line(ctx, ts, tr.map(s => s.map), X, Y, '#2a7fb8');
  line(ctx, ts, tr.map(s => s.hr), X, Y, '#c0262d', 1.5);
  ctx.fillText(`${Math.round((t1 - t0))} s shown`, w - 80, h - 4);
}
function drawKpis() {
  if (!beat) return;
  const m = beat.res.m, e = beat.effect;
  const active = e.levels.filter(l => l.level > 0.005).map(l => `${ALL_DRUGS[l.drug].short} ${(l.level * 100).toFixed(0)}%`).join(', ') || 'none';
  $('#kpis').innerHTML = [
    ['Central BP', `${m.Ps.toFixed(0)}/${m.Pd.toFixed(0)}`], ['Cuff BP', `${m.bSBP.toFixed(0)}/${m.bDBP.toFixed(0)}`], ['MAP', m.map.toFixed(0)],
    ['HR', e.params.hr.toFixed(0) + (e.reflexBpm ? ` (reflex ${e.reflexBpm.toFixed(1)})` : '')], ['AIx', m.AIx.toFixed(0) + ' %'],
    ['Aortic PWV', m.cAoOp.toFixed(1)], ['Beat', String(beat.index)], ['Time', `${clock.t.toFixed(1)} s`], ['Drug effect', active]
  ].map(([k, v]) => `<span>${k}<br><b>${v}</b></span>`).join('');
}

let lastFrame = performance.now();
function frame(now: number) {
  clock = tick(clock, (now - lastFrame) / 1000);
  lastFrame = now;
  const r = catchUp(sim, clock.t);
  sim = r.sim;
  if (r.beats.length) beat = r.beats[r.beats.length - 1];
  if (r.beats.length || !beat) { drawWave(); drawTrend(); }
  drawKpis();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
