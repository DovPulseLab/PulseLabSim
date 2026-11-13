/* =====================================================================
   v3 stage 1 · Time-varying elastance left ventricle coupled to the
   v2 arterial model. Pure.

   LV pressure:  P_LV(t) = E(t) · (V(t) − V0)
   E(t) = Emin + (Ees − Emin) · En(t / Tmax)          (Stergiopulos et al. 1996)
   En(x) ∝ [(x/0.7)^1.9 / (1 + (x/0.7)^1.9)] · [1 / (1 + (x/1.17)^21.9)], peak scaled to 1
   Tmax = 0.2 + 0.15 · cycle length (s), time from onset of contraction to peak elastance.

   Aortic valve: flow only forward, Q = (P_LV − P_Ao) / R_AV. Optional ejection effect
   (internal source resistance): P_LV = E(t)(V − V0)(1 − ks·Q) (Shroff et al. 1985).
   Arterial side: unchanged v2 model, input impedance Zin(ω). Split into the
   instantaneous characteristic impedance and a delayed part:
       P_Ao(t) = Zc · Q(t) + P_del(t)
   P_del (reflections + Windkessel, depends only on earlier flow through the
   periodic beat) is iterated to a fixed point; at each time step the valve
   and chamber equations are solved implicitly with it, which keeps the
   stiff Zc coupling stable.

   Stage 1 scope: systole and isovolumic relaxation. End-diastolic volume is an
   input (preload); LVEDP = Emin · (EDV − V0) until the EDPVR of stage 2.
   Time 0 of the internal beat = onset of contraction (≈ mitral closure);
   the arterial output is rotated so index 0 = start of ejection, as in v2.
   ===================================================================== */
import { DEFAULTS, PHYS, type Params } from '../config/physiology';
import { cx, type Cx } from './complex';
import { derive, type Derived } from './derive';
import { fft } from './fft';
import { inputImpedance, simulateWithFlow, type BeatResult } from './solve';

export interface LVParams {
  ees: number;    // end-systolic (peak) elastance, mmHg/mL
  emin: number;   // diastolic elastance (stage 1, linear), mmHg/mL
  v0: number;     // unstressed volume, mL
  edv: number;    // end-diastolic volume (preload), mL
  rav: number;    // aortic valve resistance, mmHg·s/mL
  tmaxScale: number; // multiplier on Tmax = 0.2 + 0.15·T
  tauFill: number; // s, time constant of the (stage-1, schematic) diastolic refilling
  ks: number;     // ejection-effect (source resistance) coefficient, s/mL: P = E(V−V0)(1 − ks·Q) (Shroff 1985)
}

/** Stage-1 defaults: with the default adult they give SV ≈ 72 mL, EF ≈ 53 %, Ea/Ees ≈ 0.66 and
 *  aortic/cuff pressures and AIx within a few units of v2 (tests/ventricle.test.ts). */
export const LV_DEFAULTS: Readonly<LVParams> = { ees: 2.25, emin: 0.06, v0: 10, edv: 135, rav: 0.0025, tmaxScale: 1.2, ks: 0.0005, tauFill: 0.08 };

/** Normalized double-Hill elastance shape, peak = 1 at x ≈ 1. */
const hill = (x: number) => { const a = Math.pow(x / 0.7, 1.9), b = Math.pow(x / 1.17, 21.9); return (a / (1 + a)) * (1 / (1 + b)); };
const HILL_PEAK = (() => { let m = 0; for (let i = 1; i <= 4000; i++) m = Math.max(m, hill(i / 2000)); return m; })();
export const elastanceShape = (x: number): number => x <= 0 ? 0 : hill(x) / HILL_PEAK;
export const tMax = (T: number, scale = 1): number => (0.2 + 0.15 * T) * scale;

export interface LVResult {
  beat: BeatResult;          // arterial solution, index 0 = start of ejection (as v2)
  lv: number[];              // LV pressure on the same grid and origin as beat.p, mmHg
  vol: number[];             // LV volume, mL
  elast: number[];           // E(t), mmHg/mL
  sv: number; esv: number; edv: number; ef: number;
  lvedp: number; lvesp: number; lvsp: number;
  dpdtMax: number; dpdtMin: number;   // mmHg/s
  ivct: number; lvet: number; tmax: number;  // s; IVCT = mitral closure (P_LV > filling pressure) → valve opening
  ea: number;                // effective arterial elastance = LVESP / SV, mmHg/mL
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

/** Stage 1 diastole: after ejection the chamber relaxes isovolumically until LV pressure
 *  falls below the filling pressure (LVEDP + 1 mmHg), then refills exponentially so that
 *  V returns to EDV at the end of the beat (keeps the periodic beat continuous). */
function fill(V: Float64Array, P: Float64Array, E: number[], q: Float64Array, dt: number, lvp: LVParams): void {
  const N = V.length, pla = lvp.emin * (lvp.edv - lvp.v0) + 1;
  let k1 = 0; while (k1 < N && q[k1] <= 0) k1++; while (k1 < N && q[k1] > 0) k1++;
  let kmo = k1; while (kmo < N && P[kmo] > pla) kmo++;
  if (kmo >= N - 2) return;
  const esv = V[k1 - 1], span = (N - 1 - kmo) * dt, den = 1 - Math.exp(-span / lvp.tauFill);
  for (let k = kmo; k < N; k++) {
    const f = (1 - Math.exp(-((k - kmo) * dt) / lvp.tauFill)) / den;
    V[k] = esv + (lvp.edv - esv) * f; P[k] = E[k] * (V[k] - lvp.v0);
  }
}

/** One steady beat with the elastance ventricle. `p.sv` and `p.etScale` are ignored (outputs). */
export function simulateLV(input: Partial<Params>, lvIn: Partial<LVParams> = {}, opts: { maxIter?: number; tol?: number } = {}): LVResult {
  const lvp: LVParams = { ...LV_DEFAULTS, ...lvIn };
  const N = PHYS.N, base: Params = { ...simulateDefaults(), ...input } as Params;
  const T = 60 / base.hr, dt = T / N, tmax = tMax(T, lvp.tmaxScale);
  const E = Array.from({ length: N }, (_, k) => lvp.emin + (lvp.ees - lvp.emin) * elastanceShape(k * dt / tmax));
  let sv = 70, d = derive({ ...base, sv });
  let zin = zinTable(d, N), zc = d.zc;
  let pdel = new Float64Array(N).fill(d.map);
  const q = new Float64Array(N), V = new Float64Array(N), P = new Float64Array(N);
  let it = 0, converged = false;
  const maxIter = opts.maxIter ?? 200, tol = opts.tol ?? 0.005;
  for (it = 1; it <= maxIter; it++) {
    // ventricle over one beat against the current delayed arterial pressure
    let v = lvp.edv, ejecting = false, done = false;
    for (let k = 0; k < N; k++) {
      const e = E[k];
      let qk = 0;
      if (!done) {
        // implicit in V: Q = (E (V − Q dt − V0) − Pdel) / (Rav + Zc)  ⇒  Q = (E (V − V0) − Pdel) / (Rav + Zc + E dt)
        const piso = e * (v - lvp.v0);
        const qTry = (piso - pdel[k]) / (lvp.rav + zc + e * dt + piso * lvp.ks);
        if (qTry > 0) { qk = qTry; ejecting = true; }
        else if (ejecting) done = true;      // valve closes once flow would reverse
      }
      q[k] = qk; v -= qk * dt; V[k] = v; P[k] = e * (v - lvp.v0) * (1 - lvp.ks * qk);
    }
    fill(V, P, E, q, dt, lvp);
    let s = 0; for (let k = 0; k < N; k++) s += q[k] * dt;
    // arterial response; MAP ↔ PWV coupling through derive(sv)
    sv = s; d = derive({ ...base, sv }); zin = zinTable(d, N); zc = d.zc;
    const pao = pressureFromFlow(q, zin);
    let diff = 0;
    for (let k = 0; k < N; k++) { const nd = pao[k] - zc * q[k]; diff = Math.max(diff, Math.abs(nd - pdel[k])); pdel[k] = 0.5 * pdel[k] + 0.5 * nd; }
    if (diff < tol) { converged = true; break; }
  }
  // locate ejection, rotate to the v2 origin (index 0 = valve opening)
  let i0 = 0; while (i0 < N && q[i0] <= 0) i0++;
  let i1 = i0; while (i1 < N && q[i1] > 0) i1++;
  const rot = <A extends ArrayLike<number>>(a: A) => Array.from({ length: N }, (_, k) => a[(k + i0) % N]);
  const qRot = Float64Array.from(rot(q));
  const lvet = (i1 - i0) * dt;
  const dEj: Derived = { ...derive({ ...base, sv }), ET: lvet };
  const beat = simulateWithFlow({ ...base, sv, lvedp: lvp.emin * (lvp.edv - lvp.v0) }, dEj, qRot);
  // LV pressure on the rotated grid: outside ejection the chamber is isovolumic or filling;
  // stage 1 keeps the computed curve (isovolumic relaxation follows E(t) at ESV).
  const lv = rot(P), vol = rot(V), elast = rot(E);
  const dp = lv.map((_, k) => (lv[(k + 1) % N] - lv[(k - 1 + N) % N]) / (2 * dt));
  const esv = V[i1 - 1], lvesp = P[i1 - 1];
  const pla = lvp.emin * (lvp.edv - lvp.v0) + 1;
  let iMC = 0; while (iMC < i0 && P[iMC] <= pla) iMC++;
  const lvedp = lvp.emin * (lvp.edv - lvp.v0);
  return {
    beat, lv, vol, elast, sv, esv, edv: lvp.edv, ef: sv / lvp.edv, lvedp, lvesp, lvsp: Math.max(...lv),
    dpdtMax: Math.max(...dp), dpdtMin: Math.min(...dp), ivct: (i0 - iMC) * dt, lvet, tmax,
    ea: lvesp / sv, iterations: it, converged
  };
}

const simulateDefaults = (): Params => ({ ...DEFAULTS });

/** Find Ees giving a target stroke volume (bisection), all else fixed. */
export function eesForSV(input: Partial<Params>, lv: Partial<LVParams>, targetSV: number): number {
  let lo = 0.3, hi = 8;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (simulateLV(input, { ...lv, ees: mid }).sv < targetSV) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
