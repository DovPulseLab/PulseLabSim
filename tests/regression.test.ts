/* v2 must reproduce v1 (js/model.js) within 0.5 mmHg / 0.5 %.
   Fixture: tests/fixtures/v1-snapshots.json, made by scripts/snapshot-v1.mjs from the untouched v1 code. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import snap from './fixtures/v1-snapshots.json';
import { simulate } from '../src/model';
import { applyDrugs } from '../src/model/drugsSteady';
import { DEFAULTS, DRUGS, PRESETS, isStudyPreset, useV1Laws, type Params } from '../src/config/physiology';

// v1 started every profile at the Weissler ejection time (etScale 1.0, 294 ms at 70 bpm);
// v2 starts at 300 ms. The v1 comparison uses v1's starting value. The healthy study
// profiles are new in v2 and are checked against reference data in validation tests.
const V1_DEFAULTS: Params = { ...DEFAULTS, etScale: 1 };
const V1_PRESETS = Object.keys(PRESETS).filter(n => !isStudyPreset(n));

interface SnapCase {
  label: string;
  input: Record<string, number>;
  m: Record<string, number | string>;
  wave: Record<'p' | 'pf' | 'pb' | 'brachial' | 'radial' | 'q', number[]>;
  zin: [number, number][];
}
const fixture = snap as unknown as { sampleStep: number; cases: SnapCase[] };
const cases = fixture.cases;
const STEP = fixture.sampleStep;

// Fields in mmHg: absolute tolerance 0.5 mmHg
const MMHG_KEYS = new Set(['Ps', 'Pd', 'PP', 'map', 'Pi', 'P1', 'P2', 'AP', 'bSBP', 'bDBP', 'bPP', 'rSBP', 'rDBP', 'fwdAmp', 'bwdAmp', 'cMAP', 'ep']);
// Fields in %: absolute tolerance 0.5 percentage points
const PCT_KEYS = new Set(['AIx', 'AIx75', 'rm', 'sevr']);
// Sample indices: must match exactly
const INDEX_KEYS = new Set(['i1', 'i2', 'iPk', 'iInf', 'iET', 'iTi']);

function within(key: string, v2: number, v1: number): boolean {
  if (INDEX_KEYS.has(key)) return v2 === v1;
  if (MMHG_KEYS.has(key) || PCT_KEYS.has(key)) return Math.abs(v2 - v1) <= 0.5;
  return Math.abs(v2 - v1) <= Math.max(0.005 * Math.abs(v1), 1e-9);
}

describe('v1 regression snapshots', () => {
  // v2.5 changed the reflection law; the port is checked with the v1 law switched back on.
  beforeAll(() => useV1Laws(true));
  afterAll(() => useV1Laws(false));
  it('covers every preset and every drug', () => {
    for (const name of V1_PRESETS) {
      expect(cases.some(c => c.label === `${name} | no drug`)).toBe(true);
      for (const k of Object.keys(DRUGS)) expect(cases.some(c => c.label === `${name} | ${k}`)).toBe(true);
    }
  });

  it('applyDrugs reproduces the v1 drug-adjusted inputs', () => {
    for (const c of cases) {
      const [name, what] = c.label.split(' | ');
      if (!(name in PRESETS) || what === 'no drug') continue;
      const base: Params = { ...V1_DEFAULTS, ...PRESETS[name] };
      const keys = what === 'all drugs' ? Object.keys(DRUGS) : [what];
      const p = applyDrugs(base, keys);
      for (const [k, v] of Object.entries(c.input)) expect(p[k as keyof Params]).toBeCloseTo(v, 6);
    }
  });

  let worst = { key: '', label: '', diff: 0 };
  for (const c of cases) {
    it(c.label, () => {
      const r = simulate(c.input as Partial<Params>);
      for (const [k, v1] of Object.entries(c.m)) {
        const v2 = r.m[k as keyof typeof r.m];
        if (typeof v1 === 'string') { expect(v2, k).toBe(v1); continue; }
        expect(typeof v2, k).toBe('number');
        expect(Number.isFinite(v2 as number), `${k} finite`).toBe(true);
        const ok = within(k, v2 as number, v1);
        if (!ok) throw new Error(`${k}: v2 ${v2} vs v1 ${v1}`);
        const d = Math.abs((v2 as number) - v1);
        if (d > worst.diff) worst = { key: k, label: c.label, diff: d };
      }
      for (const [name, arr] of Object.entries(c.wave)) {
        const full = r[name as keyof typeof c.wave];
        arr.forEach((v1, j) => {
          const v2 = full[j * STEP];
          const tol = name === 'q' ? Math.max(0.005 * Math.abs(v1), 1e-6) : 0.5;
          if (Math.abs(v2 - v1) > tol) throw new Error(`${name}[${j * STEP}]: v2 ${v2} vs v1 ${v1}`);
        });
      }
      const zin = r.zin.filter(h => h.f <= 12);
      expect(zin.length).toBe(c.zin.length);
      zin.forEach((h, j) => {
        expect(h.f).toBeCloseTo(c.zin[j][0], 6);
        expect(Math.abs(h.mod - c.zin[j][1])).toBeLessThanOrEqual(0.005 * c.zin[j][1]);
      });
    });
  }
});
