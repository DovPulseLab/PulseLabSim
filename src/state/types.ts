import { DEFAULTS, PRESETS, type Params } from '../config/physiology';
import type { DrugEvent } from '../engine/kinetics';
import type { Warp } from '../engine/clock';

export type PatientId = 'A' | 'B';
export const TABS = ['sim', 'cycle', 'cmp', 'learn', 'sweep', 'imp', 'valid', 'eq'] as const;
export type TabId = (typeof TABS)[number];

export interface PatientState {
  preset: string;
  inputs: Params;          // what the user set (targets)
  events: DrugEvent[];
}

export interface Pinned {
  patient: PatientId;
  params: Params;          // effective inputs of the pinned beat (re-simulated exactly)
}

export interface AppState {
  tab: TabId;
  active: PatientId;
  patients: Record<PatientId, PatientState>;
  pinned: Pinned | null;
  t: number;               // clock time, s
  warp: Warp;
  paused: boolean;
  nextEventId: number;
}

export const newPatient = (preset = 'Default adult (45 y)'): PatientState =>
  ({ preset, inputs: { ...DEFAULTS, ...(PRESETS[preset] ?? {}) }, events: [] });

export const defaultState = (): AppState => ({
  tab: 'sim', active: 'A',
  patients: { A: newPatient('Default adult (45 y)'), B: newPatient('Older adult (70 y)') },
  pinned: null, t: 0, warp: 1, paused: false, nextEventId: 1
});
