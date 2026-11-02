/* =====================================================================
   Validation: recomputes published numbers and checks model trends.
   Ported from v1 js/validation.js as pure data (the UI renders it).
   ===================================================================== */
import { DEFAULTS, DRUGS, PRESETS, PHYS, type Params } from '../config/physiology';
import { applyDrugs } from './drugsSteady';
import { simulate } from './solve';
import type { Indices } from './indices';

export type Verdict = 'pass' | 'near' | 'fail';

export interface FormulaRow { check: string; computed: number; reported: number; unit: string; verdict: Verdict; }
export interface CaseRow { name: string; brachial: [number, number]; central: [number, number]; computed: number; reported: number; verdict: Verdict; }
export interface AgeRow { variable: string; paper: [number, number | null, number]; model: [number, number, number]; verdict: Verdict; }
export interface DrugRow { drug: string; expSBP: string; dSBP: number; expAIx: string; dAIx: number; dCuffSBP: number; verdict: Verdict; }
export interface MechRow { prediction: string; source: string; detail: string; verdict: Verdict; }

export interface ValidationReport {
  formulas: FormulaRow[];
  cases: CaseRow[];
  age: AgeRow[];
  drugs: DrugRow[];
  nitrateLargest: { nitrateDAIx: number; nextLargest: number; verdict: Verdict };
  mechanisms: MechRow[];
}

const pct = (a: number, b: number) => Math.abs(a - b) / Math.abs(b) * 100;
const formulaVerdict = (e: number): Verdict => e <= 3 ? 'pass' : e <= 12 ? 'near' : 'fail';
const ew = (dtr: number, ap: number) => dtr / 1000 * ap * Math.PI / 2 * PHYS.DYN / 1000;
const sim = (p: Partial<Params>): Indices => simulate(Object.assign({}, DEFAULTS, p)).m;

export function runValidation(): ValidationReport {
  /* 1 · formula checks against published numbers */
  const A: [string, number, number, string][] = [
    ['N&S 2002 Fig. 2 (83 y): ΔEw = 0.228 s × 34 mmHg × π/2', ew(228, 34), 16.3, '×10³ dyn·s/cm²'],
    ['N&S 2002 Fig. 5 baseline: 0.211 s × 24 mmHg × π/2', ew(211, 24), 10.7, '×10³'],
    ['N&S 2002 Fig. 5 lisinopril: 0.175 s × 8 mmHg × π/2', ew(175, 8), 2.9, '×10³'],
    ['N&S 2002 Fig. 3 baseline (AP ≈ 0.35 × 44 mmHg, Δtr 247 ms)', ew(247, 0.35 * 44), 7.2, '×10³'],
    ['N&S 2002 Fig. 3 atorvastatin (AP ≈ 0.25 × 34, Δtr 163 ms)', ew(163, 0.25 * 34), 3.1, '×10³'],
    ['Townsend 2015 (DeBakey) AIx example: 4 / 33', 4 / 33 * 100, 12, '%'],
    ['Townsend 2015 (DeBakey) LSPTI/ESPTI: 10628 / 19592', 10628 / 19592, 0.54, ''],
    ['N&S 2002 Fig. 2 amplification, age 19: radial PP 40 / aortic PP 24', 40 / 24, 1.7, '×'],
    ['N&S 2002 Fig. 2 amplification, age 83: 82 / 75', 82 / 75, 1.1, '×'],
    ['N&S 2002 Fig. 5 amplification after lisinopril: 67 / 48', 67 / 48, 1.4, '×']
  ];
  const formulas = A.map(([check, computed, reported, unit]) =>
    ({ check, computed, reported, unit, verdict: formulaVerdict(pct(computed, reported)) }));

  const caseData: [string, number, number, number, number, number][] = [
    ['Case 1 (ramipril)', 144, 74, 114, 75, 79], ['Case 2 initial', 142, 64, 109, 65, 77], ['Case 2 after exercise', 124, 62, 99, 62, 68],
    ['Case 3 initial', 151, 78, 142, 79, 16], ['Case 3 follow-up', 145, 82, 128, 83, 40], ['Case 4 initial', 174, 104, 154, 106, 46],
    ['Case 4 + atenolol', 158, 86, 147, 87, 20], ['Case 4 + amlodipine', 136, 84, 124, 85, 33], ['Case 5 initial', 220, 103, 202, 104, 19],
    ['Case 5 follow-up', 123, 74, 111, 74, 32], ['Case 6 initial', 177, 56, 171, 56, 5], ['Case 6 + amlodipine', 152, 50, 145, 50, 7]
  ];
  const cases = caseData.map(([name, bs, bd, cs, cd, reported]) => {
    const computed = ((bs - bd) / (cs - cd) - 1) * 100;
    return { name, brachial: [bs, bd] as [number, number], central: [cs, cd] as [number, number], computed, reported,
      verdict: (Math.abs(computed - reported) <= 1.5 ? 'pass' : 'fail') as Verdict };
  });

  /* 2 · model vs published age trend (N&S 2002 Fig. 2) */
  const yng = sim(PRESETS['Young adult (20 y)']), mid = sim(PRESETS['Middle-aged (45 y)']), old = sim(PRESETS['Isolated systolic HTN (80 y)']);
  const ageData: [string, number, number | null, number, number, number, number][] = [
    ['Aortic AIx (%)', -19, 25, 46, yng.AIx, mid.AIx, old.AIx],
    ['Aortic pulse pressure (mmHg)', 24, 39, 75, yng.PP, mid.PP, old.PP],
    ['Amplification (peripheral/aortic PP)', 1.7, 1.3, 1.1, yng.ppa, mid.ppa, old.ppa],
    ['Round-trip time Δtp (ms)', 332, null, 126, yng.dtp, mid.dtp, old.dtp],
    ['Wasted energy ΔEw (×10³)', 0, null, 16.3, yng.Ew / 1000, mid.Ew / 1000, old.Ew / 1000]
  ];
  const mono = (a: number, b: number, c: number) => (a <= b && b <= c) || (a >= b && b >= c);
  const age = ageData.map(r => {
    const same = Math.sign(r[3] - r[1]) === Math.sign(r[6] - r[4]);
    const score = !same ? 0 : mono(r[4], r[5], r[6]) ? 2 : 1;
    return { variable: r[0], paper: [r[1], r[2], r[3]] as [number, number | null, number], model: [r[4], r[5], r[6]] as [number, number, number],
      verdict: (['fail', 'near', 'pass'] as const)[score] };
  });

  /* 3 · drug directions vs Townsend 2015 Table 1, on the essential-HTN patient */
  const htnBase: Params = Object.assign({}, DEFAULTS, PRESETS['Essential HTN (55 y)']);
  const b0 = simulate(htnBase).m;
  const exp: Record<string, [string, string]> = { arb: ['↓↓', '↓↓'], acei: ['↓↓', '↓↓'], bb: ['↓ or ↔', '↑'], ccb: ['↓↓', '↓↓'], diur: ['↓', '↓'], nitrate: ['↓↓', '↓↓↓↓'] };
  const drugs: DrugRow[] = Object.entries(exp).map(([k, e]) => {
    const m = simulate(applyDrugs(htnBase, [k])).m;
    const dS = m.Ps - b0.Ps, dA = m.AIx - b0.AIx, dB = m.bSBP - b0.bSBP;
    const okS = e[0] === '↓ or ↔' ? dS <= 0.5 : dS < 0;
    const okA = e[1] === '↑' ? dA > 0 : dA < 0;
    return { drug: DRUGS[k].label, expSBP: e[0], dSBP: dS, expAIx: e[1], dAIx: dA, dCuffSBP: dB, verdict: okS && okA ? 'pass' : 'fail' };
  });
  const nitrateDAIx = drugs.find(r => r.drug.startsWith('Organic'))!.dAIx;
  const nextLargest = Math.min(...drugs.filter(r => !r.drug.startsWith('Organic') && r.dAIx < 0).map(r => r.dAIx));
  const nitrateLargest = { nitrateDAIx, nextLargest, verdict: (nitrateDAIx < nextLargest ? 'pass' : 'near') as Verdict };

  /* 4 · mechanistic predictions */
  const base = sim({});
  const stiff = sim({ cAo: 11 });
  const vc = sim({ radius: 95 });
  const tall = sim({ height: 195 }), short = sim({ height: 155 });
  const fast = sim({ hr: 90, sv: DEFAULTS.sv * 70 / 90 });
  const nit = simulate(applyDrugs(DEFAULTS, ['nitrate'])).m;
  const f0 = (v: number) => v.toFixed(0), f1 = (v: number) => v.toFixed(1), f2 = (v: number) => v.toFixed(2);
  const mechData: [string, string, boolean, string][] = [
    ['Stiffer aorta (PWV 7.5 → 11 m/s): SBP ↑, PP ↑, DBP ↓, MAP unchanged', 'N&E 2001 Fig. 3 & Eqs. 10–11',
      stiff.Ps > base.Ps && stiff.PP > base.PP && stiff.Pd < base.Pd && Math.abs(stiff.map - base.map) < 1.5 * Math.abs(stiff.cMAP - base.cMAP) + 0.5,
      `SBP ${f0(base.Ps)}→${f0(stiff.Ps)}, DBP ${f0(base.Pd)}→${f0(stiff.Pd)}, MAP ${f0(base.map)}→${f0(stiff.map)}`],
    ['Stiffer aorta returns reflection earlier (Δtp ↓) and raises AIx', 'N&S 2002',
      stiff.dtp < base.dtp && stiff.AIx > base.AIx, `Δtp ${f0(base.dtp)}→${f0(stiff.dtp)} ms, AIx ${f0(base.AIx)}→${f0(stiff.AIx)} %`],
    ['Arteriolar constriction (radius −5 %) raises MAP and DBP', 'N&E 2001 Eqs. 1, 5',
      vc.map > base.map && vc.Pd > base.Pd, `MAP ${f0(base.map)}→${f0(vc.map)}, DBP ${f0(base.Pd)}→${f0(vc.Pd)}`],
    ['Taller stature lowers AIx (inverse relation with height)', 'N&S 2002; Marchais 1993',
      tall.AIx < base.AIx && short.AIx > base.AIx, `155 cm ${f1(short.AIx)} %, 175 cm ${f1(base.AIx)} %, 195 cm ${f1(tall.AIx)} %`],
    ['Higher heart rate lowers AIx (pacing: cardiac output held constant)', 'Wilkinson 2000',
      fast.AIx < base.AIx, `HR 70 → 90 (SV 72 → 56 mL): AIx ${f1(base.AIx)} → ${f1(fast.AIx)} %`],
    ['Nitrate: central SBP falls more than brachial SBP', 'N&E 2001; N&S 2002 Fig. 5',
      (base.Ps - nit.Ps) > (base.bSBP - nit.bSBP), `central −${f1(base.Ps - nit.Ps)}, brachial −${f1(base.bSBP - nit.bSBP)} mmHg`],
    ['Vasodilator raises pulse-pressure amplification', 'N&S 2002 Fig. 5',
      nit.ppa > base.ppa, `PPA ${f2(base.ppa)} → ${f2(nit.ppa)}`],
    ['MAP = CO × SVR holds exactly', 'N&E 2001 Eq. 1',
      Math.abs(base.map - base.cMAP) < 0.01, `MAP ${f2(base.map)} vs CO×SVR ${f2(base.cMAP)}`]
  ];
  const mechanisms = mechData.map(([prediction, source, ok, detail]) =>
    ({ prediction, source, detail, verdict: (ok ? 'pass' : 'fail') as Verdict }));

  return { formulas, cases, age, drugs, nitrateLargest, mechanisms };
}

/** All verdicts in the order v1's Validation tab displays them. */
export function verdictSequence(r: ValidationReport): Verdict[] {
  return [
    ...r.formulas.map(x => x.verdict),
    ...r.cases.map(x => x.verdict),
    ...r.age.map(x => x.verdict),
    ...r.drugs.map(x => x.verdict),
    r.nitrateLargest.verdict,
    ...r.mechanisms.map(x => x.verdict)
  ];
}
