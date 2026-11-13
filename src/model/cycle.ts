/* =====================================================================
   Cardiac cycle (Wiggers diagram) for one simulated beat. Pure.

   Modelled (from the simulator): aortic pressure, aortic flow, ejection
   time, heart rate, stroke volume, LVEDP.
   Schematic (typical healthy-adult values, not modelled by the arterial
   solver): LV and left-atrial pressure outside ejection, LV volume during
   filling, the ECG and heart sounds. They are built to be consistent with
   the modelled beat: the aortic valve opens when LV pressure reaches
   aortic DBP and closes at the end of ejection; LV volume falls by exactly
   the stroke volume during ejection.

   Display time 0 = QRS onset; one cycle = 60/HR s.
   ===================================================================== */
import type { BeatResult } from './solve';

export const CYCLE = {
  qrsToMC: 0.050,        // s, QRS onset → mitral closure (electromechanical delay)
  ivct: 0.045,           // s, isovolumic contraction (normal ≈ 30–60 ms)
  tauLV: 0.040,          // s, LV isovolumic relaxation time constant (normal ≈ 35–50 ms)
  ef: 0.60,              // ejection fraction for the schematic volume curve
  gradPeak: 4,           // mmHg, peak LV–aortic ejection gradient (normal ≈ 3–6)
  gradInertial: 3,       // mmHg, late-ejection gradient reversal from flow deceleration
  laBase: -1,            // mmHg vs LVEDP: LA pressure during diastasis
  aWave: 3,              // mmHg above LVEDP at the a-wave peak
  vWave: 5,              // mmHg above LVEDP at the v-wave peak
  atrialFrac: 0.22,      // share of filling from atrial contraction (≈ 20–25 % at rest)
  atrialS: 0.10,         // s, mechanical atrial systole before mitral closure
  pToQRS: 0.140,         // s, P-wave peak before the next QRS onset
  rapidTau: 0.06         // s, time constant of early rapid filling
} as const;

export type PhaseId = 'ivc' | 'ejRapid' | 'ejReduced' | 'ivr' | 'fillRapid' | 'diastasis' | 'atrial';
export interface Phase { id: PhaseId; label: string; short: string; t0: number; t1: number; systole: boolean; }
export interface CycleEvent { id: 'MC' | 'AO' | 'AC' | 'MO'; label: string; t: number; }

export interface Cycle {
  T: number; dt: number; n: number;
  t: number[];                 // s, display time
  ao: number[]; lv: number[]; la: number[];   // mmHg
  q: number[];                 // mL/s, aortic flow
  vol: number[];               // mL, LV volume
  ecg: number[];               // arbitrary units, 0 = baseline, R = 1
  phases: Phase[];
  events: CycleEvent[];
  sounds: { s1: number; s2: number };
  edv: number; esv: number; sv: number; lvedp: number;
  /** display time of model index 0 (start of ejection) */
  tAO: number; tAC: number; tMC: number; tMO: number;
  /** LV relaxation time constant used (s); shorter than CYCLE.tauLV only when diastole is very short */
  tauIVR: number;
  /** true when LV pressure, volume and valve timing come from the v3 ventricle model (not schematic) */
  modelled: boolean;
}

const smooth = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };
const gauss = (t: number, c: number, w: number) => Math.exp(-0.5 * ((t - c) / w) ** 2);
/** periodic distance from t to c on a cycle of length T */
const pd = (t: number, c: number, T: number) => { let d = (t - c) % T; if (d > T / 2) d -= T; if (d < -T / 2) d += T; return d; };

export function buildCycle(r: BeatResult, n = Math.max(300, Math.round(r.d.T / 0.001))): Cycle {
  const T = r.d.T, ET = r.d.ET, N = r.p.length, mdt = r.dt;
  const model = r.lv && Number.isFinite(r.m.ivct) ? r.lv : null;
  const lvedp = model ? r.m.lvEDP : r.params.lvedp, sv = r.params.sv;
  const dt = T / n;
  const tMC = CYCLE.qrsToMC, tAO = tMC + (model ? r.m.ivct / 1000 : CYCLE.ivct), tAC = tAO + ET;
  // aortic pressure at display time t (model time 0 = start of ejection)
  const aoAt = (t: number) => {
    let tm = (t - tAO) % T; if (tm < 0) tm += T;
    const x = tm / mdt, k = Math.floor(x) % N, f = x - Math.floor(x);
    return r.p[k] * (1 - f) + r.p[(k + 1) % N] * f;
  };
  const qAt = (t: number) => {
    let tm = (t - tAO) % T; if (tm < 0) tm += T;
    if (tm > ET) return 0;
    const x = tm / mdt, k = Math.min(N - 2, Math.floor(x)), f = x - k;
    return Math.max(0, r.q[k] * (1 - f) + r.q[k + 1] * f);
  };
  const pd0 = aoAt(tAO), pes = aoAt(tAC);
  // mitral opening: relaxing LV falls to the v-wave LA pressure
  const laPeak = lvedp + CYCLE.vWave;
  const diastole = T - tAC + tMC;
  const drop = Math.log(Math.max(1.01, pes / laPeak));
  const ivrt = model ? r.m.ivrt / 1000 : Math.min(CYCLE.tauLV * drop, 0.45 * diastole);
  // at very short diastole IVR is squeezed: relax faster so LV still meets LA pressure at mitral opening
  const tauIVR = model ? r.m.tauLV / 1000 : ivrt / drop;
  const tMO = tAC + ivrt;
  const fillDur = T + tMC - tMO;
  const tAtrial = T + tMC - Math.min(CYCLE.atrialS, 0.35 * fillDur);   // start of atrial systole (display, may exceed T−…)

  // flow peak and its derivative scale for the ejection gradient
  let qpk = 1e-9, dqMax = 1e-9;
  for (let k = 0; k < N - 1 && k * mdt <= ET; k++) { qpk = Math.max(qpk, r.q[k]); dqMax = Math.max(dqMax, -(r.q[k + 1] - r.q[k]) / mdt); }

  const edv = model ? r.m.edv : sv / CYCLE.ef, esv = model ? r.m.esv : edv - sv;
  const t: number[] = [], ao: number[] = [], lv: number[] = [], la: number[] = [], q: number[] = [], vol: number[] = [], ecg: number[] = [];
  let ejected = 0;
  // filling fractions: passive part approaches (1 − atrialFrac) exponentially, then the atrial kick
  const passive = (s: number) => (1 - CYCLE.atrialFrac) * (1 - Math.exp(-s / CYCLE.rapidTau)) / (1 - Math.exp(-(tAtrial - tMO) / CYCLE.rapidTau));
  for (let i = 0; i <= n; i++) {
    const ti = i * dt; t.push(ti);
    const a = aoAt(ti), qi = qAt(ti);
    ao.push(a); q.push(qi);
    // time since mitral opening, on the wrapped cycle (filling runs tMO → T + tMC)
    const sFill = ti >= tMO ? ti - tMO : ti + T - tMO;
    let p: number;
    if (ti >= tMC && ti < tAO) {
      p = lvedp + (pd0 - lvedp) * smooth((ti - tMC) / CYCLE.ivct);                    // isovolumic contraction
    } else if (ti >= tAO && ti <= tAC) {
      const k = Math.min(N - 2, Math.floor((ti - tAO) / mdt));
      const dq = (r.q[k + 1] - r.q[k]) / mdt;
      // resistive part ∝ flow; inertial part only while flow decelerates, so the gradient
      // reverses late in ejection (LV falls just below aortic pressure)
      p = a + CYCLE.gradPeak * qi / qpk + CYCLE.gradInertial * Math.min(0, dq) / dqMax;    // ejection
    } else if (ti > tAC && ti < tMO) {
      p = pes * Math.exp(-(ti - tAC) / tauIVR);                                          // isovolumic relaxation
    } else {
      // filling: dip below LVEDP early, then rise; atrial contraction brings it to LVEDP at mitral closure
      // continues the relaxation fall below LA pressure (suction), then rises slowly
      const lo = lvedp - 4;
      const base = lo + 2 * (1 - Math.exp(-sFill / 0.15)) + (laPeak - lo) * Math.exp(-sFill / 0.025);
      const atr = (sFill + tMO) >= tAtrial ? smooth((sFill + tMO - tAtrial) / (T + tMC - tAtrial)) : 0;
      p = base + (lvedp - base) * atr;
    }
    lv.push(p);
    // left atrium: a wave, x descent, v wave peaking at mitral opening, y descent
    const aW = CYCLE.aWave * gauss(pd(ti, T + tMC - 0.04, T), 0, 0.035);
    const vRise = ti >= tMC && ti <= tMO ? (lvedp + CYCLE.laBase) + (laPeak - (lvedp + CYCLE.laBase)) * smooth((ti - tMC) / (tMO - tMC)) : NaN;
    const yDesc = (lvedp + CYCLE.laBase) + (laPeak - (lvedp + CYCLE.laBase)) * Math.exp(-sFill / 0.07);
    la.push(Number.isNaN(vRise) ? yDesc + aW : vRise + aW);
    // LV volume
    if (ti >= tAO && ti <= tAC) { if (i > 0) ejected += (qi + q[i - 1]) / 2 * dt; vol.push(edv - Math.min(sv, ejected)); }
    else if (ti > tAC && ti < tMO) vol.push(esv);
    else if (ti >= tMC && ti < tAO) vol.push(edv);
    else {
      const tt = sFill + tMO;   // display time on the unwrapped filling axis
      const pas = Math.min(1 - CYCLE.atrialFrac, passive(Math.min(sFill, tAtrial - tMO)));
      const atr = tt >= tAtrial ? CYCLE.atrialFrac * smooth((tt - tAtrial) / (T + tMC - tAtrial)) : 0;
      vol.push(esv + sv * (pas + atr));
    }
    // ECG (schematic): P, QRS, T
    const e = 0.15 * gauss(pd(ti, T - CYCLE.pToQRS, T), 0, 0.022)
      - 0.10 * gauss(pd(ti, 0.012, T), 0, 0.006) + 1.0 * gauss(pd(ti, 0.035, T), 0, 0.009) - 0.22 * gauss(pd(ti, 0.058, T), 0, 0.008)
      + 0.30 * gauss(pd(ti, tAC - 0.05, T), 0, 0.045);
    ecg.push(e);
  }
  // rescale ejected volume so it equals SV exactly (trapezoid error on the display grid)
  const scale = ejected > 0 ? sv / ejected : 1;
  ejected = 0;
  for (let i = 0; i <= n; i++) {
    const ti = t[i];
    if (ti >= tAO && ti <= tAC) { if (i > 0 && t[i - 1] >= tAO) ejected += (q[i] + q[i - 1]) / 2 * dt * scale; vol[i] = edv - ejected; }
  }

  if (model) {
    // v3: LV pressure and volume from the ventricle model (model time 0 = aortic valve opening)
    const at = (y: number[], ti: number) => { let tm = (ti - tAO) % T; if (tm < 0) tm += T; const x = tm / mdt, k = Math.floor(x) % N, f = x - Math.floor(x); return y[k] * (1 - f) + y[(k + 1) % N] * f; };
    for (let i = 0; i <= n; i++) { lv[i] = at(model.p, t[i]); vol[i] = at(model.vol, t[i]); }
  }

  const ejMid = tAO + ET * 0.4;
  const fillEnd = Math.min(tAtrial, tMO + 3 * CYCLE.rapidTau);
  // phases on the unwrapped axis (mitral closure → next mitral closure), then wrapped into [0, T)
  const unwrapped: Phase[] = [
    { id: 'ivc', label: 'Isovolumic contraction', short: 'IVC', t0: tMC, t1: tAO, systole: true },
    { id: 'ejRapid', label: 'Rapid ejection', short: 'Rapid ej.', t0: tAO, t1: ejMid, systole: true },
    { id: 'ejReduced', label: 'Reduced ejection', short: 'Reduced ej.', t0: ejMid, t1: tAC, systole: true },
    { id: 'ivr', label: 'Isovolumic relaxation', short: 'IVR', t0: tAC, t1: tMO, systole: false },
    { id: 'fillRapid', label: 'Rapid filling', short: 'Rapid fill', t0: tMO, t1: fillEnd, systole: false },
    { id: 'diastasis', label: 'Diastasis (slow filling)', short: 'Diastasis', t0: fillEnd, t1: tAtrial, systole: false },
    { id: 'atrial', label: 'Atrial systole', short: 'Atrial', t0: tAtrial, t1: T + tMC, systole: false }
  ];
  const phases: Phase[] = [];
  for (const ph of unwrapped) {
    if (ph.t1 - ph.t0 <= 1e-6) continue;
    if (ph.t1 <= T) phases.push(ph);
    else if (ph.t0 >= T) phases.push({ ...ph, t0: ph.t0 - T, t1: ph.t1 - T });
    else { phases.push({ ...ph, t1: T }); phases.push({ ...ph, t0: 0, t1: ph.t1 - T }); }
  }
  phases.sort((a, b) => a.t0 - b.t0);
  const events: CycleEvent[] = [
    { id: 'MC', label: 'Mitral valve closes', t: tMC },
    { id: 'AO', label: 'Aortic valve opens', t: tAO },
    { id: 'AC', label: 'Aortic valve closes', t: tAC },
    { id: 'MO', label: 'Mitral valve opens', t: tMO }
  ];
  return { T, dt, n, t, ao, lv, la, q, vol, ecg, phases, events, sounds: { s1: tMC, s2: tAC }, edv, esv, sv, lvedp, tAO, tAC, tMC, tMO, tauIVR, modelled: !!model };
}

/** Phase at a display time. */
export function phaseAt(c: Cycle, time: number): Phase {
  const tt = ((time % c.T) + c.T) % c.T;
  return c.phases.find(p => tt >= p.t0 && tt < p.t1) ?? c.phases[c.phases.length - 1];
}

/** Sample index nearest a display time. */
export const indexAt = (c: Cycle, time: number): number =>
  Math.min(c.n, Math.max(0, Math.round((((time % c.T) + c.T) % c.T) / c.dt)));
