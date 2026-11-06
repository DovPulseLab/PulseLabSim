import { describe, expect, it, vi } from 'vitest';
import { fixedPoint } from '../src/model/coupling';
import { derive, simulate } from '../src/model';
import { detectFeatures } from '../src/model/features';
import { ALL_CONTROLS, DEFAULTS, PRESETS, type Params } from '../src/config/physiology';

describe('MAP ↔ PWV fixed-point iteration', () => {
  it('converges at defaults within 8 iterations', () => {
    const d = derive({ ...DEFAULTS });
    expect(d.coupling.converged).toBe(true);
    expect(d.coupling.iterations).toBeLessThanOrEqual(8);
    expect(d.map).toBeCloseTo(d.svr * d.qMean, 12);
  });
  it('reports non-convergence without NaN and logs a warning', () => {
    const warn = vi.fn();
    const r = fixedPoint(x => x + 1, 93, { warn });           // never settles
    expect(r.converged).toBe(false);
    expect(r.iterations).toBe(8);
    expect(Number.isFinite(r.value)).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
  });
  it('keeps the last finite value if the update goes non-finite', () => {
    const warn = vi.fn();
    const r = fixedPoint(() => NaN, 93, { warn });
    expect(r).toEqual({ value: 93, converged: false, iterations: 1 });
    expect(warn).toHaveBeenCalledOnce();
  });
  it('derive never returns NaN even when the iteration is cut short', () => {
    const d = derive({ ...DEFAULTS }, { maxIter: 0, warn: () => {} });
    expect(d.coupling.converged).toBe(false);
    expect(Number.isFinite(d.map)).toBe(true);
    expect(Number.isFinite(d.cAoOp)).toBe(true);
  });
});

describe('feature points', () => {
  const run = (o: Partial<Params>) => {
    const r = simulate({ ...DEFAULTS, ...o });
    return { r, f: detectFeatures(r.p, r.d.T, r.d.ET), ms: (i: number) => i * r.dt * 1000 };
  };
  const cases: [string, Partial<Params>, 'A' | 'B' | 'C'][] = [
    ['ISH (type A)', PRESETS['Isolated systolic HTN (80 y)'], 'A'],
    ['defaults (type A)', {}, 'A'],
    ['essential HTN (type A)', PRESETS['Essential HTN (55 y)'], 'A'],
    // v2.5: near 0 Hz the load is the full Windkessel, so even low Γ leaves some augmentation
    ['low reflection Γ 0.1 (type B)', { gamma: 0.1 }, 'B'],
    ['young adult (type C)', PRESETS['Young adult (20 y)'], 'C'],
    ['young adult, low Γ 0.2 (type C)', { ...PRESETS['Young adult (20 y)'], gamma: 0.2 }, 'C']
  ];
  for (const [name, o, type] of cases) {
    it(name, () => {
      const { r, f, ms } = run(o);
      expect(r.m.type).toBe(type);
      expect(f.foot).toBeLessThan(f.peak);
      expect(f.peak).toBe(r.m.iPk);
      expect(Math.abs(ms(f.notch) - r.m.et)).toBeLessThanOrEqual(60);
      if (type === 'C') {
        expect(f.inflection).toBeNull();             // shown as "n/a"
        expect(f.lateShoulder).not.toBeNull();
        expect(f.lateShoulder!).toBeGreaterThan(f.peak);
      } else {
        expect(f.inflection).not.toBeNull();
        expect(f.inflection!).toBeLessThan(f.peak);
        // inflection marks the arrival of the reflected wave
        expect(Math.abs(ms(f.inflection!) - r.m.dtp)).toBeLessThanOrEqual(25);
      }
    });
  }
  it('never throws at any slider extreme', () => {
    for (const c of ALL_CONTROLS) for (const v of [c.min, c.max]) {
      const { f } = run({ [c.key]: v });
      for (const x of [f.foot, f.peak, f.notch]) expect(Number.isInteger(x)).toBe(true);
    }
  });
});
