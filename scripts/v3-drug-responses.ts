import { DEFAULTS, PRESETS, ACUTE_DRUGS } from '../src/config/physiology.ts';
import { simulate } from '../src/model/solve.ts';
import { applyCalibration } from '../src/model/calibrate.ts';
import { applyDrugEffects, v3SvRatio } from '../src/engine/kinetics.ts';
const prof = process.argv[2] ?? 'Healthy man (45 y)';
for (const heart of [0, 1]) {
  const base = applyCalibration({ ...DEFAULTS, ...PRESETS[prof], heart });
  const m0 = simulate(base).m;
  console.log(`\n${prof} — ${heart ? 'Ventricle (v3)' : 'Fixed flow (v2)'}: SV ${(heart ? m0.svOut : base.sv).toFixed(0)} MAP ${m0.map.toFixed(0)} HR ${base.hr}`);
  for (const d of Object.keys(ACUTE_DRUGS)) {
    const ev = [{ id: 1, drug: d, mode: 'infusion' as const, t0: 0, tStop: null, dose: 1, steady: true, rampS: 0 }];
    const r = applyDrugEffects(base, ev, 3600), p = r.params, m = simulate(p).m;
    const sv = heart ? m.svOut : p.sv, sv0 = heart ? m0.svOut : base.sv;
    const est = heart ? (v3SvRatio(p, base) * base.sv / m0.svOut * m0.svOut) : NaN;
    const pc = (a: number, b: number) => `${(100 * (a / b - 1)).toFixed(0).padStart(4)} %`;
    console.log(d.padEnd(15), 'SV', pc(sv, sv0), ' MAP', pc(m.map, m0.map), ' CO', pc(sv * p.hr, sv0 * base.hr), ' HR', (p.hr - base.hr).toFixed(0).padStart(4),
      heart ? `  EDV ${pc(m.edv, m0.edv)} LVEDP ${m0.lvEDP.toFixed(1)}→${m.lvEDP.toFixed(1)} dP/dt ${pc(m.dpdtMax, m0.dpdtMax)} EF ${m0.ef.toFixed(0)}→${m.ef.toFixed(0)}  SV-estimate err ${(100 * (est / m.svOut - 1)).toFixed(1)} %` : '');
  }
}
