/* Research generator workbook: results (one row per patient × mode × heart rate), patient
   profiles at rest, synchronized aortic pressure/flow per patient at a fixed sampling rate,
   and a README last. Pure: takes the runs, returns sheets. */
import { periodicInterp } from '../model/waveformExport';
import { PACING_NOTE, PROFILE_ROWS, RESULT_COLUMNS, type ResearchOptions, type ResearchPatient, type ResearchRun } from '../model/research';
import type { Cell, Sheet } from './xlsx';

const round = (v: number, d: number) => { const k = 10 ** d; return Math.round(v * k) / k; };
const num = (v: number | string, d = 3): Cell => typeof v === 'number' ? (Number.isFinite(v) ? round(v, d) : '') : v;

export interface ResearchWorkbookOptions { fs: number; created: string; version: string; options: ResearchOptions; }

/** One beat per run, resampled at fs (Hz). Time 0 = start of ejection. */
function waveRows(run: ResearchRun, fs: number): Cell[][] {
  const r = run.beat, n = Math.round(fs * r.d.T), lv = r.lv, rows: Cell[][] = [];
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    const row: Cell[] = [run.mode, run.hr, i, round(t, 6), round(periodicInterp(r.p, r.dt, t), 3), round(periodicInterp(r.q, r.dt, t), 3)];
    if (lv) row.push(round(periodicInterp(lv.p, r.dt, t), 3), round(periodicInterp(lv.vol, r.dt, t), 3));
    rows.push(row);
  }
  return rows;
}

export function researchWorkbook(patients: ResearchPatient[], runs: ResearchRun[], o: ResearchWorkbookOptions): Sheet[] {
  const lvOn = o.options.heart === 1;
  const results: Sheet = {
    name: 'Results', headerRows: 2, widths: RESULT_COLUMNS.map(([n]) => Math.max(10, Math.min(18, n.length + 2))),
    rows: [RESULT_COLUMNS.map(c => c[0]), RESULT_COLUMNS.map(c => c[1]),
      ...runs.map(r => RESULT_COLUMNS.map(([name, , get]) => num(get(r), name === 'tau_RC' ? 4 : 2)))]
  };
  const profiles: Sheet = {
    name: 'Patient profiles', headerRows: 1, widths: [32, 16, ...patients.map(() => 22)],
    rows: [['Measure', 'Unit', ...patients.map(p => p.id)],
      ...PROFILE_ROWS.map(([name, unit, get]) => [name, unit, ...patients.map(p => num(get(p), 2))])]
  };
  const head = ['mode', 'heart_rate', 'sample', 'time', 'aortic_pressure', 'aortic_flow', ...(lvOn ? ['lv_pressure', 'lv_volume'] : [])];
  const units = ['', 'bpm', '', 's', 'mmHg', 'mL/s', ...(lvOn ? ['mmHg', 'mL'] : [])];
  const waves: Sheet[] = patients.map(p => ({
    name: `${p.id} waveforms`, headerRows: 2, widths: head.map(() => 14),
    rows: [head, units, ...runs.filter(r => r.patient === p.id).flatMap(r => waveRows(r, o.fs))]
  }));
  const o2 = o.options;
  const readme: Sheet = {
    name: 'README', headerRows: 1, widths: [26, 110],
    rows: [
      ['Pulse Lab Simulator: research run', ''],
      ['Created', o.created], ['Simulator version', o.version],
      ['Heart model', lvOn ? 'Ventricle (v3): stroke volume, EF, dP/dt, LVEDP and LVESP are outputs of the elastance ventricle' : 'Fixed flow (v2): LV columns are blank'],
      ['Patients', patients.map(p => p.label).join('; ')],
      ['Heart rates', `${o2.hrs.join(', ')} bpm`], ['Modes', 'Independent, Pacing, Physiologic (see below)'],
      ['Resting heart rate', `${o2.hrRest} bpm: the profile values are at this rate, and the Pacing relation is anchored to it`],
      ['Independent', 'Heart rate changes alone; every other input is held. With the ventricle, stroke volume still responds to the shorter cycle.'],
      ['Pacing', `${PACING_NOTE} With the ventricle, EDV is adjusted to reach that cardiac output.`],
      ['Physiologic', 'The Pacing relation plus baroreflex buffering of drug effects. No drugs are given in a research run, so Physiologic equals Pacing here.'],
      ['Results sheet', 'One row per patient × mode × heart rate (long format: filter or pivot in Excel). Row 2 = units. inputs_at_slider_limit lists inputs the mode pushed to a control limit.'],
      ['Patient profiles', 'Resting values (Independent, resting heart rate) and the calibrated inputs for each patient.'],
      ['Waveform sheets', `One sheet per patient: one beat per mode and heart rate, resampled at ${o.fs} Hz (Δt = ${round(1000 / o.fs, 4)} ms) from the solver's 1024 points per beat. Time 0 = start of ejection. Pressure and flow share each row (synchronized).`],
      ['Mean values', 'Mean aortic_flow over one beat × cycle length = stroke volume; mean aortic_pressure = MAP.'],
      ['Important', 'Educational model output, not measured patient data. Not a medical device. See the Methods and Validation tabs for equations, sources and known misses.']
    ]
  };
  return [results, profiles, ...waves, readme];
}
