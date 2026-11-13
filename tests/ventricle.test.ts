/* v3 stages 1–2: time-varying elastance LV with EDPVR and mitral filling, coupled to the v2 arterial model. */
import { describe, expect, it } from 'vitest';
import { DEFAULTS, PRESETS } from '../src/config/physiology';
import { simulate } from '../src/model';
import { FUJIMOTO_2012, LV_FIXED, edpvrForAge, elastanceShape, lvForPatient, simulateLV } from '../src/model/ventricle';

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
    expect(r.dpdtMin).toBeLessThan(-1200); expect(r.dpdtMin).toBeGreaterThan(-2000); // Zhang & Kovács 2009
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
  it('EDPVR passes through each Fujimoto 2012 age group (PCWP at its EDV index)', () => {
    FUJIMOTO_2012.age.forEach((age, i) => {
      const e = edpvrForAge(age);
      expect(e.pRef).toBeCloseTo(FUJIMOTO_2012.pcwp[i], 10); expect(e.edviRef).toBeCloseTo(FUJIMOTO_2012.edvi[i], 10); expect(e.a).toBeCloseTo(FUJIMOTO_2012.a[i], 10);
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
