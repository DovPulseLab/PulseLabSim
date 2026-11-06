/* =====================================================================
   Haemodynamic solver (ported from v1 js/model.js, Nichols & Edwards 2001).
   The LV is a flow source Q(t) ejecting into a uniform aortic tube
   (Zc, wave speed c) that ends at an effective reflection site Lp away,
   loaded by a 3-element Windkessel (Zt + R ∥ C). Solved exactly per
   harmonic for a periodic beat:
     Pf(ω) = Zc Q(ω) / (1 − G(ω)E(ω))     forward wave
     Pb(ω) = G(ω)E(ω) Pf(ω)               reflected wave
     P(ω)  = Pf + Pb,  Zin = Zc (1+GE)/(1−GE)
     E(ω)  = e^{−iωΔtp} · damping,  G(ω) = (ZL − Zc)/(ZL + Zc)
   At ω = 0, Zin = SVR, so MAP = CO × SVR exactly.
   Brachial/radial pressure come from a second transmission line (the arm).
   ===================================================================== */
import { DEFAULTS, LAWS, MODEL, PHYS, type Params } from '../config/physiology';
import { abs, add, cx, div, expi, mul, sub, type Cx } from './complex';
import { derive, type Derived } from './derive';
import { fft } from './fft';
import { flowWave } from './flow';
import { indices, type Indices } from './indices';

export interface ZinPoint { f: number; mod: number; }

export interface BeatResult {
  params: Params;
  d: Derived;
  N: number;
  dt: number;
  t: number[];
  q: number[];
  p: number[];        // central aortic pressure
  pf: number[];       // forward wave
  pb: number[];       // reflected wave
  radial: number[];
  brachial: number[];
  zin: ZinPoint[];    // |Zin| at each harmonic, mmHg·s/mL
  m: Indices;
}

/** Scale applied to the terminal reflection coefficient at frequency f (Hz).
 *  v1: Γ/0.5 at every frequency. That also weakens the reflection near 0 Hz,
 *  where the whole arterial tree acts as one Windkessel, so late-systolic pressure sags
 *  toward the flow wave and diastole decays more slowly than R·C.
 *  v2.5: scale 1 near 0 Hz (Windkessel limit) and Γ/0.5 at the higher
 *  harmonics, where reflections from many sites partly cancel. Lorentzian crossover
 *  at MODEL.reflFc. */
export function reflScale(kRefl: number, f: number): number {
  if (LAWS.gen === 'v1') return kRefl;
  return kRefl + (1 - kRefl) / (1 + (f / MODEL.reflFc) ** 2);
}

/** Reflection term G(ω)·E(ω) seen from the aortic root at frequency f (Hz). */
export function reflectionGE(d: Derived, f: number): Cx {
  const w = 2 * Math.PI * f;
  const ZL = add(cx(d.zt, 0), div(cx(d.rTerm, 0), cx(1, w * d.rTerm * d.cTerm)));
  let G = div(sub(ZL, cx(d.zc, 0)), add(ZL, cx(d.zc, 0)));
  const kf = reflScale(d.kRefl, f);
  G = cx(G.r * kf, G.i * kf);
  const gm = abs(G);
  if (gm > MODEL.gMax) G = cx(G.r * MODEL.gMax / gm, G.i * MODEL.gMax / gm);
  const E = expi(-w * d.dtp, Math.exp(-MODEL.damp * f));
  return mul(G, E);
}

/** Aortic input impedance at any frequency (Hz), mmHg·s/mL. */
export function inputImpedance(d: Derived, f: number): Cx {
  const one = cx(1, 0);
  const GE = reflectionGE(d, f);
  return div(mul(cx(d.zc, 0), add(one, GE)), sub(one, GE));
}

/** Simulate one steady-state beat. Missing inputs take their defaults. */
export function simulate(input: Partial<Params>): BeatResult {
  const N = PHYS.N;
  const p: Params = Object.assign({}, DEFAULTS, input);
  const d = derive(p);
  const dt = d.T / N;
  const q = flowWave(p, d, N);
  const qr = Float64Array.from(q), qi = new Float64Array(N);
  fft(qr, qi, false);

  const Pr = new Float64Array(N), Pi = new Float64Array(N);
  const Fr = new Float64Array(N), Fi = new Float64Array(N);
  const Br = new Float64Array(N), Bi = new Float64Array(N);
  const Rr = new Float64Array(N), Ri = new Float64Array(N);   // radial
  const Hr = new Float64Array(N), Hi = new Float64Array(N);   // brachial
  const zin: ZinPoint[] = [];
  const tArm = (d.armLen / 100) / d.cMusOp, tBr = (d.brachX / 100) / d.cMusOp;
  const one = cx(1, 0);

  for (let k = 0; k <= N / 2; k++) {
    const f = k / d.T, w = 2 * Math.PI * f;
    const Q = cx(qr[k], qi[k]);
    const GE = reflectionGE(d, f);
    const Pf = div(mul(cx(d.zc, 0), Q), sub(one, GE));
    const Pb = mul(GE, Pf);
    const P = add(Pf, Pb);
    zin.push({ f, mod: abs(div(mul(cx(d.zc, 0), add(one, GE)), sub(one, GE))) });
    // arm line: P(x)/P(0) = (e^{−iωx/c} + G e^{−iω(2L−x)/c}) / (1 + G e^{−2iωL/c})
    const att = Math.exp(-MODEL.armAtt * f);
    const den = add(one, mul(cx(d.gArm, 0), expi(-2 * w * tArm, att)));
    const HR = div(add(expi(-w * tArm, Math.sqrt(att)), mul(cx(d.gArm, 0), expi(-w * tArm, Math.sqrt(att)))), den);
    const HB = div(add(expi(-w * tBr, Math.pow(att, tBr / tArm / 2)),
      mul(cx(d.gArm, 0), expi(-w * (2 * tArm - tBr), Math.pow(att, (2 * tArm - tBr) / tArm / 2)))), den);
    const PR = mul(HR, P), PB = mul(HB, P);
    const put = (ar: Float64Array, ai: Float64Array, z: Cx) => {
      ar[k] = z.r; ai[k] = z.i;
      if (k > 0 && k < N / 2) { ar[N - k] = z.r; ai[N - k] = -z.i; }
    };
    put(Pr, Pi, P); put(Fr, Fi, Pf); put(Br, Bi, Pb); put(Rr, Ri, PR); put(Hr, Hi, PB);
  }
  // mean terms: MAP = SVR × Qmean exactly; split evenly into forward/backward
  Pr[0] = d.map * N; Fr[0] = d.map * N / 2; Br[0] = d.map * N / 2; Rr[0] = d.map * N; Hr[0] = d.map * N;
  Pi[0] = Fi[0] = Bi[0] = Ri[0] = Hi[0] = 0;
  for (const [a, b] of [[Pr, Pi], [Fr, Fi], [Br, Bi], [Rr, Ri], [Hr, Hi]] as const) fft(a, b, true);

  const base = {
    params: p, d, N, dt,
    t: Array.from({ length: N }, (_, k) => k * dt),
    q: Array.from(q), p: Array.from(Pr), pf: Array.from(Fr), pb: Array.from(Br),
    radial: Array.from(Rr), brachial: Array.from(Hr), zin
  };
  return { ...base, m: indices(base) };
}
