/* Learn tab: v1 lessons with live figures and "Try it" scenarios, the glossary, and the
   cause → effect map, whose nodes pulse ▲/▼ as inputs ramp after a change. */
import { GLOSSARY, LESSONS, type Lesson, type PatientSpec } from '../../config/lessons';
import { DEFAULTS, PRESETS } from '../../config/physiology';
import type { DrugEvent } from '../../engine/kinetics';
import type { BeatResult } from '../../model/solve';
import { lineChart } from '../../render/chart';
import type { PatientState } from '../../state/types';
import { CausalMap } from '../causalMap';
import type { Ctx } from '../context';
import { $, $$ } from '../dom';
import { setScenario } from './cmp';

/** cause → effect node id → Explain-drawer id */
const NODE_EXPLAIN: Record<string, string> = {
  rad: 'radius', cao: 'cAoOp', dia: 'diam', cmus: 'cMus', gam: 'gamma', svr: 'svrDyn', zc: 'zcDyn', comp: 'ctot',
  fwd: 'fwdAmp', bwd: 'bwdAmp', sbp: 'Ps', dbp: 'Pd', pp: 'PP', bsbp: 'bSBP', aix: 'AIx', ew: 'Ew', lses: 'lsEs'
};
let lesson = 0;
let map: CausalMap | null = null;
/** beat captured just before the last input/drug change (the map's reference) */
let ref: BeatResult | null = null;
export const setCausalRef = (r: BeatResult | null) => { ref = r; };

export function buildLearn(ctx: Ctx): void {
  $('#pane-learn').innerHTML = `
  <div class="card">
    <div class="card-h"><h2>Cause → effect <span class="muted">live · after you change an input or give a drug, affected nodes pulse ▲/▼ in causal order</span></h2>
      <button class="btn sm" id="causalClear" title="Use the current beat as the new reference">Clear changes</button></div>
    <div class="causal" id="causal"></div>
    <p class="caption">Values are for the patient being edited. ▲/▼ show the change since just before your last input or drug change. Click a node to explain it.</p>
  </div>
  <div class="learn">
    <nav class="lesson-nav" id="lessonNav" aria-label="Lessons"></nav>
    <article class="card lesson" id="lesson"></article>
  </div>`;
  map = new CausalMap($('#causal'), id => ctx.explain(NODE_EXPLAIN[id] ?? id));
  $('#causalClear').addEventListener('click', () => { ref = null; renderLearnBeat(ctx); });
  $('#lessonNav').innerHTML = LESSONS.map((l, i) => `<button data-lesson="${i}"><span class="n">${i + 1}</span><span>${l.title}</span></button>`).join('') +
    `<button data-lesson="${LESSONS.length}"><span class="n">≡</span><span>Glossary</span></button>`;
  $('#lessonNav').addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-lesson]'); if (!b) return; lesson = Number(b.dataset.lesson); renderLesson(); });
  $('#lesson').addEventListener('click', e => {
    const t = e.target as HTMLElement;
    const nav = t.closest<HTMLElement>('[data-go]'); if (nav) { lesson = Math.max(0, Math.min(LESSONS.length, lesson + Number(nav.dataset.go))); renderLesson(); return; }
    if (t.closest('#tryBtn')) runTry(ctx, LESSONS[lesson]);
  });
}

export function renderLesson(): void {
  $$('#lessonNav button').forEach(b => b.setAttribute('aria-current', String(Number(b.dataset.lesson) === lesson)));
  const i = lesson;
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
  lineChart($<HTMLCanvasElement>('#cLesson'), fig.cfg);
}

function runTry(ctx: Ctx, L: Lesson): void {
  const app = ctx.store.get().app;
  let nid = app.nextEventId;
  ctx.syncClock();
  const t0 = ctx.store.get().app.t;
  const make = (s: PatientSpec): PatientState => ({
    preset: s.preset,
    inputs: { ...DEFAULTS, ...(PRESETS[s.preset] ?? {}), ...(s.over ?? {}) },
    // lesson drugs are the v1 long-term drugs: start them at steady state
    events: (s.drugs ?? []).map((drug): DrugEvent => ({ id: nid++, drug, mode: 'infusion', t0, tStop: null, dose: 1, steady: true, rampS: 0 }))
  });
  const t = L.tryIt;
  ctx.store.dispatch({ type: 'setPatients', patients: { A: make(t.A), B: t.B ? make(t.B) : app.patients.B } });
  ctx.store.dispatch({ type: 'setActive', patient: 'A' });
  if (app.pinned) ctx.store.dispatch({ type: 'clearPin' });
  setScenario(t.B ? { title: `Lesson ${lesson + 1}: ${t.label}`, look: t.look } : null);
  ctx.store.dispatch({ type: 'setTab', tab: t.tab ?? 'cmp' });
}

export function renderLearnBeat(ctx: Ctx): void {
  const beat = ctx.live.beats[ctx.active()]; if (!beat || !map) return;
  map.update(beat.res, ref);
}
