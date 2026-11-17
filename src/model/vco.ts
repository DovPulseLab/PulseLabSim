/* =====================================================================
   v3.1 · Vena caval occlusion (transient preload reduction). Pure.

   The steady solver (ventricle.ts) finds one periodic beat. A caval
   occlusion is a transient: filling falls beat by beat while the arteries
   still hold the pressure of the beats before. So here the same ventricle
   (time-varying elastance, EDPVR, valves, ejection effect) is stepped in
   time over many beats against the same arterial load, written as an
   impulse response instead of a per-harmonic transfer function:

       P_Ao(t) = Zc · Q(t) + ∫₀^∞ g(s) · Q(t − s) ds
       g = inverse Fourier transform of [Zin(ω) − Zc]

   Zin(ω) is the v2 input impedance of this patient (same function the
   steady solver uses), evaluated on a fine frequency grid so g is resolved
   over ≈ 2 × the record length and treated as causal. Flow before the record
   is the converged steady beat repeated, so the record starts in steady
   state. Within a beat the convolution is summed directly; each finished
   beat's contribution to later samples is added with one FFT.

   The occlusion: mean left-atrial (filling) pressure falls from its steady
   value P_LA0 as P_LA(t) = P_LA0 − ΔP_LA · (1 − e^{−(t − t_occ)/τ}), with
   τ = one third of the occlusion run. ΔP_LA is solved by bisection so that
   end-systolic pressure falls by the requested amount (default 25 mmHg,
   Little et al. 1989; Freeman et al. 1986; Kass et al. 1987) from the last
   control beat to the last occlusion beat. As in the papers' analysis
   window, heart rate, contractility and the arteries are held constant
   (no baroreflex: the reflex starts after ≈ 5–10 s and the beats used are
   the first ones after occlusion).

   End-systole: the point of maximal P/(V − V0) in each beat, with V0 taken
   from the regression and iterated (Kono et al. 1984; Sagawa 1981). The
   ESPVR is the least-squares line through those points: slope Ees, volume
   intercept V0. Isochrones: least-squares lines through the points reached
   at the same time after the onset of contraction in every beat (Suga &
   Sagawa 1974), slope E(t).
   ===================================================================== */
import type { Params } from '../config/physiology';
import { cx, type Cx } from './complex';
import { fft } from './fft';
import { inputImpedance } from './solve';
import { lvInputsForPatient, simulateLV, type LVParams, type LVResult } from './ventricle';

export interface VCOOptions {
  /** control (pre-occlusion) beats simulated; the last one is the first loop of the run */
  control?: number;
  /** occlusion beats */
  beats?: number;
  /** requested fall in end-systolic pressure, mmHg */
  dropPes?: number;
  /** fixed fall in filling pressure instead of solving for dropPes, mmHg */
  dPla?: number;
  /** isochrone times after onset of contraction, s */
  isochrones?: number[];
}

export interface VCOBeat {
  n: number;              // 0 = last control beat, 1… = occlusion beats
  pla: number;            // mean LA pressure during this beat's filling, mmHg
  edv: number; edp: number;
  esv: number; esp: number; tEs: number;   // max P/(V−V0) point; tEs from onset of contraction, s
  sv: number; lvsp: number; dpdtMax: number;
  aoSys: number; aoDia: number;
  /** loop samples, onset of contraction → next onset */
  v: number[]; p: number[];
}

export interface Line { slope: number; v0: number; r2: number; n: number; }

export interface VCOResult {
  params: Params;
  lvp: LVParams;
  T: number; dt: number;
  pla0: number; dPla: number;
  dropPes: number;            // achieved fall in end-systolic pressure, mmHg
  target: number;             // requested fall, mmHg (NaN when dPla was given)
  reached: boolean;
  beats: VCOBeat[];
  espvr: Line;                // fitted ESPVR
  isochrones: (Line & { t: number; pts: { v: number; p: number }[] })[];
  /** model inputs for comparison */
  eesModel: number; v0Model: number;
  /** EDPVR of this ventricle, P(V), mmHg */
  edpvr: (v: number) => number;
  /** continuous record of the run (from the start of the last control beat) */
  trace: { t: number[]; beat: number[]; plv: number[]; vol: number[]; pao: number[]; qao: number[]; qmv: number[]; pla: number[] };
  /** steady beat the run starts from */
  steady: LVResult;
}

const nextPow2 = (n: number) => { let m = 1; while (m < n) m <<= 1; return m; };

export function linFit(x: readonly number[], y: readonly number[]): Line {
  const n = x.length; let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; sxx += x[i] * x[i]; sxy += x[i] * y[i]; syy += y[i] * y[i]; }
  const vx = n * sxx - sx * sx, vy = n * syy - sy * sy, cxy = n * sxy - sx * sy;
  const slope = cxy / vx, b = (sy - slope * sx) / n;
  return { slope, v0: -b / slope, r2: vy > 0 ? (cxy * cxy) / (vx * vy) : 1, n };
}

interface Kernel { g: Float64Array; G: { re: Float64Array; im: Float64Array }; M: number; hist: Float64Array; pzf: number; }

/** Causal impulse response of Zin − Zc on the solver grid, its FFT, and the pressure from flow before t = 0. */
function buildKernel(r: LVResult, L: number): Kernel {
  const { d, dt, zc, q } = r.internal, N = q.length;
  const M = nextPow2(2 * L), re = new Float64Array(M), im = new Float64Array(M);
  // Zin(0) = SVR, but Zin just above 0 Hz is the resistance above the arteriolar zero-flow pressure
  // (v2.5, Chemla 2017). The difference is that pressure, Pzf: a constant offset, not part of g.
  const z0: Cx = inputImpedance(d, 1e-6), pzf = (d.svr - z0.r) * d.qMean;
  for (let j = 0; j <= M / 2; j++) {
    const z: Cx = j === 0 ? cx(z0.r, 0) : inputImpedance(d, j / (M * dt));
    re[j] = z.r - zc; im[j] = j === 0 || j === M / 2 ? 0 : z.i;
    if (j > 0 && j < M / 2) { re[M - j] = re[j]; im[M - j] = -im[j]; }
  }
  fft(re, im, true);
  const g = new Float64Array(M); for (let n = 0; n < L; n++) g[n] = re[n];   // causal part, record length
  const Gr = Float64Array.from(g), Gi = new Float64Array(M); fft(Gr, Gi, false);
  // pressure at t ≥ 0 from the steady flow before t = 0: periodic response minus the response to the in-record part
  const fold = new Float64Array(N); for (let n = 0; n < L; n++) fold[n % N] += g[n];
  const pss = new Float64Array(N);
  for (let n = 0; n < N; n++) { let s = 0; for (let i = 0; i < N; i++) s += fold[i] * q[(n - i + N) % N]; pss[n] = s; }
  const tr = new Float64Array(M), ti = new Float64Array(M); for (let n = 0; n < L; n++) tr[n] = q[n % N];
  fft(tr, ti, false);
  for (let k = 0; k < M; k++) { const a = tr[k], b = ti[k]; tr[k] = a * Gr[k] - b * Gi[k]; ti[k] = a * Gi[k] + b * Gr[k]; }
  fft(tr, ti, true);
  const hist = new Float64Array(L); for (let n = 0; n < L; n++) hist[n] = pzf + pss[n % N] - tr[n];
  return { g, G: { re: Gr, im: Gi }, M, hist, pzf };
}

interface Run { P: Float64Array; V: Float64Array; Pao: Float64Array; Q: Float64Array; Qm: Float64Array; Pla: Float64Array; }

/** Step the ventricle through `nb` beats; `pla(n)` is the filling pressure at sample n. */
function run(r: LVResult, K: Kernel, nb: number, pla: (n: number) => number): Run {
  const lv = r.lvp, { en, dt, zc } = r.internal, N = en.length, L = nb * N;
  const ped = (v: number) => lv.pRef * Math.exp(lv.a * (v / lv.bsa - lv.edviRef));
  const zEff = zc + K.g[0];
  const fut = Float64Array.from(K.hist.subarray(0, L));
  const P = new Float64Array(L), V = new Float64Array(L), Pao = new Float64Array(L), Q = new Float64Array(L), Qm = new Float64Array(L), Pla = new Float64Array(L);
  const br = new Float64Array(K.M), bi = new Float64Array(K.M);
  let v = lv.edv;
  for (let b = 0; b < nb; b++) {
    let ejecting = false, ejDone = false;
    const s0 = b * N;
    for (let k = 0; k < N; k++) {
      const n = s0 + k;
      let pdel = fut[n];
      for (let m = s0; m < n; m++) pdel += K.g[n - m] * Q[m];
      const e = en[k], pp = ped(v), pl = pla(n);
      const piso = e * lv.ees * (v - lv.v0) + (1 - e) * pp;
      const dPdV = e * lv.ees + (1 - e) * pp * lv.a / lv.bsa;
      let qa = 0, qi = 0;
      if (!ejDone) {
        const qTry = (piso - pdel) / (lv.rav + zEff + dPdV * dt + piso * lv.ks);
        if (qTry > 0) { qa = qTry; ejecting = true; } else if (ejecting) ejDone = true;
      }
      if (qa === 0) { const qTry = (pl - piso) / (lv.rmv + dPdV * dt); if (qTry > 0) qi = qTry; }
      v += (qi - qa) * dt;
      Q[n] = qa; Qm[n] = qi; V[n] = v; Pla[n] = pl;
      P[n] = (e * lv.ees * (v - lv.v0) + (1 - e) * ped(v)) * (1 - lv.ks * qa);
      Pao[n] = zEff * qa + pdel;
    }
    if (b < nb - 1) {   // this beat's flow → pressure at all later samples
      br.fill(0); bi.fill(0); for (let k = 0; k < N; k++) br[k] = Q[s0 + k];
      fft(br, bi, false);
      for (let k = 0; k < K.M; k++) { const a = br[k], c = bi[k]; br[k] = a * K.G.re[k] - c * K.G.im[k]; bi[k] = a * K.G.im[k] + c * K.G.re[k]; }
      fft(br, bi, true);
      for (let n = s0 + N; n < L; n++) fut[n] += br[n - s0];
    }
  }
  return { P, V, Pao, Q, Qm, Pla };
}

/** End-systolic points (max P/(V − V0), V0 iterated) and the ESPVR through them. */
function endSystole(loops: { v: number[]; p: number[] }[], v0Start: number, dt: number) {
  let v0 = v0Start, idx: number[] = [], fit: Line = { slope: NaN, v0: NaN, r2: NaN, n: 0 };
  for (let it = 0; it < 30; it++) {
    idx = loops.map(({ v, p }) => {
      let best = 0, bk = 0;
      const kMax = Math.floor(v.length * 0.75);
      for (let k = 1; k < kMax; k++) { const dv = v[k] - v0; if (dv > 1) { const e = p[k] / dv; if (e > best) { best = e; bk = k; } } }
      return bk;
    });
    fit = linFit(idx.map((k, i) => loops[i].v[k]), idx.map((k, i) => loops[i].p[k]));
    if (!Number.isFinite(fit.v0) || Math.abs(fit.v0 - v0) < 0.01) { if (Number.isFinite(fit.v0)) v0 = fit.v0; break; }
    v0 = Math.max(Math.min(fit.v0, Math.min(...loops.map(l => Math.min(...l.v))) - 2), v0Start - 200);
  }
  return { idx, fit, tEs: idx.map(k => k * dt) };
}

function analyse(r: LVResult, R: Run, control: number, nb: number, iso: number[]) {
  const { dt } = r.internal, N = r.internal.en.length;
  const loops: { v: number[]; p: number[] }[] = [];
  for (let b = control - 1; b < nb; b++) {
    const s = b * N;
    loops.push({ v: Array.from(R.V.subarray(s, s + N)), p: Array.from(R.P.subarray(s, s + N)) });
  }
  // the loop starts at the onset of contraction: prepend the previous end-diastolic sample so it closes
  const es = endSystole(loops, r.lvp.v0, dt);
  const beats: VCOBeat[] = loops.map((l, i) => {
    const b = control - 1 + i, s = b * N;
    let sv = 0, ao1 = -Infinity, ao0 = Infinity, dmax = -Infinity, plaFill = 0, nf = 0;
    for (let k = 0; k < N; k++) {
      sv += R.Q[s + k] * dt; ao1 = Math.max(ao1, R.Pao[s + k]); ao0 = Math.min(ao0, R.Pao[s + k]);
      if (k > 0 && k < N - 1) dmax = Math.max(dmax, (l.p[k + 1] - l.p[k - 1]) / (2 * dt));
      if (R.Qm[s + k] > 0) { plaFill += R.Pla[s + k]; nf++; }
    }
    const pre = s > 0 ? s - 1 : 0;   // end-diastole = last sample of the previous beat
    const k = es.idx[i];
    return {
      n: i, pla: nf ? plaFill / nf : R.Pla[s], edv: R.V[pre], edp: R.P[pre],
      esv: l.v[k], esp: l.p[k], tEs: es.tEs[i], sv, lvsp: Math.max(...l.p), dpdtMax: dmax, aoSys: ao1, aoDia: ao0,
      v: [R.V[pre], ...l.v], p: [R.P[pre], ...l.p]
    };
  });
  const isochrones = iso.filter(t => t / dt < N - 1).map(t => {
    const k = Math.round(t / dt), pts = loops.map(l => ({ v: l.v[k], p: l.p[k] }));
    return { t, pts, ...linFit(pts.map(q => q.v), pts.map(q => q.p)) };
  });
  return { beats, espvr: es.fit, isochrones };
}

const vcoCache = new Map<string, VCOResult>();

/** Simulate a vena caval occlusion for a patient with the v3 ventricle (any heart setting is
 *  treated as v3). Returns the loop family, the fitted ESPVR and isochrones. */
export function simulateVCO(p: Params, o: VCOOptions = {}): VCOResult {
  const key = JSON.stringify([p, o]);
  const hit = vcoCache.get(key); if (hit) return hit;
  const control = o.control ?? 3, occ = o.beats ?? 12, nb = control + occ;
  const target = o.dPla == null ? (o.dropPes ?? 25) : NaN;
  const iso = o.isochrones ?? [0.05, 0.1, 0.15, 0.2, 0.25];
  const steady = simulateLV({ ...p, heart: 1 }, lvInputsForPatient({ ...p, heart: 1 }));
  const { en, dt } = steady.internal, N = en.length, T = N * dt, L = nb * N;
  const K = buildKernel(steady, L);
  const pla0 = steady.pla, tau = Math.max(1, occ / 3) * T, nOcc = control * N;
  const go = (dP: number) => {
    const R = run(steady, K, nb, n => n < nOcc ? pla0 : pla0 - dP * (1 - Math.exp(-(n - nOcc) * dt / tau)));
    const A = analyse(steady, R, control, nb, iso);
    return { R, A, drop: A.beats[0].esp - A.beats[A.beats.length - 1].esp };
  };
  let dPla: number, res: ReturnType<typeof go>, reached = true;
  if (o.dPla != null) { dPla = o.dPla; res = go(dPla); }
  else {
    // keep filling pressure ≥ 0.5 mmHg; bisection on ΔP_LA for the requested fall in Pes
    let lo = 0, hi = Math.max(0, pla0 - 0.5);
    const top = go(hi);
    if (top.drop < target) { dPla = hi; res = top; reached = false; }
    else {
      res = top;
      for (let i = 0; i < 18 && hi - lo > 0.01; i++) {
        const mid = (lo + hi) / 2, m = go(mid);
        if (m.drop < target) lo = mid; else { hi = mid; res = m; }
      }
      dPla = hi;
    }
  }
  const { R, A } = res;
  const s0 = (control - 1) * N, tr = { t: [] as number[], beat: [] as number[], plv: [] as number[], vol: [] as number[], pao: [] as number[], qao: [] as number[], qmv: [] as number[], pla: [] as number[] };
  for (let n = s0; n < L; n++) {
    tr.t.push((n - s0) * dt); tr.beat.push(Math.floor((n - s0) / N)); tr.plv.push(R.P[n]); tr.vol.push(R.V[n]);
    tr.pao.push(R.Pao[n]); tr.qao.push(R.Q[n]); tr.qmv.push(R.Qm[n]); tr.pla.push(R.Pla[n]);
  }
  const lv = steady.lvp;
  const out: VCOResult = {
    params: p, lvp: lv, T, dt, pla0, dPla, dropPes: res.drop, target, reached,
    beats: A.beats, espvr: A.espvr, isochrones: A.isochrones,
    eesModel: lv.ees, v0Model: lv.v0,
    edpvr: v => lv.pRef * Math.exp(lv.a * (v / lv.bsa - lv.edviRef)),
    trace: tr, steady
  };
  if (vcoCache.size > 20) vcoCache.clear();
  vcoCache.set(key, out);
  return out;
}

/** Steady-state check: the transient run with no occlusion should repeat the steady beat. */
export function vcoSteadyCheck(p: Params): { svSteady: number; svRun: number; espSteady: number; espRun: number; maxDiffP: number } {
  const steady = simulateLV({ ...p, heart: 1 }, lvInputsForPatient({ ...p, heart: 1 }));
  const N = steady.internal.en.length, nb = 4, K = buildKernel(steady, nb * N);
  const R = run(steady, K, nb, () => steady.pla);
  let svRun = 0, maxDiffP = 0; const s = (nb - 1) * N;
  const Pss = steady.lv, rot = (N - Math.round(steady.tOnset / steady.internal.dt)) % N;   // steady.lv is rotated to ejection origin
  for (let k = 0; k < N; k++) { svRun += R.Q[s + k] * steady.internal.dt; maxDiffP = Math.max(maxDiffP, Math.abs(R.P[s + k] - Pss[(k - rot + N) % N])); }
  return { svSteady: steady.sv, svRun, espSteady: steady.lvesp, espRun: NaN, maxDiffP };
}
