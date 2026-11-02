/* Shareable state in the URL hash, versioned v=2. Pure.
   Example: #v=2&tab=sim&pt=A&t=95.2&w=1&p=0&A=0_h70_s72_e1_r100_a7.5_d2.8_m9_g0.45_l1_H175
            &Ad=ntg~i~60~~1&B=3_...&pin=A_h70_...
   Inputs: preset index then key+value pairs; events: drug~mode~t0~tStop~dose[~s] joined by "_". */
import { ALL_DRUGS, DEFAULTS, ENGINE, PRESETS, type Params, type ParamKey } from '../config/physiology';
import type { DrugEvent } from '../engine/kinetics';
import { checkParams, SLIDER_KEYS } from './inputs';
import { defaultState, TABS, type AppState, type PatientId, type PatientState, type TabId } from './types';

const SHORT: Record<string, string> = {
  hr: 'h', sv: 's', etScale: 'e', radius: 'r', cAo: 'a', diam: 'd', cMus: 'm', gamma: 'g', lpScale: 'l', height: 'H'
};
const LONG: Record<string, ParamKey> = Object.fromEntries(Object.entries(SHORT).map(([k, v]) => [v, k as ParamKey]));
const PRESET_NAMES = Object.keys(PRESETS);
const MODE = { bolus: 'b', infusion: 'i' } as const;

const num = (v: number) => String(Number(v.toFixed(6)));

function encodeParams(p: Params): string {
  return SLIDER_KEYS.map(k => SHORT[k] + num(p[k])).join('_');
}

function encodeEvents(evs: DrugEvent[]): string {
  return evs.map(e => [e.drug, MODE[e.mode], num(e.t0), e.tStop == null ? '' : num(e.tStop), num(e.dose),
    e.steady ? 's' + num(e.rampS ?? 0) : ''].join('~').replace(/~$/, '')).join('_');
}

export function encodeState(s: AppState): string {
  const q = new URLSearchParams();
  q.set('v', '2');
  q.set('tab', s.tab);
  q.set('pt', s.active);
  q.set('t', num(s.t));
  q.set('w', String(s.warp));
  q.set('p', s.paused ? '1' : '0');
  for (const id of ['A', 'B'] as PatientId[]) {
    const pt = s.patients[id];
    q.set(id, `${Math.max(0, PRESET_NAMES.indexOf(pt.preset))}_${encodeParams(pt.inputs)}`);
    if (pt.events.length) q.set(id + 'd', encodeEvents(pt.events));
  }
  if (s.pinned) q.set('pin', `${s.pinned.patient}_${encodeParams(s.pinned.params)}`);
  // keep "~" readable; URLSearchParams escapes it otherwise
  return '#' + q.toString().replace(/%7E/g, '~');
}

export interface DecodeResult {
  state: AppState;
  warnings: string[];
  /** set when the hash could not be used at all; state is then the defaults */
  error: string | null;
}

class HashError extends Error {}

function decodeParams(text: string, base: Params, warnings: string[], where: string): Params {
  const raw: Partial<Record<ParamKey, unknown>> = {};
  for (const part of text.split('_')) {
    if (!part) continue;
    const m = /^([a-zA-Z])(.*)$/.exec(part);
    if (!m || !LONG[m[1]]) { warnings.push(`${where}: ignored unknown value "${part}"`); continue; }
    raw[LONG[m[1]]] = m[2];
  }
  const r = checkParams(raw, base);
  warnings.push(...r.warnings.map(w => `${where}: ${w}`));
  return r.params;
}

function decodeEvents(text: string, startId: number, warnings: string[], where: string): DrugEvent[] {
  const out: DrugEvent[] = [];
  let id = startId;
  for (const part of text.split('_')) {
    if (!part) continue;
    const [drug, mode, t0, tStop, dose, steady] = part.split('~');
    const m = mode === 'b' ? 'bolus' : mode === 'i' ? 'infusion' : null;
    const nT0 = Number(t0), nStop = tStop ? Number(tStop) : null, nDose = dose ? Number(dose) : 1;
    if (!ALL_DRUGS[drug] || !m || !Number.isFinite(nT0) || (nStop != null && !Number.isFinite(nStop)) || !Number.isFinite(nDose)) {
      warnings.push(`${where}: ignored drug event "${part}"`);
      continue;
    }
    const ev: DrugEvent = { id: id++, drug, mode: m, t0: nT0, tStop: nStop, dose: Math.min(2, Math.max(0.25, nDose)) };
    if (steady && steady[0] === 's') { ev.steady = true; ev.rampS = Math.max(0, Number(steady.slice(1)) || 0); }
    out.push(ev);
  }
  return out;
}

export function decodeHash(hash: string): DecodeResult {
  const text = hash.replace(/^#/, '');
  const warnings: string[] = [];
  if (!text) return { state: defaultState(), warnings, error: null };
  try {
    const q = new URLSearchParams(text);
    const v = q.get('v');
    if (v !== '2') throw new HashError(v ? `link version "${v}" is not supported` : 'link has no version');
    const s = defaultState();
    const tab = q.get('tab');
    if (tab) { if ((TABS as readonly string[]).includes(tab)) s.tab = tab as TabId; else warnings.push(`unknown tab "${tab}"`); }
    const pt = q.get('pt');
    if (pt === 'A' || pt === 'B') s.active = pt;
    const t = Number(q.get('t') ?? 0);
    s.t = Number.isFinite(t) && t >= 0 ? t : 0;
    const w = Number(q.get('w') ?? 1);
    s.warp = (ENGINE.warps as readonly number[]).includes(w) ? (w as AppState['warp']) : 1;
    s.paused = q.get('p') === '1';
    let nextId = 1;
    for (const id of ['A', 'B'] as PatientId[]) {
      const enc = q.get(id);
      if (enc) {
        const [idx, ...rest] = enc.split('_');
        const i = Number(idx);
        const preset = Number.isInteger(i) && i >= 0 && i < PRESET_NAMES.length ? PRESET_NAMES[i] : PRESET_NAMES[0];
        const base: Params = { ...DEFAULTS, ...PRESETS[preset] };
        const p: PatientState = { preset, inputs: decodeParams(rest.join('_'), base, warnings, `patient ${id}`), events: [] };
        s.patients[id] = p;
      }
      const evs = q.get(id + 'd');
      if (evs) {
        s.patients[id].events = decodeEvents(evs, nextId, warnings, `patient ${id}`);
        nextId += s.patients[id].events.length;
      }
    }
    s.nextEventId = nextId;
    const pin = q.get('pin');
    if (pin) {
      const [who, ...rest] = pin.split('_');
      if (who === 'A' || who === 'B') s.pinned = { patient: who, params: decodeParams(rest.join('_'), DEFAULTS, warnings, 'pinned baseline') };
      else warnings.push('ignored a malformed pinned baseline');
    }
    return { state: s, warnings, error: null };
  } catch (e) {
    const msg = e instanceof HashError ? e.message : 'link could not be read';
    return { state: defaultState(), warnings: [], error: `${msg}; showing the default patients instead.` };
  }
}
