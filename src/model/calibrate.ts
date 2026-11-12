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
   - Stroke volume (v2.7): Patel HN, et al. (WASE). J Am Soc Echocardiogr 2021;34:1077–1085,
     Table 4, pulsed-wave Doppler LVOT stroke volume index by sex and age group (18–40,
     41–65, > 65 y; n = 1 450 healthy adults, 15 countries). The model's heart is a flow
     source into the aortic root, so forward (LVOT) flow is the matching measurement.
     Doppler SVI does not fall with age in this cohort; 2D and 3D volumetric SVI do, and the
     study warns the methods are not interchangeable.
     Until v2.5 SV came from Maceira AM, et al. J Cardiovasc Magn Reson 2006;8:417–426
     (SSFP CMR SV/BSA by decile) × an uncited 0.70 scale; kept below as SVI_CMR for
     comparison only.
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

/** WASE 2021 Table 4, Doppler BSA-indexed SV (mL/m², mean ± SD), placed at the age-group
 *  midpoints 29, 53 and 72 y (> 65 y group: midpoint of 65–80), flat outside. Observed group
 *  means; values between and beyond the groups are interpolated / extrapolated. */
export const SVI_DOPPLER = {
  male:   [[29, 39.7], [53, 39.0], [72, 39.3]],
  female: [[29, 37.4], [53, 38.1], [72, 38.3]]
} as const;
export const SVI_DOPPLER_SD = { male: [7.3, 8.2, 8.6], female: [7.4, 8.1, 9.2] } as const;
/** WASE 2021 Table 4, Doppler cardiac index (L/min/m²) and heart rate in the same groups. */
export const WASE_DOPPLER_CI = { male: [2.6, 2.6, 2.6], female: [2.6, 2.6, 2.7] } as const;
export const WASE_HR = { male: [66.4, 66.4, 64.7], female: [70.3, 68.4, 69.0] } as const;
export const WASE_GROUPS = ['18–40', '41–65', '> 65'] as const;

/** Maceira 2006 Tables 2–3: SV/BSA (mL/m²) by age decile, at the decile midpoint.
 *  CMR chamber-volume SV; no longer used for calibration (v2.7), shown for comparison. */
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

/** Stroke-volume index used for calibration: WASE Doppler (mL/m²). */
export const svIndex = (sex: number, age: number): number =>
  interp(sex === 1 ? SVI_DOPPLER.female : SVI_DOPPLER.male, age);

/** The pre-v2.7 rule (Maceira CMR × CALIB.svScale), kept for comparison in Methods. */
export const svIndexLegacy = (sex: number, age: number): number =>
  interp(sex === 1 ? SVI_CMR.female : SVI_CMR.male, age) * CALIB.svScale;

export const CALIB = {
  /** Pre-v2.7 only: scale that brought Maceira CMR SV to the v1 default flow level
   *  (72 mL in a 45-y man of BSA 1.90 m² ⇒ 37.9 mL/m² ≈ 0.70 × 54). Not from a
   *  published conversion; no longer used for calibration. */
  svScale: 0.70
} as const;

/** Muscular-artery PWV (m/s) at a given age: Avolio 1983 slope, v1 anchor at 45 y. */
export const MUS_PWV = { slope: 0.048, anchorAge: 45, anchor: 9.0 } as const;
export const musPWV = (age: number): number => MUS_PWV.anchor + MUS_PWV.slope * (age - MUS_PWV.anchorAge);

/** Arteriolar radius (%) and reflection coefficient Γ fitted at the eight healthy study
 *  profiles (v2.7, HR 70 bpm, ejection 300 ms, the profiles' heights and weights): radius so
 *  cuff SBP = Herbert 2014 central SBP + amplification for the sex and decade; Γ so AIx =
 *  Janner 2010 for sex, age, HR 70 and height. Between the knots the values are interpolated
 *  linearly; below 25 y and above 80 y they are held flat (extrapolated). The knots equal the
 *  STUDY_PROFILES values; tests/calibration.test.ts checks that and that the fitted targets
 *  are still met (the "Cuff SBP" and "AIx" rows on the Validation tab). */
export const AGE_FIT = {
  ages: [25, 45, 65, 80],
  male:   { radius: [103, 102, 104, 103],      gamma: [0.14, 0.23, 0.27, 0.33] },
  female: { radius: [99.5, 98.5, 100.5, 99],   gamma: [0.26, 0.37, 0.39, 0.37] }
} as const;
const knots = (ys: readonly number[]) => AGE_FIT.ages.map((a, i) => [a, ys[i]] as const);
export const radiusFor = (sex: number, age: number): number =>
  interp(knots((sex === 1 ? AGE_FIT.female : AGE_FIT.male).radius), age);
export const gammaFor = (sex: number, age: number): number =>
  interp(knots((sex === 1 ? AGE_FIT.female : AGE_FIT.male).gamma), age);

/** Age range each calibrated input rests on, in years; outside it the value is held flat. */
export const CAL_DATA_RANGE = {
  diam: [1, 85],      // Campens 2014 sample
  cAo: [25, 75],      // RVASC decade midpoints (strict-normal sample to 85, ≥ 70 pooled)
  sv: [29, 72],       // WASE age-group midpoints (18–40, 41–65, > 65)
  cMus: [20, 70],     // Avolio 1983 slope (anchor from v1)
  radius: [25, 80],   // fitted study profiles
  gamma: [25, 80]
} as const;
export type CalKey = keyof typeof CAL_DATA_RANGE;
/** Calibrated inputs whose value at this age is extrapolated beyond their data. */
export const extrapolatedAt = (age: number): CalKey[] =>
  (Object.keys(CAL_DATA_RANGE) as CalKey[]).filter(k => age < CAL_DATA_RANGE[k][0] || age > CAL_DATA_RANGE[k][1]);

export interface Calibration {
  bsa: number;
  cMus: number;
  diam: number; diamRange: [number, number];
  cAo: number; pwvRange: [number, number];
  sv: number; svi: number;
  radius: number; gamma: number;
  extrapolated: CalKey[];
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
    cMus: musPWV(p.age),
    radius: radiusFor(p.sex, p.age), gamma: gammaFor(p.sex, p.age),
    extrapolated: extrapolatedAt(p.age)
  };
}

/** Inputs that calibration sets (v2.7 adds arteriolar radius and Γ). */
export const CALIBRATED_KEYS = ['diam', 'cAo', 'sv', 'cMus', 'radius', 'gamma'] as const;
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
    cMus: Math.round(c.cMus * 10) / 10,
    radius: Math.round(c.radius * 2) / 2,
    gamma: Math.round(c.gamma * 100) / 100
  };
}
