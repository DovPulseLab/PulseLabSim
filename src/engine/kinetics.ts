/* Drug events on a timeline with first-order onset and offset.
   Doses of one drug add into one exposure that saturates (Emax); different drugs
   combine in log space (factor^E multiplied), additions scale with E, then inputs are clamped to the slider ranges. Phenylephrine adds a
   baroreflex fall in HR. All pure. */
import {
  ALL_CONTROLS, ALL_DRUGS, BAROREFLEX, DRUG_EMAX, DRUG_KINETICS, MODEL,
  type DrugMode, type Params, type ParamKey
} from '../config/physiology';
import { derive } from '../model/derive';

export interface DrugEvent {
  id: number;
  drug: string;
  mode: DrugMode;
  t0: number;               // s, clock time given
  tStop: number | null;     // s, infusion stopped (null = running)
  dose: number;             // multiplier on the full effect, 0.25–2
  /** start at full (steady-state) effect, eased in over rampS seconds */
  steady?: boolean;
  rampS?: number;
}

const ease = (x: number) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, x)))) / 2;

/** Bolus shape (Bateman function) normalised to a peak of 1. */
function bolusShape(s: number, tauOn: number, tauOff: number): number {
  if (s <= 0) return 0;
  if (Math.abs(tauOn - tauOff) < 1e-9) { const x = s / tauOn; return x * Math.exp(1 - x); }
  const a = 1 / tauOn, b = 1 / tauOff;                  // rise and fall rates
  const tPeak = Math.log(a / b) / (a - b);
  const f = (t: number) => Math.exp(-b * t) - Math.exp(-a * t);
  return f(s) / f(tPeak);
}

/** Effect level E(t) of one event, before dose (0 … 1). */
export function effectLevel(ev: DrugEvent, t: number): number {
  const k = DRUG_KINETICS[ev.drug];
  if (!k) throw new Error(`No kinetics for drug "${ev.drug}"`);
  if (t < ev.t0) return 0;
  if (ev.mode === 'bolus') return bolusShape(t - ev.t0, k.tauOn, k.tauOff);
  const on = (s: number) => ev.steady
    ? (ev.rampS && ev.rampS > 0 ? ease(s / ev.rampS) : 1)
    : 1 - Math.exp(-s / k.tauOn);
  if (ev.tStop == null || t <= ev.tStop) return on(t - ev.t0);
  const atStop = on(ev.tStop - ev.t0);
  return atStop * Math.exp(-(t - ev.tStop) / k.tauOff);
}

/** Combined effect of all doses of one drug (exposure C) — saturates at Emax. */
export function emaxEffect(c: number, emax: number = DRUG_EMAX.emax): number {
  if (c <= 0) return 0;
  if (c === 1) return 1;                       // one full dose = exactly the v1 effect
  return emax * c / ((emax - 1) + c);
}

export interface DrugLevel {
  drug: string;
  ids: number[];            // events contributing
  exposure: number;         // C: sum of dose levels (1 = one standard dose at full effect)
  effect: number;           // E after saturation; 1 = one dose's full effect, max 1.2
}

export interface EffectResult {
  params: Params;
  /** one combined entry per drug, in order of first dose */
  levels: DrugLevel[];
  reflexBpm: number;        // baroreflex HR change (≤ 0)
  clamped: ParamKey[];      // inputs held at a slider limit
}

const RANGE: Partial<Record<ParamKey, [number, number]>> =
  Object.fromEntries(ALL_CONTROLS.map(c => [c.key, [c.min, c.max] as [number, number]]));

/** Multiply/add each drug's combined effect onto the inputs (no clamping). */
function combine(base: Params, levels: DrugLevel[]): Params {
  const p: Params = { ...base };
  for (const { drug, effect: e } of levels) {
    if (e === 0) continue;
    const fx = ALL_DRUGS[drug].fx;
    // e = 1 gives exactly the v1 factor (x^1 = x), so steady state matches v1 applyDrugs
    const pow = (f: number) => (e === 1 ? f : Math.pow(f, e));
    if (fx.radius) p.radius *= pow(fx.radius);
    if (fx.cMus) p.cMus *= pow(fx.cMus);
    if (fx.cAo) p.cAo *= pow(fx.cAo);
    if (fx.gamma) p.gamma *= pow(fx.gamma);
    if (fx.hrAdd) p.hr += fx.hrAdd * e;
    if (fx.svAdd) p.sv += fx.svAdd * e;
  }
  p.gamma = Math.min(MODEL.gammaMax, p.gamma);
  return p;
}

function clampToRanges(p: Params): ParamKey[] {
  const hit: ParamKey[] = [];
  for (const [k, r] of Object.entries(RANGE) as [ParamKey, [number, number]][]) {
    if (p[k] < r[0]) { p[k] = r[0]; hit.push(k); } else if (p[k] > r[1]) { p[k] = r[1]; hit.push(k); }
  }
  return hit;
}

/** Group events by drug: exposure = sum of dose levels, effect = Emax curve of exposure. */
export function drugLevels(events: readonly DrugEvent[], t: number): DrugLevel[] {
  const by = new Map<string, DrugLevel>();
  for (const ev of events) {
    const c = effectLevel(ev, t) * ev.dose;
    const g = by.get(ev.drug) ?? { drug: ev.drug, ids: [], exposure: 0, effect: 0 };
    g.ids.push(ev.id); g.exposure += c;
    by.set(ev.drug, g);
  }
  for (const g of by.values()) g.effect = emaxEffect(g.exposure);
  return [...by.values()];
}

/** Inputs at clock time t with every drug event applied. */
export function applyDrugEffects(base: Params, events: readonly DrugEvent[], t: number): EffectResult {
  const levels = drugLevels(events, t);
  const params = combine(base, levels);
  let reflexBpm = 0;
  if (levels.some(l => l.drug === BAROREFLEX.drug && l.effect > 0)) {
    const without = combine(base, levels.filter(l => l.drug !== BAROREFLEX.drug));
    const rise = derive(params).map - derive(without).map;
    reflexBpm = -Math.min(BAROREFLEX.maxFall, BAROREFLEX.bpmPerMmHg * Math.max(0, rise));
    params.hr += reflexBpm;
  }
  const clamped = clampToRanges(params);
  return { params, levels, reflexBpm, clamped };
}
