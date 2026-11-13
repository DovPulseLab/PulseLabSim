/* =====================================================================
   Synchronized waveform export at a fixed sampling rate. Pure.

   The solver computes one periodic steady-state beat on PHYS.N (1024)
   points, i.e. 1 200 Hz at 70 bpm and 3 070 Hz at 180 bpm. For export the
   beat is resampled onto a uniform time grid at the requested rate (200 Hz
   or more) by periodic linear interpolation, and repeated for the requested
   number of beats. Pressure and flow share one time axis, so every row is
   a synchronized pressure–flow sample.

   Time 0 = start of ejection (aortic valve opening) of the first beat, the
   same origin as the solver. Values are model outputs, not measurements.
   ===================================================================== */
import type { BeatResult } from './solve';

export const EXPORT_RATES = [200, 250, 500, 1000, 2000] as const;
export const EXPORT_BEATS = [1, 3, 5, 10] as const;
export const DEFAULT_RATE = 1000;
export const DEFAULT_BEATS = 3;

export interface Resampled {
  fs: number;          // Hz
  beats: number;
  T: number;           // s, cycle length
  t: number[];         // s
  beat: number[];      // 1-based beat number
  p: number[];         // central aortic pressure, mmHg
  q: number[];         // aortic flow, mL/s
  pf: number[];        // forward pressure wave, mmHg
  pb: number[];        // backward (reflected) pressure wave, mmHg
  brachial: number[];  // intra-arterial brachial pressure, mmHg
  radial: number[];    // radial pressure, mmHg
  dpdt: number[];      // dP/dt of aortic pressure, mmHg/s
  /** present only with the v3 ventricle */
  lv?: { p: number[]; vol: number[]; qm: number[]; dpdt: number[] };
}

/** Periodic linear interpolation of a beat sampled at k·dt (k = 0…N−1) at time t. */
export function periodicInterp(y: readonly number[], dt: number, t: number): number {
  const N = y.length, T = N * dt;
  let u = (t % T) / dt; if (u < 0) u += N;
  const i = Math.floor(u), f = u - i;
  return y[i % N] * (1 - f) + y[(i + 1) % N] * f;
}

/** Central-difference derivative of a periodic signal. */
export function periodicDerivative(y: readonly number[], dt: number): number[] {
  const N = y.length;
  return y.map((_, k) => (y[(k + 1) % N] - y[(k - 1 + N) % N]) / (2 * dt));
}

export function resampleBeat(r: BeatResult, fs = DEFAULT_RATE, beats = DEFAULT_BEATS): Resampled {
  if (!(fs >= 200)) throw new Error('sampling rate must be at least 200 Hz');
  if (!(beats >= 1) || !Number.isInteger(beats)) throw new Error('beats must be a positive integer');
  const T = r.d.T, dt = r.dt, n = Math.round(fs * T * beats);
  const dp = periodicDerivative(r.p, dt);
  const out: Resampled = { fs, beats, T, t: [], beat: [], p: [], q: [], pf: [], pb: [], brachial: [], radial: [], dpdt: [] };
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    out.t.push(t);
    out.beat.push(Math.min(beats, Math.floor(t / T) + 1));
    out.p.push(periodicInterp(r.p, dt, t));
    out.q.push(periodicInterp(r.q, dt, t));
    out.pf.push(periodicInterp(r.pf, dt, t));
    out.pb.push(periodicInterp(r.pb, dt, t));
    out.brachial.push(periodicInterp(r.brachial, dt, t));
    out.radial.push(periodicInterp(r.radial, dt, t));
    out.dpdt.push(periodicInterp(dp, dt, t));
  }
  if (r.lv) {
    const L = r.lv, dl = periodicDerivative(L.p, dt);
    const lv = { p: [] as number[], vol: [] as number[], qm: [] as number[], dpdt: [] as number[] };
    for (const t of out.t) {
      lv.p.push(periodicInterp(L.p, dt, t)); lv.vol.push(periodicInterp(L.vol, dt, t));
      lv.qm.push(periodicInterp(L.qm, dt, t)); lv.dpdt.push(periodicInterp(dl, dt, t));
    }
    out.lv = lv;
  }
  return out;
}

/** Column layout of the waveform sheet (header, unit, accessor). */
export const WAVE_COLUMNS: [string, string, (w: Resampled, i: number) => number][] = [
  ['sample', '', (_w, i) => i],
  ['time', 's', (w, i) => w.t[i]],
  ['beat', '', (w, i) => w.beat[i]],
  ['aortic_pressure', 'mmHg', (w, i) => w.p[i]],
  ['aortic_flow', 'mL/s', (w, i) => w.q[i]],
  ['forward_pressure', 'mmHg', (w, i) => w.pf[i]],
  ['backward_pressure', 'mmHg', (w, i) => w.pb[i]],
  ['aortic_dPdt', 'mmHg/s', (w, i) => w.dpdt[i]],
  ['brachial_pressure', 'mmHg', (w, i) => w.brachial[i]],
  ['radial_pressure', 'mmHg', (w, i) => w.radial[i]]
];


/** Extra columns written when the v3 ventricle is on. */
export const LV_COLUMNS: [string, string, (w: Resampled, i: number) => number][] = [
  ['lv_pressure', 'mmHg', (w, i) => w.lv!.p[i]],
  ['lv_volume', 'mL', (w, i) => w.lv!.vol[i]],
  ['mitral_flow', 'mL/s', (w, i) => w.lv!.qm[i]],
  ['lv_dPdt', 'mmHg/s', (w, i) => w.lv!.dpdt[i]]
];

/** Columns for one patient's sheet: the arterial set, plus the LV set when modelled. */
export const waveColumns = (w: Resampled) => (w.lv ? [...WAVE_COLUMNS, ...LV_COLUMNS] : WAVE_COLUMNS);
