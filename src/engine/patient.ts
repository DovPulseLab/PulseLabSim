/* One live patient: inputs ease to their targets, drugs act over time, and a
   new steady-state beat is solved at the start of every heartbeat. */
import { simulate, type BeatResult } from '../model/solve';
import { detectFeatures, type FeaturePoints } from '../model/features';
import { type Params } from '../config/physiology';
import { inputsAt, retarget, type Ramps } from './transition';
import { applyDrugEffects, type DrugEvent, type EffectResult } from './kinetics';
import { TrendBuffer } from './trends';

export interface Beat {
  index: number;
  tStart: number;        // s
  inputs: Params;        // eased inputs before drugs
  effect: EffectResult;  // after drugs (effect.params is what was simulated)
  res: BeatResult;
  features: FeaturePoints;
}

export interface PatientSim {
  targets: Params;       // what the user set
  current: Params;       // eased inputs used on the last beat
  ramps: Ramps;
  events: DrugEvent[];
  beat: number;          // index of the last generated beat
  nextT: number;         // clock time the next beat starts
  last: Beat | null;
  trend: TrendBuffer;
}

export function newPatientSim(targets: Params, events: DrugEvent[] = [], t = 0): PatientSim {
  return { targets: { ...targets }, current: { ...targets }, ramps: {}, events: [...events], beat: 0, nextT: t, last: null, trend: new TrendBuffer() };
}

/** Change the user's inputs; the change eases in over the next 3 beats. */
export function setTargets(sim: PatientSim, targets: Params): PatientSim {
  return { ...sim, ramps: retarget(sim.ramps, sim.current, targets, sim.beat), targets: { ...targets } };
}

export function setEvents(sim: PatientSim, events: DrugEvent[]): PatientSim {
  return { ...sim, events: [...events] };
}

/** Generate the next beat. The trend buffer is appended in place. */
export function nextBeat(sim: PatientSim): { sim: PatientSim; beat: Beat } {
  const index = sim.beat + 1;
  const { params: inputs, ramps } = inputsAt(sim.targets, sim.ramps, index);
  const effect = applyDrugEffects(inputs, sim.events, sim.nextT);
  const res = simulate(effect.params);
  const features = detectFeatures(res.p, res.d.T, res.d.ET);
  const m = res.m;
  sim.trend.push({
    t: sim.nextT, hr: effect.params.hr, sbp: m.bSBP, dbp: m.bDBP, map: m.map, pp: m.bPP,
    cSBP: m.Ps, cDBP: m.Pd, cPP: m.PP, bPP: m.bPP, aix: m.AIx, pwv: m.cAoOp
  });
  const beat: Beat = { index, tStart: sim.nextT, inputs, effect, res, features };
  return { sim: { ...sim, current: inputs, ramps, beat: index, nextT: sim.nextT + res.d.T, last: beat }, beat };
}

/** Generate every beat due by clock time t (at most maxBeats; skips ahead if further behind). */
export function catchUp(sim: PatientSim, t: number, maxBeats = 4): { sim: PatientSim; beats: Beat[] } {
  const beats: Beat[] = [];
  let s = sim;
  while (s.nextT <= t && beats.length < maxBeats) {
    const r = nextBeat(s);
    s = r.sim; beats.push(r.beat);
  }
  if (s.nextT <= t) s = { ...s, nextT: t };   // too far behind: resume from now
  return { sim: s, beats };
}
