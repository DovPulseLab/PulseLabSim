/* Research report: workbook → report, .xlsx read-back (ours and Excel-style re-saved files). */
import { describe, expect, it } from 'vitest';
import { buildReport } from '../src/model/researchReport';
import { DEFAULT_RESEARCH, runResearch } from '../src/model/research';
import { researchWorkbook } from '../src/state/researchWorkbook';
import { writeXlsx } from '../src/state/xlsx';
import { readXlsx } from '../src/state/xlsxRead';
import { RESAVED, SHARED } from './fixtures/xlsxFixtures';

const o = { ...DEFAULT_RESEARCH, sexes: [0], ages: [20, 80], hrs: [60, 80, 100, 120], modes: [1] };
const r = runResearch(o);
const sheets = researchWorkbook(r.patients, r.runs, { fs: 250, created: '2026-11-18T12:00:00Z', version: 'v3', options: o, waveforms: false });

describe('research report', () => {
  const rep = buildReport(sheets);
  it('reads patients, heart rates and modes from the Results sheet', () => {
    expect(rep.patients.map(p => p.id)).toEqual(['M20', 'M80']);
    expect(rep.hrs).toEqual([60, 80, 100, 120]);
    expect(rep.modes).toEqual(['Pacing']);
    expect(rep.heartModel).toBe('v3');
    expect(rep.rows.length).toBe(8);
  });
  it('finds AIx falling with heart rate and writes it as a finding', () => {
    const t = rep.trends.find(t => t.key === 'AIx')!;
    expect(t.per.every(p => p.slope10 < 0)).toBe(true);
    expect(rep.findings.some(f => f.includes('Augmentation index') && f.includes('fell'))).toBe(true);
    expect(rep.findings.some(f => f.includes('Wilkinson'))).toBe(true);
    expect(rep.findings.some(f => f.includes('Age effect'))).toBe(true);
  });
  it('profiles come from the Patient profiles sheet', () => {
    expect(Number(rep.patients[1].profile['Aortic PWV at rest (operating)'])).toBeGreaterThan(Number(rep.patients[0].profile['Aortic PWV at rest (operating)']));
  });
  it('rejects a workbook that is not a Research workbook', () => {
    expect(() => buildReport([{ name: 'Sheet1', rows: [['a']] }])).toThrow('Research workbook');
  });
  it('the Summary tables sheet follows the reading layout', () => {
    const s = sheets.find(x => x.name === 'Summary tables')!;
    expect(s.rows[0]).toEqual(['Resting HR:', '70 bpm']);
    expect(s.rows[2]).toEqual(['Patient:', 'M20', 'Mode:', 'Pacing']);
    expect(String(s.rows[3][0])).toMatch(/^MALE, \d+ cm, \d+ kg$/);
    expect(s.rows[7][0]).toBe('HR');
    expect(String(s.rows[8][1])).toMatch(/^\d+\/\d+$/);
  });
});

describe('xlsx read-back', () => {
  it('reads our own workbook back cell for cell', async () => {
    const back = await readXlsx(writeXlsx(sheets));
    expect(back.map(s => s.name)).toEqual(sheets.map(s => s.name));
    const a = sheets[0].rows, b = back[0].rows;
    expect(b.length).toBe(a.length);
    expect(b[0]).toEqual(a[0]);
    expect(b[2][5]).toBe(a[2][5]);
    expect(buildReport(back).findings).toEqual(buildReport(sheets).findings);
  });
  it('reads a workbook re-saved by a spreadsheet program (shared strings, deflate)', async () => {
    const buf = RESAVED;
    const back = await readXlsx(buf);
    const rep = buildReport(back);
    expect(rep.patients.length).toBeGreaterThan(0);
    expect(rep.rows.length).toBeGreaterThan(0);
    expect(rep.trends.length).toBeGreaterThan(5);
  });
});

describe('xlsx read-back: Excel conventions', () => {
  it('shared strings, rich text, relationship targets, skipped rows and columns', async () => {
    const buf = SHARED;
    const [s] = await readXlsx(buf);
    expect(s.name).toBe('Results');
    expect(s.rows[0]).toEqual(['patient', 'mode', 'heart_rate']);
    expect(s.rows[1]).toEqual([]);
    expect(s.rows[2][0]).toBe('M20');
    expect(s.rows[2][1]).toBe('Pacing & more');
    expect(s.rows[2][2]).toBeUndefined();
    expect(s.rows[2][3]).toBe(60);
  });
});
