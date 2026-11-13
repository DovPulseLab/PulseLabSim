/* Regenerates V3_FIT in src/model/ventricle.ts (nested fit: Ees inside every radius and Γ step).
   Run: node --experimental-transform-types scripts/fit-v3-profiles.ts  (about 3 minutes). */
import { DEFAULTS, PRESETS, STUDY_PROFILES, STUDY_TARGETS } from '../src/config/physiology.ts';
import { bsaDuBois } from '../src/model/calibrate.ts';
import { herbertRow, jannerAIx } from '../src/model/validationStudy.ts';
import { simulateLV, FUJIMOTO_2012 } from '../src/model/ventricle.ts';
const out: any[] = [];
for (const [name, sp] of Object.entries(STUDY_PROFILES)) {
  const p0 = { ...DEFAULTS, ...PRESETS[name] }; const h = herbertRow(sp.sex, sp.age);
  const sbpT = h.cSBP[0] + h.amp[0], aixT = jannerAIx(sp.sex, sp.age, 70, sp.height), svT = sp.sv;
  let ees = 2.9, radius = sp.radius, gamma = sp.gamma, r: any;
  const sim = () => (r = simulateLV({ ...p0, radius, gamma }, { ees }));
  const solveEes = () => { let lo = 0.8, hi = 9; for (let i = 0; i < 13; i++) { ees = (lo + hi) / 2; sim(); if (r.sv < svT) lo = ees; else hi = ees; } ees = (lo + hi) / 2; sim(); };
  for (let round = 0; round < 3; round++) {
    let lo = 85, hi = 120; for (let i = 0; i < 10; i++) { radius = (lo + hi) / 2; solveEes(); if (r.beat.m.bSBP > sbpT) lo = radius; else hi = radius; } radius = (lo + hi) / 2;
    lo = 0.01; hi = 0.9; for (let i = 0; i < 9; i++) { gamma = (lo + hi) / 2; solveEes(); if (r.beat.m.AIx < aixT) lo = gamma; else hi = gamma; } gamma = (lo + hi) / 2;
  }
  radius = Math.round(radius * 2) / 2; gamma = Math.round(gamma * 100) / 100; solveEes(); ees = Math.round(ees * 100) / 100; sim();
  const m = r.beat.m, bsa = bsaDuBois(sp.height, sp.weight);
  out.push({ name, ees, radius, gamma, sv: +r.sv.toFixed(1), svT, sbp: +m.bSBP.toFixed(1), sbpT, aix: +m.AIx.toFixed(1), aixT: +aixT.toFixed(1), dbp: +m.bDBP.toFixed(1), dbpT: STUDY_TARGETS[name].cuffDBP, map: +m.map.toFixed(1),
    ef: +(r.ef*100).toFixed(0), edv: +r.edv.toFixed(0), lvedp: +r.lvedp.toFixed(1), pla: +r.pla.toFixed(1), dpdt: +r.dpdtMax.toFixed(0), dpdtMin: +r.dpdtMin.toFixed(0), tau: +(r.tau*1000).toFixed(0),
    ivct: +(r.ivct*1000).toFixed(0), lvet: +(r.lvet*1000).toFixed(0), ivrt: +(r.ivrt*1000).toFixed(0), eaees: +(r.ea/ees).toFixed(2), ea: +r.ea.toFixed(2), lvesp: +r.lvesp.toFixed(0), svri: Math.round(m.svrDyn*bsa), conv: r.converged });
}
for (const x of out) console.log(JSON.stringify(x));
