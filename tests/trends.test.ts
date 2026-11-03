import { describe, expect, it } from 'vitest';
import { simulate } from '../src/model';
import { DEFAULTS, PRESETS, type Params } from '../src/config/physiology';

const m = (o: Partial<Params>) => simulate({ ...DEFAULTS, ...o }).m;
const increasing = (a: number[]) => a.every((v, i) => i === 0 || v > a[i - 1]);
const decreasing = (a: number[]) => a.every((v, i) => i === 0 || v < a[i - 1]);

describe('published directions', () => {
  it('AIx rises with aortic PWV', () => {
    expect(increasing([5, 7.5, 10, 13, 16].map(cAo => m({ cAo }).AIx))).toBe(true);
  });
  it('AIx rises with reflection coefficient Γ', () => {
    expect(increasing([0.1, 0.3, 0.5, 0.7, 0.9].map(gamma => m({ gamma }).AIx))).toBe(true);
  });
  it('AIx falls with heart rate at constant cardiac output (pacing, Wilkinson 2000)', () => {
    const co = DEFAULTS.sv * DEFAULTS.hr;
    expect(decreasing([50, 60, 70, 80, 90, 100, 110, 120, 130].map(hr => m({ hr, sv: co / hr }).AIx))).toBe(true);
  });
  it('PP amplification falls from the young to the old (ISH) profile', () => {
    // v1 uses a fixed arm transfer function, so amplification does not fall with aortic PWV alone;
    // it falls across the age profiles as in Nichols & Singh 2002 Fig. 2 (see Validation).
    const young = m(PRESETS['Young adult (20 y)']).ppa;
    const mid = m(PRESETS['Middle-aged (45 y)']).ppa;
    const old = m(PRESETS['Isolated systolic HTN (80 y)']).ppa;
    expect(young).toBeGreaterThan(mid);
    expect(young).toBeGreaterThan(old);
  });
});

describe('extreme physiology (spec "done when")', () => {
  it('aortic PWV, Γ and L at max with HR at min: early reflection, AIx > 30 %, wide central PP', () => {
    const base = m({});
    const x = m({ cAo: 16, gamma: 0.9, lpScale: 1.5, hr: 40 });
    expect(x.type).toBe('A');
    expect(x.dtp).toBeLessThan(x.et);          // reflection returns during ejection
    expect(x.AIx).toBeGreaterThan(30);
    expect(x.PP).toBeGreaterThan(base.PP * 1.5);
  });
});
