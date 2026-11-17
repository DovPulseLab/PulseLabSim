/* v3.1: vena caval occlusion (transient preload reduction) and its workbook. */
import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../src/config/physiology';
import { simulateVCO, vcoSteadyCheck, linFit } from '../src/model/vco';
import { resampleVCO, vcoWorkbook } from '../src/state/vcoWorkbook';

const p = { ...DEFAULTS, heart: 1 };

describe('vena caval occlusion', () => {
  it('with no occlusion the transient run repeats the steady beat', () => {
    const c = vcoSteadyCheck(p);
    expect(Math.abs(c.svRun - c.svSteady) / c.svSteady).toBeLessThan(0.01);
    expect(c.maxDiffP).toBeLessThan(2);
  });
  const r = simulateVCO(p);
  it('lowers end-systolic pressure by the requested 25 mmHg', () => {
    expect(r.reached).toBe(true);
    expect(r.dropPes).toBeCloseTo(25, 0);
    expect(r.beats.length).toBe(13);   // control + 12 occlusion beats
  });
  it('loops shift left: EDV, ESV, SV and filling pressure fall beat by beat', () => {
    for (let i = 2; i < r.beats.length; i++) {
      const a = r.beats[i - 1], b = r.beats[i];
      expect(b.edv).toBeLessThan(a.edv); expect(b.esv).toBeLessThan(a.esv + 0.01); expect(b.sv).toBeLessThan(a.sv); expect(b.pla).toBeLessThan(a.pla);
    }
  });
  it('end-systolic points lie on a straight ESPVR with a positive slope', () => {
    expect(r.espvr.r2).toBeGreaterThan(0.99);
    expect(r.espvr.slope).toBeGreaterThan(0.5 * r.eesModel);
    expect(r.espvr.slope).toBeLessThan(1.05 * r.eesModel);   // ejection effect lowers the fitted slope
    expect(r.espvr.v0).toBeLessThan(Math.min(...r.beats.map(b => b.esv)));
  });
  it('isochrone slopes rise through systole', () => {
    const s = r.isochrones.map(i => i.slope);
    expect(s.length).toBe(5);
    expect(s[4]).toBeGreaterThan(s[0]);
  });
  it('a weaker ventricle gives a flatter ESPVR', () => {
    expect(simulateVCO({ ...p, ees: 1.2 }).espvr.slope).toBeLessThan(r.espvr.slope);
  });
  it('linFit recovers a line', () => { const f = linFit([1, 2, 3], [5, 7, 9]); expect(f.slope).toBeCloseTo(2, 9); expect(f.v0).toBeCloseTo(-1.5, 9); });
  it('workbook: 500 Hz record from end-diastole of the control beat, one row per beat', () => {
    const w = resampleVCO(r, 500);
    expect(w.t[1]).toBeCloseTo(0.002, 9);
    expect(w.plv[0]).toBeLessThan(20);                  // starts at end-diastole (LVEDP), not aortic diastolic pressure
    expect(Math.max(...w.dpdt)).toBeGreaterThan(800);
    const sheets = vcoWorkbook(r, { fs: 500, created: 'x', version: 'v3.1', patient: 'A' });
    expect(sheets.map(s => s.name)).toEqual(['VCO waveforms', 'VCO beats', 'ESPVR', 'README']);
    expect(sheets[1].rows.length).toBe(2 + r.beats.length);
    expect(sheets[0].rows.length).toBe(2 + w.t.length);
  });
});

describe('VCO workbook dP/dt edges', () => {
  it('first rows match the same point of the steady control beat one cycle later', () => {
    const r = simulateVCO({ ...DEFAULTS, heart: 1 }), w = resampleVCO(r, 500), k = Math.round(r.T * 500);
    if (Math.abs(k - r.T * 500) < 1e-6) expect(w.dpdt[0]).toBeCloseTo(w.dpdt[k], 0);
    expect(Math.abs(w.dpdt[0])).toBeLessThan(200);   // end-diastole: LV pressure nearly flat
  });
});
