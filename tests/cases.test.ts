import { describe, expect, it } from 'vitest';
import { CASES, CASE_BY_ID } from '../src/cases/defs';
import { answer, caseSetup, finish, holdFraction, ON_BOARD_LEAD_S, score, SCORE_WEIGHTS, seedOf, shuffleQuestions, startProgress, stepProgress } from '../src/cases/engine';
import type { CaseDef, CaseProgress } from '../src/cases/types';
import { DEFAULTS, PRESETS, type Params } from '../src/config/physiology';
import type { DrugEvent } from '../src/engine/kinetics';
import { catchUp, newPatientSim, setEvents, setTargets, type PatientSim } from '../src/engine/patient';

/** Play a case on the real beat engine. actions: [time since start (s), change]. */
function play(def: CaseDef, actions: [number, (inputs: Params, events: DrugEvent[], t: number) => { inputs?: Params; events?: DrugEvent[] }][], until: number, opts: { answers?: number[] } = {}) {
  const t0 = 100;
  const s0 = caseSetup(def, t0, 1);
  let inputs = s0.inputs, events = s0.events;
  let sim: PatientSim = newPatientSim(inputs, events, t0);
  let p: CaseProgress = startProgress(def, t0);
  const first: { met: boolean | null } = { met: null };
  const queue = [...actions].sort((a, b) => a[0] - b[0]);
  for (let t = t0; t <= t0 + until; t += 0.5) {
    while (queue.length && queue[0][0] + t0 <= t) {
      const [, fn] = queue.shift()!;
      const r = fn(inputs, events, t);
      if (r.inputs) { inputs = r.inputs; sim = setTargets(sim, inputs); }
      if (r.events) { events = r.events; sim = setEvents(sim, events); }
    }
    const c = catchUp(sim, t);
    sim = c.sim;
    for (const b of c.beats) {
      p = stepProgress(def, p, { t: b.tStart, tCase: b.tStart - t0, m: b.res.m, params: b.effect.params, events, tStart: t0 });
      if (first.met == null) first.met = p.met;
    }
  }
  (opts.answers ?? []).forEach((a, i) => { p = answer(p, i, a); });
  return { p: finish(p), firstMet: first.met };
}
let nid = 1000;
const give = (drug: string, mode: 'bolus' | 'infusion', dose = 1) => (_i: Params, ev: DrugEvent[], t: number) => ({ events: [...ev, { id: nid++, drug, mode, t0: t, tStop: null, dose }] });
const start = (drug: string) => (_i: Params, ev: DrugEvent[], t: number) => ({ events: [...ev, { id: nid++, drug, mode: 'infusion' as const, t0: t, tStop: null, dose: 1, steady: true, rampS: 2 }] });
const set = (k: keyof Params, v: number) => (i: Params) => ({ inputs: { ...i, [k]: v } });

describe('case definitions', () => {
  it('there are five cases with 2–3 questions, teaching points and valid answers', () => {
    expect(CASES.map(c => c.id)).toEqual(['athlete', 'ish', 'ntg', 'bb', 'induction']);
    for (const c of CASES) {
      expect(c.questions.length).toBeGreaterThanOrEqual(2); expect(c.questions.length).toBeLessThanOrEqual(3);
      for (const q of c.questions) { expect(q.correct).toBeGreaterThanOrEqual(0); expect(q.correct).toBeLessThan(q.options.length); }
      expect(c.teaching.length).toBeGreaterThan(0);
      expect(c.setup.preset in PRESETS).toBe(true);
    }
  });
  it('each case loads its preset (plus overrides) and its drugs on board at steady state', () => {
    for (const c of CASES) {
      const s = caseSetup(c, 500, 7);
      expect(s.inputs).toEqual({ ...DEFAULTS, ...PRESETS[c.setup.preset], ...(c.setup.over ?? {}) });
      expect(s.events.map(e => e.drug)).toEqual((c.setup.onBoard ?? []).map(d => d.drug));
      for (const e of s.events) { expect(e.steady).toBe(true); expect(e.t0).toBe(500 - ON_BOARD_LEAD_S); }
      expect(s.events.map(e => e.id)).toEqual(s.events.map((_, i) => 7 + i));
    }
    expect(caseSetup(CASE_BY_ID.ntg, 0, 1).baseline).toEqual(caseSetup(CASE_BY_ID.ntg, 0, 1).inputs);
  });
  it('the stiff-aorta case note says stiffness does not change the MAP fall', () => {
    expect(CASE_BY_ID.induction.note).toMatch(/does not change the MAP fall/);
    expect(CASE_BY_ID.induction.teaching.join(' ')).toMatch(/pulse pressure|PP/i);
  });
});

describe('goals: not met at the start, reached with the intended strategy, failed otherwise', () => {
  it('young athlete is an exploration: each change counts once held, in any order', () => {
    const def = CASE_BY_ID.athlete;
    expect(def.kind).toBe('explore');
    const none = play(def, [], 30);
    expect(none.p.taskDone.every(x => x == null)).toBe(true);
    expect(score(def, none.p)).toMatchObject({ kind: 'explore', tasks: 0, tasksDone: 0, nTasks: 3 });
    const all = play(def, [[5, set('cAo', 9)], [20, set('cAo', 5.2)], [21, set('lpScale', 0.8)], [40, set('lpScale', 1.3)], [41, set('cAo', 4.5)]], 60);
    expect(all.p.taskDone.every(x => x != null)).toBe(true);
    expect(all.p.met).toBe(true);
    expect(score(def, all.p).tasks).toBe(SCORE_WEIGHTS.tasks);
    const some = play(def, [[5, set('cAo', 9)]], 30);
    expect(some.p.taskDone.filter(x => x != null)).toHaveLength(1);
    expect(score(def, some.p).tasks).toBe(SCORE_WEIGHTS.tasks / 3);
  });
  it('young athlete: a change that only lasts a moment does not count', () => {
    const r = play(CASE_BY_ID.athlete, [[5, set('cAo', 9)], [6, set('cAo', 5.2)]], 30);
    expect(r.p.taskDone[0]).toBeNull();
  });
  it('ISH: an NTG infusion reaches cSBP < 130 with MAP ≥ 65; doing nothing fails', () => {
    const ok = play(CASE_BY_ID.ish, [[5, give('ntg', 'infusion')]], 400);
    expect(ok.firstMet).toBe(false); expect(ok.p.reachedAt).not.toBeNull();
    expect(ok.p.lowestMap).toBeGreaterThanOrEqual(65);
    expect(play(CASE_BY_ID.ish, [], 120).p.reachedAt).toBeNull();
  });
  it('ISH: an overdose of propofol + NTG fails on MAP', () => {
    const r = play(CASE_BY_ID.ish, [[5, give('ntg', 'infusion', 2)], [5, give('propofol', 'infusion', 2)]], 400);
    expect(r.p.parts.find(x => x.label.startsWith('MAP'))!.ok).toBe(false);
  });
  it('post-NTG: more NTG alone is not enough; adding an ACE inhibitor is', () => {
    expect(play(CASE_BY_ID.ntg, [[5, give('ntg', 'infusion')]], 400).p.reachedAt).toBeNull();
    const ok = play(CASE_BY_ID.ntg, [[5, start('acei')]], 60);
    expect(ok.firstMet).toBe(false); expect(ok.p.reachedAt).not.toBeNull();
  });
  it('beta-blockade: esmolol reaches HR ≤ 60 with MAP ≥ 70; lowering the HR slider by hand does not count', () => {
    const ok = play(CASE_BY_ID.bb, [[5, give('esmolol', 'infusion')]], 300);
    expect(ok.firstMet).toBe(false); expect(ok.p.reachedAt).not.toBeNull();
    const byHand = play(CASE_BY_ID.bb, [[5, set('hr', 58)]], 120);
    expect(byHand.p.reachedAt).toBeNull();
    expect(byHand.p.parts[0]).toMatchObject({ label: 'Esmolol given', ok: false });
  });
  it('induction: propofol alone drops MAP below 65 and fails; adding phenylephrine ½× passes', () => {
    const alone = play(CASE_BY_ID.induction, [[10, give('propofol', 'bolus')]], 240);
    expect(alone.p.reachedAt).toBeNull();
    expect(alone.p.lowestMap).toBeLessThan(65);
    const treated = play(CASE_BY_ID.induction, [[10, give('propofol', 'bolus')], [40, give('phe', 'infusion', 0.5)]], 300);
    expect(treated.firstMet).toBe(false); expect(treated.p.reachedAt).not.toBeNull();
  });
  it('induction: on-board drugs do not count as the propofol bolus', () => {
    const r = play(CASE_BY_ID.induction, [], 30);
    expect(r.p.parts[0]).toMatchObject({ ok: false, value: 'not yet' });
  });
});

describe('progress and scoring', () => {
  const def: CaseDef = {
    id: 't', kind: 'goal', title: 't', summary: '', brief: '', setup: { preset: 'Default adult (45 y)' }, hints: [], teaching: ['x'],
    goal: { text: '', holdS: 10, check: s => [{ label: 'map', ok: s.m.map >= 90, value: '' }] },
    questions: [{ q: '', options: ['a', 'b'], correct: 1, explain: '' }, { q: '', options: ['a', 'b'], correct: 0, explain: '' }]
  };
  const snap = (t: number, map: number) => ({ t, tCase: t, m: { map } as never, params: DEFAULTS, events: [], tStart: 0 });
  const run = (seq: [number, number][]) => seq.reduce((p, [t, map]) => stepProgress(def, p, snap(t, map)), startProgress(def, 0));

  it('the goal counts as reached only after holding for holdS', () => {
    let p = run([[0, 95], [5, 95], [9, 95]]);
    expect(p.reachedAt).toBeNull(); expect(holdFraction(def, p, 9)).toBeCloseTo(0.9);
    p = stepProgress(def, p, snap(10, 95));
    expect(p.reachedAt).toBe(10);
  });
  it('a break resets the hold', () => {
    const p = run([[0, 95], [8, 80], [9, 95], [15, 95]]);
    expect(p.reachedAt).toBeNull(); expect(p.holdStart).toBe(9);
  });
  it('perfect run: 100', () => {
    let p = run([[0, 95], [10, 95], [11, 95], [12, 95]]);
    p = answer(answer(p, 0, 1), 1, 0);
    expect(score(def, finish(p))).toMatchObject({ kind: 'goal', reached: 40, kept: 20, answers: 40, total: 100, correct: 2 });
  });
  it('never reached: only answers count; nothing answered: 0', () => {
    const p = run([[0, 80], [30, 80]]);
    expect(score(def, p).total).toBe(0);
    expect(score(def, answer(p, 0, 1)).total).toBe(SCORE_WEIGHTS.answers / 2);
  });
  it('goal lost after reaching it reduces the "kept" part in proportion', () => {
    const p = run([[0, 95], [10, 95], [11, 80], [12, 80], [13, 95]]);   // 4 beats after reaching, 2 met
    expect(score(def, p).kept).toBe(10);
  });
  it('only the first answer counts, and nothing changes after finishing', () => {
    let p = answer(startProgress(def, 0), 0, 0);
    p = answer(p, 0, 1);
    expect(p.answers[0]).toBe(0);
    expect(answer(p, 5, 0)).toBe(p);
    const f = finish(p);
    expect(answer(f, 1, 0)).toBe(f);
    expect(stepProgress(def, f, snap(100, 95))).toBe(f);
  });
  it('weights add up to 100', () => {
    expect(SCORE_WEIGHTS.reached + SCORE_WEIGHTS.kept + SCORE_WEIGHTS.answers).toBe(100);
    expect(SCORE_WEIGHTS.tasks + SCORE_WEIGHTS.answers).toBe(100);
  });
});

describe('questions: shuffled answers, short options', () => {
  it('the correct answer is not always in the same position (overall and within each case)', () => {
    const pos = CASES.flatMap(c => c.questions.map(q => q.correct));
    expect(new Set(pos).size).toBeGreaterThanOrEqual(3);
    for (const c of CASES) expect(new Set(c.questions.map(q => q.correct)).size).toBeGreaterThan(1);
  });
  it('the shuffle is fixed per case and keeps each correct answer with its text', () => {
    for (const c of CASES) {
      const again = shuffleQuestions({ ...c, questions: c.questions }, seedOf(c.id));
      expect(shuffleQuestions(c, seedOf(c.id))).toEqual(again);       // deterministic
      c.questions.forEach((q, i) => {
        const s2 = again.questions[i];
        expect([...s2.options].sort()).toEqual([...q.options].sort());
        expect(s2.options[s2.correct]).toBe(q.options[q.correct]);
      });
    }
  });
  it('options are short and carry no explanation (that goes in the feedback)', () => {
    for (const c of CASES) for (const q of c.questions) {
      expect(q.explain.length).toBeGreaterThan(20);
      for (const o of q.options) {
        expect(o.length, `${c.id}: "${o}"`).toBeLessThanOrEqual(30);
        expect(o, `${c.id}: "${o}"`).not.toMatch(/[:;—(]|because|does not|e\.g\./i);
      }
      // the correct option is not conspicuously longer than the others
      const lens = q.options.map(o => o.length), longest = Math.max(...lens.filter((_, i) => i !== q.correct));
      expect(lens[q.correct]).toBeLessThanOrEqual(longest + 12);
    }
  });
});
