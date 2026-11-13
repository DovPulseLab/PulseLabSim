/* v3 stage 4: the ventricle inside the app — model switch, calibration, cycle diagram and export. */
import { describe, expect, it } from 'vitest';
import { DEFAULTS, PRESETS } from '../src/config/physiology';
import { simulate } from '../src/model';
import { applyCalibration } from '../src/model/calibrate';
import { buildCycle } from '../src/model/cycle';
import { LV_ONLY_KEYS, finiteOutputs } from '../src/model/indices';
import { resampleBeat, waveColumns, WAVE_COLUMNS, LV_COLUMNS } from '../src/model/waveformExport';
import { v3For } from '../src/model/ventricle';

const v2 = simulate({ ...DEFAULTS });
const v3 = simulate({ ...DEFAULTS, heart: 1 });

describe('heart model switch', () => {
  it('v2 heart leaves LV outputs empty', () => {
    expect(v2.lv).toBeUndefined();
    for (const k of LV_ONLY_KEYS) expect(Number.isFinite(v2.m[k] as number)).toBe(false);
  });
  it('v3 heart fills every LV output with a finite value', () => {
    expect(v3.lv).toBeDefined();
    for (const k of LV_ONLY_KEYS) expect(Number.isFinite(v3.m[k] as number), String(k)).toBe(true);
    expect(finiteOutputs(v3.m, 1).every(([, v]) => Number.isFinite(v))).toBe(true);
  });
  it('LV traces share the aortic grid; LV volume falls by SV', () => {
    const L = v3.lv!;
    expect(L.p.length).toBe(v3.p.length); expect(L.vol.length).toBe(v3.p.length);
    expect(Math.max(...L.vol) - Math.min(...L.vol)).toBeCloseTo(v3.m.svOut, 0);
  });
  it('Ees raises SV; preload raises SV and LVEDP; stiffness raises LVEDP', () => {
    const hi = simulate({ ...DEFAULTS, heart: 1, ees: 3 });
    expect(hi.m.svOut).toBeGreaterThan(v3.m.svOut);
    const fill = simulate({ ...DEFAULTS, heart: 1, preload: 1.2 });
    expect(fill.m.svOut).toBeGreaterThan(v3.m.svOut); expect(fill.m.lvEDP).toBeGreaterThan(v3.m.lvEDP);
    const stiff = simulate({ ...DEFAULTS, heart: 1, lvStiff: 2 });
    expect(stiff.m.lvEDP).toBeGreaterThan(v3.m.lvEDP);
  });
  it('repeat calls are cached (same object)', () => {
    expect(simulate({ ...DEFAULTS, heart: 1 })).toBe(simulate({ ...DEFAULTS, heart: 1 }));
  });
});

describe('calibration with the ventricle on', () => {
  it('uses the v3 fit for Ees, radius and reflection', () => {
    const p = applyCalibration({ ...DEFAULTS, ...PRESETS['Healthy man (65 y)'], heart: 1 });
    const f = v3For(0, 65);
    expect(p.ees).toBeCloseTo(f.ees, 2); expect(p.radius).toBeCloseTo(f.radius, 1);
  });
  it('v2 calibration is unchanged with the v2 heart', () => {
    const a = applyCalibration({ ...DEFAULTS, ...PRESETS['Healthy man (65 y)'] });
    expect(a.heart).toBe(0);
  });
});

describe('cardiac cycle diagram', () => {
  it('v2: schematic; v3: modelled timings and volumes', () => {
    expect(buildCycle(v2).modelled).toBe(false);
    const c = buildCycle(v3), m = v3.m;
    expect(c.modelled).toBe(true);
    expect((c.tAO - c.tMC) * 1000).toBeCloseTo(m.ivct, 0);
    expect(c.edv).toBeCloseTo(m.edv, 1); expect(c.esv).toBeCloseTo(m.esv, 1);
    expect(Math.max(...c.lv)).toBeCloseTo(m.lvSP, -1);
  });
});

describe('waveform export', () => {
  it('adds LV columns only with the ventricle', () => {
    expect(waveColumns(resampleBeat(v2, 500, 1))).toBe(WAVE_COLUMNS);
    const w = resampleBeat(v3, 500, 1), cols = waveColumns(w);
    expect(cols.length).toBe(WAVE_COLUMNS.length + LV_COLUMNS.length);
    expect(Math.max(...w.lv!.p)).toBeCloseTo(v3.m.lvSP, -1);
    expect(Math.max(...w.lv!.dpdt)).toBeGreaterThan(0.85 * v3.m.dpdtMax);
  });
});
