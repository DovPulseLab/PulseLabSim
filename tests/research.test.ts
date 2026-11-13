/* Research generator: patients × modes × heart rates, and its workbook. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_RESEARCH, RESULT_COLUMNS, bodySize, runResearch } from '../src/model/research';
import { researchWorkbook } from '../src/state/researchWorkbook';
import { writeXlsx } from '../src/state/xlsx';

const o = { ...DEFAULT_RESEARCH, ages: [20, 80], hrs: [60, 90, 120], modes: [0, 1, 3] };
const { patients, runs } = runResearch(o);

describe('research runs', () => {
  it('runs every patient × mode × heart rate', () => {
    expect(patients.map(p => p.id)).toEqual(['M20', 'M80']);
    expect(runs.length).toBe(2 * 3 * 3);
  });
  it('every requested column is a finite number with the ventricle', () => {
    for (const r of runs) for (const [name, , get] of RESULT_COLUMNS) {
      const v = get(r);
      if (typeof v === 'number') expect(Number.isFinite(v), `${r.patient} ${r.mode} ${r.hr} ${name}`).toBe(true);
    }
  });
  it('heart rate is applied; Independent at the resting rate equals the profile', () => {
    for (const r of runs) expect(r.beat.params.hr).toBe(r.hr);
    const p = patients[1], m = runs.find(r => r.patient === 'M80' && r.mode === 'Independent' && r.hr === 60)!;
    expect(m.beat.params.age).toBe(80);
    expect(p.rest.params.hr).toBe(70);
  });
  it('Pacing holds cardiac output; Physiologic equals Pacing without drugs', () => {
    const co = (mode: string, hr: number) => { const r = runs.find(x => x.patient === 'M80' && x.mode === mode && x.hr === hr)!; return r.beat.m.svOut * hr; };
    expect(Math.abs(co('Pacing', 120) / co('Pacing', 60) - 1)).toBeLessThan(0.05);
    expect(co('Physiologic', 90)).toBeCloseTo(co('Pacing', 90), 6);
  });
  it('body size is interpolated and held flat below 25 y', () => {
    expect(bodySize(0, 20)).toEqual(bodySize(0, 25));
    const m = bodySize(0, 35); expect(m.height).toBeLessThan(177); expect(m.height).toBeGreaterThan(176);
  });
});

describe('research workbook', () => {
  const sheets = researchWorkbook(patients, runs, { fs: 250, created: 'test', version: 'v3', options: o });
  it('Results first, README last, one waveform sheet per patient', () => {
    expect(sheets.map(s => s.name)).toEqual(['Results', 'Patient profiles', 'M20 waveforms', 'M80 waveforms', 'README']);
    expect(sheets[0].rows.length).toBe(2 + runs.length);
  });
  it('waveform sheets hold one beat per run at the sampling rate', () => {
    const w = sheets[2], expected = runs.filter(r => r.patient === 'M20').reduce((n, r) => n + Math.round(250 * r.beat.d.T), 0);
    expect(w.rows.length - 2).toBe(expected);
    expect(w.rows[0]).toEqual(['mode', 'heart_rate', 'sample', 'time', 'aortic_pressure', 'aortic_flow', 'lv_pressure', 'lv_volume']);
  });
  it('writes a valid xlsx (zip) file', () => {
    const b = writeXlsx(sheets);
    expect(b[0]).toBe(0x50); expect(b[1]).toBe(0x4b);
  });
});
