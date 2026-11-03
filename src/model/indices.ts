import { MODEL, PHYS, type Params } from '../config/physiology';
import type { Derived } from './derive';

export type WaveType = 'A' | 'B' | 'C';

export interface Indices {
  Ps: number; Pd: number; PP: number; map: number; Pi: number; P1: number; P2: number;
  i1: number; i2: number; AP: number; AIx: number; AIx75: number; type: WaveType;
  iPk: number; iInf: number; iET: number; iTi: number;
  dtp: number; dtr: number; Ew: number; rm: number; lsEs: number; tti: number; dpti: number; sevr: number;
  svf: number; svrefl: number; bSBP: number; bDBP: number; bPP: number; rSBP: number; rDBP: number;
  ppa: number; co: number; svrDyn: number; svrWU: number; zcDyn: number;
  ctot: number; svpp: number; tau: number; lp: number;
  cAoOp: number; cMusOp: number; cPath: number; ep: number; et: number;
  peakQ: number; fwdAmp: number; bwdAmp: number; cMAP: number;
}

export interface IndexInput {
  params: Params; d: Derived; dt: number;
  q: number[]; p: number[]; pf: number[]; pb: number[]; brachial: number[]; radial: number[];
}

const arrMax = (a: number[]) => Math.max(...a);
const arrMin = (a: number[]) => Math.min(...a);

/** Clinical indices for one beat (ported from v1 indices()). */
export function indices(r: IndexInput): Indices {
  const { d, dt, p, pf, pb, q, brachial, radial, params } = r;
  const DYN = PHYS.DYN;
  const n = p.length, iET = Math.min(n - 1, Math.round(d.ET / dt));
  let iPk = 0; for (let k = 0; k <= iET + 5; k++) if (p[k] > p[iPk]) iPk = k;
  const Ps = p[iPk], Pd = arrMin(p), PP = Ps - Pd;
  const map = p.reduce((a, b) => a + b, 0) / n;
  const iTi = Math.min(n - 1, Math.round(d.dtp / dt));
  // P1 = highest pressure before the reflected wave arrives; P2 = highest after it.
  // AIx = (P2 − P1)/PP, continuous across the type C → A transition.
  let i1 = 0; for (let k = 0; k <= iTi; k++) if (p[k] > p[i1]) i1 = k;
  const iEnd = Math.min(n - 1, Math.max(iET, iTi + Math.round(MODEL.p2Window / dt)));
  let i2 = iTi; for (let k = iTi; k <= iEnd; k++) if (p[k] > p[i2]) i2 = k;
  const P1 = p[i1], P2 = p[i2];
  const AP = P2 - P1;
  const type: WaveType = AP <= 0 ? 'C' : AP / PP > MODEL.typeAThreshold ? 'A' : 'B';
  const Pi = AP > 0 ? P1 : P2;
  const iInf = AP > 0 ? Math.max(i1, Math.min(iTi, i1)) : i2;
  const AIx = 100 * AP / PP;
  const AIx75 = AIx + MODEL.aix75PerBpm * (params.hr - 75);
  const dtr = AP > 0 ? Math.max(0, d.ET - d.dtp) : 0;
  const Ew = dtr * Math.max(AP, 0) * Math.PI / 2 * DYN;      // dyn·s/cm²
  const rm = 100 * (arrMax(pb) - arrMin(pb)) / (arrMax(pf) - arrMin(pf));
  // systolic thirds
  const third = iET / 3; let a1 = 0, a2 = 0, a3 = 0;
  for (let k = 0; k < iET; k++) { const v = p[k] * dt; if (k < third) a1 += v; else if (k < 2 * third) a2 += v; else a3 += v; }
  const lsEs = a3 / (a1 + a2);
  let tti = 0, dpti = 0;
  for (let k = 0; k < n; k++) { if (k < iET) tti += p[k] * dt; else dpti += (p[k] - params.lvedp) * dt; }
  const sevr = 100 * dpti / tti;
  // stroke volume split (N&E Eq. 13): SVm = SVf − SVr
  let svf = 0, svr2 = 0;
  for (let k = 0; k < iET; k++) { svf += (pf[k] - pf[0]) / d.zc * dt; svr2 += (pb[k] - pb[0]) / d.zc * dt; }
  const bS = arrMax(brachial), bD = arrMin(brachial), rS = arrMax(radial), rD = arrMin(radial);
  const ppa = (bS - bD) / PP;
  const co = params.sv * params.hr / 1000;     // L/min
  return {
    Ps, Pd, PP, map, Pi, P1, P2, i1, i2, AP, AIx, AIx75, type, iPk, iInf, iET, iTi,
    dtp: d.dtp * 1000, dtr: dtr * 1000, Ew, rm, lsEs, tti, dpti, sevr,
    svf, svrefl: svr2, bSBP: bS, bDBP: bD, bPP: bS - bD, rSBP: rS, rDBP: rD,
    ppa, co, svrDyn: d.svr * DYN, svrWU: d.svr * 60, zcDyn: d.zc * DYN,
    ctot: d.cTot, svpp: params.sv / PP, tau: d.svr * d.cTot, lp: d.lp,
    cAoOp: d.cAoOp, cMusOp: d.cMusOp, cPath: d.cPath, ep: d.ep, et: d.ET * 1000,
    peakQ: arrMax(q), fwdAmp: arrMax(pf) - arrMin(pf), bwdAmp: arrMax(pb) - arrMin(pb), cMAP: d.map
  };
}
