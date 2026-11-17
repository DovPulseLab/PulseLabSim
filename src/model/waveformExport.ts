/* =====================================================================
   Synchronized waveform export at a fixed sampling rate. Pure.

   The solver computes one periodic steady-state beat on PHYS.N (1024)
   points, i.e. 1 200 Hz at 70 bpm and 3 070 Hz at 180 bpm. For export the
   beat is resampled onto a uniform time grid at the requested rate (200 Hz
   or more) by periodic linear interpolation, and repeated for the requested
   number of beats. Pressure and flow share one time axis, so every row is
   a synchronized pressure–flow sample.

   Time origin. With the Ventricle (v3) heart, time 0 = onset of contraction
   (end-diastole, LVEDP) of the first beat, so each beat holds the whole LV
   pressure waveform in order: isovolumic contraction from LVEDP, ejection,
   isovolumic relaxation and filling. With the fixed-flow (v2) heart there is
   no LV, and time 0 = start of ejection (aortic valve opening), the solver's
   own origin.

   dP/dt. Computed on the exported samples with a 5-point Savitzky–Golay
   first-derivative filter (least-squares quadratic over 5 samples):
       dP/dt(i) = [−2P(i−2) − P(i−1) + P(i+1) + 2P(i+2)] / (10 Δt)
   i.e. a 5-point moving filter that smooths and differentiates in one step,
   as used for catheter pressure. At 500 Hz the window is 8 ms. Because the
   beat is periodic, samples either side of the file's ends come from the
   neighbouring beats, so the first and last rows are not truncated.
   Values are model outputs, not measurements.
   ===================================================================== */
import type { BeatResult } from './solve';

export const EXPORT_RATES = [200, 250, 500, 1000, 2000] as const;
export const EXPORT_BEATS = [1, 3, 5, 10] as const;
export const DEFAULT_RATE = 500;
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
  dpdt: number[];      // dP/dt of aortic pressure, mmHg/s (5-point filter)
  /** s, time on the solver grid (0 = start of ejection) that export time 0 maps to */
  t0: number;
  origin: 'end-diastole' | 'ejection';
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

/** 5-point Savitzky–Golay first derivative (quadratic, window 5) of a uniformly sampled
 *  signal. `at(i)` returns sample i and may be called for i outside the record (periodic beat). */
export function sg5Derivative(at: (i: number) => number, n: number, h: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((-2 * at(i - 2) - at(i - 1) + at(i + 1) + 2 * at(i + 2)) / (10 * h));
  return out;
}

export interface ResampleOptions {
  /** 'auto' (default): end-diastole with the v3 ventricle, start of ejection otherwise */
  origin?: 'auto' | 'end-diastole' | 'ejection';
}

export function resampleBeat(r: BeatResult, fs = DEFAULT_RATE, beats = DEFAULT_BEATS, opts: ResampleOptions = {}): Resampled {
  if (!(fs >= 200)) throw new Error('sampling rate must be at least 200 Hz');
  if (!(beats >= 1) || !Number.isInteger(beats)) throw new Error('beats must be a positive integer');
  const T = r.d.T, dt = r.dt, n = Math.round(fs * T * beats), h = 1 / fs;
  const want = opts.origin ?? 'auto';
  const ed = want === 'end-diastole' || (want === 'auto' && r.lv?.tOnset != null);
  if (ed && r.lv?.tOnset == null) throw new Error('end-diastolic origin needs the v3 ventricle');
  const t0 = ed ? r.lv!.tOnset! : 0;
  const at = (y: readonly number[]) => (i: number) => periodicInterp(y, dt, t0 + i * h);
  const series = (y: readonly number[]) => { const f = at(y), o: number[] = []; for (let i = 0; i < n; i++) o.push(f(i)); return o; };
  const out: Resampled = {
    fs, beats, T, t0, origin: ed ? 'end-diastole' : 'ejection',
    t: Array.from({ length: n }, (_, i) => i * h),
    beat: Array.from({ length: n }, (_, i) => Math.min(beats, Math.floor(i * h / T + 1e-9) + 1)),
    p: series(r.p), q: series(r.q), pf: series(r.pf), pb: series(r.pb), brachial: series(r.brachial), radial: series(r.radial),
    dpdt: sg5Derivative(at(r.p), n, h)
  };
  if (r.lv) {
    const L = r.lv;
    out.lv = { p: series(L.p), vol: series(L.vol), qm: series(L.qm), dpdt: sg5Derivative(at(L.p), n, h) };
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
