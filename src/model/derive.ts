import { LAWS, MODEL, PHYS, type Params } from '../config/physiology';
import { fixedPoint, type FixedPointOptions, type FixedPointResult } from './coupling';

/** Operating parameters derived from the inputs for one beat. */
export interface Derived {
  T: number;        // cycle length, s
  ET: number;       // ejection time, s
  svr: number;      // mmHg·s/mL
  qMean: number;    // mL/s
  map: number;      // mmHg (= CO × SVR + CVP)
  cAoOp: number;    // operating aortic PWV, m/s
  cMusOp: number;   // operating muscular PWV, m/s
  A: number;        // aortic area, cm²
  zc: number;       // characteristic impedance, mmHg·s/mL
  lp: number;       // reflection distance, cm
  cPath: number;    // path PWV, m/s
  dtp: number;      // round-trip time, s
  cTot: number;     // total compliance, mL/mmHg
  cTube: number;
  cTerm: number;
  g: number;        // clamped Γ
  kRefl: number;
  zt: number;
  rTerm: number;
  armLen: number;   // cm
  brachX: number;   // cm
  gArm: number;
  ep: number;       // Peterson modulus, mmHg
  coupling: FixedPointResult;  // MAP ↔ PWV iteration result
}

/** Weissler LVET in seconds (men by default; sex = 1 uses the women's regression). */
export const weisslerLVET = (hr: number, sex = 0): number =>
  (sex === 1 ? MODEL.lvetAF - MODEL.lvetBF * hr : MODEL.lvetA - MODEL.lvetB * hr) / 1000;

/** Operating PWVs at a given MAP (passive pressure dependence, Nichols). */
export function operatingPWV(p: Params, map: number): { cAoOp: number; cMusOp: number } {
  return {
    cAoOp: Math.max(MODEL.cAoMin, p.cAo * (1 + MODEL.kAo * (map - MODEL.mapRef))),
    cMusOp: Math.max(MODEL.cMusMin, p.cMus * (1 + MODEL.kMus * (map - MODEL.mapRef)))
  };
}

/** Ported from v1 derive(); same arithmetic in the same order. */
export function derive(p: Params, couplingOpts: FixedPointOptions = {}): Derived {
  const { RHO, MMHG } = PHYS;
  const T = 60 / p.hr;
  const etW = weisslerLVET(p.hr, p.sex);
  const ET = Math.min(Math.max(etW * p.etScale, MODEL.etMin), MODEL.etMaxFrac * T);
  const svr = p.svrRef / Math.pow(p.radius / 100, 4);   // Poiseuille r⁻⁴
  const qMean = p.sv / T;
  // Passive feedback: MAP sets operating PWV; the solved MAP is CO × SVR + CVP.
  // With a flow-source heart MAP does not depend on PWV, so this settles in 2 steps.
  const coupling = fixedPoint(() => svr * qMean + PHYS.cvp, MODEL.mapRef, couplingOpts);
  const map = coupling.value;
  const { cAoOp, cMusOp } = operatingPWV(p, map);
  const A = Math.PI * Math.pow(p.diam / 2, 2);
  const zc = RHO * cAoOp / (A * 1e-4) / MMHG / 1e6;
  const lp = MODEL.lpPerHeight * p.height * p.lpScale;
  const fAo = MODEL.fAo;
  const cPath = 1 / (fAo / cAoOp + (1 - fAo) / cMusOp);
  const dtp = 2 * (lp / 100) / cPath;
  const rhoc2 = RHO * cAoOp * cAoOp / MMHG;
  const cTot = p.vEff * Math.pow(p.diam / MODEL.diamRef, 2) / rhoc2;   // Bramwell–Hill
  const cTube = A * lp / (RHO * cPath * cPath / MMHG);
  const cTerm = Math.max(MODEL.cTermMinFrac * cTot, cTot - cTube);
  const g = Math.min(Math.max(p.gamma, MODEL.gammaMin), MODEL.gammaMax);
  let zt = MODEL.ztOverZc * zc;
  if (zt > MODEL.ztMaxFracSvr * svr) zt = MODEL.ztMaxFracSvr * svr;
  const kRefl = g / MODEL.gammaRef;
  // v2.5: the arterioles drain toward a zero-flow (critical closing) pressure Pzf, not 0, so the
  // pulsatile load sees only the resistance above Pzf (Chemla 2017). DC is still MAP = CO × SVR.
  const pzf = LAWS.gen === 'v2.5' ? MODEL.pzfFrac * svr * qMean : 0;
  const rTerm = Math.max(MODEL.rTermMinFrac * svr, svr - zt - pzf / qMean);
  const armLen = MODEL.armLenPerHeight * p.height;
  const brachX = MODEL.brachFrac * armLen;
  const gArm = MODEL.gArm;
  const ep = 2 * rhoc2;
  return { T, ET, svr, qMean, map, cAoOp, cMusOp, A, zc, lp, cPath, dtp, cTot, cTube, cTerm, g, kRefl, zt, rTerm, armLen, brachX, gArm, ep, coupling };
}
