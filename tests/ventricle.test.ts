/* v3 stages 1–2: time-varying elastance LV with EDPVR and mitral filling, coupled to the v2 arterial model. */
import { describe, expect, it } from 'vitest';
import { DEFAULTS, PRESETS } from '../src/config/physiology';
import { simulate } from '../src/model';
import { FUJIMOTO_2012, LVEDP_REF, LV_FIXED, V3_FIT, V3_SHAPE, edpvrForAge, elastanceShape, lvForPatient, relaxForAge, simulateLV, stiffenedEDPVR, v3For } from '../src/model/ventricle';
import { LV_PUBLISHED, healthyRangeFor } from '../src/config/lvReference';
import { runV3Validation } from '../src/model/validationV3';

const base = { ...DEFAULTS };
const r = simulateLV(base);

describe('elastance shape', () => {
  it('is 0 at onset, peaks at 1 near Tmax and relaxes', () => {
    expect(elastanceShape(0)).toBe(0);
    let m = 0, xm = 0; for (let x = 0.01; x < 2; x += 0.001) { const e = elastanceShape(x); if (e > m) { m = e; xm = x; } }
    expect(m).toBeCloseTo(1, 6); expect(xm).toBeGreaterThan(0.85); expect(xm).toBeLessThan(1.15);
    expect(elastanceShape(1.6)).toBeLessThan(0.05);
  });
});

describe('coupled beat', () => {
  it('converges for every preset and heart rates 50–150 bpm', () => {
    for (const name of Object.keys(PRESETS)) { const x = simulateLV({ ...DEFAULTS, ...PRESETS[name] }); expect(x.converged, name).toBe(true); expect(x.iterations, name).toBeLessThan(60); }
    for (const hr of [50, 90, 120, 150]) expect(simulateLV({ ...base, hr }).converged, `HR ${hr}`).toBe(true);
  });
  it('mass balance: SV = EDV − ESV = mean flow × T', () => {
    expect(r.sv).toBeCloseTo(r.edv - r.esv, 1);
    const qm = r.beat.q.reduce((a, b) => a + b, 0) / r.beat.q.length;
    expect(qm * r.beat.d.T).toBeCloseTo(r.sv, 1);
  });
  it('valve: no backflow, flow only while the LV is ejecting', () => {
    expect(Math.min(...r.beat.q)).toBeGreaterThanOrEqual(0);
    const n = Math.round(r.lvet / r.beat.dt);
    for (let k = n + 2; k < r.beat.q.length; k++) expect(r.beat.q[k]).toBe(0);
  });
  it('the arterial output keeps the v2 origin (index 0 = start of ejection) and MAP = CO × SVR', () => {
    expect(r.beat.q[0]).toBeGreaterThan(0);
    expect(r.beat.m.map).toBeCloseTo(r.beat.d.svr * r.sv / r.beat.d.T, 0);
  });
});

describe('ventricular physiology', () => {
  it('Frank–Starling: more preload, more stroke volume and dP/dt', () => {
    const hi = simulateLV(base, { edv: r.lvp.edv * 1.15 });
    expect(hi.sv).toBeGreaterThan(r.sv + 5); expect(hi.dpdtMax).toBeGreaterThan(r.dpdtMax);
  });
  it('contractility: higher Ees raises SV and dP/dt max', () => {
    const hi = simulateLV(base, { ees: LV_FIXED.ees * 1.3 });
    expect(hi.sv).toBeGreaterThan(r.sv); expect(hi.dpdtMax).toBeGreaterThan(r.dpdtMax * 1.15);
  });
  it('afterload: narrower arterioles lower SV and raise end-systolic pressure', () => {
    const hi = simulateLV({ ...base, radius: 92 });
    expect(hi.sv).toBeLessThan(r.sv - 3); expect(hi.lvesp).toBeGreaterThan(r.lvesp + 5);
  });
  it('coupling and relaxation in published healthy ranges', () => {
    const eaEes = r.ea / LV_FIXED.ees;
    expect(eaEes).toBeGreaterThan(0.5); expect(eaEes).toBeLessThan(0.9);            // Chen 1998; Redfield 2005 ≈ 0.6–0.7
    expect(r.dpdtMin).toBeLessThan(-1500); expect(r.dpdtMin).toBeGreaterThan(-2200); // Mulligan 2026, normal adult
    expect(r.ef).toBeGreaterThan(0.5); expect(r.ef).toBeLessThan(0.7);
  });
});

describe('agreement with v2 (same arteries, ventricle instead of prescribed flow)', () => {
  it('default adult: pressures, AIx and SV within a few units', () => {
    const v2 = simulate(base).m, m = r.beat.m;
    expect(Math.abs(m.Ps - v2.Ps)).toBeLessThan(6);
    expect(Math.abs(m.Pd - v2.Pd)).toBeLessThan(3);
    expect(Math.abs(m.bSBP - v2.bSBP)).toBeLessThan(6);
    expect(Math.abs(m.AIx - v2.AIx)).toBeLessThan(5);
    expect(Math.abs(r.sv - DEFAULTS.sv)).toBeLessThan(3);
    expect(Math.abs(Math.max(...r.beat.q) - Math.max(...simulate(base).q))).toBeLessThan(30);
  });
});

describe('stage 2: EDPVR, filling and LVEDP', () => {
  it('EDPVR passes through the healthy LVEDP (8 mmHg) at each Fujimoto 2012 age group\'s EDV index', () => {
    FUJIMOTO_2012.age.forEach((age, i) => {
      const e = edpvrForAge(age);
      expect(e.pRef).toBe(LVEDP_REF); expect(e.edviRef).toBeCloseTo(FUJIMOTO_2012.edvi[i], 10); expect(e.a).toBeCloseTo(FUJIMOTO_2012.a[i], 10);
    });
  });
  it('with the age-typical EDV, LVEDP and LA pressure equal that age\'s measured filling pressure', () => {
    for (const age of [28, 57]) {
      const x = simulateLV({ ...base, age });
      expect(x.lvedp).toBeCloseTo(edpvrForAge(age).pRef, 0);
      expect(x.pla).toBeCloseTo(x.lvedp, 0);
    }
  });
  it('LVEDP is calculated from preload: more volume, higher LVEDP along the exponential EDPVR', () => {
    const lo = simulateLV(base, { edv: r.lvp.edv * 0.9 }), hi = simulateLV(base, { edv: r.lvp.edv * 1.1 });
    expect(lo.lvedp).toBeLessThan(r.lvedp); expect(hi.lvedp).toBeGreaterThan(r.lvedp);
    expect(hi.lvedp - r.lvedp).toBeGreaterThan(r.lvedp - lo.lvedp);       // convex (stiffer at higher volume)
  });
  it('a stiffer ventricle (older EDPVR constant) needs a higher filling pressure for the same volume', () => {
    const young = lvForPatient({ ...base, age: 28 }), stiff = simulateLV(base, { ...young, a: 0.068 }), soft = simulateLV(base, { ...young });
    expect(stiff.lvedp).toBeCloseTo(soft.lvedp, 0);                       // same reference point…
    const stiffHi = simulateLV(base, { ...young, a: 0.068, edv: young.edv * 1.15 }), softHi = simulateLV(base, { ...young, edv: young.edv * 1.15 });
    expect(stiffHi.lvedp).toBeGreaterThan(softHi.lvedp + 1);               // …but steeper above it
  });
  it('the beat is periodic and the valves never open together', () => {
    expect(Math.abs(r.vol[0] - r.vol[r.vol.length - 1])).toBeLessThan(1.5);
    for (let k = 0; k < r.qm.length; k++) expect(r.qm[k] > 0 && r.beat.q[k] > 0).toBe(false);
  });
  it('isovolumic relaxation time in the normal range', () => {
    expect(r.ivrt * 1000).toBeGreaterThan(60); expect(r.ivrt * 1000).toBeLessThan(110);
  });
});

describe('stage 3: calibration by age and sex', () => {
  const v = runV3Validation();
  it('the fitted targets (SV, Herbert cuff SBP, Janner AIx) are met', () => {
    const misses = v.profiles.flatMap(p => p.checks.filter(c => c.fitted && c.verdict !== 'pass').map(c => `${p.name}: ${c.what}`));
    expect(misses).toEqual([]);
  });
  it('the fits are stored at the profile ages and interpolate between them', () => {
    expect(v3For(0, 65).ees).toBe(V3_FIT.male.ees[2]);
    expect(v3For(1, 55).ees).toBeCloseTo((V3_FIT.female.ees[1] + V3_FIT.female.ees[2]) / 2, 10);
    expect(v3For(0, 90).radius).toBe(V3_FIT.male.radius[3]);
  });
  it('age trends: Ees and dP/dt max rise, τ slows modestly (Chen, Redfield, Zhang & Kovács, Mulligan)', () => {
    for (const c of v.trends.filter(c => /^(Ees rises|τ with age|dP\/dt max with age)/.test(c.what))) expect(c.verdict, c.what).toBe('pass');
  });
  it('known v3 misses are pinned so changes are noticed', () => {
    expect(v.trends.filter(c => c.verdict !== 'pass').map(c => `${c.what}: ${c.verdict}`)).toEqual([
      'Ea/Ees with age, 25 → 80 y (men): near',
      'MAP after midlife: lowest of 65 / 80 y minus 45 y (men): near',
      '−dP/dt with age, 25 → 80 y (women): near'
    ]);
  });
});

describe('v3.2: calibration to Mulligan 2026 (human LV dP/dt and LVEDP)', () => {
  const v = runV3Validation();
  it('every healthy profile has dP/dt max and LVEDP inside its healthy range, and −dP/dt within 100 mmHg/s of it', () => {
    for (const { name, r } of v.profiles) {
      const age = Number(name.match(/\((\d+) y\)/)![1]), h = healthyRangeFor(age);
      expect(r.dpdtMax, name).toBeGreaterThanOrEqual(h.dpdtMax.lo); expect(r.dpdtMax, name).toBeLessThanOrEqual(h.dpdtMax.hi);
      expect(r.lvedp, name).toBeGreaterThanOrEqual(h.lvedp.lo); expect(r.lvedp, name).toBeLessThanOrEqual(h.lvedp.hi);
      expect(r.dpdtMin, name).toBeGreaterThanOrEqual(h.dpdtMin.lo - 100); expect(r.dpdtMin, name).toBeLessThanOrEqual(h.dpdtMin.hi);
      expect(r.tau * 1000, name).toBeGreaterThan(35); expect(r.tau * 1000, name).toBeLessThan(55);
    }
  });
  it('the 45-y man is within one SD of the published normal controls', () => {
    const r = v.profiles.find(p => p.name === 'Healthy man (45 y)')!.r, c = LV_PUBLISHED[0];
    expect(Math.abs(r.dpdtMax - c.dpdtMax)).toBeLessThan(c.dpdtMaxSd!);
    expect(Math.abs(r.dpdtMin - c.dpdtMin!)).toBeLessThan(c.dpdtMinSd!);
    expect(Math.abs(r.lvedp - c.lvedp!)).toBeLessThan(c.lvedpSd!);
  });
  it('the exponential relaxation tail joins the Hill curve smoothly and decays at 1/tauX', () => {
    const h = { ...V3_SHAPE, tauX: relaxForAge(45) }, d = 1e-4;
    let prev = elastanceShape(1, h), maxJump = 0;
    for (let x = 1 + d; x < 1.6; x += d) { const e = elastanceShape(x, h); maxJump = Math.max(maxJump, Math.abs(e - prev)); prev = e; }
    expect(maxJump).toBeLessThan(0.002);                                            // continuous
    const x = 1.5, rate = -(Math.log(elastanceShape(x + d, h)) - Math.log(elastanceShape(x - d, h))) / (2 * d);
    expect(rate).toBeCloseTo(1 / h.tauX, 3);                                        // exponential at 1/tauX
    expect(relaxForAge(80)).toBeGreaterThan(relaxForAge(45));
  });
  it('diastolic stiffness raises LVEDP at normal preload (HFpEF-like range at 1.5–2.5×)', () => {
    const base = lvForPatient(DEFAULTS);
    expect(stiffenedEDPVR(base, 1)).toEqual({ a: base.a, pRef: base.pRef });
    const at = (k: number) => simulateLV(DEFAULTS, stiffenedEDPVR(base, k)).lvedp;
    expect(at(1)).toBeCloseTo(8, 0); expect(at(1.5)).toBeGreaterThan(10); expect(at(2.5)).toBeGreaterThan(20); expect(at(2.5)).toBeLessThan(26);
  });
});
