/* =====================================================================
   v3 · Time-varying elastance left ventricle coupled to the v2 arterial
   model. Pure.

   LV pressure (active + passive, stage 2):
       P_LV = [en(t) · Ees · (V − V0)  +  (1 − en(t)) · P_ED(V)] · (1 − ks·Q_out)
   en(t)  normalized double-Hill activation (Stergiopulos et al. 1996),
          peak 1 at Tmax = (0.2 + 0.15 · cycle length) × tmaxScale
   P_ED   end-diastolic pressure–volume relation (EDPVR), exponential in
          volume index:  P_ED(V) = Pref · exp(a · (V/BSA − EDVIref))
          with Pref, a and EDVIref from Fujimoto et al. 2012 by age (healthy
          sedentary adults, invasive PCWP and MRI EDV), so the curve passes
          through each age group's measured filling pressure and EDV index.
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
import { DEFAULTS, PHYS, type Params } from '../config/physiology';
import { bsaDuBois, interp, registerV3Fits } from './calibrate';
import { cx, type Cx } from './complex';
import { derive, type Derived } from './derive';
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
/** EDPVR for an age: passes through that age's PCWP at its EDV index; slope from the stiffness constant. */
export const edpvrForAge = (age: number) => ({ pRef: fj(FUJIMOTO_2012.pcwp, age), a: fj(FUJIMOTO_2012.a, age), edviRef: fj(FUJIMOTO_2012.edvi, age) });
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
export interface HillShape { c1: number; n1: number; c2: number; n2: number; }
export const STERGIOPULOS: Readonly<HillShape> = { c1: 0.7, n1: 1.9, c2: 1.17, n2: 21.9 };
const hillRaw = (x: number, h: HillShape) => { const a = Math.pow(x / h.c1, h.n1), b = Math.pow(x / h.c2, h.n2); return (a / (1 + a)) * (1 / (1 + b)); };
const peakCache = new Map<string, number>();
function hillPeak(h: HillShape): number {
  const key = `${h.c1},${h.n1},${h.c2},${h.n2}`; let m = peakCache.get(key);
  if (m == null) { m = 0; for (let i = 1; i <= 6000; i++) m = Math.max(m, hillRaw(i / 2000, h)); peakCache.set(key, m); }
  return m;
}
/** Normalized activation, peak = 1. */
export const elastanceShape = (x: number, h: HillShape = STERGIOPULOS): number => x <= 0 ? 0 : hillRaw(x, h) / hillPeak(h);
export const tMax = (T: number, scale = 1): number => (0.2 + 0.15 * T) * scale;

/** Activation shape and ejection effect fitted (v3 stage 3) for the default adult at 70 bpm, with
 *  Ees set so SV = 72 mL, to: relaxation τ 40–50 ms (Zhang & Kovács 2009: 42–54 ms), dP/dt max
 *  1 000–1 500 and −dP/dt −1 200 to −1 800 mmHg/s (Zhang & Kovács 2009), ejection ≈ 300 ms (study
 *  design; Weissler 294 ms) and v2's AIx and cuff SBP. The relaxation exponent n2 trades τ against
 *  IVRT and −dP/dt; 15.5 balances them. ESPVR intercept V0 = −20 mL (chosen so Ea/Ees ≈ 0.6–0.7 at
 *  the healthy profiles' EF, Chen 1998; with V0 = 0 Ea/Ees fell to 0.36 by 80 y). Result for the
 *  default adult: Ees 2.10, Ea/Ees 0.72, τ 40 ms, dP/dt max 1 210, −dP/dt −1 370, IVCT 74 ms,
 *  LVET 303 ms, IVRT 101 ms, AIx 31 % (v2 28), cuff SBP 117 (v2 122). */
export const V3_SHAPE: Readonly<HillShape> = { c1: 0.55, n1: 1.9, c2: 1.17, n2: 15.5 };
export const LV_FIXED: Omit<LVParams, 'edv' | 'bsa' | 'pRef' | 'a' | 'edviRef'> = { ees: 2.10, v0: -20, rav: 0.0025, rmv: 0.006, tmaxScale: 1.05, ks: 0.0009, shape: V3_SHAPE };

/** Patient-dependent ventricle: EDPVR and EDV from Fujimoto by age, scaled by BSA. */
export function lvForPatient(p: Pick<Params, 'age' | 'height' | 'weight'>): LVParams {
  const bsa = bsaDuBois(p.height, p.weight), ed = edpvrForAge(p.age);
  return { ...LV_FIXED, bsa, ...ed, edv: ed.edviRef * bsa };
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
  lvp: LVParams;
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
  const N = PHYS.N, T = 60 / base.hr, dt = T / N, tmax = tMax(T, lv.tmaxScale);
  const en = Array.from({ length: N }, (_, k) => elastanceShape(k * dt / tmax, lv.shape));
  let sv = 70, d = derive({ ...base, sv });
  let zin = zinTable(d, N), zc = d.zc, pla = 10;
  const pdel = new Float64Array(N).fill(d.map);
  let pass!: Pass, it = 0, converged = false;
  const maxIter = opts.maxIter ?? 200, tol = opts.tol ?? 0.005;
  for (it = 1; it <= maxIter; it++) {
    const s = solvePLA(lv, en, pdel, zc, dt, pla); pla = s.pla; pass = s.pass;
    let tot = 0; for (let k = 0; k < N; k++) tot += pass.q[k] * dt;
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
    ea: lvesp / sv, lvp: lv, iterations: it, converged
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
  male:   { ees: [1.77, 2.04, 2.46, 2.83], radius: [101.5, 100, 100, 97.5], gamma: [0.01, 0.05, 0.08, 0.19] },
  female: { ees: [1.72, 2.00, 2.43, 2.80], radius: [99.5, 96, 95, 92.5],    gamma: [0.12, 0.27, 0.20, 0.23] }
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
export function simulatePatientLV(p: Params): BeatResult {
  const key = JSON.stringify(p);
  const hit = lvCache.get(key); if (hit) return hit;
  const base = lvForPatient(p);
  const r = simulateLV(p, { ees: p.ees, edv: base.edv * p.preload, a: base.a * p.lvStiff });
  const out: BeatResult = { ...r.beat, lv: { p: r.lv, vol: r.vol, qm: r.qm },
    m: { ...r.beat.m, svOut: r.sv, ef: r.ef * 100, edv: r.edv, esv: r.esv, lvEDP: r.lvedp, lvESP: r.lvesp, lvSP: r.lvsp, pla: r.pla,
      dpdtMax: r.dpdtMax, dpdtMin: r.dpdtMin, tauLV: r.tau * 1000, ivct: r.ivct * 1000, ivrt: r.ivrt * 1000, ees: r.lvp.ees, ea: r.ea, eaEes: r.ea / r.lvp.ees } };
  if (lvCache.size > 400) lvCache.clear();
  lvCache.set(key, out);
  return out;
}
