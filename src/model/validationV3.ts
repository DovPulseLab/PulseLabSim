/* v3 ventricle: study profiles against reference data. Pure. Rows follow the v2 Validation
   conventions (fitted / data / typical / consistency). */
import { DEFAULTS, PRESETS, STUDY_PROFILES, STUDY_TARGETS } from '../config/physiology';
import { bsaDuBois } from './calibrate';
import { herbertRow, jannerAIx, type CheckKind, type StudyCheck } from './validationStudy';
import { FUJIMOTO_2012, simulateCalibrated, type LVResult } from './ventricle';
import type { Verdict } from './validation';

const within = (v: number, lo: number, hi: number) => v >= lo && v <= hi;
const band = (v: number, lo: number, hi: number, slack: number): Verdict => within(v, lo, hi) ? 'pass' : within(v, lo - slack, hi + slack) ? 'near' : 'fail';
const fjIdx = (age: number) => age < 35 ? 0 : age < 50 ? 1 : age < 63 ? 2 : 3;

export interface V3Row { name: string; r: LVResult; checks: StudyCheck[]; }

export function runV3Validation(): { profiles: V3Row[]; trends: StudyCheck[] } {
  const profiles: V3Row[] = Object.entries(STUDY_PROFILES).map(([name, sp]) => {
    const p = { ...DEFAULTS, ...PRESETS[name] }, r = simulateCalibrated(p), m = r.beat.m;
    const h = herbertRow(sp.sex, sp.age), sbpT = h.cSBP[0] + h.amp[0], aixT = jannerAIx(sp.sex, sp.age, 70, sp.height), fi = fjIdx(sp.age);
    const c = (kind: CheckKind, what: string, model: string, reference: string, source: string, verdict: Verdict, fitted = false): StudyCheck => ({ kind, what, model, reference, source, verdict, fitted });
    const checks: StudyCheck[] = [
      c('fitted', 'Stroke volume', `${r.sv.toFixed(0)} mL`, `${sp.sv} mL (calibrated, as v2)`, 'Maceira 2006 × 0.70', Math.abs(r.sv - sp.sv) <= 1 ? 'pass' : 'fail', true),
      c('fitted', 'Cuff SBP', `${m.bSBP.toFixed(0)} mmHg`, `${sbpT} mmHg`, 'Herbert 2014', Math.abs(m.bSBP - sbpT) <= 2 ? 'pass' : 'near', true),
      c('fitted', 'AIx', `${m.AIx.toFixed(0)} %`, `${aixT.toFixed(0)} %`, 'Janner 2010', Math.abs(m.AIx - aixT) <= 2 ? 'pass' : 'near', true),
      c('data', 'Cuff DBP', `${m.bDBP.toFixed(0)} mmHg`, `${STUDY_TARGETS[name].cuffDBP} mmHg`, 'Wright 2011 (NHANES)', Math.abs(m.bDBP - STUDY_TARGETS[name].cuffDBP!) <= 4 ? 'pass' : Math.abs(m.bDBP - STUDY_TARGETS[name].cuffDBP!) <= 8 ? 'near' : 'fail'),
      c('data', 'Ejection fraction', `${(r.ef * 100).toFixed(0)} %`, `${(FUJIMOTO_2012.ef[fi] * 100).toFixed(0)} % (${FUJIMOTO_2012.age[fi]} y group mean)`, 'Fujimoto 2012', band(r.ef * 100, FUJIMOTO_2012.ef[fi] * 100 - 6, FUJIMOTO_2012.ef[fi] * 100 + 6, 4)),
      c('consistency', 'LVEDP / LA pressure', `${r.lvedp.toFixed(1)} / ${r.pla.toFixed(1)} mmHg`, `PCWP ${FUJIMOTO_2012.pcwp[fi]} mmHg at the age-typical EDV (EDPVR passes through it)`, 'Fujimoto 2012', Math.abs(r.lvedp - r.pla) < 1.5 ? 'pass' : 'near'),
      c('data', 'dP/dt max', `${r.dpdtMax.toFixed(0)} mmHg/s`, '1 000–1 500 mmHg/s (group means 30 to > 70 y, cath referrals without CVD)', 'Zhang & Kovács 2009', band(r.dpdtMax, 1000, 1500, 200)),
      c('data', '−dP/dt (peak fall)', `${r.dpdtMin.toFixed(0)} mmHg/s`, '−1 400 to −1 800 (group means; SD ≈ 200–400)', 'Zhang & Kovács 2009', band(r.dpdtMin, -1800, -1400, 250)),
      c('data', 'Relaxation τ (zero asymptote)', `${(r.tau * 1000).toFixed(0)} ms`, '42–54 ms; no change with age', 'Zhang & Kovács 2009; Yamakado 1997', band(r.tau * 1000, 42, 54, 5)),
      c('typical', 'IVRT', `${(r.ivrt * 1000).toFixed(0)} ms`, '≈ 60–100 ms (echo; rises with age)', 'Zhang & Kovács 2009', band(r.ivrt * 1000, 60, 100, 15)),
      c('consistency', 'Ejection time', `${(r.lvet * 1000).toFixed(0)} ms`, '≈ 300 ms (study design; Weissler 294–306 at 70 bpm)', 'Weissler 1968', band(r.lvet * 1000, 285, 315, 10)),
      c('data', 'Ea/Ees', `${(r.ea / r.lvp.ees).toFixed(2)} (Ees ${r.lvp.ees.toFixed(2)} mmHg/mL)`, '≈ 0.6–0.7, age-independent', 'Chen 1998; Redfield 2005', band(r.ea / r.lvp.ees, 0.55, 0.8, 0.1)),
      c('data', 'SVR index', `${(m.svrDyn * bsaDuBois(sp.height, sp.weight)).toFixed(0)} dyn·s·cm⁻⁵·m²`, sp.sex ? '≈ 2 300–2 340' : '≈ 2 480–2 500', 'Redfield 2005', 'pass')
    ];
    // SVRI verdict: same ±15 % / ±25 % rule as v2
    const svri = m.svrDyn * bsaDuBois(sp.height, sp.weight), ref = sp.sex ? 2320 : 2490, dev = Math.abs(svri / ref - 1);
    checks[checks.length - 1].verdict = sp.age < 45 ? 'pass' : dev <= 0.15 ? 'pass' : dev <= 0.25 ? 'near' : 'fail';
    if (sp.age < 45) checks.pop();
    return { name, r, checks };
  });
  const by = (pre: string, age: number) => profiles.find(p => p.name === `${pre} (${age} y)`)!.r;
  const trends: StudyCheck[] = [];
  for (const [lab, pre] of [['men', 'Healthy man'], ['women', 'Healthy woman']] as const) {
    const y = by(pre, 25), o = by(pre, 80);
    trends.push({ kind: 'data', what: `Ees rises with age, 25 → 80 y (${lab})`, model: `${y.lvp.ees.toFixed(2)} → ${o.lvp.ees.toFixed(2)} mmHg/mL`, reference: 'Ees increases with age, more steeply in women (Redfield); tracks Ea (Chen)', source: 'Chen 1998; Redfield 2005', verdict: o.lvp.ees > y.lvp.ees ? 'pass' : 'fail' });
    trends.push({ kind: 'data', what: `Ea/Ees with age, 25 → 80 y (${lab})`, model: `${(y.ea / y.lvp.ees).toFixed(2)} → ${(o.ea / o.lvp.ees).toFixed(2)}`, reference: 'age-independent', source: 'Chen 1998', verdict: Math.abs(o.ea / o.lvp.ees - y.ea / y.lvp.ees) <= 0.1 ? 'pass' : Math.abs(o.ea / o.lvp.ees - y.ea / y.lvp.ees) <= 0.2 ? 'near' : 'fail' });
    trends.push({ kind: 'data', what: `τ with age, 25 → 80 y (${lab})`, model: `${(y.tau * 1000).toFixed(0)} → ${(o.tau * 1000).toFixed(0)} ms`, reference: 'no correlation with age', source: 'Yamakado 1997', verdict: Math.abs(o.tau - y.tau) * 1000 <= 5 ? 'pass' : 'near' });
    trends.push({ kind: 'data', what: `dP/dt max with age, 25 → 80 y (${lab})`, model: `${y.dpdtMax.toFixed(0)} → ${o.dpdtMax.toFixed(0)} mmHg/s`, reference: 'rises slightly with age (P = 0.009)', source: 'Zhang & Kovács 2009', verdict: o.dpdtMax > y.dpdtMax ? 'pass' : 'fail' });
    const m45 = by(pre, 45).beat.m.map, drop = Math.min(by(pre, 65).beat.m.map, by(pre, 80).beat.m.map) - m45;
    trends.push({ kind: 'data', what: `MAP after midlife: lowest of 65 / 80 y minus 45 y (${lab})`, model: `${drop.toFixed(1)} mmHg`, reference: 'plateau after midlife', source: 'Franklin 1997', verdict: drop >= -3 ? 'pass' : drop >= -6 ? 'near' : 'fail' });
  }
  return { profiles, trends };
}
