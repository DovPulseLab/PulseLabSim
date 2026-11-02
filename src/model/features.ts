/* =====================================================================
   Feature points on one central pressure beat: foot, inflection,
   systolic peak, dicrotic notch. Used to place markers on the plots;
   the AIx index itself keeps the v1 method (echo arrival from the model).

   Derivatives are taken spectrally (multiply by iω, low-pass at 16 Hz),
   which is exact for a periodic beat and avoids finite-difference noise.
   The inflection is where the upstroke suddenly steepens as the reflected
   wave arrives: the largest positive peak of d²P/dt² during ejection.
   The 4th derivative is not used: with this model's ejection profile it
   rings and its zero crossings do not track the reflected wave.
   ===================================================================== */
import { fft } from './fft';

export interface FeaturePoints {
  foot: number;              // sample index
  peak: number;              // systolic peak
  inflection: number | null; // null = not found before the peak ("n/a", type C)
  lateShoulder: number | null; // reflected shoulder after the peak (type C)
  notch: number;             // dicrotic notch (end of ejection)
}

/** n-th time derivative of a periodic signal, low-passed at fc (Hz). */
export function spectralDerivative(x: number[], T: number, order: number, fc = 16): number[] {
  const n = x.length;
  const re = Float64Array.from(x), im = new Float64Array(n);
  fft(re, im, false);
  for (let k = 0; k < n; k++) {
    const kk = k <= n / 2 ? k : k - n;
    const f = kk / T;
    if (Math.abs(f) > fc || k === n / 2) { re[k] = 0; im[k] = 0; continue; }
    const w = 2 * Math.PI * f;
    let ar = 1, ai = 0;                     // (iω)^order
    for (let o = 0; o < order; o++) { const t = -ai * w; ai = ar * w; ar = t; }
    const r = re[k] * ar - im[k] * ai, i = re[k] * ai + im[k] * ar;
    re[k] = r; im[k] = i;
  }
  fft(re, im, true);
  return Array.from(re);
}

/**
 * Detect feature points. p: central pressure over one beat starting at ejection onset;
 * T: cycle length (s); et: ejection time (s).
 */
export function detectFeatures(p: number[], T: number, et: number): FeaturePoints {
  const n = p.length, dt = T / n;
  const idx = (s: number) => Math.max(0, Math.min(n - 1, Math.round(s / dt)));
  const iET = idx(et);
  const d1 = spectralDerivative(p, T, 1);
  const d2 = spectralDerivative(p, T, 2);

  // systolic peak
  let peak = 0;
  for (let k = 0; k <= Math.min(n - 1, iET + 5); k++) if (p[k] > p[peak]) peak = k;

  // foot: tangent at the steepest early upstroke meets the diastolic minimum
  let iUp = 0;
  for (let k = 0; k <= idx(0.05); k++) if (d1[k] > d1[iUp]) iUp = k;
  const pMin = Math.min(...p);
  const foot = d1[iUp] > 0 ? Math.max(0, Math.min(iUp, Math.round(iUp - (p[iUp] - pMin) / d1[iUp] / dt))) : 0;

  // inflection / late shoulder: largest positive d2 peak during ejection (away from the notch)
  const lo = Math.max(iUp + 1, foot + idx(0.02)), hi = Math.max(lo, iET - idx(0.03));
  let best = -1;
  for (let k = Math.max(1, lo); k < Math.min(n - 1, hi); k++) {
    if (d2[k] > 0 && d2[k] >= d2[k - 1] && d2[k] > d2[k + 1] && (best < 0 || d2[k] > d2[best])) best = k;
  }
  const inflection = best >= 0 && best < peak ? best : null;
  const lateShoulder = best > peak ? best : null;

  // dicrotic notch: the upward bend (local peak of d²P/dt²) nearest the end of ejection;
  // falls back to end of ejection if there is no bend within ±60 ms
  let notch = iET, bestDist = Infinity;
  for (let k = Math.max(1, iET - idx(0.06)); k <= Math.min(n - 2, iET + idx(0.06)); k++) {
    if (d2[k] >= d2[k - 1] && d2[k] > d2[k + 1] && Math.abs(k - iET) < bestDist) { bestDist = Math.abs(k - iET); notch = k; }
  }
  return { foot, peak, inflection, lateShoulder, notch };
}
