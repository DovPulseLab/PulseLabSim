/* Parameters JSON: export, and schema-checked import. Accepts the v2 format and v1 exports.
   A file with a bad field is rejected (naming the field) and the current state is kept;
   numbers outside a slider range are clamped with a warning. Pure. */
import { ALL_DRUGS, DEFAULTS, DRUGS, PRESETS, type Params, type ParamKey } from '../config/physiology';
import type { DrugEvent } from '../engine/kinetics';
import { checkParams, SLIDER_KEYS } from './inputs';
import type { AppState, PatientId, PatientState } from './types';

export interface ExportFile {
  format: 'pulse-lab';
  version: 2;
  patients: Record<PatientId, { preset: string; inputs: Partial<Params>; events: Omit<DrugEvent, 'id'>[]; effective?: Params }>;
}

export function exportParameters(s: AppState, effective?: Partial<Record<PatientId, Params>>): ExportFile {
  const one = (id: PatientId) => {
    const p = s.patients[id];
    return {
      preset: p.preset,
      inputs: Object.fromEntries(SLIDER_KEYS.map(k => [k, p.inputs[k]])) as Partial<Params>,
      events: p.events.map(({ id: _id, ...rest }) => rest),
      ...(effective?.[id] ? { effective: effective[id] } : {})
    };
  };
  return { format: 'pulse-lab', version: 2, patients: { A: one('A'), B: one('B') } };
}

export type ImportResult =
  | { ok: true; patients: Record<PatientId, PatientState>; warnings: string[] }
  | { ok: false; error: string };

class SchemaError extends Error {}
const fail = (path: string, msg: string): never => { throw new SchemaError(`${path}: ${msg}`); };
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function readInputs(raw: unknown, path: string, preset: string, warnings: string[]): Params {
  if (!isObj(raw)) fail(path, 'expected an object of inputs');
  const obj = raw as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if ((SLIDER_KEYS as string[]).includes(k) && typeof v !== 'number') fail(`${path}.${k}`, `expected a number, got ${JSON.stringify(v)}`);
  }
  const r = checkParams(obj as Partial<Record<ParamKey, unknown>>, { ...DEFAULTS, ...PRESETS[preset] });
  warnings.push(...r.warnings.map(w => `${path}: ${w}`));
  return r.params;
}

function readEvents(raw: unknown, path: string, nextId: () => number): DrugEvent[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) fail(path, 'expected a list of drug events');
  return (raw as unknown[]).map((e, i) => {
    const p = `${path}[${i}]`;
    if (!isObj(e)) fail(p, 'expected an object');
    const ev = e as Record<string, unknown>;
    if (typeof ev.drug !== 'string' || !ALL_DRUGS[ev.drug]) fail(`${p}.drug`, `unknown drug ${JSON.stringify(ev.drug)}`);
    if (ev.mode !== 'bolus' && ev.mode !== 'infusion') fail(`${p}.mode`, 'expected "bolus" or "infusion"');
    if (typeof ev.t0 !== 'number' || !Number.isFinite(ev.t0) || ev.t0 < 0) fail(`${p}.t0`, 'expected a time ≥ 0 in seconds');
    if (ev.tStop != null && (typeof ev.tStop !== 'number' || !Number.isFinite(ev.tStop))) fail(`${p}.tStop`, 'expected a number or null');
    if (ev.dose != null && (typeof ev.dose !== 'number' || !Number.isFinite(ev.dose))) fail(`${p}.dose`, 'expected a number');
    const out: DrugEvent = {
      id: nextId(), drug: ev.drug as string, mode: ev.mode as DrugEvent['mode'], t0: ev.t0 as number,
      tStop: (ev.tStop as number | null | undefined) ?? null, dose: Math.min(2, Math.max(0.25, (ev.dose as number | undefined) ?? 1))
    };
    if (ev.steady === true) { out.steady = true; out.rampS = typeof ev.rampS === 'number' ? Math.max(0, ev.rampS) : 0; }
    return out;
  });
}

function readPreset(raw: unknown, path: string): string {
  if (raw === undefined) return Object.keys(PRESETS)[0];
  if (typeof raw !== 'string' || !(raw in PRESETS)) fail(path, `unknown profile ${JSON.stringify(raw)}`);
  return raw as string;
}

/** Validate a parsed or raw JSON file. */
export function importParameters(input: unknown, t = 0): ImportResult {
  const warnings: string[] = [];
  let id = 1;
  const nextId = () => id++;
  try {
    let data = input;
    if (typeof input === 'string') {
      try { data = JSON.parse(input); } catch { fail('file', 'is not valid JSON'); }
    }
    if (!isObj(data)) fail('file', 'expected a JSON object');
    const d = data as Record<string, unknown>;
    const patients = {} as Record<PatientId, PatientState>;
    if (d.format === 'pulse-lab') {
      if (d.version !== 2) fail('version', `expected 2, got ${JSON.stringify(d.version)}`);
      if (!isObj(d.patients)) fail('patients', 'expected an object with A and B');
      const ps = d.patients as Record<string, unknown>;
      for (const pid of ['A', 'B'] as PatientId[]) {
        const raw = ps[pid];
        if (!isObj(raw)) fail(`patients.${pid}`, 'missing or not an object');
        const r = raw as Record<string, unknown>;
        const preset = readPreset(r.preset, `patients.${pid}.preset`);
        patients[pid] = { preset, inputs: readInputs(r.inputs, `patients.${pid}.inputs`, preset, warnings), events: readEvents(r.events, `patients.${pid}.events`, nextId) };
      }
    } else if (isObj(d.A) && isObj(d.B)) {
      // v1 export: { A: { preset, patient, drugs, effective }, B: … }
      for (const pid of ['A', 'B'] as PatientId[]) {
        const r = d[pid] as Record<string, unknown>;
        const preset = readPreset(r.preset, `${pid}.preset`);
        const inputs = readInputs(r.patient, `${pid}.patient`, preset, warnings);
        if (r.drugs !== undefined && !Array.isArray(r.drugs)) fail(`${pid}.drugs`, 'expected a list of drug names');
        const drugs = (r.drugs as unknown[] | undefined) ?? [];
        drugs.forEach((k, i) => { if (typeof k !== 'string' || !DRUGS[k]) fail(`${pid}.drugs[${i}]`, `unknown drug ${JSON.stringify(k)}`); });
        // v1 drugs become steady-state events, which give exactly the v1 effect
        patients[pid] = { preset, inputs, events: (drugs as string[]).map(k => ({ id: nextId(), drug: k, mode: 'infusion' as const, t0: t, tStop: null, dose: 1, steady: true, rampS: 0 })) };
      }
    } else {
      fail('format', 'not a Pulse Lab parameters file (expected "format": "pulse-lab")');
    }
    return { ok: true, patients, warnings };
  } catch (e) {
    if (e instanceof SchemaError) return { ok: false, error: `Import rejected — ${e.message}. Current settings kept.` };
    throw e;
  }
}
