/* Excel workbook of a vena caval occlusion run: the continuous LV and aortic record at a fixed
   sampling rate, a row per beat (end-diastolic and end-systolic points), and the fitted ESPVR
   and isochrones. Pure: takes a VCOResult, returns sheets. */
import { sg5Derivative } from '../model/waveformExport';
import type { VCOResult } from '../model/vco';
import type { Sheet } from './xlsx';

const round = (v: number, d: number) => { if (!Number.isFinite(v)) return ''; const k = 10 ** d; return Math.round(v * k) / k; };

/** Linear interpolation of a uniformly sampled record (not periodic), clamped at the ends. */
function lerp(y: readonly number[], dt: number, t: number): number {
  const u = Math.min(Math.max(t / dt, 0), y.length - 1), i = Math.min(Math.floor(u), y.length - 2), f = u - i;
  return y[i] * (1 - f) + y[i + 1] * f;
}

export interface VCOResampled { t: number[]; beat: number[]; plv: number[]; vol: number[]; pao: number[]; qao: number[]; qmv: number[]; pla: number[]; dpdt: number[]; }

export function resampleVCO(r: VCOResult, fs: number): VCOResampled {
  const tr = r.trace, dt = r.dt, dur = tr.t.length * dt, n = Math.floor(dur * fs), h = 1 / fs;
  const s = (y: number[]) => Array.from({ length: n }, (_, i) => lerp(y, dt, i * h));
  // dP/dt filter edges: before t = 0 the control beat (steady, so periodic) continues backwards;
  // past the end the last two samples are extrapolated linearly
  const plvAt = (i: number) => i < 0 ? lerp(tr.plv, dt, r.T + i * h)
    : i > n - 1 ? lerp(tr.plv, dt, (n - 1) * h) + (i - n + 1) * (lerp(tr.plv, dt, (n - 1) * h) - lerp(tr.plv, dt, (n - 2) * h))
    : lerp(tr.plv, dt, i * h);
  return {
    t: Array.from({ length: n }, (_, i) => i * h),
    beat: Array.from({ length: n }, (_, i) => Math.min(r.beats.length - 1, Math.floor(i * h / r.T + 1e-9))),
    plv: s(tr.plv), vol: s(tr.vol), pao: s(tr.pao), qao: s(tr.qao), qmv: s(tr.qmv), pla: s(tr.pla),
    dpdt: sg5Derivative(plvAt, n, h)
  };
}

export function vcoWorkbook(r: VCOResult, o: { fs: number; created: string; version: string; patient: string }): Sheet[] {
  const w = resampleVCO(r, o.fs);
  const wave: Sheet = {
    name: 'VCO waveforms', headerRows: 2, widths: Array(9).fill(15),
    rows: [
      ['time', 'beat', 'lv_pressure', 'lv_volume', 'lv_dPdt', 'aortic_pressure', 'aortic_flow', 'mitral_flow', 'la_pressure'],
      ['s', '0 = control', 'mmHg', 'mL', 'mmHg/s', 'mmHg', 'mL/s', 'mL/s', 'mmHg'],
      ...w.t.map((t, i) => [round(t, 6), w.beat[i], round(w.plv[i], 3), round(w.vol[i], 3), round(w.dpdt[i], 1), round(w.pao[i], 3), round(w.qao[i], 3), round(w.qmv[i], 3), round(w.pla[i], 3)])
    ]
  };
  const beats: Sheet = {
    name: 'VCO beats', headerRows: 2, widths: [8, 12, 11, 11, 11, 11, 13, 11, 11, 13, 12, 12],
    rows: [
      ['beat', 'LA pressure', 'EDV', 'EDP', 'ESV', 'Pes', 't(Pes)', 'SV', 'LV peak', 'dP/dt max', 'Ao systolic', 'Ao diastolic'],
      ['', 'mmHg (filling)', 'mL', 'mmHg', 'mL', 'mmHg', 'ms from onset', 'mL', 'mmHg', 'mmHg/s', 'mmHg', 'mmHg'],
      ...r.beats.map(b => [b.n, round(b.pla, 2), round(b.edv, 2), round(b.edp, 2), round(b.esv, 2), round(b.esp, 2), round(b.tEs * 1000, 1), round(b.sv, 2), round(b.lvsp, 1), round(b.dpdtMax, 0), round(b.aoSys, 1), round(b.aoDia, 1)])
    ]
  };
  const fit: Sheet = {
    name: 'ESPVR', headerRows: 1, widths: [34, 14, 14, 12, 10],
    rows: [
      ['Relation', 'Slope (mmHg/mL)', 'V0 (mL)', 'r²', 'points'],
      ['ESPVR (fitted, max P/(V−V0) points)', round(r.espvr.slope, 4), round(r.espvr.v0, 2), round(r.espvr.r2, 5), r.espvr.n],
      ['Model input Ees and V0 (for comparison)', round(r.eesModel, 4), round(r.v0Model, 2), '', ''],
      ...r.isochrones.map(i => [`Isochrone ${Math.round(i.t * 1000)} ms after onset`, round(i.slope, 4), round(i.v0, 2), round(i.r2, 5), i.n]),
      [],
      ['Occlusion', 'Value', 'Unit', '', ''],
      ['Filling (LA) pressure before', round(r.pla0, 2), 'mmHg'],
      ['Fall in filling pressure (solved)', round(r.dPla, 2), 'mmHg'],
      ['Fall in Pes, control → last beat', round(r.dropPes, 2), 'mmHg'],
      ['Requested fall in Pes', Number.isFinite(r.target) ? r.target : '', 'mmHg'],
      ['Occlusion beats', r.beats.length - 1, ''],
      ['Cycle length', round(r.T, 5), 's']
    ]
  };
  const readme: Sheet = {
    name: 'README', headerRows: 1, widths: [26, 110],
    rows: [
      ['Pulse Lab Simulator: vena caval occlusion', ''],
      ['Created', o.created], ['Simulator version', o.version], ['Patient', o.patient],
      ['Sampling rate', `${o.fs} Hz (uniform; Δt = ${round(1000 / o.fs, 4)} ms), linear interpolation of the 1024-points-per-beat transient`],
      ['Time origin', 'time 0 = onset of contraction (end-diastole) of the last control beat (beat 0). Beats 1… are occlusion beats.'],
      ['Maneuver', 'Transient preload reduction: mean left-atrial (filling) pressure falls exponentially (time constant one third of the run) by the amount that lowers end-systolic pressure by the requested value from beat 0 to the last beat. Heart rate, contractility and the arteries are held constant (no baroreflex), as in the first beats after occlusion analysed in the literature (Little et al. 1989; Freeman et al. 1986; Kass et al. 1987).'],
      ['Model', 'Same time-varying elastance ventricle as the steady beat, stepped in time against this patient’s arterial input impedance written as an impulse response (P_Ao = Zc·Q + g * Q + Pzf). With no occlusion the run repeats the steady beat.'],
      ['End-systole', 'Point of maximal P/(V − V0) in each beat, V0 iterated with the regression (Kono 1984; Sagawa 1981). ESPVR = least-squares line through those points. The fitted slope is below the model’s input Ees because of the ejection effect (pressure falls with outflow, Shroff 1985), which is larger at higher preload: it is what a catheter measurement of this ventricle would report.'],
      ['Isochrones', 'Least-squares lines through the points every loop reaches at the same time after the onset of contraction (Suga & Sagawa 1974).'],
      ['dP/dt', 'lv_dPdt: 5-point Savitzky–Golay first-derivative filter on the exported samples, [−2P(i−2) − P(i−1) + P(i+1) + 2P(i+2)] / (10 Δt). The first rows use the end of the (steady) control beat before time 0; the last two rows extrapolate.'],
      ['Important', 'Educational model output, not measured patient data. Not a medical device.']
    ]
  };
  return [wave, beats, fit, readme];
}
