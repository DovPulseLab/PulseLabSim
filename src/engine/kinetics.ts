/* Drug events on a timeline with first-order onset and offset.
   Doses of one drug add into one exposure that saturates (Emax); different drugs
   combine in log space (factor^E multiplied), additions scale with E, then inputs are clamped to the slider ranges. Phenylephrine adds a
   baroreflex fall in HR. HR falls caused by acute drugs raise SV slightly (illustrative). All pure. */
import {
  ALL_CONTROLS, ALL_DRUGS, BAROREFLEX, DRUG_EMAX, DRUG_KINETICS, MODEL, RESPONSE, SV_HR_COUPLING, baroFraction, exerciseMapSlope, exerciseSvFactor,
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
  svRise: number;           // illustrative SV rise from a drug-induced HR fall (mL, ≥ 0)
  clamped: ParamKey[];      // inputs held at a slider limit
  /** what the physiologic response mode changed (null in Independent mode) */
  response: ResponseEffect | null;
}

export interface ResponseEffect {
  mode: number;
  svFactor: number;         // effective SV ÷ SV slider
  svrFactor: number;        // effective SVR ÷ SVR before the response
  mapOpen: number;          // MAP after the heart-rate relation, with drugs, before any baroreflex (mmHg)
  mapSet: number;           // MAP the heart-rate relation gives without drugs (baroreflex target) (mmHg)
}

/** SVR scale ↔ arteriolar radius (SVR ∝ radius⁻⁴). */
const radiusForSvr = (radius: number, svrFactor: number) => radius * Math.pow(svrFactor, -0.25);

/** Physiologic response (Params.resp), applied after drugs. `base` = the user's inputs (no drugs).
 *  The couplings follow the heart rate the user set (base.hr: the pacing rate or exercise intensity);
 *  heart-rate changes caused by drugs keep each drug's own SV effect, so pharmacology is not
 *  double-counted. All constants are from human data (RESPONSE, Methods §13). x = base.hr − hrRest.
 *  1 Pacing: CO × (1 + 0.033 %·x) (Ross 1965), MAP × (1 + 0.32 %·x) (Lazim 2025) → SV and SVR set to match.
 *  2 Exercise (x > 0): SV × exerciseSvFactor(x) (Pandey 2020), MAP × (1 + 0.21 %·x) (Wheatley) → SVR to match.
 *  3 Physiologic: the pacing relation, plus baroreflex buffering of the MAP change caused by drugs:
 *    SVR × (MAP without drugs / MAP with drugs)^f, f = baroFraction(sex, age) (Jones 2003; Christou 2003, 2005). */
export function applyResponse(params: Params, base: Params, hasDrugs = true): ResponseEffect | null {
  const mode = Math.round(params.resp);
  if (mode === 0) return null;
  const hrSet = Math.max(1, base.hr), hr0 = params.hrRest, x = hrSet - hr0;
  let svFactor = 1, svrFactor = 1, mapSet = NaN;
  if (mode === 1 || mode === 3) {
    const coRatio = Math.max(0.5, 1 + RESPONSE.pacingCoPerBpm * x);
    const mapRatio = Math.max(0.5, 1 + RESPONSE.pacingMapPerBpm * x);
    svFactor = coRatio * hr0 / hrSet;
    svrFactor = mapRatio / coRatio;
  } else if (mode === 2 && x > 0) {
    svFactor = exerciseSvFactor(x);
    const mapRatio = 1 + exerciseMapSlope * x;
    svrFactor = mapRatio / (svFactor * hrSet / hr0);
  }
  params.sv *= svFactor;
  params.radius = radiusForSvr(params.radius, svrFactor);
  const mapOpen = derive(params).map;
  // MAP the HR relation alone aims for (no drugs), shown in the rail
  const noDrug: Params = { ...base, sv: base.sv * svFactor, radius: radiusForSvr(base.radius, svrFactor) };
  mapSet = derive(noDrug).map;
  if (mode === 3 && hasDrugs) {
    const f = baroFraction(params.sex, params.age);
    const k = Math.pow(mapSet / mapOpen, f);
    params.radius = radiusForSvr(params.radius, k);
    svrFactor *= k;
  }
  return { mode, svFactor, svrFactor, mapOpen, mapSet };
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
  // illustrative SV rise for HR falls caused by acute drugs (incl. the baroreflex);
  // v1 long-term drugs keep their exact v1 effects
  const hrBefore = combine(base, levels.filter(l => DRUG_KINETICS[l.drug]?.chronic)).hr;
  const [hrMin, hrMax] = RANGE.hr!;
  const hrAfter = Math.min(hrMax, Math.max(hrMin, params.hr));
  const hrRef = Math.min(hrMax, Math.max(hrMin, hrBefore));
  let svRise = 0;
  if (hrAfter < hrRef - 1e-9) {
    const sv0 = params.sv;
    params.sv *= Math.pow(hrRef / hrAfter, SV_HR_COUPLING.exponent);
    svRise = params.sv - sv0;
  }
  const response = applyResponse(params, base, levels.some(l => l.effect > 0));
  const clamped = clampToRanges(params);
  return { params, levels, reflexBpm, svRise, clamped, response };
}
