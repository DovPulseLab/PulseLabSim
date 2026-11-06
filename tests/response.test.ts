/* v2.3: physiologic response modes, set from human data. */
import { describe, expect, it } from 'vitest';
import { DEFAULTS, PRESETS, RESPONSE, baroFraction, exerciseSvFactor } from '../src/config/physiology';
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
  it('Pacing reproduces Ross 1965 cardiac output and Lazim 2025 MAP', () => {
    const a = simulate(eff({ hr: 80, hrRest: 80, resp: 1 }).params).m, b = simulate(eff({ hr: 121, hrRest: 80, resp: 1 }).params).m;
    expect(b.co / a.co).toBeCloseTo(3.72 / 3.67, 3);
    const c = simulate(eff({ resp: 1 }).params).m, d = simulate(eff({ hr: 90, resp: 1 }).params).m;
    expect(d.map / c.map).toBeCloseTo(102.02 / 95.95, 2);
  });
  it('Exercise SV follows Pandey 2020', () => {
    expect(exerciseSvFactor(24)).toBeCloseTo(51 / 37, 9);
    expect(exerciseSvFactor(91)).toBeCloseTo(49 / 37, 9);
    expect(exerciseSvFactor(200)).toBeCloseTo(49 / 37, 9);
  });
  it('baroreflex buffering follows ganglionic-blockade data', () => {
    expect(baroFraction(0, 25)).toBeCloseTo(1 - 1 / 3.5, 9);
    expect(baroFraction(0, 65)).toBeCloseTo(1 - 1 / 1.6, 9);
    expect(baroFraction(1, 25)).toBeLessThan(baroFraction(0, 25));
    expect(RESPONSE.baro.womenExcessRatio).toBeCloseTo(2.3 / 5.3, 9);
  });
  it('profiles set the resting HR to their own HR', () => {
    expect(PRESETS['Young adult (20 y)'].hrRest).toBe(64);
    expect(PRESETS['Healthy woman (45 y)'].hrRest).toBe(70);
  });
  it('fitted and consistency rows pass; prediction results are pinned so changes are noticed', () => {
    const rows = runStudyValidation().response;
    for (const c of rows.filter(r => r.kind !== 'data')) expect(c.verdict, c.what).toBe('pass');
    expect(rows.filter(r => r.kind === 'data').map(r => r.verdict)).toEqual(['pass', 'fail', 'pass', 'fail', 'pass', 'fail', 'near']);
  });
});

describe('Wilkinson 2000 pacing benchmark', () => {
  it('verdicts are pinned so changes are noticed', () => {
    const w = runStudyValidation().wilkinson;
    expect(w.map(c => c.verdict)).toEqual(['pass', 'pass', 'fail', 'fail', 'fail', 'fail', 'fail', 'near']);
  });
});
