/* v3 stage 5: drugs, heart rate and response modes acting on the ventricle. */
import { describe, expect, it } from 'vitest';
import { ACUTE_DRUGS, DEFAULTS, PRESETS } from '../src/config/physiology';
import { simulate } from '../src/model';
import { applyCalibration } from '../src/model/calibrate';
import { applyDrugEffects, v3SvRatio, type DrugEvent } from '../src/engine/kinetics';
import { simulateLV, lvForPatient } from '../src/model/ventricle';
import { v3DrugChecks, v3RateChecks } from '../src/model/validationV3';

const prof = (heart: number, extra = {}) => applyCalibration({ ...DEFAULTS, ...PRESETS['Healthy man (45 y)'], heart, ...extra });
const dose = (drug: string): DrugEvent[] => [{ id: 1, drug, mode: 'infusion', t0: 0, tStop: null, dose: 1, steady: true, rampS: 0 }];

describe('drugs with the ventricle', () => {
  const base = prof(1), m0 = simulate(base).m;
  it('svAdd is ignored; contractility and preload act instead', () => {
    const p = applyDrugEffects(base, dose('dobutamine'), 3600).params;
    expect(p.sv).toBe(base.sv);
    expect(p.ees).toBeCloseTo(base.ees * 1.55, 6);
    expect(applyDrugEffects(base, dose('ntg'), 3600).params.preload).toBeCloseTo(0.89, 6);
  });
  it('the v2 heart keeps its v2 drug effects', () => {
    const b2 = prof(0), p = applyDrugEffects(b2, dose('dobutamine'), 3600).params;
    expect(p.sv).toBeCloseTo(b2.sv + 15, 6);
  });
  it('directions: dobutamine raises dP/dt, esmolol lowers it, NTG lowers LVEDP', () => {
    const at = (d: string) => simulate(applyDrugEffects(base, dose(d), 3600).params).m;
    expect(at('dobutamine').dpdtMax).toBeGreaterThan(m0.dpdtMax * 1.3);
    expect(at('esmolol').dpdtMax).toBeLessThan(m0.dpdtMax * 0.8);
    expect(at('ntg').lvEDP).toBeLessThan(m0.lvEDP - 2);
  });
  it('the fast SV estimate is within 3 % of full beats for every acute drug', () => {
    for (const d of Object.keys(ACUTE_DRUGS)) {
      const p = applyDrugEffects(base, dose(d), 3600).params;
      const est = base.sv * v3SvRatio(p, base);
      expect(Math.abs(est / simulate(p).m.svOut - 1), d).toBeLessThan(0.03);
    }
  });
});

describe('heart rate with the ventricle', () => {
  const b = prof(1), L = lvForPatient(b);
  it('relaxes fully and converges from 50 to 180 bpm, even at low preload', () => {
    for (const hr of [50, 90, 140, 180]) for (const pre of [0.6, 1]) {
      const r = simulateLV({ ...b, hr }, { ees: b.ees, edv: L.edv * pre });
      expect(r.converged, `${hr} bpm × ${pre}`).toBe(true);
      expect(r.sv).toBeGreaterThan(15);
      expect(r.lvedp).toBeLessThan(18);
    }
  });
  it('pacing keeps cardiac output; exercise raises Ees', () => {
    const at = (hr: number, resp: number) => { const p = applyDrugEffects(prof(1, { resp, hrRest: 70, hr }), [], 0).params; return { p, m: simulate(p).m }; };
    const a = at(70, 1), c = at(140, 1);
    expect(Math.abs(c.m.svOut * c.p.hr / (a.m.svOut * a.p.hr) - 1)).toBeLessThan(0.04);
    expect(at(110, 2).p.ees).toBeGreaterThan(a.p.ees * 1.3);
  });
});

describe('Validation §12 stage 5 rows', () => {
  it('all pass except the known pacing EF miss', () => {
    const bad = [...v3DrugChecks(), ...v3RateChecks()].filter(c => c.verdict !== 'pass').map(c => c.what);
    expect(bad).toEqual(['Pacing 70 → 110 bpm: ejection fraction']);
  });
});

import { runStudyValidation } from '../src/model/validationStudy';
describe('stage 6: Wilkinson pacing benchmark with the ventricle', () => {
  const s = runStudyValidation();
  const get = (rows: typeof s.wilkinson, what: string) => rows.find(r => r.what.includes(what))!;
  it('has the same eight rows as v2', () => {
    expect(s.wilkinsonV3.map(r => r.what)).toEqual(s.wilkinson.map(r => r.what));
  });
  it('the ventricle moves cuff and central SBP toward the patients (numbers quoted in §10)', () => {
    const num = (t: string) => Number(t.replace('−', '-').split(' ')[0]);
    const v2c = num(get(s.wilkinson, 'cuff SBP').model), v3c = num(get(s.wilkinsonV3, 'cuff SBP').model);
    expect(v3c).toBeGreaterThan(v2c);
    expect(v3c).toBeGreaterThanOrEqual(0); expect(v3c).toBeLessThanOrEqual(4);
    expect(num(get(s.wilkinsonV3, 'central SBP').model)).toBeGreaterThan(num(get(s.wilkinson, 'central SBP').model));
    expect(num(get(s.wilkinsonV3, 'ejection duration').model)).toBeLessThan(-80);
  });
});
