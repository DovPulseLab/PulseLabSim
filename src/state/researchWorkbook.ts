/* Research generator workbook: results (one row per patient × mode × heart rate), patient
   profiles at rest, synchronized aortic pressure/flow per patient at a fixed sampling rate,
   and a README last. Pure: takes the runs, returns sheets. */
import { resampleBeat } from '../model/waveformExport';
import { ID_COLUMNS, PACING_NOTE, PROFILE_ROWS, RESULT_COLUMNS, VCO_COLUMNS, VCO_PROFILE_ROWS, type ResearchOptions, type ResearchPatient, type ResearchRun } from '../model/research';
import type { VCOResult } from '../model/vco';
import { resampleVCO } from './vcoWorkbook';
import type { Cell, Sheet } from './xlsx';

const round = (v: number, d: number) => { const k = 10 ** d; return Math.round(v * k) / k; };
const num = (v: number | string, d = 3): Cell => typeof v === 'number' ? (Number.isFinite(v) ? round(v, d) : '') : v;

export interface ResearchWorkbookOptions {
  fs: number; created: string; version: string; options: ResearchOptions;
  /** output columns to include (ID columns always); default all */
  columns?: readonly string[];
  profiles?: boolean;   // default true
  waveforms?: boolean;  // default true
  /** occlusion loop sheet (LV pressure and volume of every occlusion beat, resting run); default true when the occlusion ran */
  vcoLoops?: boolean;
}

/** One beat per run, resampled at fs (Hz). With the ventricle, time 0 = onset of contraction
 *  (end-diastole), so LV pressure starts at LVEDP; with fixed flow, time 0 = start of ejection.
 *  dP/dt: 5-point Savitzky–Golay derivative on the exported samples (as the main export). */
function waveRows(run: ResearchRun, fs: number): Cell[][] {
  const w = resampleBeat(run.beat, fs, 1), rows: Cell[][] = [];
  for (let i = 0; i < w.t.length; i++) {
    const row: Cell[] = [run.mode, run.hr, i, round(w.t[i], 6), round(w.p[i], 3), round(w.q[i], 3), round(w.dpdt[i], 1)];
    if (w.lv) row.push(round(w.lv.p[i], 3), round(w.lv.vol[i], 3), round(w.lv.dpdt[i], 1));
    rows.push(row);
  }
  return rows;
}

/** Occlusion runs in sheet order: each patient's resting run, then its per-run occlusions. */
function vcoList(patients: ResearchPatient[], runs: ResearchRun[]): { pid: string; mode: string; hr: number | string; v: VCOResult }[] {
  const out: { pid: string; mode: string; hr: number | string; v: VCOResult }[] = [];
  for (const p of patients) {
    if (p.vco) out.push({ pid: p.id, mode: 'Rest', hr: p.params.hrRest, v: p.vco });
    for (const r of runs) if (r.patient === p.id && r.vco) out.push({ pid: p.id, mode: r.mode, hr: r.hr, v: r.vco });
  }
  return out;
}

export function researchWorkbook(patients: ResearchPatient[], runs: ResearchRun[], o: ResearchWorkbookOptions): Sheet[] {
  const lvOn = o.options.heart === 1;
  const want = o.columns ? new Set(o.columns) : null;
  const vcoEvery = runs.some(r => r.vco), vcoAny = vcoEvery || patients.some(p => p.vco);
  const cols = [...RESULT_COLUMNS.filter(([n]) => ID_COLUMNS.includes(n) || !want || want.has(n)), ...(vcoEvery ? VCO_COLUMNS : [])];
  const results: Sheet = {
    name: 'Results', headerRows: 2, widths: cols.map(([n]) => Math.max(10, Math.min(18, n.length + 2))),
    rows: [cols.map(c => c[0]), cols.map(c => c[1]),
      ...runs.map(r => cols.map(([name, , get]) => num(get(r), name === 'tau_RC' || name === 'VCO_r2' || name === 'VCO_Ees' ? 4 : 2)))]
  };
  const profiles: Sheet = {
    name: 'Patient profiles', headerRows: 1, widths: [32, 16, ...patients.map(() => 22)],
    rows: [['Measure', 'Unit', ...patients.map(p => p.id)],
      ...[...PROFILE_ROWS, ...(vcoAny ? VCO_PROFILE_ROWS : [])].map(([name, unit, get]) => [name, unit, ...patients.map(p => num(get(p), name.includes('r²') ? 4 : 2))])]
  };
  const head = ['mode', 'heart_rate', 'sample', 'time', 'aortic_pressure', 'aortic_flow', 'aortic_dPdt', ...(lvOn ? ['lv_pressure', 'lv_volume', 'lv_dPdt'] : [])];
  const units = ['', 'bpm', '', 's', 'mmHg', 'mL/s', 'mmHg/s', ...(lvOn ? ['mmHg', 'mL', 'mmHg/s'] : [])];
  const waves: Sheet[] = patients.map(p => ({
    name: `${p.id} waveforms`, headerRows: 2, widths: head.map(() => 14),
    rows: [head, units, ...runs.filter(r => r.patient === p.id).flatMap(r => waveRows(r, o.fs))]
  }));
  const vl = vcoList(patients, runs);
  const vcoSheets: Sheet[] = [];
  if (vl.length) {
    const iso = vl[0].v.isochrones.map(i => Math.round(i.t * 1000));
    vcoSheets.push({
      name: 'Occlusion fits', headerRows: 2, widths: [10, 13, 11, 11, 10, 10, 12, 12, 12, 12, 12, ...iso.map(() => 12)],
      rows: [
        ['patient', 'mode', 'heart_rate', 'Ees_fitted', 'V0_fitted', 'r2', 'Ees_input', 'V0_input', 'Pes_fall', 'filling_before', 'filling_fall', ...iso.map(t => `isochrone_${t}ms`)],
        ['', '', 'bpm', 'mmHg/mL', 'mL', '', 'mmHg/mL', 'mL', 'mmHg', 'mmHg', 'mmHg', ...iso.map(() => 'mmHg/mL')],
        ...vl.map(({ pid, mode, hr, v }) => [pid, mode, hr, num(v.espvr.slope, 4), num(v.espvr.v0, 2), num(v.espvr.r2, 5), num(v.eesModel, 4), num(v.v0Model, 2),
          num(v.dropPes, 2), num(v.pla0, 2), num(v.dPla, 2), ...v.isochrones.map(i => num(i.slope, 4))])
      ]
    }, {
      name: 'Occlusion beats', headerRows: 2, widths: [10, 13, 11, 7, 11, 10, 10, 10, 10, 11, 10, 10, 12],
      rows: [
        ['patient', 'mode', 'heart_rate', 'beat', 'LA_pressure', 'EDV', 'EDP', 'ESV', 'Pes', 't_Pes', 'SV', 'LV_peak', 'dPdt_max'],
        ['', '', 'bpm', '0 = control', 'mmHg', 'mL', 'mmHg', 'mL', 'mmHg', 'ms from onset', 'mL', 'mmHg', 'mmHg/s'],
        ...vl.flatMap(({ pid, mode, hr, v }) => v.beats.map(b => [pid, mode, hr, b.n, num(b.pla, 2), num(b.edv, 2), num(b.edp, 2), num(b.esv, 2), num(b.esp, 2),
          num(b.tEs * 1000, 1), num(b.sv, 2), num(b.lvsp, 1), num(b.dpdtMax, 0)]))
      ]
    });
    if (o.vcoLoops !== false) {
      const rest = vl.filter(x => x.mode === 'Rest');
      vcoSheets.push({
        name: 'Occlusion loops (rest)', headerRows: 2, widths: [10, 7, 11, 12, 12, 12],
        rows: [
          ['patient', 'beat', 'time', 'lv_pressure', 'lv_volume', 'lv_dPdt'],
          ['', '0 = control', 's', 'mmHg', 'mL', 'mmHg/s'],
          ...rest.flatMap(({ pid, v }) => { const w = resampleVCO(v, o.fs); return w.t.map((t, i) => [pid, w.beat[i], round(t, 6), round(w.plv[i], 3), round(w.vol[i], 3), round(w.dpdt[i], 1)]); })
        ]
      });
    }
  }
  const o2 = o.options;
  const readme: Sheet = {
    name: 'README', headerRows: 1, widths: [26, 110],
    rows: [
      ['Pulse Lab Simulator: research run', ''],
      ['Created', o.created], ['Simulator version', o.version],
      ['Heart model', lvOn ? 'Ventricle (v3): stroke volume, EF, dP/dt, LVEDP and LVESP are outputs of the elastance ventricle' : 'Fixed flow (v2): LV columns are blank'],
      ['Patients', patients.map(p => `${p.id} = ${p.label}`).join('; ')],
      ['Heart rates', `${o2.hrs.join(', ')} bpm`], ['Modes', 'Independent, Pacing, Physiologic (see below)'],
      ['Resting heart rate', `${o2.hrRest} bpm: the profile values are at this rate, and the Pacing relation is anchored to it`],
      ['Independent', 'Heart rate changes alone; every other input is held. With the ventricle, stroke volume still responds to the shorter cycle.'],
      ['Pacing', `${PACING_NOTE} With the ventricle, EDV is adjusted to reach that cardiac output.`],
      ['Physiologic', 'The Pacing relation plus baroreflex buffering of drug effects. No drugs are given in a research run, so Physiologic equals Pacing here.'],
      ['Results sheet', 'One row per patient × mode × heart rate (long format: filter or pivot in Excel). Row 2 = units. inputs_at_slider_limit lists inputs the mode pushed to a control limit.'],
      ['Patient profiles', 'Resting values (Independent, resting heart rate) and the calibrated inputs for each patient.'],
      ['Waveform sheets', `One sheet per patient: one beat per mode and heart rate, resampled at ${o.fs} Hz (Δt = ${round(1000 / o.fs, 4)} ms) from the solver’s 1024 points per beat. ${lvOn ? 'Time 0 = onset of contraction (end-diastole), so lv_pressure starts at LVEDP and holds the whole LV waveform.' : 'Time 0 = start of ejection.'} Pressure and flow share each row (synchronized).`],
      ['dP/dt', `aortic_dPdt and lv_dPdt: 5-point Savitzky–Golay first-derivative filter on the ${o.fs} Hz samples, [−2P(i−2) − P(i−1) + P(i+1) + 2P(i+2)] / (10 Δt).`],
      ...(vl.length ? [
        ['Vena caval occlusion', `Run once per patient at rest (mode "Rest": Independent, resting heart rate)${vcoEvery ? ' and again at every mode × heart rate' : ''}. Left-atrial filling pressure falls over ${vl[0].v.beats.length - 1} beats until end-systolic pressure (Pes) has fallen by ${Number.isFinite(vl[0].v.target) ? vl[0].v.target : '—'} mmHg; heart rate, contractility and the arteries are held (no baroreflex). Same model as the Cardiac cycle tab (Methods §17).`],
        ['Occlusion fits', 'ESPVR fitted through each loop’s maximal P/(V − V0) point (V0 iterated), with the model’s input Ees and V0 for comparison, and isochrone slopes (lines through the points every loop reaches at the same time after onset of contraction).' + (vcoEvery ? ' The same fit is repeated as VCO_ columns in the Results sheet.' : '')],
        ['Occlusion beats', 'One row per occlusion beat: end-diastolic and end-systolic points (beat 0 = last control beat).'],
        ...(o.vcoLoops !== false ? [['Occlusion loops (rest)', `LV pressure and volume of every beat of each patient’s resting occlusion at ${o.fs} Hz, time 0 = end-diastole of the control beat: plot lv_pressure against lv_volume for the loop family.`]] : [])
      ] as Cell[][] : []),
      ['Mean values', 'Mean aortic_flow over one beat × cycle length = stroke volume; mean aortic_pressure = MAP.'],
      ['Important', 'Educational model output, not measured patient data. Not a medical device. See the Methods and Validation tabs for equations, sources and known misses.']
    ]
  };
  return [results, ...(o.profiles === false ? [] : [profiles]), ...vcoSheets, ...(o.waveforms === false ? [] : waves), readme];
}
