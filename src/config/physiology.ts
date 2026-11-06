/* =====================================================================
   Every physiological constant, default, slider range, preset and drug.
   Values are copied unchanged from v1 (js/model.js, js/content.js).
   Units: mmHg, mL, bpm, m/s, s, cm; impedance inside the model is
   mmHg·s/mL (× DYN → dyn·s·cm⁻⁵).
   ===================================================================== */

/** Inputs to the haemodynamic model. */
export interface Params {
  hr: number;        // heart rate, bpm
  sv: number;        // stroke volume, mL
  etScale: number;   // multiplier on Weissler LVET
  radius: number;    // arteriolar radius, % of normal (sets SVR via r⁻⁴)
  svrRef: number;    // SVR at radius 100 %, mmHg·s/mL
  cAo: number;       // intrinsic elastic-aorta PWV at MAP 93, m/s
  cMus: number;      // muscular-artery PWV, m/s
  gamma: number;     // peripheral reflection coefficient Γ
  diam: number;      // ascending aortic diameter, cm
  height: number;    // body height, cm
  lpScale: number;   // reflection-site distance multiplier
  vEff: number;      // effective arterial volume for compliance, mL
  lvedp: number;     // LV end-diastolic pressure for SEVR, mmHg
  sex: number;       // 0 = male, 1 = female (Weissler LVET; calibration)
  age: number;       // years (calibration only)
  weight: number;    // kg (BSA for calibration only)
  resp: number;      // physiologic response: 0 independent, 1 pacing, 2 exercise, 3 physiologic rest (see RESPONSE)
  hrRest: number;    // bpm, resting heart rate the response is anchored to (the SV slider = SV at this HR)
}

export type ParamKey = keyof Params;

/* ---------------- physical constants ---------------- */
export const PHYS = {
  RHO: 1060,          // blood density, kg/m³
  MMHG: 133.322,      // Pa per mmHg
  DYN: 1333.22,       // dyn/cm² per mmHg
  N: 1024,            // samples per beat
  /** Central venous pressure. v1 has none, so 0 keeps MAP = CO × SVR exactly. */
  cvp: 0
} as const;

/* ---------------- model tuning constants (v1) ---------------- */
export const MODEL = {
  /** Weissler LVET (ms) = a − b·HR (Weissler 1968; men 413 − 1.7·HR, women 418 − 1.6·HR) */
  lvetA: 413,
  lvetB: 1.7,
  lvetAF: 418,
  lvetBF: 1.6,
  etMin: 0.15,              // s
  etMaxFrac: 0.6,           // of cycle length
  /** Passive MAP → stiffness coupling: c = c0·(1 + k·(MAP − mapRef)). Aortic slope k·c0 =
   *  0.45 m/s per 10 mmHg at c0 7.5 m/s and 0.53 at 8.8 m/s, inside the measured
   *  0.6 ± 0.3 (Butlin 2017) and 0.65 (95 % CI 0.46–0.83; McNally 2024). Validation §9. */
  mapRef: 93,
  kAo: 0.006,               // elastic aorta, per mmHg
  kMus: 0.004,              // muscular arteries, per mmHg
  cAoMin: 3,                // m/s floor
  cMusMin: 4,               // m/s floor
  lpPerHeight: 0.27,        // Lp = 0.27 × height × lpScale
  fAo: 0.65,                // fraction of reflection path that is elastic aorta
  diamRef: 2.8,             // cm, reference diameter for compliance
  cTermMinFrac: 0.15,       // terminal compliance floor, fraction of total
  gammaMin: 0.01,
  gammaMax: 0.95,
  ztOverZc: 2.6,            // terminal impedance step Zt = 2.6·Zc
  ztMaxFracSvr: 0.8,        // ...but no more than 0.8·SVR
  gammaRef: 0.5,            // kRefl = Γ / 0.5
  cuff: { sbp: 5.7, dbp: 5.5 },  // cuff − intra-arterial brachial offsets, mmHg (Picone 2017)
  pzfFrac: 0.6,             // zero-flow pressure / MAP (v2.5): study-profile mean P∞ 58 vs 58.5 mmHg (Yamakado 2018)
  rTermMinFrac: 0.05,
  reflFc: 2.0,              // Hz, Windkessel → dispersed-reflection crossover (v2.5; results change < 1 mmHg RMS over 1.5–3 Hz)
  gMax: 0.97,               // cap on |G(ω)|
  damp: 0.055,              // attenuation per Hz per round trip
  armLenPerHeight: 0.42,    // v1: aortic root → radial, × height
  armReflPerHeight: 0.30,   // v2.5: effective arm reflection distance × height, and
  gArmV25: 0.60,            // v2.5 arm reflection: together they put the aorta→brachial transfer-function peak at
                            // ≈ 2.6× near 4–4.5 Hz (measured 2.5× at 5 Hz, Karamanoglu 1993; 2.0× at 4 Hz, Westerhof 2007)
  brachFrac: 0.62,          // brachial site along the arm
  gArm: 0.45,               // fixed upper-limb reflection
  armAtt: 0.035,            // arm attenuation per Hz
  flowRise: 0.75,           // ejection profile x^a (1−x)^b
  flowFall: 1.55,
  aix75PerBpm: 0.39,        // AIx@75 = AIx + 0.39·(HR − 75)  (Wilkinson 2000; v1)
  typeAThreshold: 0.12,     // AP/PP above this → Murgo type A
  p2Window: 0.08            // s after echo arrival to search for P2
} as const;

/** Model generation. v2.5 adds three physiologic pieces to the v1 solver:
 *  - reflection: Γ scales reflection at the higher harmonics only; near 0 Hz the load is
 *    the full Windkessel (reflScale in solve.ts), so diastole decays as R·C predicts;
 *  - zero-flow pressure: the arterioles drain toward Pzf = MODEL.pzfFrac × MAP, not 0
 *    (critical closing pressure; Chemla 2017, Yamakado 2018);
 *  - cuff: bSBP/bDBP are what a cuff reads, intra-arterial − 5.7 / + 5.5 mmHg (Picone 2017).
 *  'v1' switches all three off so tests/regression.test.ts can prove the port reproduces v1. */
export const LAWS: { gen: 'v2.5' | 'v1' } = { gen: 'v2.5' };
export function useV1Laws(on = true): void { LAWS.gen = on ? 'v1' : 'v2.5'; }

/** Default ejection duration at the default HR (ms). etScale is stored so that ejection
 *  still follows HR through the Weissler relation; the slider shows milliseconds. */
export const DEFAULT_LVET_MS = 300;

/* ---------------- default physiology (healthy ~45 y man) ---------------- */
export const DEFAULTS: Readonly<Params> = {
  hr: 70,
  sv: 72,
  etScale: Number((DEFAULT_LVET_MS / (413 - 1.7 * 70)).toFixed(6)),   // 300 ms at 70 bpm (v1: 1.0 = 294 ms)
  radius: 100,
  svrRef: 1.10,
  cAo: 7.5,
  cMus: 9.0,
  gamma: 0.45,
  diam: 2.8,
  height: 175,
  lpScale: 1.0,
  vEff: 450,
  lvedp: 8,
  sex: 0,
  age: 45,
  weight: 77,
  resp: 0,
  hrRest: 70
};

/* ---------------- sliders (from v1 js/content.js) ---------------- */
export interface Control {
  key: ParamKey;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  /** decimals shown */
  f: number;
  tip: string;
  /** 'toggle' renders as buttons, one per option (value = option index) */
  kind?: 'toggle';
  options?: string[];
  /** false: patient description only (calibration), not a direct model input;
   *  left out of sweeps and the "what differs" breakdown */
  model?: false;
  /** Shown to the user in other units than stored (ejection duration: ms ↔ multiplier). */
  view?: ControlView;
}
export interface ControlView {
  unit: string;
  f: number;
  step: number;
  to: (v: number, p: Params) => number;
  from: (x: number, p: Params) => number;
}

/** Weissler LVET in ms for a heart rate and sex (men 413 − 1.7·HR; women 418 − 1.6·HR). */
export const weisslerMs = (hr: number, sex: number): number =>
  sex === 1 ? MODEL.lvetAF - MODEL.lvetBF * hr : MODEL.lvetA - MODEL.lvetB * hr;

/** Ejection duration shown in ms: Weissler LVET at the set HR × multiplier, before the
 *  model's floor (150 ms) and ceiling (60 % of the cycle) are applied. */
const ET_VIEW: ControlView = {
  unit: 'ms', f: 0, step: 1,
  to: (v, p) => v * weisslerMs(p.hr, p.sex),
  from: (x, p) => x / weisslerMs(p.hr, p.sex)
};

/** A control's value as text, in the units the user sees. */
export function controlText(c: Control, v: number, p: Params): string {
  if (c.kind === 'toggle' && c.options) return c.options[Math.round(v)] ?? String(v);
  if (c.view) return `${c.view.to(v, p).toFixed(c.view.f)} ${c.view.unit}`;
  return `${v.toFixed(c.f)}${c.unit ? ' ' + c.unit : ''}`;
}
export interface ControlGroup {
  group: string;
  color: string;
  items: Control[];
}

export const CONTROLS: ControlGroup[] = [
  { group: 'Heart', color: 'var(--accent)', items: [
    { key: 'hr', label: 'Heart rate', min: 40, max: 180, step: 1, unit: 'bpm', f: 0,
      tip: 'Sets cycle length and, via the Weissler relation, ejection time (LVET ≈ 413 − 1.7·HR ms in men, 418 − 1.6·HR in women). Slower HR lengthens systole, so the reflected wave lands earlier relative to ejection and AIx rises. Weissler\'s regression was validated from 50 to 150 bpm; above that ejection is held at its 150 ms floor and 60 % of the cycle, so treat values above 150 bpm as extrapolation.' },
    { key: 'sv', label: 'Stroke volume', min: 30, max: 120, step: 1, unit: 'mL', f: 0,
      tip: 'Volume ejected per beat. Scales the flow wave, hence the forward pressure wave (water-hammer: ΔP = Zc·ΔQ) and cardiac output.' },
    { key: 'etScale', label: 'Ejection duration', min: 0.8, max: 1.2, step: 0.001, unit: '× Weissler', f: 3, view: ET_VIEW,
      tip: 'Left-ventricular ejection time (LVET) in ms. It follows heart rate through the Weissler relation (LVET ≈ 413 − 1.7·HR ms in men, 418 − 1.6·HR in women), so changing HR changes it; the slider sets how far this patient sits from that line (0.8–1.2 ×). Longer ejection keeps the ventricle exposed to the returning reflected wave for longer (larger Δtr and wasted energy).' }
  ]},
  { group: 'Arterioles (resistance)', color: 'var(--ink-3)', items: [
    { key: 'radius', label: 'Arteriolar radius', min: 75, max: 140, step: 0.5, unit: '%', f: 1,
      tip: 'Poiseuille: R = 8μL/πr⁴, so SVR scales with radius⁻⁴. A 10 % increase in radius lowers SVR by ~32 %. Mainly moves mean pressure (MAP = CO × SVR).' }
  ]},
  { group: 'Elastic arteries (aorta)', color: 'var(--fwd)', items: [
    { key: 'cAo', label: 'Aortic PWV (intrinsic)', min: 4, max: 16, step: 0.1, unit: 'm/s', f: 1,
      tip: 'Stiffness of the central elastic arteries at a reference MAP of 93 mmHg. Raises characteristic impedance (Zc = ρc/A), lowers compliance (C ∝ 1/ρc²) and speeds wave return. The operating value also rises passively with MAP.' },
    { key: 'diam', label: 'Aortic diameter', min: 2.0, max: 4.2, step: 0.05, unit: 'cm', f: 2,
      tip: 'Larger lumen lowers Zc (Zc = ρc/A) and adds compliance — the aorta dilates with age, partly offsetting stiffening.' }
  ]},
  { group: 'Muscular arteries & reflection', color: 'var(--bwd)', items: [
    { key: 'cMus', label: 'Muscular-artery PWV', min: 4, max: 14, step: 0.1, unit: 'm/s', f: 1,
      tip: 'Smooth-muscle tone of the muscular conduits (femoral, popliteal, brachial). Vasodilators lower it, delaying the reflected wave (Nichols & Singh 2002). Also sets arm-wave speed (amplification).' },
    { key: 'gamma', label: 'Reflection coefficient Γ', min: 0.04, max: 0.9, step: 0.01, unit: '', f: 2,
      tip: 'Fraction of the forward wave reflected at the effective reflection site (impedance mismatch). Vasodilators lower it; vasoconstrictors raise it.' },
    { key: 'lpScale', label: 'Reflection-site position', min: 0.7, max: 1.5, step: 0.01, unit: '×', f: 2,
      tip: 'Scales the effective distance to the major reflection site (Lp = 0.27 × height × factor). Values > 1 shift the site distally (as described in youth).' }
  ]},
  { group: 'Physiologic response', color: 'var(--accent)', items: [
    { key: 'resp', label: 'When HR or drugs change', min: 0, max: 3, step: 1, unit: '', f: 0, kind: 'toggle', options: ['Independent', 'Pacing', 'Exercise', 'Physiologic'], model: false,
      tip: 'Independent: every input acts alone (for studying one variable at a time). Pacing: as measured during atrial pacing, cardiac output stays almost constant (Ross 1965) and MAP rises ≈ 3 % per 10 bpm (Lazim 2025). Exercise: as measured in upright cycling, stroke volume rises ≈ 38 % in early exercise then plateaus (Pandey 2020) and MAP rises ≈ 2 % per 10 bpm (Wheatley), so SVR falls. Physiologic: the pacing relation for heart rate, plus baroreflex buffering of drug effects measured by ganglionic blockade (≈ 70 % in young men, ≈ 38 % at 65 y, less in women; Jones 2003, Christou 2003 and 2005).' },
    { key: 'hrRest', label: 'Resting heart rate (reference)', min: 40, max: 120, step: 1, unit: 'bpm', f: 0, model: false,
      tip: 'The heart rate the stroke-volume slider and the baroreflex set-point refer to. With Pacing, Exercise or Physiologic on, the SV slider means stroke volume at this heart rate. Loading a profile sets it to the profile\'s heart rate.' }
  ]},
  { group: 'Patient', color: 'var(--brach)', items: [
    { key: 'sex', label: 'Sex', min: 0, max: 1, step: 1, unit: '', f: 0, kind: 'toggle', options: ['Male', 'Female'],
      tip: 'Selects the sex-specific Weissler ejection-time line and the sex-specific reference equations used to calibrate aortic diameter and stroke volume. Changing it recalibrates aortic diameter, aortic PWV and stroke volume.' },
    { key: 'age', label: 'Age', min: 18, max: 95, step: 1, unit: 'y', f: 0, model: false,
      tip: 'Used only for calibration: changing age recalculates aortic diameter (Campens 2014), intrinsic aortic PWV (Reference Values for Arterial Stiffness Collaboration 2010) and stroke volume (Maceira 2006). It does not act on the waveform directly.' },
    { key: 'height', label: 'Height', min: 140, max: 205, step: 1, unit: 'cm', f: 0,
      tip: 'Body height sets the path length to the reflection site and the arm path. Shorter people have earlier reflections and a higher AIx (Nichols & Singh 2002). With weight it gives body surface area, so changing it also recalibrates aortic diameter and stroke volume.' },
    { key: 'weight', label: 'Weight', min: 35, max: 160, step: 1, unit: 'kg', f: 0, model: false,
      tip: 'Used only for calibration: with height it gives body surface area (Du Bois), which scales the predicted aortic diameter and stroke volume.' }
  ]}
];

export const ALL_CONTROLS: Control[] = CONTROLS.flatMap(g => g.items);

/* ---------------- presets (from v1) ---------------- */

/* -------- healthy study profiles: men and women at 25, 45, 65 and 80 y --------
   Height and weight: typical healthy-weight adults (BMI ≈ 23–24); enter your
   subject's own values and the calibrated inputs update.
   Calibrated from sex, age, height and weight (src/model/calibrate.ts):
     aortic diameter (Campens 2014), intrinsic aortic PWV (RVASC 2010 normal values),
     stroke volume (Maceira 2006 SV/BSA × 0.70).
   Fitted, two numbers per profile, to healthy reference data:
     arteriolar radius (SVR) so central SBP = mean of the "normal" population of
       Herbert et al. 2014 for that sex and age decade;
     reflection coefficient Γ so AIx = Janner et al. 2010 reference equation
       (sex, age, HR, height).
   Everything else (DBP, PP, amplification, PWV at the operating MAP, diastolic decay,
   SEVR) is a model prediction, checked on the Validation tab.
   Ejection duration starts at 300 ms (etScale = 300 / Weissler LVET at 70 bpm). */
export interface StudyProfile { sex: 0 | 1; age: number; height: number; weight: number; diam: number; cAo: number; sv: number; cMus: number; radius: number; gamma: number; }
export const STUDY_PROFILES: Record<string, StudyProfile> = {
  'Healthy man (25 y)':   { sex: 0, age: 25, height: 177, weight: 75, diam: 2.70, cAo: 6.2,  sv: 75, cMus: 8.0, radius: 102.5, gamma: 0.14 },
  'Healthy man (45 y)':   { sex: 0, age: 45, height: 176, weight: 77, diam: 3.00, cAo: 7.2,  sv: 73, cMus: 9.0, radius: 100.5, gamma: 0.23 },
  'Healthy man (65 y)':   { sex: 0, age: 65, height: 174, weight: 75, diam: 3.20, cAo: 10.3, sv: 69, cMus: 10.0, radius: 101.5, gamma: 0.24 },
  'Healthy man (80 y)':   { sex: 0, age: 80, height: 171, weight: 71, diam: 3.30, cAo: 10.9, sv: 65, cMus: 10.7, radius: 99,    gamma: 0.27 },
  'Healthy woman (25 y)': { sex: 1, age: 25, height: 163, weight: 61, diam: 2.45, cAo: 6.2,  sv: 63, cMus: 8.0, radius: 100,   gamma: 0.27 },
  'Healthy woman (45 y)': { sex: 1, age: 45, height: 162, weight: 62, diam: 2.75, cAo: 7.2,  sv: 59, cMus: 9.0, radius: 96.5,  gamma: 0.37 },
  'Healthy woman (65 y)': { sex: 1, age: 65, height: 160, weight: 61, diam: 2.90, cAo: 10.3, sv: 55, cMus: 10.0, radius: 96,    gamma: 0.32 },
  'Healthy woman (80 y)': { sex: 1, age: 80, height: 157, weight: 58, diam: 2.95, cAo: 10.9, sv: 52, cMus: 10.7, radius: 94,    gamma: 0.32 }
};
/** Reference values for the study profiles. v2.5 fits SVR to cuff SBP (Herbert 2014 central
 *  SBP + amplification, i.e. their healthy cuff SBP) and Γ to AIx (Janner 2010); central SBP
 *  (Herbert) and cuff DBP (NHANES normotensive, Wright 2011) are then predictions. */
export const STUDY_TARGETS: Record<string, { cSBP: number; aix: number; cuffDBP?: number }> = {
  'Healthy man (25 y)':   { cSBP: 103, aix: 5.1, cuffDBP: 68 },
  'Healthy man (45 y)':   { cSBP: 106, aix: 15.3, cuffDBP: 74 },
  'Healthy man (65 y)':   { cSBP: 114, aix: 24.2, cuffDBP: 67 },
  'Healthy man (80 y)':   { cSBP: 116, aix: 30.5, cuffDBP: 67 },
  'Healthy woman (25 y)': { cSBP: 95,  aix: 12.7, cuffDBP: 67 },
  'Healthy woman (45 y)': { cSBP: 102, aix: 24.0, cuffDBP: 72 },
  'Healthy woman (65 y)': { cSBP: 114, aix: 31.5, cuffDBP: 66 },
  'Healthy woman (80 y)': { cSBP: 118, aix: 34.8, cuffDBP: 66 }
};

function studyPresets(): Record<string, Partial<Params>> {
  return Object.fromEntries(Object.entries(STUDY_PROFILES).map(([name, s]) => [name, {
    ...s, hr: 70, lpScale: 1.0, etScale: Number((DEFAULT_LVET_MS / weisslerMs(70, s.sex)).toFixed(6))
  }]));
}
export const isStudyPreset = (name: string): boolean => name in STUDY_PROFILES;

/* v1 teaching profiles first (their order is part of saved links), then the healthy
   study profiles. Age on the v1 profiles is descriptive only. */
export const PRESETS: Record<string, Partial<Params>> = {
  'Default adult (45 y)': {},
  'Young adult (20 y)':  { hr: 64, sv: 78, cAo: 5.2, cMus: 9.0, gamma: 0.42, diam: 2.4, lpScale: 1.3, radius: 102, age: 20 },
  'Middle-aged (45 y)':  { hr: 70, sv: 72, cAo: 7.5, cMus: 9.0, gamma: 0.45, diam: 2.8, lpScale: 1.0 },
  'Older adult (70 y)':  { hr: 68, sv: 70, cAo: 9.5, cMus: 9.0, gamma: 0.58, diam: 3.4, lpScale: 0.95, radius: 97, age: 70 },
  'Isolated systolic HTN (80 y)': { hr: 66, sv: 70, cAo: 11.5, cMus: 9.0, gamma: 0.62, diam: 3.8, lpScale: 0.9, radius: 95, age: 80 },
  'Essential HTN (55 y)': { hr: 74, sv: 74, cAo: 8.8, cMus: 9.5, gamma: 0.55, diam: 3.0, lpScale: 0.95, radius: 97, age: 55 },
  'Short stature (155 cm)': { height: 155 },
  'Tall stature (195 cm)':  { height: 195 },
  ...studyPresets()
};
// the response modes anchor to each profile's own resting heart rate
for (const p of Object.values(PRESETS)) if (p.hr != null && p.hrRest == null) p.hrRest = p.hr;

/* -------- long-term drug effects (from v1, multiplicative / additive) --------
   Based on Nichols & Singh 2002 and Townsend et al. 2015 (Table 1):
   vasodilators act on muscular arteries (lower muscular PWV & reflection),
   arteriolar dilators raise arteriolar radius (lower SVR), beta-blockers
   slow HR (lengthening ejection, raising AIx) with little vasodilation.
   Magnitudes are teaching values; only the directions come from the sources. */
export interface DrugEffect {
  radius?: number;   // × arteriolar radius
  cMus?: number;     // × muscular PWV
  cAo?: number;      // × intrinsic aortic PWV
  gamma?: number;    // × Γ
  hrAdd?: number;    // + bpm
  svAdd?: number;    // + mL
}
export interface Drug {
  label: string;
  short: string;
  fx: DrugEffect;
  illustrative: true;
  source: string;
}

const DIRECTION_SOURCE = 'Direction: Nichols & Singh 2002; Townsend et al. 2015, Table 1';

export const DRUGS: Record<string, Drug> = {
  acei:    { label: 'ACE inhibitor', short: 'ACEi', fx: { radius: 1.025, cMus: 0.88, gamma: 0.82, cAo: 0.97 }, illustrative: true, source: DIRECTION_SOURCE },
  arb:     { label: 'Angiotensin receptor blocker', short: 'ARB', fx: { radius: 1.025, cMus: 0.89, gamma: 0.83, cAo: 0.97 }, illustrative: true, source: DIRECTION_SOURCE },
  ccb:     { label: 'Calcium-channel blocker (DHP)', short: 'CCB', fx: { radius: 1.03, cMus: 0.90, gamma: 0.85, hrAdd: 3 }, illustrative: true, source: DIRECTION_SOURCE },
  bb:      { label: 'Beta-blocker (atenolol)', short: 'β-blocker', fx: { hrAdd: -14, svAdd: 6, radius: 0.99 }, illustrative: true, source: DIRECTION_SOURCE },
  diur:    { label: 'Thiazide diuretic', short: 'Diuretic', fx: { svAdd: -2, radius: 1.006, gamma: 0.95 }, illustrative: true, source: DIRECTION_SOURCE },
  nitrate: { label: 'Organic nitrate', short: 'Nitrate', fx: { cMus: 0.76, gamma: 0.55, radius: 1.004, svAdd: -2 }, illustrative: true, source: DIRECTION_SOURCE },
  pe:      { label: 'Vasoconstrictor (phenylephrine)', short: 'Vasoconstrictor', fx: { radius: 0.96, cMus: 1.10, gamma: 1.18 }, illustrative: true, source: DIRECTION_SOURCE }
};

/* -------- drug kinetics and the acute (timeline) drugs --------
   Every drug acts only on model inputs. Effect level E(t) ∈ [0, 1] follows
   first-order onset (τon) and offset (τoff). Multipliers combine in log
   space (factor^E, multiplied across drugs); additions scale with E.
   All magnitudes and time constants are illustrative teaching values. */
export type DrugMode = 'bolus' | 'infusion';

export interface DrugKinetics {
  tauOn: number;           // s
  tauOff: number;          // s
  modes: DrugMode[];
  /** chronic = v1 long-term therapy; can start at steady state */
  chronic: boolean;
}

export const DRUG_KINETICS: Record<string, DrugKinetics> = {
  // v1 long-term drugs: slow on/off; usually started "at steady state"
  acei:    { tauOn: 600, tauOff: 1800, modes: ['infusion'], chronic: true },
  arb:     { tauOn: 600, tauOff: 1800, modes: ['infusion'], chronic: true },
  ccb:     { tauOn: 600, tauOff: 1800, modes: ['infusion'], chronic: true },
  bb:      { tauOn: 600, tauOff: 1800, modes: ['infusion'], chronic: true },
  diur:    { tauOn: 900, tauOff: 2400, modes: ['infusion'], chronic: true },
  nitrate: { tauOn: 300, tauOff: 900,  modes: ['infusion'], chronic: true },
  pe:      { tauOn: 300, tauOff: 900,  modes: ['infusion'], chronic: true },
  // acute drugs (spec): NTG τon 60 s / τoff 180 s; esmolol τon 60 s / τoff 600 s
  ntg:     { tauOn: 60,  tauOff: 180,  modes: ['bolus', 'infusion'], chronic: false },
  phe:     { tauOn: 30,  tauOff: 300,  modes: ['bolus', 'infusion'], chronic: false },
  esmolol: { tauOn: 60,  tauOff: 600,  modes: ['bolus', 'infusion'], chronic: false },
  dobutamine: { tauOn: 90, tauOff: 120, modes: ['infusion'], chronic: false },
  propofol: { tauOn: 30, tauOff: 300,  modes: ['bolus', 'infusion'], chronic: false },
  norepinephrine: { tauOn: 30, tauOff: 120, modes: ['infusion'], chronic: false }
};

const ACUTE_SOURCE = 'Illustrative teaching values. Directions: Nichols & Singh 2002; Townsend et al. 2015, Table 1 (vasodilators, β-blockade); standard pharmacology for inotropes, vasopressors and propofol.';

export const ACUTE_DRUGS: Record<string, Drug> = {
  ntg:        { label: 'Nitroglycerin', short: 'NTG', fx: { cMus: 0.75, gamma: 0.55, radius: 1.01, svAdd: -6 }, illustrative: true, source: ACUTE_SOURCE },
  phe:        { label: 'Phenylephrine (acute)', short: 'Phenylephrine', fx: { radius: 0.92, cMus: 1.10, gamma: 1.20 }, illustrative: true, source: ACUTE_SOURCE },
  esmolol:    { label: 'Esmolol', short: 'Esmolol', fx: { hrAdd: -18, svAdd: -4 }, illustrative: true, source: ACUTE_SOURCE },
  dobutamine: { label: 'Dobutamine', short: 'Dobutamine', fx: { hrAdd: 15, svAdd: 15, radius: 1.03 }, illustrative: true, source: ACUTE_SOURCE },
  propofol:   { label: 'Propofol', short: 'Propofol', fx: { radius: 1.05, cMus: 0.95, svAdd: -8, hrAdd: -3 }, illustrative: true, source: ACUTE_SOURCE },
  norepinephrine: { label: 'Norepinephrine', short: 'Norepi', fx: { radius: 0.93, cMus: 1.08, gamma: 1.12, hrAdd: 4, svAdd: 6 }, illustrative: true, source: ACUTE_SOURCE }
};

/** Every drug: the 7 v1 long-term drugs plus the 6 acute drugs. */
export const ALL_DRUGS: Record<string, Drug> = { ...DRUGS, ...ACUTE_DRUGS };

/** Repeat doses of one drug saturate (Emax model). Exposure C is the sum of every dose's
 *  current level (1 = one standard dose at full effect). Effect E = Emax·C / (EC50 + C),
 *  with EC50 = Emax − 1 so one full dose gives exactly E = 1 (the v1 effect) and no
 *  amount of drug exceeds Emax = 1.2 (120 % of one dose). Illustrative. */
export const DRUG_EMAX = { emax: 1.2 } as const;

/** Phenylephrine baroreflex: HR falls 0.3 bpm per mmHg MAP rise, at most 20 bpm. */
/** Illustrative stroke-volume rise when an acute drug lowers HR (longer filling time):
 *  SV × (HR before / HR after)^exponent. Live engine only; v1 long-term drugs are unchanged. */
export const SV_HR_COUPLING = { exponent: 0.5, illustrative: true } as const;

export const BAROREFLEX = { drug: 'phe', bpmPerMmHg: 0.3, maxFall: 20 } as const;

/** Physiologic response modes (Params.resp). Applied in the live engine after drugs.
 *  Every number below is taken from published human data (see Methods §13). x = set HR − resting HR. */
export const RESPONSE = {
  modes: ['Independent', 'Pacing', 'Exercise', 'Physiologic'] as const,
  /** Pacing, cardiac output: right-atrial pacing 80 → 121 bpm at rest, cardiac index 3.67 → 3.72 L/min/m²
   *  (Ross, Linhart & Braunwald 1965): +1.36 % over 41 bpm. */
  pacingCoPerBpm: (3.72 / 3.67 - 1) / 41,
  /** Pacing, MAP: brachial MAP 95.95 → 102.02 mmHg, paced 70 → 90 bpm (Lazim et al. 2025; rise also
   *  reported by Wilkinson et al. 2000): +6.3 % over 20 bpm. */
  pacingMapPerBpm: (102.02 / 95.95 - 1) / 20,
  /** Exercise, stroke volume index (upright cycling, invasive; Pandey et al. 2020, n = 104, 20–76 y):
   *  rest 37 mL/m² at HR 77 → 51 at HR 101 (50 W) → 49 at HR 168 (peak). */
  exSv: { rest: 37, sub: 51, peak: 49, hrRest: 77, hrSub: 101, hrPeak: 168 },
  /** Exercise, MAP (upright cycling, intra-arterial; Wheatley et al.): 96.1 → 107.4 mmHg at HR 81 → 133
   *  and 116.2 mmHg at HR 183. Least-squares slope through rest: 0.21 % per bpm. */
  exMap: { rest: 96.1, low: 107.4, mod: 116.2, hrRest: 81, hrLow: 133, hrMod: 183 },
  /** Baroreflex buffering (potentiation of the pressor response to phenylephrine infusion during vs
   *  before ganglionic blockade, BRB; buffered fraction = 1 − 1/BRB).
   *  Men: 3.5 at 25 y and 1.6 at 65 y (Jones et al. 2003); 2.65 at 41 y (mean of 2.5 and 2.8,
   *  Christou et al. 2003). Women: BRB 47 % smaller than men at 27–28 y (bolus 3.3 vs 6.3; Christou
   *  et al. 2005); applied as the same share of the excess over 1 at every age (an assumption). */
  baro: { menAge: [25, 41, 65], menBrb: [3.5, 2.65, 1.6], womenExcessRatio: (3.3 - 1) / (6.3 - 1) }
} as const;

/** Exercise SV factor vs x (bpm above rest): linear to the 50 W value, then linear to the peak value. */
export function exerciseSvFactor(x: number): number {
  const s = RESPONSE.exSv, x1 = s.hrSub - s.hrRest, x2 = s.hrPeak - s.hrRest;
  if (x <= 0) return 1;
  const f1 = s.sub / s.rest, f2 = s.peak / s.rest;
  return x <= x1 ? 1 + (f1 - 1) * x / x1 : f1 + (f2 - f1) * Math.min(1, (x - x1) / (x2 - x1));
}
/** Exercise MAP ratio vs x: least-squares line through the origin of Wheatley's two exercise stages. */
export const exerciseMapSlope = (() => {
  const m = RESPONSE.exMap;
  const xs = [m.hrLow - m.hrRest, m.hrMod - m.hrRest], ys = [m.low / m.rest - 1, m.mod / m.rest - 1];
  return (xs[0] * ys[0] + xs[1] * ys[1]) / (xs[0] ** 2 + xs[1] ** 2);
})();
/** Baroreflex buffered fraction for a sex and age (0 = none, 1 = complete). */
export function baroFraction(sex: number, age: number): number {
  const b = RESPONSE.baro, a = b.menAge, v = b.menBrb;
  let brb = age <= a[0] ? v[0] : age >= a[2] ? v[2]
    : age <= a[1] ? v[0] + (v[1] - v[0]) * (age - a[0]) / (a[1] - a[0]) : v[1] + (v[2] - v[1]) * (age - a[1]) / (a[2] - a[1]);
  if (sex === 1) brb = 1 + (brb - 1) * b.womenExcessRatio;
  return 1 - 1 / brb;
}

/** Live engine settings. */
export const ENGINE = {
  rampBeats: 3,             // input changes ease over 3 beats
  trendWindowS: 600,        // 10 min of per-beat trends
  warps: [0.25, 0.5, 1] as const,
  historySteps: 50          // undo/redo depth
} as const;

/* ---------------- citations ---------------- */
export const CITATIONS = {
  NE2001: 'Nichols WW, Edwards DG. Arterial elastance and wave reflection augmentation of systolic blood pressure: deleterious effects and implications for therapy. J Cardiovasc Pharmacol Ther 2001;6(1):5–21.',
  NS2002: 'Nichols WW, Singh BM. Augmentation index as a measure of peripheral vascular disease state. Curr Opin Cardiol 2002;17:543–551.',
  T2015a: 'Townsend RR, Black HR, Chirinos JA, et al. Clinical use of pulse wave analysis: proceedings from a symposium sponsored by North American Artery. J Clin Hypertens 2015;17:503–513.',
  T2015b: 'Townsend RR. Novel uses of office-based measures of arterial compliance. Methodist DeBakey Cardiovasc J 2015;11(4):219–222.',
  W2000: 'Wilkinson IB, MacCallum H, Flint L, et al. The influence of heart rate on augmentation index and central arterial pressure in humans. J Physiol 2000;525:263–270.',
  McDonald: "Nichols WW, O'Rourke MF, Vlachopoulos C. McDonald's Blood Flow in Arteries. 6th ed. Hodder Arnold; 2011.",
  Weissler1968: 'Weissler AM, Harris WS, Schoenfeld CD. Systolic time intervals in heart failure in man. Circulation 1968;37:149–159.',
  Campens2014: 'Campens L, Demulier L, De Groote K, et al. Reference values for echocardiographic assessment of the diameter of the aortic root and ascending aorta spanning all age categories. Am J Cardiol 2014;114:914–920.',
  RVASC2010: "Reference Values for Arterial Stiffness' Collaboration. Determinants of pulse wave velocity in healthy people and in the presence of cardiovascular risk factors: 'establishing normal and reference values'. Eur Heart J 2010;31:2338–2350.",
  Maceira2006: 'Maceira AM, Prasad SK, Khan M, Pennell DJ. Normalized left ventricular systolic and diastolic function by steady state free precession cardiovascular magnetic resonance. J Cardiovasc Magn Reson 2006;8:417–426.',
  Herbert2014: 'Herbert A, Cruickshank JK, Laurent S, Boutouyrie P; Reference Values for Arterial Measurements Collaboration. Establishing reference values for central blood pressure and its amplification in a general healthy population and according to cardiovascular risk factors. Eur Heart J 2014;35:3122–3133.',
  Janner2010: 'Janner JH, Godtfredsen NS, Ladelund S, Vestbo J, Prescott E. Aortic augmentation index: reference values in a large unselected population by means of the SphygmoCor device. Am J Hypertens 2010;23:180–185.',
  Chemla2017: 'Chemla D, et al. Influence of critical closing pressure on systemic vascular resistance and total arterial compliance: a clinical invasive study. 2017; PMID 28958408.',
  Yamakado2018: 'Yamakado T. Effect of aging on the pressure asymptote and time constant of exponential diastolic aortic pressure decay in humans. Artery Res 2018;24:82 (abstract P11).',
  Ross1965: 'Ross J Jr, Linhart JW, Braunwald E. Effects of changing heart rate in man by electrical stimulation of the right atrium: studies at rest, during exercise, and with isoproterenol. Circulation 1965;32:549–558.',
  Lazim2025: 'Lazim MRML, Chellappan K, Ugusman A, et al. The influence of heart rate on peripheral vascular function among pacemaker patients. Int J Med Sci 2025;22:309–317.',
  Wilkinson2000: 'Wilkinson IB, MacCallum H, Flint L, Cockcroft JR, Newby DE, Webb DJ. The influence of heart rate on augmentation index and central arterial pressure in humans. J Physiol 2000;525:263–270.',
  Wilkinson2002: 'Wilkinson IB, Mohammad NH, Tyrrell S, et al. Heart rate dependency of pulse pressure amplification and arterial stiffness. Am J Hypertens 2002;15:24–30.',
  Pandey2020: 'Pandey A, Kraus WE, Brubaker PH, Kitzman DW. Healthy aging and cardiovascular function: invasive hemodynamics during rest and exercise in 104 healthy volunteers. JACC Heart Fail 2020;8:111–121.',
  Wheatley: 'Wheatley CM, Snyder EM, Joyner MJ, Johnson BD, Olson TP. Intra-arterial versus cuff auscultation blood pressure at rest and during submaximal exercise in healthy young adults (PMC12431019).',
  Jones2003: 'Jones PP, Christou DD, Jordan J, Seals DR. Baroreflex buffering is reduced with age in healthy men. Circulation 2003;107:1770–1774.',
  Christou2003: 'Christou DD, Jones PP, Seals DR. Baroreflex buffering in sedentary and endurance exercise-trained healthy men. Hypertension 2003; doi:10.1161/01.HYP.0000072011.17095.ae.',
  Christou2005: 'Christou DD, Jones PP, Jordan J, Diedrich A, Robertson D, Seals DR. Women have lower tonic autonomic support of arterial blood pressure and less effective baroreflex buffering than men. Circulation 2005;111:494–498.',
  DuBois1916: 'Du Bois D, Du Bois EF. A formula to estimate the approximate surface area if height and weight be known. Arch Intern Med 1916;17:863–871.',
  Liu1986: 'Liu Z, Brin KP, Yin FC. Estimation of total arterial compliance: an improved method and evaluation of current methods. Am J Physiol 1986;251:H588–H600.',
  Spronck2015: 'Spronck B, Heusinkveld MHG, Vanmolkot FH, et al. Pressure-dependence of arterial stiffness: potential clinical implications. J Hypertens 2015;33:330–338.',
  Butlin2017: 'Butlin M, Tan I, Shirbani F, Spronck B, Avolio A. Measurement of blood pressure dependency of carotid–femoral pulse wave velocity. Artery Res 2017;20:97–98 (abstract P145).',
  McNally2024: 'McNally RJ, Boguslavskyi A, Malek R, et al. Influence of blood pressure reduction on pulse wave velocity in primary hypertension: a meta-analysis and comparison with an acute modulation of transmural pressure. Hypertension 2024;81:1619–1627.',
  Picone2017: 'Picone DS, Schultz MG, Otahal P, et al. Accuracy of cuff-measured blood pressure: systematic reviews and meta-analyses. J Am Coll Cardiol 2017;70:572–586.',
  Wright2011: 'Wright JD, Hughes JP, Ostchega Y, Yoon SS, Nwankwo T. Mean systolic and diastolic blood pressure in adults aged 18 and over in the United States, 2001–2008. Natl Health Stat Report 2011;(35):1–22.',
  Avolio1983: 'Avolio AP, Chen SG, Wang RP, et al. Effects of aging on changing arterial compliance and left ventricular load in a northern Chinese urban community. Circulation 1983;68:50–58.',
  Murgo1980: 'Murgo JP, Westerhof N, Giolma JP, Altobelli SA. Aortic input impedance in normal man: relationship to pressure wave forms. Circulation 1980;62:105–116.',
  Westerhof2009: 'Westerhof N, Lankhaar JW, Westerhof BE. The arterial Windkessel. Med Biol Eng Comput 2009;47:131–141.',
  Parker1971: 'Parker JO, Ledwich JR, West RO, Case RB. Pacing-induced changes in stroke volume in the evaluation of myocardial function. Circulation 1971;43:253–261.',
  Wisheart1973: 'Wisheart JD, Wright JEC, Rosenfeldt FL, Ross JK. Atrial and ventricular pacing after open heart surgery. Thorax 1973;28:9–14.',
  Karamanoglu1993: 'Karamanoglu M, O\'Rourke MF, Avolio AP, Kelly RP. An analysis of the relationship between central aortic and peripheral upper limb pressure waves in man. Eur Heart J 1993;14:160–167.',
  Westerhof2007: 'Westerhof BE, Guelen I, Stok WJ, et al. Arterial pressure transfer characteristics: effects of travel time. Am J Physiol Heart Circ Physiol 2007;292:H800–H807.',
  Yokota2023: 'Yokota A, Kabutoya T, Hoshide S, Kario K. Comparison of heart rate and cardiac output of VVI pacemaker settings in patients with atrial fibrillation with bradycardia. J Arrhythm 2023;39:574–579.',
  Harrison1989: 'Harrison MR, Clifton GD, Sublett KL, DeMaria AN. Effect of heart rate on Doppler indexes of systolic function in humans. J Am Coll Cardiol 1989;14:929–935.',
  Alhakak2023: 'Alhakak AS, Olsen FJ, Skaarup KG, et al. Age- and sex-based normal reference ranges of the cardiac time intervals: the Copenhagen City Heart Study. Clin Res Cardiol 2023; doi:10.1007/s00392-023-02269-2.'
} as const;
