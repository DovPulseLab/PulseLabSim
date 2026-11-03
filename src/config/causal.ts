/* Cause → effect graph (from v1 js/causal.js). Used by the Learn map and the
   Explain drawer ("which inputs move it"). */
import type { BeatResult } from '../model/solve';

export interface CausalNode {
  id: string; c: number; r: number; l: string; u: string; f: number;
  v: (r: BeatResult) => number;
  /** relative change below this counts as "no change" (absolute floor for indices near 0) */
  abs?: boolean;
}

export const CAUSAL_COLUMNS = ['INPUTS (what you set)', 'MECHANISMS', 'PRESSURES', 'LV LOAD & INDICES'];

export const NODES: CausalNode[] = [
  { id: 'hr', c: 0, r: 0, l: 'Heart rate', v: r => r.params.hr, u: 'bpm', f: 0 },
  { id: 'sv', c: 0, r: 1, l: 'Stroke volume', v: r => r.params.sv, u: 'mL', f: 0 },
  { id: 'rad', c: 0, r: 2, l: 'Arteriolar radius', v: r => r.params.radius, u: '%', f: 0 },
  { id: 'cao', c: 0, r: 3, l: 'Aortic PWV (operating)', v: r => r.m.cAoOp, u: 'm/s', f: 1 },
  { id: 'dia', c: 0, r: 4, l: 'Aortic diameter', v: r => r.params.diam, u: 'cm', f: 1 },
  { id: 'cmus', c: 0, r: 5, l: 'Muscular-artery PWV', v: r => r.m.cMusOp, u: 'm/s', f: 1 },
  { id: 'gam', c: 0, r: 6, l: 'Reflection coeff. Γ', v: r => r.d.g, u: '', f: 2 },
  { id: 'lp', c: 0, r: 7, l: 'Reflection distance Lp', v: r => r.m.lp, u: 'cm', f: 0 },
  { id: 'co', c: 1, r: 0, l: 'Cardiac output', v: r => r.m.co, u: 'L/min', f: 2 },
  { id: 'et', c: 1, r: 1, l: 'Ejection time', v: r => r.m.et, u: 'ms', f: 0 },
  { id: 'svr', c: 1, r: 2, l: 'SVR', v: r => r.m.svrDyn, u: 'dyn·s·cm⁻⁵', f: 0 },
  { id: 'zc', c: 1, r: 3, l: 'Char. impedance Zc', v: r => r.m.zcDyn, u: 'dyn·s·cm⁻⁵', f: 0 },
  { id: 'comp', c: 1, r: 4, l: 'Total compliance C', v: r => r.m.ctot, u: 'mL/mmHg', f: 2 },
  { id: 'dtp', c: 1, r: 5, l: 'Round-trip time Δtp', v: r => r.m.dtp, u: 'ms', f: 0 },
  { id: 'fwd', c: 1, r: 6, l: 'Forward wave amplitude', v: r => r.m.fwdAmp, u: 'mmHg', f: 1 },
  { id: 'bwd', c: 1, r: 7, l: 'Reflected wave amplitude', v: r => r.m.bwdAmp, u: 'mmHg', f: 1 },
  { id: 'map', c: 2, r: 0.5, l: 'Mean arterial pressure', v: r => r.m.map, u: 'mmHg', f: 0 },
  { id: 'sbp', c: 2, r: 2, l: 'Central SBP', v: r => r.m.Ps, u: 'mmHg', f: 0 },
  { id: 'dbp', c: 2, r: 3.5, l: 'Diastolic BP', v: r => r.m.Pd, u: 'mmHg', f: 0 },
  { id: 'pp', c: 2, r: 5, l: 'Central pulse pressure', v: r => r.m.PP, u: 'mmHg', f: 0 },
  { id: 'bsbp', c: 2, r: 6.5, l: 'Brachial (cuff) SBP', v: r => r.m.bSBP, u: 'mmHg', f: 0 },
  { id: 'aix', c: 3, r: 0.5, l: 'Augmentation index', v: r => r.m.AIx, u: '%', f: 1, abs: true },
  { id: 'ew', c: 3, r: 2, l: 'Wasted LV energy ΔEw', v: r => r.m.Ew / 1000, u: '×10³', f: 1, abs: true },
  { id: 'lses', c: 3, r: 3.5, l: 'Late/early systolic load', v: r => r.m.lsEs, u: '', f: 2 },
  { id: 'ppa', c: 3, r: 5, l: 'PP amplification', v: r => r.m.ppa, u: '', f: 2 },
  { id: 'sevr', c: 3, r: 6.5, l: 'SEVR (supply/demand)', v: r => r.m.sevr, u: '%', f: 0 }
];

export const EDGES: [string, string][] = [
  ['hr', 'co'], ['hr', 'et'], ['sv', 'co'], ['sv', 'fwd'], ['rad', 'svr'],
  ['cao', 'zc'], ['cao', 'comp'], ['cao', 'dtp'], ['dia', 'zc'], ['dia', 'comp'], ['cmus', 'dtp'], ['lp', 'dtp'], ['gam', 'bwd'],
  ['co', 'map'], ['svr', 'map'], ['zc', 'fwd'], ['et', 'fwd'], ['fwd', 'bwd'], ['comp', 'dbp'], ['fwd', 'pp'], ['bwd', 'pp'], ['dtp', 'sbp'],
  ['map', 'sbp'], ['map', 'dbp'], ['pp', 'sbp'], ['pp', 'bsbp'],
  ['bwd', 'aix'], ['dtp', 'aix'], ['et', 'ew'], ['bwd', 'ew'], ['dtp', 'lses'], ['pp', 'ppa'], ['bsbp', 'ppa'],
  ['sbp', 'sevr'], ['dbp', 'sevr'], ['et', 'sevr'], ['sbp', 'aix']
];

/** Passive feedback drawn dashed: MAP → operating aortic PWV. */
export const FEEDBACK_EDGE: [string, string] = ['map', 'cao'];

/** Input nodes (column 0) upstream of a node, following the arrows backwards. */
export function upstreamInputs(id: string): string[] {
  const seen = new Set<string>(), out: string[] = [];
  const stack = [id];
  while (stack.length) {
    const n = stack.pop()!;
    for (const [a, b] of EDGES) if (b === n && !seen.has(a)) { seen.add(a); stack.push(a); }
  }
  for (const node of NODES) if (node.c === 0 && seen.has(node.id)) out.push(node.l);
  return out;
}

/** Breadth-first depth of each node from the inputs (for animating in causal order). */
export function causalDepth(): Record<string, number> {
  const depth: Record<string, number> = {};
  for (const n of NODES) if (n.c === 0) depth[n.id] = 0;
  let changed = true;
  while (changed) {
    changed = false;
    for (const [a, b] of EDGES) {
      if (depth[a] == null) continue;
      const d = depth[a] + 1;
      if (depth[b] == null || d > depth[b]) { depth[b] = d; changed = true; }
    }
  }
  return depth;
}
