/* v2.1: patient calibration, study profiles, ejection time in ms, HR to 180 bpm, diastolic decay. */
import { describe, expect, it } from 'vitest';
import { ALL_CONTROLS, DEFAULTS, PRESETS, STUDY_PROFILES, controlText, weisslerMs, type Params } from '../src/config/physiology';
import { aortaDiameter, applyCalibration, bsaDuBois, calibrate, pwvNormal, svIndex } from '../src/model/calibrate';
import { diastolicDecay } from '../src/model/indices';
import { simulate } from '../src/model';
import { runStudyValidation } from '../src/model/validationStudy';
import { withInput } from '../src/state/store';
import { decodeHash, encodeState } from '../src/state/url';
import { defaultState } from '../src/state/types';

const ET = ALL_CONTROLS.find(c => c.key === 'etScale')!;

describe('calibration equations', () => {
  it('Du Bois BSA', () => {
    expect(bsaDuBois(175, 70)).toBeCloseTo(1.85, 2);
  });
  it('Campens 2014 ascending aorta: larger with age, BSA and in men', () => {
    const m45 = aortaDiameter(0, 45, 1.9).mean;
    expect(m45).toBeCloseTo(Math.pow(10, 1.033 + 0.188 * Math.log10(45) + 0.070 * 1.9) / 10, 10);
    expect(aortaDiameter(0, 65, 1.9).mean).toBeGreaterThan(m45);
    expect(aortaDiameter(0, 45, 2.1).mean).toBeGreaterThan(m45);
    expect(aortaDiameter(1, 45, 1.9).mean).toBeLessThan(m45);
    const r = aortaDiameter(0, 45, 1.9);
    expect(r.lo).toBeLessThan(r.mean); expect(r.hi).toBeGreaterThan(r.mean);
  });
  it('RVASC 2010 normal PWV by decade, interpolated and flat beyond the ends', () => {
    expect(pwvNormal(25).mean).toBe(6.2);
    expect(pwvNormal(45).mean).toBe(7.2);
    expect(pwvNormal(50).mean).toBeCloseTo(7.75, 10);
    expect(pwvNormal(18).mean).toBe(6.2);
    expect(pwvNormal(90).mean).toBe(10.9);
  });
  it('Maceira 2006 SV index falls with age and is lower in women', () => {
    expect(svIndex(0, 25)).toBeGreaterThan(svIndex(0, 75));
    expect(svIndex(1, 45)).toBeLessThan(svIndex(0, 45));
  });
  it('applyCalibration sets diameter, PWV and SV on slider steps', () => {
    const p = applyCalibration({ ...DEFAULTS, sex: 1, age: 65, height: 160, weight: 61 });
    const c = calibrate(p);
    expect(p.diam).toBeCloseTo(Math.round(c.diam / 0.05) * 0.05, 10);
    expect(p.cAo).toBe(10.3);
    expect(p.sv).toBe(Math.round(c.sv));
  });
});

describe('demographic inputs', () => {
  it('changing age, height, weight or sex recalibrates; other inputs are untouched', () => {
    const before: Params = { ...DEFAULTS, gamma: 0.5, radius: 97 };
    for (const [key, value] of [['age', 70], ['height', 160], ['weight', 95], ['sex', 1]] as const) {
      const after = withInput(before, key, value);
      expect(after[key]).toBe(value);
      const cal = applyCalibration({ ...before, [key]: value } as Params);
      expect(after.diam).toBe(cal.diam); expect(after.cAo).toBe(cal.cAo); expect(after.sv).toBe(cal.sv);
      expect(after.gamma).toBe(0.5); expect(after.radius).toBe(97);
    }
  });
  it('other inputs do not recalibrate', () => {
    const after = withInput({ ...DEFAULTS }, 'hr', 90);
    expect(after.diam).toBe(DEFAULTS.diam); expect(after.cAo).toBe(DEFAULTS.cAo); expect(after.sv).toBe(DEFAULTS.sv);
  });
  it('a sex change keeps the ejection time in ms', () => {
    const p = { ...DEFAULTS };
    const ms0 = ET.view!.to(p.etScale, p);
    const q = withInput(p, 'sex', 1);
    expect(ET.view!.to(q.etScale, q)).toBeCloseTo(ms0, 3);
  });
  it('age and weight do not act on the waveform directly', () => {
    const a = simulate({ ...DEFAULTS }).m, b = simulate({ ...DEFAULTS, age: 80, weight: 120 }).m;
    expect(b.Ps).toBe(a.Ps); expect(b.AIx).toBe(a.AIx);
  });
  it('URL links keep sex, age and weight', () => {
    const s = defaultState();
    s.patients.B.inputs = { ...s.patients.B.inputs, sex: 1, age: 63, weight: 58 };
    const r = decodeHash(encodeState(s));
    expect(r.state.patients.B.inputs).toMatchObject({ sex: 1, age: 63, weight: 58 });
  });
});

describe('ejection duration in ms', () => {
  it('starts at 300 ms in the default patient and every study profile', () => {
    expect(simulate({}).m.et).toBeCloseTo(300, 2);
    for (const name of Object.keys(STUDY_PROFILES)) expect(simulate({ ...DEFAULTS, ...PRESETS[name] }).m.et).toBeCloseTo(300, 2);
    expect(controlText(ET, DEFAULTS.etScale, DEFAULTS)).toBe('300 ms');
  });
  it('follows HR through the sex-specific Weissler lines', () => {
    for (const sex of [0, 1]) for (const hr of [50, 90, 120]) {
      const p = { ...DEFAULTS, sex, hr };
      expect(ET.view!.to(p.etScale, p)).toBeCloseTo(p.etScale * weisslerMs(hr, sex), 10);
      expect(simulate(p).m.et).toBeCloseTo(p.etScale * weisslerMs(hr, sex), 6);
    }
    expect(weisslerMs(70, 0)).toBe(294);
    expect(weisslerMs(70, 1)).toBe(306);
  });
});

describe('heart rate up to 180 bpm', () => {
  it('the slider reaches 180 and ejection fits in the cycle', () => {
    expect(ALL_CONTROLS.find(c => c.key === 'hr')!.max).toBe(180);
    const m = simulate({ hr: 180 }).m;
    expect(m.et).toBeCloseTo(150, 6);
    for (const v of Object.values(m)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
  });
});

describe('diastolic decay', () => {
  it('recovers τ exactly from a pure exponential, and τ and P∞ from an offset one', () => {
    const n = 1024, dt = 0.001;
    const a = diastolicDecay(Array.from({ length: n }, (_, k) => 90 * Math.exp(-k * dt / 1.4)), dt, 300);
    expect(a.tau).toBeCloseTo(1.4, 8);
    const b = diastolicDecay(Array.from({ length: n }, (_, k) => 60 + 30 * Math.exp(-k * dt / 0.4)), dt, 300);
    expect(b.pInf).toBeCloseTo(60, 0);
    expect(b.tauFree).toBeCloseTo(0.4, 2);
  });
  it('is reported for every preset, positive and finite', () => {
    for (const p of Object.values(PRESETS)) {
      const m = simulate({ ...DEFAULTS, ...p }).m;
      expect(m.tauFit).toBeGreaterThan(0.2); expect(m.tauFit).toBeLessThan(5);
      expect(m.decayRate).toBeGreaterThan(0);
      expect(m.pInf).toBeGreaterThanOrEqual(0); expect(m.pInf).toBeLessThan(m.Pd);
    }
  });
});

describe('study-profile validation', () => {
  const r = runStudyValidation();
  it('every profile meets its two fitted targets', () => {
    for (const p of r.profiles) for (const c of p.checks.filter(x => x.fitted)) expect(c.verdict, `${p.name}: ${c.what}`).toBe('pass');
  });
  it('calibrated diameter and operating PWV sit inside the published normal ranges', () => {
    for (const p of r.profiles) for (const c of p.checks.filter(x => /diameter|PWV/.test(x.what))) expect(c.verdict, `${p.name}: ${c.what}`).toBe('pass');
  });
  it('heart-rate and decay checks all pass', () => {
    for (const c of [...r.heartRate, ...r.decay]) expect(c.verdict, c.what).toBe('pass');
  });
  it('known limitations stay as documented (no new failures)', () => {
    const fails = r.profiles.flatMap(p => p.checks.filter(c => c.verdict === 'fail').map(c => `${p.name}: ${c.what}`));
    expect(fails).toEqual(['Healthy man (25 y): Diastolic decay τ (asymptote 0)', 'Healthy woman (65 y): Amplification (cuff − central SBP)']);
  });
});
