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
  /** Weissler LVET (ms) = a − b·HR */
  lvetA: 413,
  lvetB: 1.7,
  etMin: 0.15,              // s
  etMaxFrac: 0.6,           // of cycle length
  /** Passive MAP → stiffness coupling: c = c0·(1 + k·(MAP − mapRef)) */
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
  gMax: 0.97,               // cap on |G(ω)|
  damp: 0.055,              // attenuation per Hz per round trip
  armLenPerHeight: 0.42,    // aortic root → radial, × height
  brachFrac: 0.62,          // brachial site along the arm
  gArm: 0.45,               // fixed upper-limb reflection
  armAtt: 0.035,            // arm attenuation per Hz
  flowRise: 0.75,           // ejection profile x^a (1−x)^b
  flowFall: 1.55,
  aix75PerBpm: 0.39,        // AIx@75 = AIx + 0.39·(HR − 75)  (Wilkinson 2000; v1)
  typeAThreshold: 0.12,     // AP/PP above this → Murgo type A
  p2Window: 0.08            // s after echo arrival to search for P2
} as const;

/* ---------------- default physiology (healthy ~45 y man) ---------------- */
export const DEFAULTS: Readonly<Params> = {
  hr: 70,
  sv: 72,
  etScale: 1.0,
  radius: 100,
  svrRef: 1.10,
  cAo: 7.5,
  cMus: 9.0,
  gamma: 0.45,
  diam: 2.8,
  height: 175,
  lpScale: 1.0,
  vEff: 450,
  lvedp: 8
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
}
export interface ControlGroup {
  group: string;
  color: string;
  items: Control[];
}

export const CONTROLS: ControlGroup[] = [
  { group: 'Heart', color: 'var(--accent)', items: [
    { key: 'hr', label: 'Heart rate', min: 40, max: 130, step: 1, unit: 'bpm', f: 0,
      tip: 'Sets cycle length and, via the Weissler relation, ejection time (LVET ≈ 413 − 1.7·HR ms). Slower HR lengthens systole, so the reflected wave lands earlier relative to ejection and AIx rises.' },
    { key: 'sv', label: 'Stroke volume', min: 30, max: 120, step: 1, unit: 'mL', f: 0,
      tip: 'Volume ejected per beat. Scales the flow wave, hence the forward pressure wave (water-hammer: ΔP = Zc·ΔQ) and cardiac output.' },
    { key: 'etScale', label: 'Ejection duration', min: 0.8, max: 1.2, step: 0.01, unit: '×', f: 2,
      tip: 'Multiplier on the Weissler LVET. Longer ejection keeps the ventricle exposed to the returning reflected wave for longer (larger Δtr and wasted energy).' }
  ]},
  { group: 'Arterioles (resistance)', color: 'var(--ink-3)', items: [
    { key: 'radius', label: 'Arteriolar radius', min: 75, max: 125, step: 0.5, unit: '%', f: 1,
      tip: 'Poiseuille: R = 8μL/πr⁴, so SVR scales with radius⁻⁴. A 10 % increase in radius lowers SVR by ~32 %. Mainly moves mean pressure (MAP = CO × SVR).' }
  ]},
  { group: 'Elastic arteries (aorta)', color: 'var(--fwd)', items: [
    { key: 'cAo', label: 'Aortic PWV (intrinsic)', min: 4, max: 16, step: 0.1, unit: 'm/s', f: 1,
      tip: 'Stiffness of the central elastic arteries at a reference MAP of 93 mmHg. Raises characteristic impedance (Zc = ρc/A), lowers compliance (C ∝ 1/ρc²) and speeds wave return. The operating value also rises passively with MAP.' },
    { key: 'diam', label: 'Aortic diameter', min: 2.0, max: 4.2, step: 0.05, unit: 'cm', f: 2,
      tip: 'Larger lumen lowers Zc (Zc = ρc/A) and adds compliance — the aorta dilates with age, partly offsetting stiffening.' }
  ]},
  { group: 'Muscular arteries & reflection', color: 'var(--bwd)', items: [
    { key: 'cMus', label: 'Muscular-artery PWV', min: 5, max: 14, step: 0.1, unit: 'm/s', f: 1,
      tip: 'Smooth-muscle tone of the muscular conduits (femoral, popliteal, brachial). Vasodilators lower it, delaying the reflected wave (Nichols & Singh 2002). Also sets arm-wave speed (amplification).' },
    { key: 'gamma', label: 'Reflection coefficient Γ', min: 0.1, max: 0.9, step: 0.01, unit: '', f: 2,
      tip: 'Fraction of the forward wave reflected at the effective reflection site (impedance mismatch). Vasodilators lower it; vasoconstrictors raise it.' },
    { key: 'lpScale', label: 'Reflection-site position', min: 0.7, max: 1.5, step: 0.01, unit: '×', f: 2,
      tip: 'Scales the effective distance to the major reflection site (Lp = 0.27 × height × factor). Values > 1 shift the site distally (as described in youth).' }
  ]},
  { group: 'Patient', color: 'var(--brach)', items: [
    { key: 'height', label: 'Height', min: 140, max: 205, step: 1, unit: 'cm', f: 0,
      tip: 'Body height sets the path length to the reflection site and the arm path. Shorter people have earlier reflections and a higher AIx (Nichols & Singh 2002).' }
  ]}
];

export const ALL_CONTROLS: Control[] = CONTROLS.flatMap(g => g.items);

/* ---------------- presets (from v1) ---------------- */
export const PRESETS: Record<string, Partial<Params>> = {
  'Default adult (45 y)': {},
  'Young adult (20 y)':  { hr: 64, sv: 78, cAo: 5.2, cMus: 9.0, gamma: 0.42, diam: 2.4, lpScale: 1.3, radius: 102 },
  'Middle-aged (45 y)':  { hr: 70, sv: 72, cAo: 7.5, cMus: 9.0, gamma: 0.45, diam: 2.8, lpScale: 1.0 },
  'Older adult (70 y)':  { hr: 68, sv: 70, cAo: 9.5, cMus: 9.0, gamma: 0.58, diam: 3.4, lpScale: 0.95, radius: 97 },
  'Isolated systolic HTN (80 y)': { hr: 66, sv: 70, cAo: 11.5, cMus: 9.0, gamma: 0.62, diam: 3.8, lpScale: 0.9, radius: 95 },
  'Essential HTN (55 y)': { hr: 74, sv: 74, cAo: 8.8, cMus: 9.5, gamma: 0.55, diam: 3.0, lpScale: 0.95, radius: 97 },
  'Short stature (155 cm)': { height: 155 },
  'Tall stature (195 cm)':  { height: 195 }
};

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
  propofol:   { label: 'Propofol', short: 'Propofol', fx: { radius: 1.08, cMus: 0.92, svAdd: -12, hrAdd: -3 }, illustrative: true, source: ACUTE_SOURCE },
  norepinephrine: { label: 'Norepinephrine', short: 'Norepi', fx: { radius: 0.93, cMus: 1.08, gamma: 1.12, hrAdd: 4, svAdd: 6 }, illustrative: true, source: ACUTE_SOURCE }
};

/** Every drug: the 7 v1 long-term drugs plus the 6 acute drugs. */
export const ALL_DRUGS: Record<string, Drug> = { ...DRUGS, ...ACUTE_DRUGS };

/** Phenylephrine baroreflex: HR falls 0.3 bpm per mmHg MAP rise, at most 20 bpm. */
export const BAROREFLEX = { drug: 'phe', bpmPerMmHg: 0.3, maxFall: 20 } as const;

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
  McDonald: "Nichols WW, O'Rourke MF, Vlachopoulos C. McDonald's Blood Flow in Arteries. 6th ed. Hodder Arnold; 2011."
} as const;
