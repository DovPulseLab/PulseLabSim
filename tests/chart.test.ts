import { describe, expect, it } from 'vitest';
import { spanRange, ticks } from '../src/render/chart';

describe('chart axes', () => {
  it('ticks terminate on a near-flat range (floating-point noise) — this used to hang the page', () => {
    const t0 = performance.now();
    const r = ticks(69 - 1e-15, 69 + 1.4e-14, 4);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(r.list.length).toBeLessThanOrEqual(200);
    expect(ticks(5, 5, 4).list).toEqual([]);
    expect(ticks(NaN, 1, 4).list).toEqual([]);
  });
  it('ticks are nice and cover the range', () => {
    expect(ticks(0, 100, 5).list).toEqual([0, 20, 40, 60, 80, 100]);
    expect(ticks(60, 80, 4)).toMatchObject({ step: 5 });
  });
  it('near-flat data counts as flat, and a minimum span is applied about the centre', () => {
    expect(spanRange(69, 69 + 1e-14)).toEqual([68.5, 69.5]);
    expect(spanRange(69, 69.1, 20)).toEqual([59.05, 79.05].map((v, i) => i ? 69.05 + 10 : 69.05 - 10) as [number, number]);
    expect(spanRange(100, 160, 40)).toEqual([100, 160]);   // already wide enough
    const [lo, hi] = spanRange(118, 121, 40);
    expect(hi - lo).toBeCloseTo(40, 9); expect((lo + hi) / 2).toBeCloseTo(119.5, 9);
  });
});
