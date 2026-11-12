/* v2.1: patient calibration, study profiles, ejection time in ms, HR to 180 bpm, diastolic decay. */
import { describe, expect, it } from 'vitest';
import { ALL_CONTROLS, DEFAULTS, PRESETS, STUDY_PROFILES, controlText, weisslerMs, type Params } from '../src/config/physiology';
import { aortaDiameter, applyCalibration, bsaDuBois, calibrate, extrapolatedAt, gammaFor, pwvNormal, radiusFor, svIndex, svIndexLegacy } from '../src/model/calibrate';
import { diastolicDecay } from '../src/model/indices';
import { simulate } from '../src/model';
import { runStudyValidation } from '../src/model/validationStudy';
import { withInput } from '../src/state/store';
import { decodeHash, encodeState } from '../src/state/url';
import { defaultState } from '../src/state/types';
import { methodsHtml } from '../src/config/methods';

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
  it('WASE 2021 Doppler SV index: group means at the midpoints, lower in women, no forced age decline', () => {
    expect(svIndex(0, 29)).toBe(39.7); expect(svIndex(0, 53)).toBe(39.0); expect(svIndex(0, 72)).toBe(39.3);
    expect(svIndex(1, 29)).toBe(37.4); expect(svIndex(1, 53)).toBe(38.1); expect(svIndex(1, 72)).toBe(38.3);
    expect(svIndex(0, 18)).toBe(39.7); expect(svIndex(1, 90)).toBe(38.3);
    expect(svIndex(1, 45)).toBeLessThan(svIndex(0, 45));
  });
  it('the pre-v2.7 Maceira × 0.70 rule is kept for comparison and still falls with age', () => {
    expect(svIndexLegacy(0, 25)).toBeCloseTo(56 * 0.70, 10);
    expect(svIndexLegacy(0, 25)).toBeGreaterThan(svIndexLegacy(0, 75));
  });
  it('radius and Γ age curves pass through the fitted study profiles and are flat beyond 25–80 y', () => {
    for (const sp of Object.values(STUDY_PROFILES)) {
      expect(radiusFor(sp.sex, sp.age)).toBe(sp.radius);
      expect(gammaFor(sp.sex, sp.age)).toBe(sp.gamma);
    }
    expect(radiusFor(0, 90)).toBe(radiusFor(0, 80)); expect(gammaFor(1, 20)).toBe(gammaFor(1, 25));
    expect(gammaFor(0, 55)).toBeCloseTo((0.23 + 0.27) / 2, 10);
  });
  it('calibration flags what is extrapolated at a given age', () => {
    expect(extrapolatedAt(50)).toEqual([]);
    expect(extrapolatedAt(90)).toEqual(['diam', 'cAo', 'sv', 'cMus', 'radius', 'gamma']);
    expect(extrapolatedAt(78)).toEqual(['cAo', 'sv', 'cMus']);
  });
  it('study profiles use the calibrated values for their sex, age, height and weight', () => {
    for (const [name, sp] of Object.entries(STUDY_PROFILES)) {
      const c = applyCalibration({ ...DEFAULTS, ...PRESETS[name] });
      expect({ name, diam: c.diam, cAo: c.cAo, sv: c.sv, cMus: c.cMus, radius: c.radius, gamma: c.gamma })
        .toEqual({ name, diam: sp.diam, cAo: sp.cAo, sv: sp.sv, cMus: sp.cMus, radius: sp.radius, gamma: sp.gamma });
    }
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
  it('changing age, height, weight or sex recalibrates (v2.7: radius and Γ too); other inputs are untouched', () => {
    const before: Params = { ...DEFAULTS, gamma: 0.5, radius: 97, cMus: 12, lpScale: 1.2 };
    for (const [key, value] of [['age', 70], ['height', 160], ['weight', 95], ['sex', 1]] as const) {
      const after = withInput(before, key, value);
      expect(after[key]).toBe(value);
      const cal = applyCalibration({ ...before, [key]: value } as Params);
      expect(after.diam).toBe(cal.diam); expect(after.cAo).toBe(cal.cAo); expect(after.sv).toBe(cal.sv);
      expect(after.radius).toBe(cal.radius); expect(after.gamma).toBe(cal.gamma);
      expect(after.lpScale).toBe(1.2); expect(after.hr).toBe(DEFAULTS.hr);
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
  it('heart-rate and decay checks pass, two documented as near', () => {
    const notPass = [...r.heartRate, ...r.decay].filter(c => c.verdict !== 'pass');
    expect(notPass.map(c => `${c.verdict}: ${c.what}`)).toEqual([
      'near: Pacing 70 → 100 bpm (cardiac output held): fall in AIx per 10 bpm',
      'near: Higher HR at the same output: fitted τ about the same'
    ]);
  });
  it('known limitations stay as documented (no new failures)', () => {
    const fails = r.profiles.flatMap(p => p.checks.filter(c => c.verdict === 'fail').map(c => `${p.name}: ${c.what}`));
    // v2.7 (WASE Doppler SV): the 80-y woman's brachial − aortic SBP improves to 'near';
    // her free-asymptote τ (0.13 s) moves from 'near' to 'fail' (the documented τ limitation).
    expect(fails).toEqual(['Healthy woman (45 y): Intra-arterial brachial − aortic SBP', 'Healthy woman (80 y): Diastolic decay τ (asymptote fitted)']);
  });
});

describe('v2.4 model review checks', () => {
  const laws = runStudyValidation().laws;
  it('pressure → PWV slope and ejection-time rows pass against data', () => {
    for (const c of laws.slice(0, 4)) expect(c.verdict, c.what).toBe('pass');
  });
  it('the fitted-τ vs R·C limitation is reported, not hidden', () => {
    const last = laws[laws.length - 1];
    expect(last.what).toMatch(/Known limitation/);
    expect(last.verdict).toBe('fail');
  });
});

describe('v2.7 age evidence', () => {
  const s = runStudyValidation();
  it('stroke-volume index rows match WASE and cardiac index stays in the Doppler range', () => {
    for (const p of s.profiles) {
      expect(p.checks.find(c => c.what === 'Stroke-volume index')!.verdict, p.name).toBe('pass');
      expect(p.checks.find(c => c.what === 'Cardiac index (HR 70)')!.verdict, p.name).toBe('pass');
    }
  });
  it('SVR index is near Redfield and roughly flat with age', () => {
    for (const p of s.profiles.filter(p => p.name.includes('45') || p.name.includes('65') || p.name.includes('80')))
      expect(p.checks.find(c => c.what === 'SVR index')!.verdict, p.name).toBe('pass');
  });
  it('age-trend verdicts are pinned (MAP plateau is the documented miss)', () => {
    expect(s.aging.map(c => `${c.what}: ${c.verdict}`)).toEqual([
      'Reflected-wave round trip, change per decade 25 → 65 y (men): pass',
      'Reflected-wave round trip, change per decade 25 → 65 y (women): pass',
      'SVR index, 45 → 80 y (men): pass',
      'SVR index, 45 → 80 y (women): pass',
      'MAP after midlife: lowest of 65 / 80 y minus 45 y (men): fail',
      'MAP after midlife: lowest of 65 / 80 y minus 45 y (women): fail',
      'Characteristic impedance Zc, 25–45 y profiles: pass'
    ]);
  });
  it('Methods documents the provenance and the superseded SV rule', () => {
    const html = methodsHtml();
    expect(html).toContain('16 · Age evidence and data provenance (v2.7)');
    expect(html).toContain('WASE, Patel 2021');
    expect(html).toContain('Superseded');
    expect(html).toContain('bolus');
  });
});
