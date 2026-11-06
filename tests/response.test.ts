/* v2.3: physiologic response modes. */
import { describe, expect, it } from 'vitest';
import { DEFAULTS, PRESETS } from '../src/config/physiology';
import { applyDrugEffects } from '../src/engine/kinetics';
import { simulate } from '../src/model';
import { runStudyValidation } from '../src/model/validationStudy';

const eff = (p: Partial<typeof DEFAULTS>) => applyDrugEffects({ ...DEFAULTS, ...p }, [], 0);

describe('physiologic response modes', () => {
  it('Independent changes nothing', () => {
    const e = eff({ hr: 110 });
    expect(e.response).toBeNull();
    expect(e.params.sv).toBe(DEFAULTS.sv); expect(e.params.radius).toBe(DEFAULTS.radius);
  });
  it('every mode is a no-op at resting HR without drugs', () => {
    for (const resp of [1, 2, 3]) {
      const e = eff({ resp });
      expect(e.params.sv).toBeCloseTo(DEFAULTS.sv, 9); expect(e.params.radius).toBeCloseTo(DEFAULTS.radius, 9);
    }
  });
  it('Pacing holds cardiac output exactly', () => {
    for (const hr of [50, 90, 130]) {
      const e = eff({ hr, resp: 1 });
      expect(e.params.sv * hr).toBeCloseTo(DEFAULTS.sv * DEFAULTS.hrRest, 6);
    }
  });
  it('Exercise lands MAP on its target', () => {
    const e = eff({ hr: 120, resp: 2 });
    expect(simulate(e.params).m.map).toBeCloseTo(e.response!.mapSet, 0);
    expect(e.params.sv).toBeGreaterThan(DEFAULTS.sv);
    expect(e.params.radius).toBeGreaterThan(DEFAULTS.radius);
  });
  it('profiles set the resting HR to their own HR', () => {
    expect(PRESETS['Young adult (20 y)'].hrRest).toBe(64);
    expect(PRESETS['Healthy woman (45 y)'].hrRest).toBe(70);
  });
  it('validation checks pass', () => {
    for (const c of runStudyValidation().response) expect(c.verdict, c.what).toBe('pass');
  });
});
