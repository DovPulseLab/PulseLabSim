/* v2.5: Windkessel-correct reflection, zero-flow pressure, cuff measurement, arm PWV by age. */
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULTS, MODEL, PRESETS, useV1Laws } from '../src/config/physiology';
import { simulate } from '../src/model';
import { musPWV, applyCalibration } from '../src/model/calibrate';

describe('v2.5 model', () => {
  afterEach(() => useV1Laws(false));

  it('cuff reads intra-arterial brachial pressure with the Picone 2017 offsets', () => {
    const m = simulate({}).m;
    expect(m.bSBP).toBeCloseTo(m.iaSBP - MODEL.cuff.sbp, 9);
    expect(m.bDBP).toBeCloseTo(m.iaDBP + MODEL.cuff.dbp, 9);
  });

  it('device central SBP inherits the cuff calibration (between true aortic DBP and SBP, below true SBP)', () => {
    const m = simulate(PRESETS['Healthy man (65 y)']).m;
    expect(m.devCSBP).toBeLessThan(m.Ps);
    expect(m.devCSBP).toBeGreaterThan(m.Pd);
  });

  it('MAP still equals CO × SVR exactly with the zero-flow pressure', () => {
    const r = simulate({});
    expect(r.m.map).toBeCloseTo(r.d.svr * r.d.qMean, 6);
  });

  it('diastole heads toward the zero-flow pressure, not 0 mmHg', () => {
    for (const n of Object.keys(PRESETS).filter(k => k.startsWith('Healthy'))) {
      const m = simulate({ ...DEFAULTS, ...PRESETS[n] }).m;
      expect(m.pInf, n).toBeGreaterThan(45);
      expect(m.pInf, n).toBeLessThan(75);
    }
  });

  it('v1 laws switch all three pieces off', () => {
    useV1Laws(true);
    const m = simulate({}).m;
    expect(m.bSBP).toBe(m.iaSBP);
    expect(m.pzf).toBe(0);
  });

  it('arm PWV follows the Avolio slope and the calibration sets it', () => {
    expect(musPWV(45)).toBeCloseTo(9.0, 9);
    expect(musPWV(80) - musPWV(25)).toBeCloseTo(0.048 * 55, 9);
    expect(applyCalibration({ ...DEFAULTS, age: 80 }).cMus).toBeCloseTo(10.7, 9);
  });
});
