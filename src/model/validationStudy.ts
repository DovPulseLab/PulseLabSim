/* =====================================================================
   Validation of the v2.1 additions: the healthy study profiles, the
   patient calibration, heart rate up to 180 bpm and the diastolic-decay
   output. Pure data; the Validation tab renders it.

   Two numbers per study profile were fitted (SVR to central SBP, Γ to
   AIx); every other row below is a prediction compared with data the
   model was not fitted to.
   ===================================================================== */
import { DEFAULTS, MODEL, PRESETS, STUDY_PROFILES, STUDY_TARGETS, weisslerMs, type Params } from '../config/physiology';
import { aortaDiameter, bsaDuBois, pwvNormal } from './calibrate';
import { diastolicDecay } from './indices';
import { simulate } from './solve';
import type { Verdict } from './validation';

/** Herbert et al. 2014, "normal" population: mean amplification, brachial − central SBP (mmHg), by decade. */
const HERBERT_AMP = {
  male:   [[25, 15], [35, 13], [45, 11], [55, 9], [65, 8], [75, 8]],
  female: [[25, 12], [35, 8], [45, 6], [55, 5], [65, 6], [75, 6]]
} as const;
const decadeValue = (rows: readonly (readonly [number, number])[], age: number) =>
  rows.reduce((best, r) => Math.abs(r[0] - Math.min(age, 75)) < Math.abs(best[0] - Math.min(age, 75)) ? r : best)[1];

/** Janner et al. 2010 reference equations for AIx (SphygmoCor, low-risk cohort). */
export const jannerAIx = (sex: number, age: number, hr: number, heightCm: number): number =>
  sex === 1 ? 56.28 + 0.90 * age - 0.005 * age * age - 0.34 * hr - 0.24 * heightCm
            : 79.20 + 0.63 * age - 0.002 * age * age - 0.28 * hr - 0.39 * heightCm;

/** Chemla 2017: τ with a 0 mmHg asymptote, 1.372 ± 0.308 s (invasive, n = 16). */
export const TAU_REF = { mean: 1.372, sd: 0.308 } as const;
/** Yamakado 2018: free-asymptote fit in 71 normal subjects aged 20–80 y: τ 436 ± 105 ms, P∞ 58.5 ± 8.1 mmHg. */
export const TAU_FREE_REF = { mean: 0.436, sd: 0.105, pInf: 58.5, pInfSd: 8.1 } as const;

export interface StudyCheck { what: string; model: string; reference: string; source: string; verdict: Verdict; fitted?: boolean; }
export interface StudyProfileRow { name: string; checks: StudyCheck[]; }
export interface StudyReport {
  profiles: StudyProfileRow[];
  heartRate: StudyCheck[];
  decay: StudyCheck[];
}

const within = (v: number, lo: number, hi: number) => v >= lo && v <= hi;
const band = (v: number, lo: number, hi: number, slack: number): Verdict =>
  within(v, lo, hi) ? 'pass' : within(v, lo - slack, hi + slack) ? 'near' : 'fail';

export function runStudyValidation(): StudyReport {
  const profiles: StudyProfileRow[] = Object.entries(STUDY_PROFILES).map(([name, sp]) => {
    const p: Params = { ...DEFAULTS, ...PRESETS[name] };
    const r = simulate(p), m = r.m, tgt = STUDY_TARGETS[name];
    const bsa = bsaDuBois(sp.height, sp.weight);
    const d = aortaDiameter(sp.sex, sp.age, bsa), pwv = pwvNormal(sp.age);
    const amp = m.bSBP - m.Ps, ampRef = decadeValue(sp.sex === 1 ? HERBERT_AMP.female : HERBERT_AMP.male, sp.age);
    const aixRef = jannerAIx(sp.sex, sp.age, p.hr, sp.height);
    const tauLo = TAU_REF.mean - 2 * TAU_REF.sd, tauHi = TAU_REF.mean + 2 * TAU_REF.sd;
    const checks: StudyCheck[] = [
      { what: 'Central SBP', model: `${m.Ps.toFixed(0)} mmHg`, reference: `${tgt.cSBP} mmHg (mean)`, source: 'Herbert 2014', fitted: true,
        verdict: Math.abs(m.Ps - tgt.cSBP) <= 2 ? 'pass' : Math.abs(m.Ps - tgt.cSBP) <= 4 ? 'near' : 'fail' },
      { what: 'AIx', model: `${m.AIx.toFixed(0)} %`, reference: `${aixRef.toFixed(0)} %`, source: 'Janner 2010', fitted: true,
        verdict: Math.abs(m.AIx - aixRef) <= 2 ? 'pass' : Math.abs(m.AIx - aixRef) <= 5 ? 'near' : 'fail' },
      { what: 'Ascending-aorta diameter', model: `${p.diam.toFixed(2)} cm`, reference: `${d.lo.toFixed(2)}–${d.hi.toFixed(2)} cm`, source: 'Campens 2014',
        verdict: band(p.diam, d.lo, d.hi, 0.1) },
      { what: 'Aortic PWV at the operating MAP', model: `${m.cAoOp.toFixed(1)} m/s`, reference: `${pwv.lo.toFixed(1)}–${pwv.hi.toFixed(1)} m/s`, source: 'RVASC 2010',
        verdict: band(m.cAoOp, pwv.lo, pwv.hi, 0.5) },
      { what: 'Amplification (cuff − central SBP)', model: `${amp.toFixed(0)} mmHg`, reference: `${ampRef} mmHg (mean)`, source: 'Herbert 2014',
        verdict: Math.abs(amp - ampRef) <= 4 ? 'pass' : Math.abs(amp - ampRef) <= 7 ? 'near' : 'fail' },
      { what: 'Cuff BP in the normal range', model: `${m.bSBP.toFixed(0)}/${m.bDBP.toFixed(0)} mmHg`, reference: '< 130 / 60–80 mmHg', source: 'ACC/AHA 2017',
        verdict: m.bSBP < 130 && within(m.bDBP, 60, 80) ? 'pass' : m.bSBP < 140 && within(m.bDBP, 55, 85) ? 'near' : 'fail' },
      { what: 'Diastolic decay τ (asymptote 0)', model: `${m.tauFit.toFixed(2)} s`, reference: `${tauLo.toFixed(2)}–${tauHi.toFixed(2)} s (mean ± 2 SD)`, source: 'Chemla 2017',
        verdict: band(m.tauFit, tauLo, tauHi, 0.4) },
      { what: 'Diastolic decay τ (asymptote fitted)', model: `${m.tauFree.toFixed(2)} s`,
        reference: `${(TAU_FREE_REF.mean - 2 * TAU_FREE_REF.sd).toFixed(2)}–${(TAU_FREE_REF.mean + 2 * TAU_FREE_REF.sd).toFixed(2)} s`, source: 'Yamakado 2018',
        verdict: band(m.tauFree, TAU_FREE_REF.mean - 2 * TAU_FREE_REF.sd, TAU_FREE_REF.mean + 2 * TAU_FREE_REF.sd, 0.1) },
      { what: 'Decay asymptote P∞', model: `${m.pInf.toFixed(0)} mmHg`,
        reference: `${(TAU_FREE_REF.pInf - 2 * TAU_FREE_REF.pInfSd).toFixed(0)}–${(TAU_FREE_REF.pInf + 2 * TAU_FREE_REF.pInfSd).toFixed(0)} mmHg`, source: 'Yamakado 2018',
        verdict: band(m.pInf, TAU_FREE_REF.pInf - 2 * TAU_FREE_REF.pInfSd, TAU_FREE_REF.pInf + 2 * TAU_FREE_REF.pInfSd, 8) },
      { what: 'Ejection time', model: `${m.et.toFixed(0)} ms`, reference: '300 ms start (Weissler ≈ 294 ms men, 306 ms women at 70 bpm)', source: 'Weissler 1968',
        verdict: Math.abs(m.et - 300) <= 1 ? 'pass' : 'fail' }
    ];
    return { name, checks };
  });

  /* heart rate up to 180 bpm */
  const lvetOk = [50, 70, 100, 150].every(hr => [0, 1].every(sex => {
    const r = simulate({ hr, sex, etScale: 1 });
    const w = weisslerMs(hr, sex);
    return Math.abs(r.m.et - Math.min(Math.max(w, MODEL.etMin * 1000), MODEL.etMaxFrac * 60000 / hr)) < 0.5;
  }));
  const at180 = simulate({ hr: 180 }).m;
  const co = DEFAULTS.sv * DEFAULTS.hr;
  const paced = [70, 100, 130, 160, 180].map(hr => simulate({ hr, sv: co / hr }).m);
  const aixFalls = paced.every((m, i) => i === 0 || m.AIx < paced[i - 1].AIx + 0.5);
  const slope = (paced[0].AIx - paced[1].AIx) / 3;   // % per 10 bpm, 70 → 100 bpm
  const finite = [40, 90, 140, 180].every(hr => Object.values(simulate({ hr }).m).every(v => typeof v === 'string' || Number.isFinite(v)));
  const heartRate: StudyCheck[] = [
    { what: 'LVET follows the Weissler lines, men and women, 50–150 bpm', model: lvetOk ? 'exact' : 'differs', reference: '413 − 1.7·HR / 418 − 1.6·HR ms', source: 'Weissler 1968', verdict: lvetOk ? 'pass' : 'fail' },
    { what: 'At 180 bpm ejection is held at its floor and fits in the cycle', model: `${at180.et.toFixed(0)} ms of a ${(60000 / 180).toFixed(0)} ms cycle`, reference: 'Weissler gives 107 ms (extrapolated); floor 150 ms; ≤ 60 % of cycle', source: 'model limits',
      verdict: Math.abs(at180.et - 150) < 0.5 && at180.et <= 0.6 * 60000 / 180 + 0.5 ? 'pass' : 'fail' },
    { what: 'Pacing 70 → 100 bpm (cardiac output held): fall in AIx per 10 bpm', model: `${slope.toFixed(1)} %`, reference: '≈ 3.9 % per 10 bpm (paced 60–110 bpm)', source: 'Wilkinson 2000',
      verdict: within(slope, 2.5, 5.5) ? 'pass' : within(slope, 1.5, 7) ? 'near' : 'fail' },
    { what: 'Pacing 70 → 180 bpm: AIx keeps falling (beyond the published range)', model: paced.map(m => m.AIx.toFixed(0)).join(' → ') + ' %', reference: 'direction only', source: 'extrapolation',
      verdict: aixFalls ? 'pass' : 'fail' },
    { what: 'Every output stays finite from 40 to 180 bpm', model: finite ? 'yes' : 'no', reference: '—', source: 'numerical', verdict: finite ? 'pass' : 'fail' }
  ];

  /* diastolic decay */
  const n = 1024, dt = 0.001, tauTrue = 1.5;
  const synth = Array.from({ length: n }, (_, k) => 100 * Math.exp(-k * dt / tauTrue));
  const fit = diastolicDecay(synth, dt, 300);
  const base = simulate({}).m, stiff = simulate({ cAo: 11 }).m, constr = simulate({ radius: 90 }).m, fast = simulate({ hr: 100, sv: co / 100 }).m;
  const decay: StudyCheck[] = [
    { what: 'Recovers τ from a pure exponential', model: `${fit.tau.toFixed(4)} s`, reference: `${tauTrue} s`, source: 'numerical', verdict: Math.abs(fit.tau - tauTrue) < 1e-6 ? 'pass' : 'fail' },
    { what: 'Fitted τ tracks the Windkessel RC (default adult)', model: `${base.tauFit.toFixed(2)} s`, reference: `RC = ${base.tau.toFixed(2)} s`, source: 'Liu 1986',
      verdict: Math.abs(base.tauFit / base.tau - 1) <= 0.15 ? 'pass' : Math.abs(base.tauFit / base.tau - 1) <= 0.3 ? 'near' : 'fail' },
    { what: 'Stiffer aorta: faster decay (τ ↓, rate ↑)', model: `τ ${base.tauFit.toFixed(2)} → ${stiff.tauFit.toFixed(2)} s`, reference: 'τ = R·C falls as C falls', source: 'Chemla 2017; McDonald',
      verdict: stiff.tauFit < base.tauFit && stiff.decayRate > base.decayRate ? 'pass' : 'fail' },
    { what: 'Arteriolar constriction: fitted τ moves with RC (R ↑, but C ↓ as pressure rises)', model: `τ ${base.tauFit.toFixed(2)} → ${constr.tauFit.toFixed(2)} s`,
      reference: `RC ${base.tau.toFixed(2)} → ${constr.tau.toFixed(2)} s`, source: 'McDonald; N&E 2001',
      verdict: Math.sign(constr.tauFit - base.tauFit) === Math.sign(constr.tau - base.tau) ? 'pass' : Math.abs(constr.tauFit / base.tauFit - 1) < 0.05 ? 'near' : 'fail' },
    { what: 'Higher HR at the same output: τ about the same', model: `τ ${base.tauFit.toFixed(2)} → ${fast.tauFit.toFixed(2)} s`, reference: 'R and C unchanged', source: 'two-element Windkessel',
      verdict: Math.abs(fast.tauFit / base.tauFit - 1) <= 0.15 ? 'pass' : Math.abs(fast.tauFit / base.tauFit - 1) <= 0.3 ? 'near' : 'fail' }
  ];

  return { profiles, heartRate, decay };
}
