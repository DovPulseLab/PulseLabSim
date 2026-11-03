/* Clamp and check user inputs from sliders, typed boxes, URLs and imported files. Never NaN. */
import { ALL_CONTROLS, DEFAULTS, type Params, type ParamKey } from '../config/physiology';

export const SLIDER_KEYS = ALL_CONTROLS.map(c => c.key);
const BY_KEY = Object.fromEntries(ALL_CONTROLS.map(c => [c.key, c]));

export interface Checked { value: number; warning: string | null; }

/** Clamp one input to its slider range; non-numbers fall back to the default. */
export function checkInput(key: ParamKey, raw: unknown): Checked {
  const c = BY_KEY[key];
  const v = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    return { value: DEFAULTS[key], warning: `${c ? c.label : key}: "${String(raw)}" is not a number; using the default ${DEFAULTS[key]}` };
  }
  if (!c) return { value: v, warning: null };
  if (v < c.min) return { value: c.min, warning: `${c.label} ${v} is below the minimum; set to ${c.min} ${c.unit}`.trim() };
  if (v > c.max) return { value: c.max, warning: `${c.label} ${v} is above the maximum; set to ${c.max} ${c.unit}`.trim() };
  return { value: v, warning: null };
}

/** One slider step up or down, clamped. */
export function stepInput(key: ParamKey, value: number, dir: 1 | -1): number {
  const c = BY_KEY[key];
  const n = Math.round((value + dir * c.step) / c.step) * c.step;
  return Number(Math.min(c.max, Math.max(c.min, n)).toFixed(6));
}

/** Check every slider input of a (partial) parameter set; others keep defaults. */
export function checkParams(raw: Partial<Record<ParamKey, unknown>>, base: Params = DEFAULTS): { params: Params; warnings: string[] } {
  const params: Params = { ...base };
  const warnings: string[] = [];
  for (const key of SLIDER_KEYS) {
    if (!(key in raw)) continue;
    const r = checkInput(key, raw[key]);
    params[key] = r.value;
    if (r.warning) warnings.push(r.warning);
  }
  return { params, warnings };
}
