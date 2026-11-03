/* Passive MAP ↔ elastic-artery stiffness feedback (v1 coefficients).
   Solved by fixed-point iteration: at most 8 iterations, tolerance 0.1 mmHg.
   Never returns NaN: on failure it keeps the last finite value and warns. */

export interface FixedPointResult {
  value: number;
  converged: boolean;
  iterations: number;
}

export interface FixedPointOptions {
  maxIter?: number;   // default 8
  tol?: number;       // default 0.1 (mmHg)
  warn?: (msg: string) => void;
}

export function fixedPoint(g: (x: number) => number, x0: number, opts: FixedPointOptions = {}): FixedPointResult {
  const maxIter = opts.maxIter ?? 8, tol = opts.tol ?? 0.1;
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  let x = Number.isFinite(x0) ? x0 : 0;
  for (let i = 1; i <= maxIter; i++) {
    const next = g(x);
    if (!Number.isFinite(next)) {
      warn(`MAP–PWV iteration produced a non-finite value at step ${i}; keeping ${x.toFixed(2)}`);
      return { value: x, converged: false, iterations: i };
    }
    if (Math.abs(next - x) <= tol) return { value: next, converged: true, iterations: i };
    x = next;
  }
  warn(`MAP–PWV iteration did not converge in ${maxIter} steps; using ${x.toFixed(2)}`);
  return { value: x, converged: false, iterations: maxIter };
}
