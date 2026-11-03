import { MODEL, PHYS, type Params } from '../config/physiology';
import type { Derived } from './derive';

/** LV ejection flow over one beat (mL/s), area scaled to SV. Ported from v1. */
export function flowWave(p: Params, d: Derived, n: number = PHYS.N): Float64Array {
  const dt = d.T / n, q = new Float64Array(n);
  let s = 0;
  for (let k = 0; k < n; k++) {
    const t = k * dt;
    if (t < d.ET) {
      const x = t / d.ET;
      q[k] = Math.pow(x, MODEL.flowRise) * Math.pow(1 - x, MODEL.flowFall);
      s += q[k] * dt;
    }
  }
  for (let k = 0; k < n; k++) q[k] *= p.sv / s;
  return q;
}
