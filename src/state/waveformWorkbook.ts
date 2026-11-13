/* Excel workbook of synchronized aortic pressure and flow at a fixed sampling rate,
   for pressure–flow analysis outside the simulator. Pure: takes beats, returns sheets. */
import { ALL_CONTROLS, controlText, type Params } from '../config/physiology';
import { METRICS } from '../config/metrics';
import { resampleBeat, waveColumns } from '../model/waveformExport';
import type { BeatResult } from '../model/solve';
import type { Sheet } from './xlsx';

export interface WorkbookPatient { id: string; preset: string; beat: BeatResult; params: Params; }
export interface WorkbookOptions { fs: number; beats: number; created: string; version: string; }

const round = (v: number, d: number) => { const k = 10 ** d; return Math.round(v * k) / k; };

export function waveformWorkbook(patients: WorkbookPatient[], o: WorkbookOptions): Sheet[] {
  const res = patients.map(p => ({ p, w: resampleBeat(p.beat, o.fs, o.beats) }));
  const readme: Sheet = {
    name: 'README', headerRows: 1, widths: [26, 110],
    rows: [
      ['Pulse Lab Simulator: synchronized aortic pressure and flow', ''],
      ['Created', o.created],
      ['Simulator version', o.version],
      ['Sampling rate', `${o.fs} Hz (uniform; Δt = ${round(1000 / o.fs, 4)} ms)`],
      ['Beats per patient', String(o.beats)],
      ['Time origin', 'time 0 = start of ejection (aortic valve opening) of the first beat'],
      ['Synchronization', 'Pressure and flow share one time axis: each row is one synchronized pressure–flow sample at the aortic root.'],
      ['Method', 'The solver computes one periodic steady-state beat on 1024 points per cycle (≈ 1.2 kHz at 70 bpm, 3.1 kHz at 180 bpm). It is resampled here by periodic linear interpolation and repeated, so all beats in a file are identical (the beat shown when you exported, including active drugs).'],
      ['Columns', 'aortic_pressure = central (ascending aortic) pressure; aortic_flow = aortic root flow, mL/s (L/min × 1000/60); forward/backward_pressure = wave separation (P = Pf + Pb); aortic_dPdt = rate of change of aortic pressure; brachial/radial = intra-arterial peripheral pressures (not cuff). With the Ventricle (v3) heart model four more columns follow: lv_pressure, lv_volume, mitral_flow (mL/s into the LV) and lv_dPdt (its maximum is dP/dt max). LV metrics in the Beat summary are blank with the fixed-flow (v2) heart.'],
      ['Mean values', 'Mean of aortic_flow over one beat × cycle length = stroke volume; mean aortic_pressure = MAP.'],
      ['Sheets', 'One waveform sheet per patient; "Beat summary" = the simulator metrics for the same beat; "Inputs" = the model inputs used.'],
      ['Important', 'Educational model output, not measured patient data. Not a medical device. See the Methods tab for equations and sources.']
    ]
  };
  const waveSheets: Sheet[] = res.map(({ p, w }) => {
    const cols = waveColumns(w);
    return {
      name: `Patient ${p.id} waveforms`, headerRows: 2, widths: cols.map(() => 16),
      rows: [
        cols.map(c => c[0]),
        cols.map(c => c[1]),
        ...w.t.map((_, i) => cols.map(([name, , get]) => {
          const v = get(w, i);
          return name === 'time' ? round(v, 6) : name === 'sample' || name === 'beat' ? v : name.endsWith('dPdt') ? round(v, 1) : round(v, 3);
        }))
      ]
    };
  });
  const summary: Sheet = {
    name: 'Beat summary', headerRows: 1, widths: [28, 38, 12, ...patients.map(() => 14)],
    rows: [
      ['Group', 'Metric', 'Unit', ...patients.map(p => `Patient ${p.id}`)],
      ['Profile', 'Preset loaded', '', ...patients.map(p => p.preset)],
      ['Timing', 'Cycle length', 's', ...res.map(r => round(r.w.T, 5))],
      ['Timing', 'Samples per beat at this rate', '', ...res.map(r => round(r.w.T * o.fs, 1))],
      ...METRICS.flatMap(g => g.items.map(it => [g.g, it.l, it.u, ...patients.map(p => {
        const v = p.beat.m[it.k] as unknown;
        return typeof v === 'number' ? (Number.isFinite(v) ? round(v, 4) : '') : String(v);
      })]))
    ]
  };
  const inputs: Sheet = {
    name: 'Inputs', headerRows: 1, widths: [30, 18, ...patients.map(() => 18)],
    rows: [
      ['Input', 'Key', ...patients.map(p => `Patient ${p.id}`)],
      ...ALL_CONTROLS.map(c => [c.label, c.key, ...patients.map(p => controlText(c, p.params[c.key], p.params))])
    ]
  };
  return [readme, ...waveSheets, summary, inputs];
}
