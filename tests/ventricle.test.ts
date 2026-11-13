/* v3 stage 1: time-varying elastance LV coupled to the v2 arterial model. */
import { describe, expect, it } from 'vitest';
import { DEFAULTS, PRESETS } from '../src/config/physiology';
import { simulate } from '../src/model';
import { LV_DEFAULTS, elastanceShape, simulateLV } from '../src/model/ventricle';

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
    const hi = simulateLV(base, { edv: 155 });
    expect(hi.sv).toBeGreaterThan(r.sv + 5); expect(hi.dpdtMax).toBeGreaterThan(r.dpdtMax);
  });
  it('contractility: higher Ees raises SV and dP/dt max', () => {
    const hi = simulateLV(base, { ees: LV_DEFAULTS.ees * 1.3 });
    expect(hi.sv).toBeGreaterThan(r.sv); expect(hi.dpdtMax).toBeGreaterThan(r.dpdtMax * 1.15);
  });
  it('afterload: narrower arterioles lower SV and raise end-systolic pressure', () => {
    const hi = simulateLV({ ...base, radius: 92 });
    expect(hi.sv).toBeLessThan(r.sv - 3); expect(hi.lvesp).toBeGreaterThan(r.lvesp + 5);
  });
  it('coupling and relaxation in published healthy ranges', () => {
    const eaEes = r.ea / LV_DEFAULTS.ees;
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
