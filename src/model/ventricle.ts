/* =====================================================================
   v3 · Time-varying elastance left ventricle coupled to the v2 arterial
   model. Pure.

   LV pressure (active + passive, stage 2):
       P_LV = [en(t) · Ees · (V − V0)  +  (1 − en(t)) · P_ED(V)] · (1 − ks·Q_out)
   en(t)  normalized double-Hill activation (Stergiopulos et al. 1996),
          peak 1 at Tmax = (0.2 + 0.15 · T70) × tmaxScale × LVET(HR) / LVET(70),
          LVET = Weissler LVET with the v2 limits (≥ 150 ms, ≤ 60 % of the
          cycle), so systole shortens with heart rate as v2's ejection does
          and relaxation still finishes before the next beat at 180 bpm
   P_ED   end-diastolic pressure–volume relation (EDPVR), exponential in
          volume index:  P_ED(V) = Pref · exp(a · (V/BSA − EDVIref))
          with a and EDVIref from Fujimoto et al. 2012 by age (healthy
          sedentary adults, MRI EDV) and, since v3.2, Pref = 8 mmHg (normal
          controls' LVEDP, Mulligan 2026) instead of Fujimoto's PCWP.
   ks     ejection effect / source resistance (Shroff et al. 1985)

   Valves: aortic Q = (P_LV − P_Ao)/R_AV and mitral Q = (P_LA − P_LV)/R_MV,
   forward only. P_LA is constant over the beat and is solved so the beat is
   periodic with the requested preload (EDV); it is the model's mean
   left-atrial (≈ wedge) pressure. LVEDP = P_LV at mitral closure.

   Arterial side: unchanged v2 input impedance Zin(ω), split into the
   instantaneous characteristic impedance and a delayed part:
       P_Ao(t) = Zc · Q(t) + P_del(t)
   P_del is iterated to a fixed point; valve and chamber equations are solved
   implicitly with it at every step, which keeps the stiff Zc coupling stable.

   Internal time 0 = onset of contraction; the arterial output is rotated so
   index 0 = start of ejection, as in v2.
   ===================================================================== */
import { DEFAULTS, MODEL, PHYS, type Params } from '../config/physiology';
import { bsaDuBois, interp, registerV3Fits } from './calibrate';
import { cx, type Cx } from './complex';
import { derive, weisslerLVET, type Derived } from './derive';
import { fft } from './fft';
import { inputImpedance, simulateWithFlow, type BeatResult } from './solve';

/** Fujimoto et al. 2012 (J Physiol 590:1871), Tables 1–2, healthy sedentary adults by age group:
 *  mean age, PCWP (mmHg), MRI LVEDV index (mL/m²), LV stiffness constant a (per mL/m²), EF. */
export const FUJIMOTO_2012 = {
  age:  [28, 42, 57, 69],
  pcwp: [12.7, 11.9, 11.9, 11.1],
  edvi: [66.1, 60.2, 59.5, 49.9],
  a:    [0.038, 0.053, 0.067, 0.068],
  ef:   [0.65, 0.67, 0.72, 0.72],
  n:    [14, 19, 23, 14]
} as const;
const fj = (ys: readonly number[], age: number) => interp(FUJIMOTO_2012.age.map((a, i) => [a, ys[i]] as const), age);
/** EDPVR for an age: passes through LVEDP_REF at that age's EDV index; slope from the stiffness constant. */
/** v3.2: healthy resting LVEDP at the age-typical EDV, mmHg. Invasive LVEDP in normal controls is
 *  8 ± 3 mmHg (and 7 mmHg in controls without diastolic HF); Mulligan's working range for normal
 *  adults is 5–12 mmHg and 6–12 mmHg for healthy older adults (LV_REFERENCE). Fujimoto's supine PCWP
 *  in sedentary volunteers (11–13 mmHg, no age trend) sits at the top of that range, so v3.2 keeps
 *  Fujimoto's EDV index and stiffness constant by age but passes the EDPVR through 8 mmHg there. */
export const LVEDP_REF = 8;
export const edpvrForAge = (age: number) => ({ pRef: LVEDP_REF, a: fj(FUJIMOTO_2012.a, age), edviRef: fj(FUJIMOTO_2012.edvi, age) });
export const edviForAge = (age: number) => fj(FUJIMOTO_2012.edvi, age);

export interface LVParams {
  ees: number;       // end-systolic (peak) elastance, mmHg/mL
  v0: number;        // ESPVR volume intercept, mL
  edv: number;       // end-diastolic volume at the start of contraction (preload), mL
  bsa: number;       // m², scales the EDPVR (volume index)
  pRef: number;      // EDPVR: pressure at the reference volume index, mmHg
  a: number;         // EDPVR stiffness constant, per mL/m²
  edviRef: number;   // EDPVR reference volume index, mL/m²
  rav: number;       // aortic valve resistance, mmHg·s/mL
  rmv: number;       // mitral valve resistance, mmHg·s/mL
  tmaxScale: number; // multiplier on Tmax = 0.2 + 0.15·T
  ks: number;        // ejection effect coefficient, s/mL (Shroff 1985)
  shape: HillShape;  // activation curve shape
}

/** Double-Hill activation shape (Stergiopulos 1996 defaults: rise centre 0.7, exponent 1.9;
 *  relaxation centre 1.17, exponent 21.9), x = t / Tmax. */
export interface HillShape {
  c1: number; n1: number; c2: number; n2: number;
  /** v3.2: exponential relaxation time constant, as a fraction of Tmax. When set, the activation
   *  follows the Hill curve until its fractional rate of fall −e′/e reaches 1/tauX, then decays as
   *  exp(−Δx/tauX) (value and slope continuous). Isovolumic pressure then falls exponentially from
   *  just after aortic closure, as measured (Weiss 1976), so −dP/dt and τ can both be normal. */
  tauX?: number;
}
export const STERGIOPULOS: Readonly<HillShape> = { c1: 0.7, n1: 1.9, c2: 1.17, n2: 21.9 };
const hillRaw = (x: number, h: HillShape) => { const a = Math.pow(x / h.c1, h.n1), b = Math.pow(x / h.c2, h.n2); return (a / (1 + a)) * (1 / (1 + b)); };
const shapeCache = new Map<string, { peak: number; xd: number; ed: number }>();
/** Peak of the Hill curve and, with tauX, the join point xd (and raw value ed there). */
function shapeInfo(h: HillShape) {
  const key = `${h.c1},${h.n1},${h.c2},${h.n2},${h.tauX ?? ''}`; let s = shapeCache.get(key);
  if (!s) {
    let peak = 0, xPeak = 0; for (let i = 1; i <= 6000; i++) { const v = hillRaw(i / 2000, h); if (v > peak) { peak = v; xPeak = i / 2000; } }
    let xd = Infinity, ed = 0;
    if (h.tauX) {
      const dx = 1e-5;
      for (let x = xPeak; x < 4; x += 0.0005) {
        const e = hillRaw(x, h), rate = -(hillRaw(x + dx, h) - hillRaw(x - dx, h)) / (2 * dx) / e;
        if (rate >= 1 / h.tauX) { xd = x; ed = e; break; }
      }
    }
    s = { peak, xd, ed }; shapeCache.set(key, s);
  }
  return s;
}
/** Normalized activation, peak = 1. */
export const elastanceShape = (x: number, h: HillShape = STERGIOPULOS): number => {
  if (x <= 0) return 0;
  const s = shapeInfo(h);
  return (x <= s.xd ? hillRaw(x, h) : s.ed * Math.exp(-(x - s.xd) / h.tauX!)) / s.peak;
};
/** Time of peak activation, s. Stergiopulos' 0.2 + 0.15·T at 70 bpm, scaled with heart rate by the
 *  Weissler LVET (clamped as in v2: ≥ etMin, ≤ etMaxFrac of the cycle). Before v3 stage 5 Tmax was
 *  0.2 + 0.15·T at every rate, which left the ventricle partly contracted at the next beat above
 *  ≈ 130 bpm (filling pressure 21 mmHg at 140 bpm, 60 mmHg at 180). Identical at 70 bpm. */
export const tMax = (T: number, scale = 1, sex = 0): number => {
  const hr = 60 / T, lvet = (h: number) => Math.min(Math.max(weisslerLVET(h, sex), MODEL.etMin), MODEL.etMaxFrac * 60 / h);
  return (0.2 + 0.15 * (60 / 70)) * scale * lvet(hr) / lvet(70);
};

/** Activation shape and ejection effect. v3 stage 3 fitted them to Zhang & Kovács 2009 (dP/dt max
 *  1 000–1 500, −dP/dt −1 200 to −1 800 mmHg/s). v3.2 recalibrates to Dr L. Mulligan's reference summary
 *  of human LV hemodynamics (LV_REFERENCE): normal adults dP/dt max 1 200–2 000 and −dP/dt −1 500 to
 *  −2 200 mmHg/s, LVEDP 5–12 mmHg; invasive normal controls 1 563 ± 123, −1 937 ± 385 mmHg/s, 8 ± 3 mmHg.
 *  Changes: faster rise (c1 0.55 → 0.40), sharper end of systole (n2 15.5 → 25) with an exponential
 *  relaxation tail (tauX, by age, see relaxForAge) so isovolumic pressure falls exponentially from just
 *  after aortic closure (Weiss 1976) and τ stays ≈ 40 ms, and Tmax × 1.00 (was 1.05) for ejection ≈ 300 ms.
 *  V0 = −20 mL as before (Ea/Ees ≈ 0.6–0.9; Chen 1998). Result for the healthy man of 45 y: Ees 1.99,
 *  dP/dt max 1 512, −dP/dt −2 038 mmHg/s, τ 40 ms, LVEDP 8 mmHg, IVCT 65 ms, LVET 300 ms, IVRT 105 ms. */
export const V3_SHAPE: Readonly<HillShape> = { c1: 0.40, n1: 1.9, c2: 1.17, n2: 25, tauX: 0.115 };
export const LV_FIXED: Omit<LVParams, 'edv' | 'bsa' | 'pRef' | 'a' | 'edviRef'> = { ees: 2.10, v0: -20, rav: 0.0025, rmv: 0.006, tmaxScale: 1.0, ks: 0.0009, shape: V3_SHAPE };

/** v3.2: relaxation time constant (fraction of Tmax) by age. 0.115 gives τ ≈ 40 ms and −dP/dt ≈ −2 000
 *  mmHg/s up to 45 y (normal controls −1 937 ± 385; Mulligan normal range −1 500 to −2 200). Relaxation
 *  slows modestly with age (τ ≈ 46–48 ms at 65–80 y) so −dP/dt moves toward Mulligan's healthy-older range
 *  (−1 200 to −1 900). Linear between the ages, flat outside 45–80 y. */
export const RELAX_BY_AGE = { ages: [45, 65, 80], tauX: [0.115, 0.135, 0.14] } as const;
export const relaxForAge = (age: number) => interp(RELAX_BY_AGE.ages.map((a, i) => [a, RELAX_BY_AGE.tauX[i]] as const), age);

/** Patient-dependent ventricle: EDPVR and EDV from Fujimoto by age, scaled by BSA; relaxation by age. */
export function lvForPatient(p: Pick<Params, 'age' | 'height' | 'weight'>): LVParams {
  const bsa = bsaDuBois(p.height, p.weight), ed = edpvrForAge(p.age);
  return { ...LV_FIXED, bsa, ...ed, edv: ed.edviRef * bsa, shape: { ...V3_SHAPE, tauX: relaxForAge(p.age) } };
}


export interface LVResult {
  beat: BeatResult;          // arterial solution, index 0 = start of ejection (as v2)
  lv: number[];              // LV pressure, same grid and origin as beat.p, mmHg
  vol: number[];             // LV volume, mL
  qm: number[];              // mitral inflow, mL/s
  sv: number; esv: number; edv: number; ef: number;
  lvedp: number; lvesp: number; lvsp: number; pla: number;   // mmHg
  dpdtMax: number; dpdtMin: number;                          // mmHg/s
  ivct: number; lvet: number; ivrt: number; tmax: number;    // s
  tau: number;               // s, isovolumic relaxation time constant (zero asymptote)
  peakE: number;             // mL/s, peak mitral inflow
  ea: number;                // effective arterial elastance = LVESP / SV, mmHg/mL
  tOnset: number;            // s, onset of contraction (end-diastole) on the output grid (origin = start of ejection)
  lvp: LVParams;
  /** solver state on the internal grid (0 = onset of contraction), for the transient (vena caval occlusion) model */
  internal: { q: Float64Array; en: number[]; dt: number; d: Derived; zc: number; params: Params };
  iterations: number; converged: boolean;
}

function zinTable(d: Derived, N: number): Cx[] {
  const out: Cx[] = [];
  for (let k = 0; k <= N / 2; k++) out.push(k === 0 ? cx(d.svr, 0) : inputImpedance(d, k / d.T));
  return out;
}

/** Aortic pressure for a periodic flow via the input impedance (DC term = SVR · mean flow). */
function pressureFromFlow(q: Float64Array, zin: Cx[]): Float64Array {
  const N = q.length, re = Float64Array.from(q), im = new Float64Array(N);
  fft(re, im, false);
  for (let k = 0; k <= N / 2; k++) {
    const z = zin[k], a = re[k], b = im[k];
    re[k] = a * z.r - b * z.i; im[k] = a * z.i + b * z.r;
    if (k > 0 && k < N / 2) { re[N - k] = re[k]; im[N - k] = -im[k]; }
  }
  fft(re, im, true);
  return re;
}

interface Pass { q: Float64Array; qm: Float64Array; V: Float64Array; P: Float64Array; vEnd: number; }

/** One beat of the chamber against the delayed arterial pressure and a constant LA pressure. */
function chamberPass(lv: LVParams, en: number[], pdel: Float64Array, zc: number, pla: number, dt: number): Pass {
  const N = en.length, q = new Float64Array(N), qm = new Float64Array(N), V = new Float64Array(N), P = new Float64Array(N);
  const ped = (v: number) => lv.pRef * Math.exp(lv.a * (v / lv.bsa - lv.edviRef));
  let v = lv.edv, ejecting = false, ejDone = false;
  for (let k = 0; k < N; k++) {
    const e = en[k], pp = ped(v);
    const piso = e * lv.ees * (v - lv.v0) + (1 - e) * pp;
    const dPdV = e * lv.ees + (1 - e) * pp * lv.a / lv.bsa;
    let qa = 0, qi = 0;
    if (!ejDone) {
      const qTry = (piso - pdel[k]) / (lv.rav + zc + dPdV * dt + piso * lv.ks);
      if (qTry > 0) { qa = qTry; ejecting = true; } else if (ejecting) ejDone = true;
    }
    if (qa === 0) { const qTry = (pla - piso) / (lv.rmv + dPdV * dt); if (qTry > 0) qi = qTry; }
    v += (qi - qa) * dt;
    q[k] = qa; qm[k] = qi; V[k] = v;
    P[k] = (e * lv.ees * (v - lv.v0) + (1 - e) * ped(v)) * (1 - lv.ks * qa);
  }
  return { q, qm, V, P, vEnd: v };
}

/** Left-atrial pressure that makes the beat periodic (V at the end = EDV at the start). */
function solvePLA(lv: LVParams, en: number[], pdel: Float64Array, zc: number, dt: number, guess: number): { pla: number; pass: Pass } {
  let lo = 0.2, hi = 60;
  if (guess > lo + 2 && guess < hi - 2) {      // bracket around the previous solution
    const a = chamberPass(lv, en, pdel, zc, guess - 2, dt), b = chamberPass(lv, en, pdel, zc, guess + 2, dt);
    if (a.vEnd <= lv.edv && b.vEnd >= lv.edv) { lo = guess - 2; hi = guess + 2; }
  }
  let pass = chamberPass(lv, en, pdel, zc, (lo + hi) / 2, dt);
  for (let i = 0; i < 40 && hi - lo > 1e-4; i++) {
    const mid = (lo + hi) / 2; pass = chamberPass(lv, en, pdel, zc, mid, dt);
    if (pass.vEnd < lv.edv) lo = mid; else hi = mid;
  }
  return { pla: (lo + hi) / 2, pass };
}

/** One steady beat with the elastance ventricle. `p.sv`, `p.etScale` and `p.lvedp` are outputs here. */
export function simulateLV(input: Partial<Params>, lvIn: Partial<LVParams> = {}, opts: { maxIter?: number; tol?: number } = {}): LVResult {
  const base: Params = { ...DEFAULTS, ...input } as Params;
  const lv: LVParams = { ...lvForPatient(base), ...lvIn };
  const N = PHYS.N, T = 60 / base.hr, dt = T / N, tmax = tMax(T, lv.tmaxScale, base.sex);
  const en = Array.from({ length: N }, (_, k) => elastanceShape(k * dt / tmax, lv.shape));
  // start near a resting cardiac output (≈ 5 L/min), not a fixed SV: at high rates a fixed 70 mL implies an
  // aortic pressure a small ventricle cannot open the valve against
  let sv = Math.min(70, 5000 / base.hr), d = derive({ ...base, sv });
  let zin = zinTable(d, N), zc = d.zc, pla = 10;
  const pdel = new Float64Array(N).fill(d.map);
  let pass!: Pass, it = 0, converged = false;
  const maxIter = opts.maxIter ?? 200, tol = opts.tol ?? 0.005;
  for (it = 1; it <= maxIter; it++) {
    const s = solvePLA(lv, en, pdel, zc, dt, pla); pla = s.pla; pass = s.pass;
    let tot = 0; for (let k = 0; k < N; k++) tot += pass.q[k] * dt;
    if (tot < 0.5) {   // no ejection against this pressure: lower the arterial guess and try again
      for (let k = 0; k < N; k++) pdel[k] *= 0.7;
      continue;
    }
    sv = tot; d = derive({ ...base, sv }); zin = zinTable(d, N); zc = d.zc;
    const pao = pressureFromFlow(pass.q, zin);
    let diff = 0;
    for (let k = 0; k < N; k++) { const nd = pao[k] - zc * pass.q[k]; diff = Math.max(diff, Math.abs(nd - pdel[k])); pdel[k] = 0.5 * pdel[k] + 0.5 * nd; }
    if (diff < tol) { converged = true; break; }
  }
  const { q, qm, V, P } = pass;
  // events on the internal grid (0 = onset of contraction)
  let i0 = 0; while (i0 < N && q[i0] <= 0) i0++;                 // aortic valve opens
  let i1 = i0; while (i1 < N && q[i1] > 0) i1++;                  // aortic valve closes
  let iMO = i1; while (iMO < N && qm[iMO] <= 0) iMO++;            // mitral valve opens
  let iMC = i0; while (iMC > 0 && qm[iMC - 1] <= 0) iMC--;        // mitral closure (end of the last inflow)
  const rot = <A extends ArrayLike<number>>(a: A) => Array.from({ length: N }, (_, k) => a[(k + i0) % N]);
  const lvet = (i1 - i0) * dt;
  const lvedp = P[Math.max(0, iMC - 1)];
  const dEj: Derived = { ...derive({ ...base, sv }), ET: lvet };
  const beat = simulateWithFlow({ ...base, sv, lvedp }, dEj, Float64Array.from(rot(q)));
  const lvR = rot(P), dp = lvR.map((_, k) => (lvR[(k + 1) % N] - lvR[(k - 1 + N) % N]) / (2 * dt));
  // τ: zero-asymptote fit of ln P from dP/dt min to mitral opening
  let iDm = i1; for (let k = i1; k < Math.min(iMO, N - 1); k++) if (P[k + 1] - P[k - 1] < P[iDm + 1] - P[iDm - 1]) iDm = k;
  let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
  for (let k = iDm; k < Math.min(iMO, N); k++) { if (P[k] <= 0) break; const x = (k - iDm) * dt, y = Math.log(P[k]); sx += x; sy += y; sxx += x * x; sxy += x * y; n++; }
  const slope = n > 2 ? (n * sxy - sx * sy) / (n * sxx - sx * sx) : NaN;
  const esv = V[i1 - 1], lvesp = P[i1 - 1], edvMax = Math.max(...V);
  return {
    beat, lv: lvR, vol: rot(V), qm: rot(qm),
    sv, esv, edv: edvMax, ef: sv / edvMax, lvedp, lvesp, lvsp: Math.max(...P), pla,
    dpdtMax: Math.max(...dp), dpdtMin: Math.min(...dp),
    ivct: (i0 - iMC) * dt, lvet, ivrt: (iMO - i1) * dt, tmax, tau: -1 / slope, peakE: Math.max(...qm),
    ea: lvesp / sv, tOnset: ((N - i0) % N) * dt, lvp: lv, iterations: it, converged,
    internal: { q: Float64Array.from(q), en, dt, d, zc, params: base }
  };
}

/** Find Ees giving a target stroke volume (bisection), all else fixed. */
export function eesForSV(input: Partial<Params>, lv: Partial<LVParams>, targetSV: number): number {
  let lo = 0.3, hi = 10;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (simulateLV(input, { ...lv, ees: mid }).sv < targetSV) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/* ---------------- stage 3: calibration of the ventricle by age and sex ----------------
   Fitted at the eight healthy study profiles (HR 70, their heights and weights), with
   EDV = Fujimoto EDV index × BSA and the EDPVR by age (stage 2):
     Ees     so stroke volume = the profile's calibrated SV (Maceira 2006 × 0.70 × BSA, as v2)
     radius  so cuff SBP = Herbert 2014 central SBP + amplification (as v2)
     Γ       so AIx = Janner 2010 (as v2)
   Everything else (EF, LVEDP, dP/dt, τ, IVCT, LVET, IVRT, Ea/Ees, DBP, MAP, SVRI) is a
   prediction, compared with data in runV3Validation(). Nested fit: Ees is re-solved inside
   every radius and Γ step. Values between ages are interpolated, flat beyond 25–80 y. */
export const V3_FIT = {
  ages: [25, 45, 65, 80],
  male:   { ees: [1.72, 1.99, 2.43, 2.74], radius: [101.5, 100, 100, 98], gamma: [0.01, 0.13, 0.23, 0.34] },
  female: { ees: [1.68, 1.96, 2.40, 2.78], radius: [99.5, 96, 95, 92.5],  gamma: [0.19, 0.37, 0.39, 0.44] }
} as const;
const v3k = (ys: readonly number[]) => V3_FIT.ages.map((a, i) => [a, ys[i]] as const);
export const v3For = (sex: number, age: number) => {
  const f = sex === 1 ? V3_FIT.female : V3_FIT.male;
  return { ees: interp(v3k(f.ees), age), radius: interp(v3k(f.radius), age), gamma: interp(v3k(f.gamma), age) };
};

/** A calibrated healthy patient with the v3 ventricle: v2 calibration for the arteries and SV
 *  target, then the v3 fits for Ees, radius and Γ. */
export function simulateCalibrated(p: Params, lvIn: Partial<LVParams> = {}): LVResult {
  const f = v3For(p.sex, p.age);
  return simulateLV({ ...p, radius: f.radius, gamma: f.gamma }, { ees: f.ees, ...lvIn });
}

registerV3Fits(v3For);

/** Beat for a patient whose inputs select the ventricle (heart = 1): Ees from the inputs, EDV =
 *  preload × age-typical EDV, EDPVR constant × lvStiff. Results are cached by input set, because the
 *  live engine, charts and tabs ask for the same beat many times. */
const lvCache = new Map<string, BeatResult>();
/** Ventricle inputs for a patient (heart = 1), as used by simulatePatientLV. */
export function lvInputsForPatient(p: Params): Partial<LVParams> {
  const base = lvForPatient(p);
  return { ees: p.ees, edv: base.edv * p.preload, ...stiffenedEDPVR(base, p.lvStiff) };
}

/** v3.2: pressure at which a stiffened EDPVR crosses the healthy one, mmHg. Before v3.2 the
 *  Diastolic stiffness control multiplied a about the reference point (EDVI_ref, P_ref), so at normal
 *  preload it left LVEDP unchanged. Now the curve turns about the low-volume point where the healthy
 *  curve is at STIFF_PIVOT_P, so a stiffer ventricle has a higher LVEDP at the same volume:
 *  LVEDP = P_pivot · (P_ref / P_pivot)^k, i.e. 8 → 11, 16, 23 and 32 mmHg at k = 1.5, 2, 2.5 and 3
 *  (Mulligan: HFpEF and hypertension with LVH 12–25, restrictive cardiomyopathy 18–30 mmHg). */
export const STIFF_PIVOT_P = 4;
export function stiffenedEDPVR(base: Pick<LVParams, 'pRef' | 'a'>, k: number): Pick<LVParams, 'pRef' | 'a'> {
  return { a: base.a * k, pRef: STIFF_PIVOT_P * Math.pow(base.pRef / STIFF_PIVOT_P, k) };
}
export function simulatePatientLV(p: Params): BeatResult {
  const key = JSON.stringify(p);
  const hit = lvCache.get(key); if (hit) return hit;
  const r = simulateLV(p, lvInputsForPatient(p));
  const out: BeatResult = { ...r.beat, lv: { p: r.lv, vol: r.vol, qm: r.qm, tOnset: r.tOnset },
    m: { ...r.beat.m, svOut: r.sv, ef: r.ef * 100, edv: r.edv, esv: r.esv, lvEDP: r.lvedp, lvESP: r.lvesp, lvSP: r.lvsp, pla: r.pla,
      dpdtMax: r.dpdtMax, dpdtMin: r.dpdtMin, tauLV: r.tau * 1000, ivct: r.ivct * 1000, ivrt: r.ivrt * 1000, ees: r.lvp.ees, ea: r.ea, eaEes: r.ea / r.lvp.ees } };
  if (lvCache.size > 400) lvCache.clear();
  lvCache.set(key, out);
  return out;
}
