/* =====================================================================
   Research generator. Pure. Runs healthy patients of chosen ages across a
   heart-rate grid in each response mode, and returns one row per run plus
   each patient's resting profile and the beat itself (for waveform export).

   Patients: sex and age set, height and weight interpolated between the
   healthy study profiles (25, 45, 65, 80 y; held flat outside), everything
   else from the calibration (aortic diameter, PWV, SV, radius, Γ and, with
   the ventricle, Ees). Ages below 25 y use the 25-year-old reference data.
   No drugs. A run = applyDrugEffects (which applies the response mode)
   then one steady beat.
   ===================================================================== */
import { DEFAULTS, RESPONSE, STUDY_PROFILES, type Params } from '../config/physiology';
import { applyDrugEffects } from '../engine/kinetics';
import { applyCalibration, bsaDuBois, extrapolatedAt, interp } from './calibrate';
import { simulate, type BeatResult } from './solve';

export const RESEARCH_AGES = [20, 40, 60, 80] as const;
export const RESEARCH_HRS = [60, 70, 80, 90, 100, 110, 120] as const;
/** Response modes offered (exercise excluded): Params.resp values. */
export const RESEARCH_MODES: { resp: number; label: string }[] = [
  { resp: 0, label: 'Independent' }, { resp: 1, label: 'Pacing' }, { resp: 3, label: 'Physiologic' }
];

export interface ResearchOptions {
  sexes: readonly number[]; // 0 men, 1 women (either or both)
  ages: readonly number[];
  hrs: readonly number[];
  modes: readonly number[]; // resp values
  heart: number;            // 1 = Ventricle (v3), 0 = fixed flow (v2)
  hrRest: number;           // bpm, the resting rate the response modes are anchored to
}
export const DEFAULT_RESEARCH: ResearchOptions = {
  sexes: [0], ages: RESEARCH_AGES, hrs: RESEARCH_HRS, modes: RESEARCH_MODES.map(m => m.resp), heart: 1, hrRest: DEFAULTS.hrRest
};

export interface ResearchPatient {
  id: string;               // "M20", "F60", …
  label: string;
  params: Params;           // calibrated inputs, resting HR
  rest: BeatResult;         // resting beat (Independent, HR = hrRest)
  note: string;             // provenance of the inputs
}
export interface ResearchRun {
  patient: string; sex: string; age: number; mode: string; hr: number;
  beat: BeatResult;
  clamped: string[];        // inputs held at a slider limit by the response mode
}

/** Height and weight for a sex and age, interpolated between the healthy study profiles. */
export function bodySize(sex: number, age: number): { height: number; weight: number } {
  const ps = Object.values(STUDY_PROFILES).filter(p => p.sex === sex).sort((a, b) => a.age - b.age);
  return { height: interp(ps.map(p => [p.age, p.height] as const), age), weight: interp(ps.map(p => [p.age, p.weight] as const), age) };
}

export function researchPatient(sex: number, age: number, heart: number, hrRest: number): ResearchPatient {
  const size = bodySize(sex, age);
  const params = applyCalibration({ ...DEFAULTS, sex, age, ...size, heart, hrRest, hr: hrRest, resp: 0 });
  const ext = extrapolatedAt(age);
  const note = [
    ext.length ? `outside the reference data for ${ext.join(', ')}: those inputs are held at the nearest age with data` : '',
    'height and weight interpolated between the healthy study profiles'
  ].filter(Boolean).join('; ');
  return { id: `${sex ? 'F' : 'M'}${age}`, label: `Healthy ${sex ? 'woman' : 'man'} (${age} y)`, params, rest: simulate(params), note };
}

/** All runs, in order patient → mode → HR. `onProgress` lets a caller yield between runs. */
export function* researchRuns(o: ResearchOptions): Generator<{ done: number; total: number; patient?: ResearchPatient; run?: ResearchRun }> {
  const total = o.sexes.length * o.ages.length * o.modes.length * o.hrs.length;
  let done = 0;
  for (const sex of o.sexes) for (const age of o.ages) {
    const pt = researchPatient(sex, age, o.heart, o.hrRest);
    yield { done, total, patient: pt };
    for (const resp of o.modes) {
      const mode = RESEARCH_MODES.find(m => m.resp === resp)?.label ?? `mode ${resp}`;
      for (const hr of o.hrs) {
        const e = applyDrugEffects({ ...pt.params, hr, resp }, [], 0);
        const beat = simulate(e.params);
        done++;
        yield { done, total, run: { patient: pt.id, sex: sex ? 'female' : 'male', age, mode, hr, beat, clamped: e.clamped } };
      }
    }
  }
}

/** Everything at once (tests and scripts). */
export function runResearch(o: ResearchOptions = DEFAULT_RESEARCH): { patients: ResearchPatient[]; runs: ResearchRun[] } {
  const patients: ResearchPatient[] = [], runs: ResearchRun[] = [];
  for (const s of researchRuns(o)) { if (s.patient) patients.push(s.patient); if (s.run) runs.push(s.run); }
  return { patients, runs };
}

/** Columns of the results sheet: header, unit, value. */
export const RESULT_COLUMNS: [string, string, (r: ResearchRun) => number | string][] = [
  ['patient', '', r => r.patient], ['sex', '', r => r.sex], ['age', 'y', r => r.age], ['mode', '', r => r.mode], ['heart_rate', 'bpm', r => r.hr],
  ['cuff_SBP', 'mmHg', r => r.beat.m.bSBP], ['cuff_DBP', 'mmHg', r => r.beat.m.bDBP],
  ['central_SBP', 'mmHg', r => r.beat.m.Ps], ['central_DBP', 'mmHg', r => r.beat.m.Pd],
  ['central_PP', 'mmHg', r => r.beat.m.PP], ['augmentation_pressure_AP', 'mmHg', r => r.beat.m.AP],
  ['AIx', '%', r => r.beat.m.AIx], ['tau_RC', 's', r => r.beat.m.tau],
  ['ejection_duration', 'ms', r => r.beat.m.et], ['EF', '%', r => r.beat.m.ef],
  ['LV_dPdt_max', 'mmHg/s', r => r.beat.m.dpdtMax], ['LVEDP', 'mmHg', r => r.beat.m.lvEDP], ['LVESP', 'mmHg', r => r.beat.m.lvESP],
  ['MAP', 'mmHg', r => r.beat.m.map], ['stroke_volume', 'mL', r => (r.beat.lv ? r.beat.m.svOut : r.beat.params.sv)],
  ['cardiac_output', 'L/min', r => (r.beat.lv ? r.beat.m.svOut : r.beat.params.sv) * r.beat.params.hr / 1000],
  ['SVR', 'dyn·s·cm⁻⁵', r => r.beat.m.svrDyn], ['EDV', 'mL', r => r.beat.m.edv], ['ESV', 'mL', r => r.beat.m.esv],
  ['inputs_at_slider_limit', '', r => r.clamped.join(' ')]
];

/** Columns always written (they identify the row). */
export const ID_COLUMNS = ['patient', 'sex', 'age', 'mode', 'heart_rate'];
/** Optional output columns with a plain-language label for the checkboxes. */
export const OUTPUT_LABELS: Record<string, string> = {
  cuff_SBP: 'Cuff SBP', cuff_DBP: 'Cuff DBP', central_SBP: 'Central SBP', central_DBP: 'Central DBP', central_PP: 'Central PP',
  augmentation_pressure_AP: 'Augmentation pressure (AP)', AIx: 'AIx (%)', tau_RC: 'τ = R·C (s)', ejection_duration: 'Ejection duration',
  EF: 'EF', LV_dPdt_max: 'LV dP/dt max', LVEDP: 'LVEDP', LVESP: 'LVESP', MAP: 'MAP', stroke_volume: 'Stroke volume',
  cardiac_output: 'Cardiac output', SVR: 'SVR', EDV: 'EDV', ESV: 'ESV', inputs_at_slider_limit: 'Inputs held at a slider limit'
};

/** Columns of the patient-profile sheet (resting, Independent, HR = hrRest). */
export const PROFILE_ROWS: [string, string, (p: ResearchPatient) => number | string][] = [
  ['Patient', '', p => p.label], ['Sex', '', p => (p.params.sex ? 'female' : 'male')], ['Age', 'y', p => p.params.age],
  ['Height', 'cm', p => p.params.height], ['Weight', 'kg', p => p.params.weight], ['Body surface area', 'm²', p => bsaDuBois(p.params.height, p.params.weight)],
  ['Resting heart rate', 'bpm', p => p.params.hrRest],
  ['Stroke volume at rest', 'mL', p => (p.rest.lv ? p.rest.m.svOut : p.params.sv)],
  ['Cardiac output at rest', 'L/min', p => (p.rest.lv ? p.rest.m.svOut : p.params.sv) * p.params.hr / 1000],
  ['SVR at rest', 'dyn·s·cm⁻⁵', p => p.rest.m.svrDyn],
  ['Aortic PWV at rest (operating)', 'm/s', p => p.rest.m.cAoOp], ['Aortic PWV, intrinsic input', 'm/s', p => p.params.cAo],
  ['Aortic diameter', 'cm', p => p.params.diam], ['Arteriolar radius (input)', '% of reference', p => p.params.radius], ['Reflection coefficient Γ', '', p => p.params.gamma],
  ['Cuff BP at rest', 'mmHg', p => `${p.rest.m.bSBP.toFixed(0)}/${p.rest.m.bDBP.toFixed(0)}`], ['Central BP at rest', 'mmHg', p => `${p.rest.m.Ps.toFixed(0)}/${p.rest.m.Pd.toFixed(0)}`],
  ['MAP at rest', 'mmHg', p => p.rest.m.map], ['AIx at rest', '%', p => p.rest.m.AIx],
  ['Ees (contractility)', 'mmHg/mL', p => p.rest.m.ees], ['EDV at rest', 'mL', p => p.rest.m.edv], ['EF at rest', '%', p => p.rest.m.ef],
  ['LVEDP at rest', 'mmHg', p => p.rest.m.lvEDP], ['LV dP/dt max at rest', 'mmHg/s', p => p.rest.m.dpdtMax],
  ['Notes', '', p => p.note]
];

export const PACING_NOTE = `Pacing: cardiac output × (1 + ${(RESPONSE.pacingCoPerBpm * 100).toFixed(3)} %/bpm) and MAP × (1 + ${(RESPONSE.pacingMapPerBpm * 100).toFixed(2)} %/bpm) above the resting rate (Ross 1965; Lazim 2025).`;
