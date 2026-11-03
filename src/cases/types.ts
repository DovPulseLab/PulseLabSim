/* Guided cases: definitions, live goal checks and scoring. Pure (no DOM). */
import type { Params } from '../config/physiology';
import type { DrugEvent } from '../engine/kinetics';
import type { Indices } from '../model/indices';

/** What a goal check sees on each beat. */
export interface CaseSnapshot {
  t: number;              // clock time, s
  tCase: number;          // time since the case started, s
  m: Indices;             // indices of the beat
  params: Params;         // effective inputs (after drugs)
  events: readonly DrugEvent[];
  tStart: number;         // clock time the case started
}

export interface GoalPart { label: string; ok: boolean; value: string; }

export interface ExploreTask {
  label: string;
  check: (s: CaseSnapshot) => boolean;
  value: (s: CaseSnapshot) => string;
}

export interface Question {
  q: string;
  options: string[];
  correct: number;
  explain: string;
}

export interface CaseSetup {
  preset: string;
  over?: Partial<Params>;
  /** drugs already on board at the start, at steady state */
  onBoard?: { drug: string; dose?: number }[];
  /** pin the patient without the on-board drugs as the baseline */
  pinWithoutDrugs?: boolean;
  /** pin the starting patient (with on-board drugs) as the baseline */
  pinStart?: boolean;
}

export interface CaseDef {
  id: string;
  title: string;
  /** one-line summary for the picker */
  summary: string;
  /** clinical vignette (HTML allowed) */
  brief: string;
  setup: CaseSetup;
  /** 'goal': reach and keep one goal. 'explore': complete a list of things to try, in any order. */
  kind: 'goal' | 'explore';
  goal: {
    text: string;
    /** seconds of clock time the goal (or each exploration task) must hold continuously */
    holdS: number;
    /** goal cases: all parts must be ok at once. Explore cases: ignored (see tasks). */
    check: (s: CaseSnapshot) => GoalPart[];
  };
  /** explore cases: each task is done once it has held for holdS, at any time */
  tasks?: ExploreTask[];
  hints: string[];
  questions: Question[];
  teaching: string[];
  /** model caveat shown with the teaching points */
  note?: string;
  /** show the lowest MAP since the case started */
  showLowestMap?: boolean;
}

export interface CaseProgress {
  caseId: string;
  tStart: number;
  /** clock time the goal started holding continuously (null = not holding) */
  holdStart: number | null;
  /** clock time the goal was first reached (held for holdS) */
  reachedAt: number | null;
  /** beats from the moment reached, and how many of them met the goal */
  beatsAfter: number;
  metAfter: number;
  parts: GoalPart[];
  met: boolean;
  /** explore cases: per task, when it started holding and when it was done */
  taskHold: (number | null)[];
  taskDone: (number | null)[];
  lowestMap: number;
  answers: (number | null)[];
  finished: boolean;
}

export interface Score {
  kind: 'goal' | 'explore';
  /** goal cases: 40 if reached, 0–20 for keeping it; explore cases: 0–60 for tasks done */
  reached: number; kept: number; tasks: number; tasksDone: number; nTasks: number;
  answers: number; total: number; correct: number; nQuestions: number;
}
