import { LAWS, MODEL, PHYS, type Params } from '../config/physiology';
import type { Derived } from './derive';

export type WaveType = 'A' | 'B' | 'C';

export interface Indices {
  Ps: number; Pd: number; PP: number; map: number; Pi: number; P1: number; P2: number;
  i1: number; i2: number; AP: number; AIx: number; AIx75: number; type: WaveType;
  iPk: number; iInf: number; iET: number; iTi: number;
  dtp: number; dtr: number; Ew: number; rm: number; lsEs: number; tti: number; dpti: number; sevr: number;
  svf: number; svrefl: number; bSBP: number; bDBP: number; bPP: number; rSBP: number; rDBP: number;
  /** intra-arterial brachial pressure (bSBP/bDBP are what a cuff reads; see MODEL.cuff) */
  iaSBP: number; iaDBP: number;
  /** central SBP as a cuff-calibrated tonometry device reports it */
  devCSBP: number;
  /** zero-flow pressure (mmHg) and Windkessel τ above it, τ′ = (SVR − Pzf/CO)·C (s) */
  pzf: number; tauEff: number;
  ppa: number; co: number; svrDyn: number; svrWU: number; zcDyn: number;
  ctot: number; svpp: number; tau: number; lp: number;
  cAoOp: number; cMusOp: number; cPath: number; ep: number; et: number;
  peakQ: number; fwdAmp: number; bwdAmp: number; cMAP: number;
  /** diastolic decay: fitted time constant (s), mean rate of fall (mmHg/s), fit window */
  tauFit: number; decayRate: number; decayFall: number; iDecay: number; decayP0: number;
  /** three-parameter fit P∞ + A·e^(−t/τ): time constant (s) and asymptote (mmHg) */
  tauFree: number; pInf: number;
}

/** Least-squares line through (t, ln(P − c)); returns slope, intercept and the pressure-space SSE. */
function logFit(p: number[], dt: number, i0: number, c: number): { slope: number; a: number; sse: number } {
  let sx = 0, sy = 0, sxx = 0, sxy = 0, m = 0;
  for (let k = i0; k < p.length; k++) {
    const v = p[k] - c; if (!(v > 0)) continue;
    const x = (k - i0) * dt, y = Math.log(v);
    sx += x; sy += y; sxx += x * x; sxy += x * y; m++;
  }
  const den = m * sxx - sx * sx;
  const slope = m > 2 && den > 0 ? (m * sxy - sx * sy) / den : 0;
  const a = m > 2 ? Math.exp((sy - slope * sx) / m) : 0;
  let sse = 0;
  for (let k = i0; k < p.length; k++) { const e = p[k] - (c + a * Math.exp(slope * (k - i0) * dt)); sse += e * e; }
  return { slope, a, sse };
}

/** Diastolic decay over the last two-thirds of diastole, which leaves out the incisura and
 *  the early reflected-wave oscillation (decay-time method, Liu et al. 1986).
 *  - tau: P(t) = P0·e^(−t/τ) with the asymptote fixed at 0 mmHg (two-element Windkessel;
 *    CVP = 0 here), least squares on ln P. Comparable with invasive τ ≈ 1.4 s (Chemla 2017).
 *  - tauFree, pInf: P(t) = P∞ + A·e^(−t/τ) with P∞ fitted (search over P∞, least squares in
 *    pressure). Comparable with invasive τ ≈ 0.35–0.45 s, P∞ ≈ 60–70 mmHg (Chemla 2017;
 *    Yamakado 2018).
 *  - rate: mean fall of pressure over the window (mmHg/s). */
export function diastolicDecay(p: number[], dt: number, iET: number): { tau: number; rate: number; fall: number; i0: number; p0: number; tauFree: number; pInf: number } {
  const n = p.length;
  const i0 = Math.min(n - 3, Math.max(0, Math.round(iET + (n - 1 - iET) / 3)));
  const f0 = logFit(p, dt, i0, 0);
  const tau = f0.slope < 0 ? -1 / f0.slope : Infinity;
  // free asymptote: coarse 1 mmHg grid, then 0.05 mmHg around the best
  let pEnd = Infinity; for (let k = i0; k < n; k++) pEnd = Math.min(pEnd, p[k]);
  let best = { c: 0, sse: f0.slope < 0 ? f0.sse : Infinity, slope: f0.slope };
  const tryC = (c: number) => { if (c < 0 || c >= pEnd - 0.2) return; const f = logFit(p, dt, i0, c); if (f.slope < 0 && f.sse < best.sse) best = { c, sse: f.sse, slope: f.slope }; };
  for (let c = 0; c < pEnd; c += 1) tryC(c);
  const c0 = best.c;
  for (let c = c0 - 1; c <= c0 + 1; c += 0.05) tryC(c);
  const tauFree = best.slope < 0 ? -1 / best.slope : Infinity;
  const dur = (n - 1 - i0) * dt;
  const fall = p[i0] - p[n - 1];
  return { tau, rate: dur > 0 ? fall / dur : 0, fall, i0, p0: f0.a || p[i0], tauFree, pInf: best.c };
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
  // Cuff reading: Picone 2017 (invasive IPD meta-analysis) — cuff SBP 5.7 mmHg below and
  // cuff DBP 5.5 mmHg above intra-arterial brachial pressure. v1 had no cuff layer.
  const cuffOn = LAWS.gen === 'v2.5';
  const cS = cuffOn ? bS - MODEL.cuff.sbp : bS, cD = cuffOn ? bD + MODEL.cuff.dbp : bD;
  // Tonometry device: the pulse is calibrated to cuff SBP/DBP, then mapped to the aorta, so
  // the reported central SBP inherits the cuff error (scale = cuff PP / true brachial PP).
  const devCSBP = cD + (Ps - Pd) * (cS - cD) / Math.max(1e-6, bS - bD);
  const co = params.sv * params.hr / 1000;     // L/min
  const dec = diastolicDecay(p, dt, iET);
  return {
    Ps, Pd, PP, map, Pi, P1, P2, i1, i2, AP, AIx, AIx75, type, iPk, iInf, iET, iTi,
    dtp: d.dtp * 1000, dtr: dtr * 1000, Ew, rm, lsEs, tti, dpti, sevr,
    svf, svrefl: svr2, bSBP: cS, bDBP: cD, bPP: cS - cD, rSBP: rS, rDBP: rD, iaSBP: bS, iaDBP: bD, devCSBP,
    ppa, co, svrDyn: d.svr * DYN, svrWU: d.svr * 60, zcDyn: d.zc * DYN,
    ctot: d.cTot, svpp: params.sv / PP, tau: d.svr * d.cTot, lp: d.lp,
    cAoOp: d.cAoOp, cMusOp: d.cMusOp, cPath: d.cPath, ep: d.ep, et: d.ET * 1000,
    peakQ: arrMax(q), fwdAmp: arrMax(pf) - arrMin(pf), bwdAmp: arrMax(pb) - arrMin(pb), cMAP: d.map,
    tauFit: dec.tau, decayRate: dec.rate, decayFall: dec.fall, iDecay: dec.i0, decayP0: dec.p0,
    tauFree: dec.tauFree, pInf: dec.pInf,
    pzf: cuffOn ? MODEL.pzfFrac * d.map : 0, tauEff: d.svr * (1 - (cuffOn ? MODEL.pzfFrac : 0)) * d.cTot
  };
}
