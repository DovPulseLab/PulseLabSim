/** Minimal complex arithmetic (ported from v1 js/model.js). */
export interface Cx { r: number; i: number; }

export const cx = (r: number, i: number): Cx => ({ r, i });
export const add = (a: Cx, b: Cx): Cx => cx(a.r + b.r, a.i + b.i);
export const sub = (a: Cx, b: Cx): Cx => cx(a.r - b.r, a.i - b.i);
export const mul = (a: Cx, b: Cx): Cx => cx(a.r * b.r - a.i * b.i, a.r * b.i + a.i * b.r);
export const div = (a: Cx, b: Cx): Cx => {
  const d = b.r * b.r + b.i * b.i;
  return cx((a.r * b.r + a.i * b.i) / d, (a.i * b.r - a.r * b.i) / d);
};
/** mag · e^{i·th} */
export const expi = (th: number, mag: number): Cx => cx(mag * Math.cos(th), mag * Math.sin(th));
export const abs = (a: Cx): number => Math.hypot(a.r, a.i);
