import { PHYS } from '../config/physiology';
import type { Derived } from './derive';
import { inputImpedance, type ZinPoint } from './solve';
import { abs, div, cx } from './complex';
import { fft } from './fft';

export interface ZPoint { f: number; mod: number; phase: number; }

/** Input impedance at each harmonic from the beat itself: Z(f) = FFT(P) / FFT(Q).
 *  At 0 Hz this is MAP / mean flow = SVR. Units mmHg·s/mL, phase in radians. */
export function impedanceFromBeat(r: { p: number[]; q: number[]; d: Derived }, fMax = 10): ZPoint[] {
  const n = r.p.length;
  const pr = Float64Array.from(r.p), pi = new Float64Array(n);
  const qr = Float64Array.from(r.q), qi = new Float64Array(n);
  fft(pr, pi, false); fft(qr, qi, false);
  const qScale = Math.max(...r.q) * n;
  const out: ZPoint[] = [];
  for (let k = 0; k <= n / 2; k++) {
    const f = k / r.d.T;
    if (f > fMax + 1e-9) break;
    // skip harmonics where the flow spectrum is numerically empty
    if (k > 0 && Math.hypot(qr[k], qi[k]) < 1e-9 * qScale) continue;
    const z = div(cx(pr[k], pi[k]), cx(qr[k], qi[k]));
    out.push({ f, mod: abs(z), phase: k === 0 ? 0 : Math.atan2(z.i, z.r) });
  }
  return out;
}

export interface ImpedanceSummary {
  z0: number;              // |Z| at 0 Hz = SVR, dyn·s·cm⁻⁵
  zcModel: number;         // ρc/A, dyn·s·cm⁻⁵
  zcEstimate: number;      // mean modulus 2–10 Hz, dyn·s·cm⁻⁵
  z1: number;              // first-harmonic modulus, dyn·s·cm⁻⁵
  firstMinHarmonicHz: number;
  firstMinHz: number;      // on a fine frequency grid
  predictedMinHz: number;  // 1 / (2·Δtp)
}

/** |Zin| on a fine grid, f from fMin to fMax (Hz). Units mmHg·s/mL. */
export function impedanceCurve(d: Derived, fMax = 10, df = 0.01, fMin = 0): ZinPoint[] {
  const out: ZinPoint[] = [];
  for (let k = 0; fMin + k * df <= fMax + 1e-9; k++) {
    const f = fMin + k * df;
    out.push({ f, mod: abs(inputImpedance(d, f)) });
  }
  return out;
}

/** First local minimum of |Z| above 0 Hz, or NaN-free fallback to the lowest point. */
export function firstMinimum(z: ZinPoint[]): number {
  for (let i = 1; i < z.length - 1; i++) {
    if (z[i].mod < z[i - 1].mod && z[i].mod <= z[i + 1].mod) return z[i].f;
  }
  let lo = 1;
  for (let i = 1; i < z.length; i++) if (z[i].mod < z[lo].mod) lo = i;
  return z[Math.min(lo, z.length - 1)].f;
}

export function summarizeImpedance(d: Derived, harmonics: ZinPoint[]): ImpedanceSummary {
  // harmonics: from impedanceFromBeat (index 0 = SVR, index 1 = first harmonic)
  const DYN = PHYS.DYN;
  // start the fine grid above 0 Hz so the falling edge from SVR is found as a minimum
  const fine = impedanceCurve(d, 12, 0.01, 0.2);
  const hi = fine.filter(h => h.f >= 2 && h.f <= 10);
  const zcEstimate = hi.reduce((a, h) => a + h.mod, 0) / hi.length * DYN;
  const harm = harmonics.filter(h => h.f <= 12);
  return {
    z0: harmonics[0].mod * DYN,
    zcModel: d.zc * DYN,
    zcEstimate,
    z1: harmonics[1].mod * DYN,
    firstMinHarmonicHz: firstMinimum(harm),
    firstMinHz: firstMinimum(fine),
    predictedMinHz: 1 / (2 * d.dtp)
  };
}
