/* Single app state with subscribe/emit and undo/redo for input changes and drug events.
   The reducer is pure; createStore wraps it. */
import { ALL_DRUGS, DEFAULTS, DRUG_KINETICS, PRESETS, weisslerMs, type DrugMode, type Params, type ParamKey } from '../config/physiology';
import type { Warp } from '../engine/clock';
import type { DrugEvent } from '../engine/kinetics';
import { newHistory, record, redo, undo, type History } from './history';
import { checkInput } from './inputs';
import { applyCalibration, DEMOGRAPHIC_KEYS } from '../model/calibrate';
import { defaultState, newPatient, type AppState, type PatientId, type PatientState, type TabId } from './types';

export type Action =
  | { type: 'setInput'; key: ParamKey; value: unknown; coalesce?: string }
  | { type: 'loadPreset'; preset: string }
  | { type: 'resetPatient' }
  | { type: 'giveDrug'; drug: string; mode: DrugMode; dose?: number; steady?: boolean; rampS?: number }
  | { type: 'stopDrug'; id: number }
  | { type: 'removeDrug'; id: number }
  | { type: 'setPatients'; patients: Record<PatientId, PatientState> }
  | { type: 'setTab'; tab: TabId }
  | { type: 'setActive'; patient: PatientId }
  | { type: 'pin'; params: Params }
  | { type: 'clearPin' }
  | { type: 'setClock'; t: number }
  | { type: 'setWarp'; warp: Warp }
  | { type: 'setPaused'; paused: boolean }
  | { type: 'replace'; state: AppState }
  | { type: 'undo' }
  | { type: 'redo' };

/** Actions that change inputs or drug events, and so can be undone. */
const UNDOABLE = new Set<Action['type']>(['setInput', 'loadPreset', 'resetPatient', 'giveDrug', 'stopDrug', 'removeDrug', 'setPatients']);

type Patients = AppState['patients'];

export interface StoreState {
  app: AppState;
  history: History<Patients>;
  /** messages for the user from the last action (clamped input, unknown drug, …) */
  warnings: string[];
}

const clonePatients = (p: Patients): Patients => structuredClone(p);

function updateActive(s: AppState, fn: (p: PatientState) => PatientState): AppState {
  return { ...s, patients: { ...s.patients, [s.active]: fn(s.patients[s.active]) } };
}

/** Set one input. Sex, age, height or weight recalibrate aortic diameter, aortic PWV and
 *  stroke volume (src/model/calibrate.ts); a sex change keeps the ejection time in ms. */
export function withInput(inputs: Params, key: ParamKey, value: number): Params {
  if (inputs[key] === value) return inputs;
  let next: Params = { ...inputs, [key]: value };
  if (key === 'sex') {
    const ms = inputs.etScale * weisslerMs(inputs.hr, inputs.sex);
    next.etScale = checkInput('etScale', Number((ms / weisslerMs(next.hr, next.sex)).toFixed(6))).value;
  }
  if ((DEMOGRAPHIC_KEYS as readonly string[]).includes(key)) next = applyCalibration(next);
  return next;
}

/** Apply one action to the app state (no history). */
export function reduceApp(s: AppState, a: Action): { app: AppState; warnings: string[] } {
  switch (a.type) {
    case 'setInput': {
      const r = checkInput(a.key, a.value);
      return { app: updateActive(s, p => ({ ...p, inputs: withInput(p.inputs, a.key, r.value) })), warnings: r.warning ? [r.warning] : [] };
    }
    case 'loadPreset': {
      if (!(a.preset in PRESETS)) return { app: s, warnings: [`Unknown profile "${a.preset}"`] };
      return { app: updateActive(s, p => ({ ...p, preset: a.preset, inputs: { ...DEFAULTS, ...PRESETS[a.preset] } })), warnings: [] };
    }
    case 'resetPatient':
      return { app: updateActive(s, () => newPatient()), warnings: [] };
    case 'giveDrug': {
      const k = DRUG_KINETICS[a.drug];
      if (!ALL_DRUGS[a.drug] || !k) return { app: s, warnings: [`Unknown drug "${a.drug}"`] };
      if (!k.modes.includes(a.mode)) return { app: s, warnings: [`${ALL_DRUGS[a.drug].label} cannot be given as a ${a.mode}`] };
      const ev: DrugEvent = { id: s.nextEventId, drug: a.drug, mode: a.mode, t0: s.t, tStop: null, dose: Math.min(2, Math.max(0.25, a.dose ?? 1)) };
      if (a.steady && k.chronic) { ev.steady = true; ev.rampS = a.rampS ?? 0; }
      return { app: { ...updateActive(s, p => ({ ...p, events: [...p.events, ev] })), nextEventId: s.nextEventId + 1 }, warnings: [] };
    }
    case 'stopDrug':
      return { app: updateActive(s, p => ({ ...p, events: p.events.map(e => e.id === a.id && e.mode === 'infusion' && e.tStop == null ? { ...e, tStop: s.t } : e) })), warnings: [] };
    case 'removeDrug':
      return { app: updateActive(s, p => ({ ...p, events: p.events.filter(e => e.id !== a.id) })), warnings: [] };
    case 'setPatients': {
      const maxId = Math.max(0, ...Object.values(a.patients).flatMap(p => p.events.map(e => e.id)));
      return { app: { ...s, patients: a.patients, nextEventId: Math.max(s.nextEventId, maxId + 1) }, warnings: [] };
    }
    case 'setTab': return { app: { ...s, tab: a.tab }, warnings: [] };
    case 'setActive': return { app: { ...s, active: a.patient }, warnings: [] };
    case 'pin': return { app: { ...s, pinned: { patient: s.active, params: { ...a.params } } }, warnings: [] };
    case 'clearPin': return { app: { ...s, pinned: null }, warnings: [] };
    case 'setClock': return { app: { ...s, t: a.t }, warnings: [] };
    case 'setWarp': return { app: { ...s, warp: a.warp }, warnings: [] };
    case 'setPaused': return { app: { ...s, paused: a.paused }, warnings: [] };
    case 'replace': return { app: a.state, warnings: [] };
    case 'undo': case 'redo': return { app: s, warnings: [] };
  }
}

/** Full reducer including undo/redo. Pure. */
export function reduce(st: StoreState, a: Action): StoreState {
  if (a.type === 'undo' || a.type === 'redo') {
    const r = (a.type === 'undo' ? undo : redo)(st.history, clonePatients(st.app.patients));
    if (!r) return { ...st, warnings: [] };
    return { app: { ...st.app, patients: r.state }, history: r.history, warnings: [] };
  }
  const { app, warnings } = reduceApp(st.app, a);
  if (app === st.app) return { ...st, warnings };
  const history = UNDOABLE.has(a.type)
    ? record(st.history, clonePatients(st.app.patients), a.type === 'setInput' && a.coalesce ? `${st.app.active}:${a.coalesce}` : null)
    : st.history;
  return { app, history, warnings };
}

export interface Store {
  get(): StoreState;
  dispatch(a: Action): void;
  subscribe(fn: (s: StoreState, a: Action) => void): () => void;
}

export function createStore(initial: AppState = defaultState()): Store {
  let st: StoreState = { app: initial, history: newHistory(), warnings: [] };
  const subs = new Set<(s: StoreState, a: Action) => void>();
  return {
    get: () => st,
    dispatch(a) { st = reduce(st, a); subs.forEach(fn => fn(st, a)); },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
  };
}
