/* Patient calibration: sex, age, height and weight set aortic diameter, intrinsic aortic
   PWV and stroke volume from published healthy-adult reference data. Pure.

   Sources
   - BSA: Du Bois D, Du Bois EF. Arch Intern Med 1916;17:863–871.
   - Ascending-aorta diameter: Campens L, et al. Reference values for echocardiographic
     assessment of the diameter of the aortic root and ascending aorta spanning all age
     categories. Am J Cardiol 2014;114:914–920 (Table 2, Du Bois BSA; leading-edge,
     end-diastole, at the right pulmonary artery). log10 D(mm) = a + b·log10(age) + c·BSA.
   - Aortic PWV: Reference Values for Arterial Stiffness' Collaboration. Eur Heart J
     2010;31:2338–2350, Table 4 "normal values" (no risk factors, optimal/normal BP),
     mean carotid–femoral PWV by age decade. Sex effect < 0.1 m/s after adjustment, so
     no sex term.
   - Stroke volume: Maceira AM, et al. J Cardiovasc Magn Reson 2006;8:417–426,
     Tables 2–3, SSFP CMR, SV/BSA by age decile, men and women. CMR SV runs higher than
     Doppler SV; see Methods.
   - Muscular (arm) PWV: Avolio AP, et al. Circulation 1983;68:50–58 — upper-limb PWV rises
     0.048 m/s per year of age (4.8·age + 998 cm/s). The slope is used, anchored at the v1
     value of 9.0 m/s for a 45-year-old, because absolute arm PWV depends on the method. */
import type { Params } from '../config/physiology';

export type Sex = 0 | 1;   // 0 = male, 1 = female

/** Du Bois body surface area, m². */
export const bsaDuBois = (heightCm: number, weightKg: number): number =>
  0.007184 * Math.pow(weightKg, 0.425) * Math.pow(heightCm, 0.725);

/** Campens 2014, ascending aorta (AA), Du Bois BSA. */
export const CAMPENS_AA = {
  male:   { a: 1.033, b: 0.188, c: 0.070, see: 0.0431 },
  female: { a: 1.001, b: 0.177, c: 0.086, see: 0.0453 }
} as const;

/** Predicted mean ascending-aortic diameter (cm) and its normal range (±1.96 SEE). */
export function aortaDiameter(sex: number, age: number, bsa: number): { mean: number; lo: number; hi: number } {
  const k = sex === 1 ? CAMPENS_AA.female : CAMPENS_AA.male;
  const lg = k.a + k.b * Math.log10(Math.max(1, age)) + k.c * bsa;
  return { mean: Math.pow(10, lg) / 10, lo: Math.pow(10, lg - 1.96 * k.see) / 10, hi: Math.pow(10, lg + 1.96 * k.see) / 10 };
}

/** RVASC 2010 Table 4: mean cfPWV (m/s) and mean ± 2 SD by age decade, placed at the decade midpoint. */
export const PWV_NORMAL: { age: number; mean: number; lo: number; hi: number }[] = [
  { age: 25, mean: 6.2, lo: 4.7, hi: 7.6 },    // < 30
  { age: 35, mean: 6.5, lo: 3.8, hi: 9.2 },    // 30–39
  { age: 45, mean: 7.2, lo: 4.6, hi: 9.8 },    // 40–49
  { age: 55, mean: 8.3, lo: 4.5, hi: 12.1 },   // 50–59
  { age: 65, mean: 10.3, lo: 5.5, hi: 15.0 },  // 60–69
  { age: 75, mean: 10.9, lo: 5.5, hi: 16.3 }   // ≥ 70 (held flat beyond 75)
];

/** Maceira 2006 Tables 2–3: SV/BSA (mL/m²) by age decile, at the decile midpoint. */
export const SVI_CMR = {
  male:   [[25, 56], [35, 55], [45, 54], [55, 53], [65, 52], [75, 51]],
  female: [[25, 54], [35, 53], [45, 51], [55, 50], [65, 48], [75, 47]]
} as const;

/** Piecewise-linear interpolation, flat beyond the ends. */
export function interp(pts: readonly (readonly [number, number])[], x: number): number {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
}

export const pwvNormal = (age: number) => ({
  mean: interp(PWV_NORMAL.map(r => [r.age, r.mean] as const), age),
  lo: interp(PWV_NORMAL.map(r => [r.age, r.lo] as const), age),
  hi: interp(PWV_NORMAL.map(r => [r.age, r.hi] as const), age)
});

/** CMR stroke-volume index scaled to Doppler/flow level (see CALIB.svScale). */
export const svIndex = (sex: number, age: number): number =>
  interp(sex === 1 ? SVI_CMR.female : SVI_CMR.male, age) * CALIB.svScale;

export const CALIB = {
  /** CMR SSFP stroke volume exceeds Doppler/thermodilution stroke volume; this scale
   *  brings the Maceira values to the model's flow level (v1 default: 72 mL in a
   *  45-y man of BSA 1.90 m² ⇒ 37.9 mL/m² ≈ 0.70 × 54). Kept as one documented
   *  constant so the age and sex differences come from the source unchanged. */
  svScale: 0.70
} as const;

/** Muscular-artery PWV (m/s) at a given age: Avolio 1983 slope, v1 anchor at 45 y. */
export const MUS_PWV = { slope: 0.048, anchorAge: 45, anchor: 9.0 } as const;
export const musPWV = (age: number): number => MUS_PWV.anchor + MUS_PWV.slope * (age - MUS_PWV.anchorAge);

export interface Calibration {
  bsa: number;
  cMus: number;
  diam: number; diamRange: [number, number];
  cAo: number; pwvRange: [number, number];
  sv: number; svi: number;
}

/** Calibrated inputs for a patient. */
export function calibrate(p: Pick<Params, 'sex' | 'age' | 'height' | 'weight'>): Calibration {
  const bsa = bsaDuBois(p.height, p.weight);
  const d = aortaDiameter(p.sex, p.age, bsa);
  const pwv = pwvNormal(p.age);
  const svi = svIndex(p.sex, p.age);
  return {
    bsa,
    diam: d.mean, diamRange: [d.lo, d.hi],
    cAo: pwv.mean, pwvRange: [pwv.lo, pwv.hi],
    sv: svi * bsa, svi,
    cMus: musPWV(p.age)
  };
}

/** Inputs that calibration sets. */
export const CALIBRATED_KEYS = ['diam', 'cAo', 'sv', 'cMus'] as const;
/** Inputs whose change triggers calibration. */
export const DEMOGRAPHIC_KEYS = ['sex', 'age', 'height', 'weight'] as const;

/** Apply calibration to a parameter set, rounding to the slider steps. */
export function applyCalibration(p: Params): Params {
  const c = calibrate(p);
  return {
    ...p,
    diam: Number((Math.round(c.diam / 0.05) * 0.05).toFixed(2)),
    cAo: Math.round(c.cAo * 10) / 10,
    sv: Math.round(c.sv),
    cMus: Math.round(c.cMus * 10) / 10
  };
}
