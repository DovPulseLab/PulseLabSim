/* "What differs" between two patients: change each differing input from A to B
   one at a time and measure its effect on central SBP. Pure. */
import { ALL_CONTROLS, type Params, type ParamKey } from '../config/physiology';
import { simulate } from './solve';

export interface Contribution { key: ParamKey; label: string; a: number; b: number; dSBP: number; }

export function sbpContributions(a: Params, b: Params): { total: number; items: Contribution[] } {
  const base = simulate(a).m.Ps;
  const items: Contribution[] = [];
  for (const c of ALL_CONTROLS) {
    if (Math.abs(a[c.key] - b[c.key]) <= 1e-9) continue;
    const one = simulate({ ...a, [c.key]: b[c.key] }).m.Ps;
    items.push({ key: c.key, label: c.label, a: a[c.key], b: b[c.key], dSBP: one - base });
  }
  items.sort((x, y) => Math.abs(y.dSBP) - Math.abs(x.dSBP));
  return { total: simulate(b).m.Ps - base, items };
}

export const topContributions = (a: Params, b: Params, n = 3) => sbpContributions(a, b).items.slice(0, n);
