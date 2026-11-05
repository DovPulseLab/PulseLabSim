/* Smooth input changes: each change eases to its new value over 3 beats (cosine ease). */
import { ENGINE, type Params, type ParamKey } from '../config/physiology';

export interface Ramp {
  from: number;
  to: number;
  startBeat: number;   // beat index of the last beat at the old value
  beats: number;
}
export type Ramps = Partial<Record<ParamKey, Ramp>>;

/** Cosine ease, 0 → 1, monotonic. */
export const ease = (x: number): number => {
  const c = Math.min(1, Math.max(0, x));
  return (1 - Math.cos(Math.PI * c)) / 2;
};

/** Value of a ramp on beat `beat`. Beat startBeat + beats is exactly `to`. */
export function rampValue(r: Ramp, beat: number): number {
  const n = beat - r.startBeat;
  if (n <= 0) return r.from;
  if (n >= r.beats) return r.to;
  return r.from + (r.to - r.from) * ease(n / r.beats);
}

/**
 * Start ramps for every input whose target differs from the current value.
 * current: inputs used on the last generated beat (beat index lastBeat).
 */
/** Inputs that switch at once instead of easing: sex is male or female, never between, and
 *  age and weight only describe the patient (they act through calibration, not the beat). */
const STEP_KEYS: ReadonlySet<ParamKey> = new Set<ParamKey>(['sex', 'age', 'weight']);

export function retarget(ramps: Ramps, current: Params, targets: Params, lastBeat: number, beats: number = ENGINE.rampBeats): Ramps {
  const next: Ramps = { ...ramps };
  for (const key of Object.keys(targets) as ParamKey[]) {
    if (STEP_KEYS.has(key)) { delete next[key]; continue; }
    const existing = next[key];
    const goal = existing ? existing.to : current[key];
    if (targets[key] === goal) continue;
    next[key] = { from: current[key], to: targets[key], startBeat: lastBeat, beats };
  }
  return next;
}

/** Inputs for beat `beat`; finished ramps are dropped. */
export function inputsAt(targets: Params, ramps: Ramps, beat: number): { params: Params; ramps: Ramps } {
  const params: Params = { ...targets };
  const left: Ramps = {};
  for (const key of Object.keys(ramps) as ParamKey[]) {
    const r = ramps[key]!;
    params[key] = rampValue(r, beat);
    if (beat - r.startBeat < r.beats) left[key] = r;
  }
  return { params, ramps: left };
}
