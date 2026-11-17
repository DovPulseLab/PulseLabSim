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
    expect(w.rows[0]).toEqual(['mode', 'heart_rate', 'sample', 'time', 'aortic_pressure', 'aortic_flow', 'aortic_dPdt', 'lv_pressure', 'lv_volume', 'lv_dPdt']);
    expect(Number(w.rows[2][7])).toBeLessThan(25);   // LV pressure starts at end-diastole (LVEDP), not aortic diastolic pressure
  });
  it('writes a valid xlsx (zip) file', () => {
    const b = writeXlsx(sheets);
    expect(b[0]).toBe(0x50); expect(b[1]).toBe(0x4b);
  });
});

describe('research choices', () => {
  it('both sexes: each age for each sex', () => {
    const r = runResearch({ ...DEFAULT_RESEARCH, sexes: [0, 1], ages: [40], hrs: [70], modes: [0] });
    expect(r.patients.map(p => p.id)).toEqual(['M40', 'F40']);
    expect(r.runs.map(x => x.sex)).toEqual(['male', 'female']);
  });
  it('chosen columns and sheets only (ID columns always)', () => {
    const sh = researchWorkbook(patients, runs, { fs: 250, created: 't', version: 'v3', options: o, columns: ['EF', 'LV_dPdt_max'], profiles: false, waveforms: false });
    expect(sh.map(s => s.name)).toEqual(['Results', 'README']);
    expect(sh[0].rows[0]).toEqual(['patient', 'sex', 'age', 'mode', 'heart_rate', 'EF', 'LV_dPdt_max']);
  });
});

describe('research: vena caval occlusion', () => {
  const vo = { ...DEFAULT_RESEARCH, sexes: [0], ages: [40], hrs: [70, 100], modes: [0], vco: { every: false, dropPes: 25, beats: 10 } };
  it('once per patient at rest: fits, beats and loops sheets; no VCO columns in Results', () => {
    const r = runResearch(vo);
    expect(r.patients[0].vco!.espvr.r2).toBeGreaterThan(0.99);
    expect(r.runs.every(x => !x.vco)).toBe(true);
    const sh = researchWorkbook(r.patients, r.runs, { fs: 500, created: 't', version: 'v3', options: vo });
    expect(sh.map(s => s.name)).toEqual(['Results', 'Patient profiles', 'Occlusion fits', 'Occlusion beats', 'Occlusion loops (rest)', 'M40 waveforms', 'README']);
    expect(sh[0].rows[0]).not.toContain('VCO_Ees');
    expect(sh[2].rows.length).toBe(3);                       // header, units, rest
    expect(sh[3].rows.length).toBe(2 + 11);                  // control + 10 beats
    expect(sh[1].rows.some(row => row[0] === 'Occlusion ESPVR slope Ees (fitted)')).toBe(true);
  });
  it('at every heart rate too: VCO columns in Results and one fit per run', () => {
    const o2 = { ...vo, vco: { ...vo.vco, every: true } };
    const r = runResearch(o2);
    const sh = researchWorkbook(r.patients, r.runs, { fs: 500, created: 't', version: 'v3', options: o2, vcoLoops: false });
    expect(sh.map(s => s.name)).not.toContain('Occlusion loops (rest)');
    const head = sh[0].rows[0] as string[], k = head.indexOf('VCO_Ees');
    expect(k).toBeGreaterThan(0);
    expect(sh[0].rows.slice(2).every(row => Number(row[k]) > 0.5)).toBe(true);
    expect(sh[2].rows.length).toBe(2 + 1 + 2);              // rest + two heart rates
  });
  it('is skipped with the fixed-flow heart', () => {
    const r = runResearch({ ...vo, heart: 0 });
    expect(r.patients[0].vco).toBeUndefined();
  });
});
