/* v3.2 · Human LV dP/dt max, dP/dt min and LVEDP in health and disease.
   Source: Dr L. Mulligan (Cooper University Hospital), "Human left ventricular dP/dtmax, dP/dtmin
   and LVEDP in health and disease", reference summary for the lab, Nov 2026.
   Section 2 gives approximate resting working ranges for adult humans: physiological working ranges,
   not formal diagnostic reference intervals, with considerable overlap between disease populations.
   Section 3 gives published invasive measurements (study citations to be added from the summary).
   The model's healthy profiles are calibrated to the normal rows (Methods §17, Validation §12). */

export interface LVRange { lo: number; hi: number; text?: string; }
export interface LVPopulation {
  key: string; label: string;
  dpdtMax: LVRange;   // mmHg/s
  dpdtMin: LVRange;   // mmHg/s (negative; lo is the faster fall)
  lvedp: LVRange;     // mmHg; hi = Infinity for an open upper bound ("35+")
  healthy?: boolean;
}

export const LV_REFERENCE_SOURCE = 'Mulligan L. Human LV dP/dtmax, dP/dtmin and LVEDP in health and disease (lab reference summary), 2026';

export const LV_POPULATIONS: LVPopulation[] = [
  { key: 'normal',      label: 'Normal healthy adult',          dpdtMax: { lo: 1200, hi: 2000 }, dpdtMin: { lo: -2200, hi: -1500 }, lvedp: { lo: 5, hi: 12 }, healthy: true },
  { key: 'older',       label: 'Healthy older adult',           dpdtMax: { lo: 1100, hi: 1800 }, dpdtMin: { lo: -1900, hi: -1200 }, lvedp: { lo: 6, hi: 12 }, healthy: true },
  { key: 'htn',         label: 'Hypertension without LVH',      dpdtMax: { lo: 1300, hi: 2200 }, dpdtMin: { lo: -2000, hi: -1200 }, lvedp: { lo: 8, hi: 15 } },
  { key: 'htnLvh',      label: 'Hypertension with LVH',         dpdtMax: { lo: 1200, hi: 2200 }, dpdtMin: { lo: -1700, hi: -900 },  lvedp: { lo: 12, hi: 25 } },
  { key: 'cad',         label: 'Coronary artery disease',       dpdtMax: { lo: 1000, hi: 1700 }, dpdtMin: { lo: -1700, hi: -900 },  lvedp: { lo: 10, hi: 20 } },
  { key: 'ischemia',    label: 'Acute myocardial ischemia',     dpdtMax: { lo: 700, hi: 1400 },  dpdtMin: { lo: -1300, hi: -600 },  lvedp: { lo: 15, hi: 30 } },
  { key: 'hfpef',       label: 'HFpEF',                         dpdtMax: { lo: 1200, hi: 2000 }, dpdtMin: { lo: -1900, hi: -1000 }, lvedp: { lo: 12, hi: 25 } },
  { key: 'hfref',       label: 'HFrEF',                         dpdtMax: { lo: 600, hi: 1200 },  dpdtMin: { lo: -1300, hi: -600 },  lvedp: { lo: 15, hi: 30 } },
  { key: 'dcm',         label: 'Dilated cardiomyopathy',        dpdtMax: { lo: 500, hi: 1200 },  dpdtMin: { lo: -1200, hi: -500 },  lvedp: { lo: 15, hi: 30 } },
  { key: 'hcm',         label: 'Hypertrophic cardiomyopathy',   dpdtMax: { lo: 1400, hi: 2500 }, dpdtMin: { lo: -1900, hi: -900 },  lvedp: { lo: 12, hi: 30 } },
  { key: 'as',          label: 'Severe aortic stenosis',        dpdtMax: { lo: 1000, hi: 2500 }, dpdtMin: { lo: -1900, hi: -800 },  lvedp: { lo: 15, hi: 30 } },
  { key: 'restrictive', label: 'Restrictive cardiomyopathy',    dpdtMax: { lo: 1000, hi: 1800 }, dpdtMin: { lo: -1600, hi: -800 },  lvedp: { lo: 18, hi: 30 } },
  { key: 'shock',       label: 'Cardiogenic shock',             dpdtMax: { lo: 300, hi: 900 },   dpdtMin: { lo: -900, hi: -300 },   lvedp: { lo: 20, hi: Infinity, text: '20–35+' } }
];

/** Section 3: published invasive measurements (mean ± SD where given). */
export interface LVPublished { group: string; n?: number; dpdtMax: number; dpdtMaxSd?: number; dpdtMin?: number; dpdtMinSd?: number; lvedp?: number; lvedpSd?: number; }
export const LV_PUBLISHED: LVPublished[] = [
  { group: 'Normal controls', dpdtMax: 1563, dpdtMaxSd: 123, dpdtMin: -1937, dpdtMinSd: 385, lvedp: 8, lvedpSd: 3 },
  { group: 'Normal controls', n: 10, dpdtMax: 1337, dpdtMaxSd: 174 },
  { group: 'Without diastolic HF', n: 12, dpdtMax: 1584, dpdtMin: -1979, lvedp: 7 },
  { group: 'Diastolic HF', n: 27, dpdtMax: 1429, dpdtMin: -1715, lvedp: 12 }
];

/** Which healthy range applies at an age. The summary does not define "older"; the model uses ≥ 60 y. */
export const OLDER_FROM_AGE = 60;
export const healthyRangeFor = (age: number): LVPopulation => LV_POPULATIONS.find(p => p.key === (age >= OLDER_FROM_AGE ? 'older' : 'normal'))!;

const inR = (v: number, r: LVRange) => v >= r.lo && v <= r.hi;
/** Populations whose three ranges all contain the given values (used to read a patient against the table). */
export function matchingPopulations(dpdtMax: number, dpdtMin: number, lvedp: number): LVPopulation[] {
  return LV_POPULATIONS.filter(p => inR(dpdtMax, p.dpdtMax) && inR(dpdtMin, p.dpdtMin) && inR(lvedp, p.lvedp));
}
export const fmtRange = (r: LVRange, neg = false) => {
  const n = (v: number) => (v < 0 ? '−' : '') + Math.abs(v).toLocaleString('en-US').replace(/,/g, ' ');
  if (r.text) return r.text;
  if (r.hi === Infinity) return `${n(r.lo)}+`;
  return neg ? `${n(r.hi)} to ${n(r.lo)}` : `${n(r.lo)}–${n(r.hi)}`;
};
