/* v2.8: synchronized pressure–flow export at a fixed sampling rate, and the xlsx writer. */
import { describe, expect, it } from 'vitest';
import { DEFAULTS, PRESETS } from '../src/config/physiology';
import { simulate } from '../src/model';
import { periodicInterp, resampleBeat, WAVE_COLUMNS } from '../src/model/waveformExport';
import { colName, crc32, writeXlsx } from '../src/state/xlsx';
import { waveformWorkbook } from '../src/state/waveformWorkbook';

const beat = simulate({ ...DEFAULTS, hr: 70 });

describe('resampling', () => {
  it('uniform grid at the requested rate, length = fs × T × beats', () => {
    for (const fs of [200, 500, 1000]) for (const n of [1, 3]) {
      const w = resampleBeat(beat, fs, n);
      expect(w.t.length).toBe(Math.round(fs * beat.d.T * n));
      expect(w.t[1] - w.t[0]).toBeCloseTo(1 / fs, 12);
      expect(w.beat[w.beat.length - 1]).toBe(n);
    }
  });
  it('rejects rates below 200 Hz', () => {
    expect(() => resampleBeat(beat, 100, 1)).toThrow();
  });
  it('pressure and flow are synchronized samples of the solver beat', () => {
    const w = resampleBeat(beat, 1000, 1);
    for (const i of [0, 37, 200, 611]) {
      expect(w.p[i]).toBeCloseTo(periodicInterp(beat.p, beat.dt, w.t[i]), 10);
      expect(w.q[i]).toBeCloseTo(periodicInterp(beat.q, beat.dt, w.t[i]), 10);
    }
    expect(w.p[0]).toBeCloseTo(beat.p[0], 10);
  });
  it('mean flow × cycle length = stroke volume; mean pressure = MAP; P = Pf + Pb', () => {
    const w = resampleBeat(beat, 1000, 1);
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    expect(mean(w.q) * beat.d.T).toBeCloseTo(DEFAULTS.sv, 0);
    expect(mean(w.p)).toBeCloseTo(beat.d.map, 0);
    for (const i of [10, 300]) expect(w.pf[i] + w.pb[i]).toBeCloseTo(w.p[i], 6);
  });
  it('repeated beats are identical (steady state)', () => {
    const w = resampleBeat(beat, 1000, 3), n = Math.round(1000 * beat.d.T);
    expect(Math.abs(w.p[5] - w.p[5 + n])).toBeLessThan(0.5);
  });
  it('dP/dt peaks in early systole and integrates to zero over a beat', () => {
    const w = resampleBeat(beat, 1000, 1);
    const iMax = w.dpdt.indexOf(Math.max(...w.dpdt));
    expect(w.t[iMax]).toBeLessThan(beat.d.ET);
    expect(Math.abs(w.dpdt.reduce((s, v) => s + v, 0) / 1000)).toBeLessThan(1);
  });
});

describe('xlsx writer', () => {
  it('column names', () => {
    expect([0, 25, 26, 27, 701, 702].map(colName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });
  it('CRC-32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xCBF43926);
  });
  it('writes a ZIP with the required parts', () => {
    const b = writeXlsx([{ name: 'S', rows: [['a', 1], [2.5, 'x<y&z']] }]);
    expect(b[0]).toBe(0x50); expect(b[1]).toBe(0x4b);
    const s = new TextDecoder().decode(b);
    for (const part of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/styles.xml', '_rels/.rels']) expect(s).toContain(part);
    expect(s).toContain('x&lt;y&amp;z');
  });
});

describe('pressure–flow workbook', () => {
  const B = simulate({ ...DEFAULTS, ...PRESETS['Older adult (70 y)'] });
  const sheets = waveformWorkbook([
    { id: 'A', preset: 'Default adult (45 y)', beat, params: beat.params },
    { id: 'B', preset: 'Older adult (70 y)', beat: B, params: B.params }
  ], { fs: 500, beats: 2, created: '2026-11-12T00:00:00Z', version: 'test' });
  it('opens on the data: waveform sheets first, then summary, inputs and README', () => {
    expect(sheets.map(s => s.name)).toEqual(['Patient A waveforms', 'Patient B waveforms', 'Beat summary', 'Inputs', 'README']);
  });
  it('waveform sheets: two header rows then fs × T × beats samples', () => {
    const a = sheets[0];
    expect(a.rows[0]).toEqual(WAVE_COLUMNS.map(c => c[0]));
    expect(a.rows.length - 2).toBe(Math.round(500 * beat.d.T * 2));
    expect(a.rows[3][1]).toBeCloseTo(1 / 500, 9);
  });
  it('summary includes the metrics for both patients', () => {
    const row = sheets[2].rows.find(r => r[1] === 'Mean arterial pressure')!;
    expect(row[3]).toBeCloseTo(beat.m.map, 3); expect(row[4]).toBeCloseTo(B.m.map, 3);
  });
});
