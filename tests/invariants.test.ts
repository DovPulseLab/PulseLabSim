import { finiteOutputs } from '../src/model/indices';
import { describe, expect, it } from 'vitest';
import { simulate, weisslerLVET } from '../src/model';
import { ALL_CONTROLS, DEFAULTS, MODEL, PHYS, type Params } from '../src/config/physiology';

const at = (o: Partial<Params>) => simulate({ ...DEFAULTS, ...o });

// defaults plus each slider at its minimum and maximum
const points: [string, Partial<Params>][] = [['defaults', {}]];
for (const c of ALL_CONTROLS) {
  points.push([`${c.key} = ${c.min}`, { [c.key]: c.min }]);
  points.push([`${c.key} = ${c.max}`, { [c.key]: c.max }]);
}

describe('MAP = CO × SVR / 80 + CVP (±1 mmHg)', () => {
  for (const [name, o] of points) {
    it(name, () => {
      const { m } = at(o);
      const predicted = m.co * m.svrDyn / 80 + PHYS.cvp;   // L/min × dyn·s·cm⁻⁵ / 80 → mmHg
      expect(Math.abs(m.map - predicted)).toBeLessThanOrEqual(1);
    });
  }
});

describe('wave separation: forward + reflected = measured at every sample', () => {
  for (const [name, o] of points) {
    it(name, () => {
      const r = at(o);
      for (let k = 0; k < r.N; k++) expect(Math.abs(r.pf[k] + r.pb[k] - r.p[k])).toBeLessThan(1e-9);
    });
  }
});

describe('transmission-line relations', () => {
  it('Δtp = 2·Lp / path PWV', () => {
    for (const [, o] of points) {
      const { d, m } = at(o);
      expect(m.dtp / 1000).toBeCloseTo(2 * (d.lp / 100) / d.cPath, 12);
    }
  });
  it('Zc = ρ·c / A', () => {
    for (const [, o] of points) {
      const { d } = at(o);
      const zcSI = PHYS.RHO * d.cAoOp / (d.A * 1e-4);                 // Pa·s/m³
      expect(d.zc).toBeCloseTo(zcSI / PHYS.MMHG / 1e6, 12);            // mmHg·s/mL
    }
  });
});

describe('ejection', () => {
  it('LVET follows Weissler (413 − 1.7·HR ms) times the ejection multiplier', () => {
    for (const hr of [40, 60, 75, 100, 130]) {
      for (const etScale of [0.8, 1, 1.2]) {
        const { d } = at({ hr, etScale });
        const expected = Math.min(Math.max((413 - 1.7 * hr) / 1000 * etScale, MODEL.etMin), MODEL.etMaxFrac * 60 / hr);
        expect(weisslerLVET(hr)).toBeCloseTo((413 - 1.7 * hr) / 1000, 12);
        expect(d.ET).toBeCloseTo(expected, 12);
      }
    }
  });
  it('area under the flow curve equals stroke volume (±1 %)', () => {
    for (const [, o] of points) {
      const r = at(o);
      const area = r.q.reduce((a, v) => a + v * r.dt, 0);
      expect(Math.abs(area - r.params.sv) / r.params.sv).toBeLessThan(0.01);
    }
  });
});

describe('robustness', () => {
  it('every index is finite at every slider extreme', () => {
    for (const [, o] of points) {
      const { m, params } = at(o);
      for (const [k, v] of finiteOutputs(m, params.heart)) expect(Number.isFinite(v), k).toBe(true);
    }
  });
});
