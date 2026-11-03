/* Case progress (one update per beat) and scoring. Pure. */
import { DEFAULTS, PRESETS, type Params } from '../config/physiology';
import type { DrugEvent } from '../engine/kinetics';
import type { CaseDef, CaseProgress, CaseSnapshot, Score } from './types';

/** Drugs on board are dated this long before the case starts. */
export const ON_BOARD_LEAD_S = 3600;

/** Score weights: goal reached, goal kept after reaching it, answers. Sum = 100. */
export const SCORE_WEIGHTS = { reached: 40, kept: 20, answers: 40, tasks: 60 } as const;

export function startProgress(def: CaseDef, tStart: number): CaseProgress {
  const n = def.tasks?.length ?? 0;
  return { caseId: def.id, tStart, holdStart: null, reachedAt: null, beatsAfter: 0, metAfter: 0, parts: [], met: false,
    taskHold: Array(n).fill(null), taskDone: Array(n).fill(null),
    lowestMap: Infinity, answers: def.questions.map(() => null), finished: false };
}

/** Apply one beat. Beats before the case started are ignored. */
export function stepProgress(def: CaseDef, p: CaseProgress, s: CaseSnapshot): CaseProgress {
  if (p.finished || s.t < p.tStart) return p;
  if (def.kind === 'explore') return stepExplore(def, p, s);
  const parts = def.goal.check(s);
  const met = parts.length > 0 && parts.every(x => x.ok);
  const holdStart = met ? (p.holdStart ?? s.t) : null;
  let reachedAt = p.reachedAt;
  if (reachedAt == null && holdStart != null && s.t - holdStart >= def.goal.holdS) reachedAt = s.t;
  const counting = reachedAt != null;
  return {
    ...p, parts, met, holdStart, reachedAt,
    beatsAfter: p.beatsAfter + (counting ? 1 : 0),
    metAfter: p.metAfter + (counting && met ? 1 : 0),
    lowestMap: Math.min(p.lowestMap, s.m.map)
  };
}

function stepExplore(def: CaseDef, p: CaseProgress, s: CaseSnapshot): CaseProgress {
  const tasks = def.tasks ?? [];
  const taskHold = [...p.taskHold], taskDone = [...p.taskDone];
  const parts = tasks.map((k, i) => {
    const now = k.check(s);
    taskHold[i] = now ? (taskHold[i] ?? s.t) : null;
    if (taskDone[i] == null && taskHold[i] != null && s.t - taskHold[i]! >= def.goal.holdS) taskDone[i] = s.t;
    return { label: k.label, ok: taskDone[i] != null, value: k.value(s) };
  });
  const met = tasks.length > 0 && taskDone.every(x => x != null);
  return { ...p, parts, met, taskHold, taskDone, holdStart: null,
    reachedAt: p.reachedAt ?? (met ? s.t : null), lowestMap: Math.min(p.lowestMap, s.m.map) };
}

/** How far through the hold the goal is (0–1); 1 once reached. */
export function holdFraction(def: CaseDef, p: CaseProgress, t: number): number {
  if (p.reachedAt != null) return 1;
  if (def.kind === 'explore') return p.taskDone.filter(x => x != null).length / Math.max(1, p.taskDone.length);
  if (p.holdStart == null) return 0;
  return Math.min(1, (t - p.holdStart) / Math.max(1e-9, def.goal.holdS));
}

/** Record an answer. Only the first answer to each question counts. */
export function answer(p: CaseProgress, qi: number, choice: number): CaseProgress {
  if (p.finished || qi < 0 || qi >= p.answers.length || p.answers[qi] != null) return p;
  const answers = [...p.answers]; answers[qi] = choice;
  return { ...p, answers };
}

export const finish = (p: CaseProgress): CaseProgress => ({ ...p, finished: true });

export function score(def: CaseDef, p: CaseProgress): Score {
  const W = SCORE_WEIGHTS;
  const n = def.questions.length;
  const correct = def.questions.filter((q, i) => p.answers[i] === q.correct).length;
  const answers = n ? Math.round(W.answers * correct / n) : W.answers;
  if (def.kind === 'explore') {
    const nTasks = p.taskDone.length, tasksDone = p.taskDone.filter(x => x != null).length;
    const tasks = nTasks ? Math.round(W.tasks * tasksDone / nTasks) : W.tasks;
    return { kind: 'explore', reached: 0, kept: 0, tasks, tasksDone, nTasks, answers, total: tasks + answers, correct, nQuestions: n };
  }
  const reached = p.reachedAt != null ? W.reached : 0;
  const kept = p.reachedAt != null && p.beatsAfter > 0 ? Math.round(W.kept * p.metAfter / p.beatsAfter) : 0;
  return { kind: 'goal', reached, kept, tasks: 0, tasksDone: 0, nTasks: 0, answers, total: reached + kept + answers, correct, nQuestions: n };
}

/** Starting inputs and drug events for a case (drugs on board start at steady state). */
export function caseSetup(def: CaseDef, t: number, firstId: number): { inputs: Params; events: DrugEvent[]; baseline: Params | null } {
  const s = def.setup;
  if (!(s.preset in PRESETS)) throw new Error(`Case ${def.id}: unknown preset "${s.preset}"`);
  const inputs: Params = { ...DEFAULTS, ...PRESETS[s.preset], ...(s.over ?? {}) };
  let id = firstId;
  // drugs on board started long before the case (at steady state, off the trend window)
  const events: DrugEvent[] = (s.onBoard ?? []).map(d => ({ id: id++, drug: d.drug, mode: 'infusion', t0: t - ON_BOARD_LEAD_S, tStop: null, dose: d.dose ?? 1, steady: true, rampS: 0 }));
  return { inputs, events, baseline: s.pinWithoutDrugs ? { ...inputs } : null };
}

/** Time of the first dose of a drug given after the case started (null if none). */
export function firstDoseAfterStart(s: CaseSnapshot, drug: string): number | null {
  const ts = s.events.filter(e => e.drug === drug && e.t0 >= s.tStart - 1e-6).map(e => e.t0);
  return ts.length ? Math.min(...ts) : null;
}

/** Small seeded PRNG (mulberry32) so shuffles are fixed per case and testable. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Shuffle each question's options with a fixed seed per case; the correct index follows its option. */
export function shuffleQuestions(def: CaseDef, seed = seedOf(def.id)): CaseDef {
  const r = rng(seed);
  const questions = def.questions.map(q => {
    const order = q.options.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    return { ...q, options: order.map(i => q.options[i]), correct: order.indexOf(q.correct) };
  });
  return { ...def, questions };
}
