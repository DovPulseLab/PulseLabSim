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
import { bsaDuBois, interp } from './calibrate';
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
}

/** Stage-2 fixed values (stage 3 calibrates Ees and timing by age and sex). */
export const LV_FIXED = { ees: 2.68, v0: 0, rav: 0.0025, rmv: 0.006, tmaxScale: 1.2, ks: 0.0005 } as const;

/** Patient-dependent ventricle: EDPVR and EDV from Fujimoto by age, scaled by BSA. */
export function lvForPatient(p: Pick<Params, 'age' | 'height' | 'weight'>): LVParams {
  const bsa = bsaDuBois(p.height, p.weight), ed = edpvrForAge(p.age);
  return { ...LV_FIXED, bsa, ...ed, edv: ed.edviRef * bsa };
}

/** Normalized double-Hill activation, peak = 1 at x ≈ 1. */
const hill = (x: number) => { const a = Math.pow(x / 0.7, 1.9), b = Math.pow(x / 1.17, 21.9); return (a / (1 + a)) * (1 / (1 + b)); };
const HILL_PEAK = (() => { let m = 0; for (let i = 1; i <= 4000; i++) m = Math.max(m, hill(i / 2000)); return m; })();
export const elastanceShape = (x: number): number => x <= 0 ? 0 : hill(x) / HILL_PEAK;
export const tMax = (T: number, scale = 1): number => (0.2 + 0.15 * T) * scale;

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
  const en = Array.from({ length: N }, (_, k) => elastanceShape(k * dt / tmax));
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
