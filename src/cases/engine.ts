/* Case progress (one update per beat) and scoring. Pure. */
import { DEFAULTS, PRESETS, type Params } from '../config/physiology';
import type { DrugEvent } from '../engine/kinetics';
import type { CaseDef, CaseProgress, CaseSnapshot, Score } from './types';

/** Drugs on board are dated this long before the case starts. */
export const ON_BOARD_LEAD_S = 3600;

/** Score weights: goal reached, goal kept after reaching it, answers. Sum = 100. */
export const SCORE_WEIGHTS = { reached: 40, kept: 20, answers: 40 } as const;

export function startProgress(def: CaseDef, tStart: number): CaseProgress {
  return { caseId: def.id, tStart, holdStart: null, reachedAt: null, beatsAfter: 0, metAfter: 0, parts: [], met: false,
    lowestMap: Infinity, answers: def.questions.map(() => null), finished: false };
}

/** Apply one beat. Beats before the case started are ignored. */
export function stepProgress(def: CaseDef, p: CaseProgress, s: CaseSnapshot): CaseProgress {
  if (p.finished || s.t < p.tStart) return p;
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

/** How far through the hold the goal is (0–1); 1 once reached. */
export function holdFraction(def: CaseDef, p: CaseProgress, t: number): number {
  if (p.reachedAt != null) return 1;
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
  const reached = p.reachedAt != null ? W.reached : 0;
  const kept = p.reachedAt != null && p.beatsAfter > 0 ? Math.round(W.kept * p.metAfter / p.beatsAfter) : 0;
  const n = def.questions.length;
  const correct = def.questions.filter((q, i) => p.answers[i] === q.correct).length;
  const answers = n ? Math.round(W.answers * correct / n) : W.answers;
  return { reached, kept, answers, total: reached + kept + answers, correct, nQuestions: n };
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
