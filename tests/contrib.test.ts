import { describe, expect, it } from 'vitest';
import { DEFAULTS, PRESETS } from '../src/config/physiology';
import { sbpContributions, topContributions } from '../src/model/contrib';

describe('Compare: what differs (one input at a time)', () => {
  it('identical patients have no contributions', () => {
    expect(sbpContributions(DEFAULTS, DEFAULTS).items).toEqual([]);
  });
  it('a single differing input carries the whole difference', () => {
    const b = { ...DEFAULTS, cAo: 12 };
    const r = sbpContributions(DEFAULTS, b);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].key).toBe('cAo');
    expect(r.items[0].dSBP).toBeCloseTo(r.total, 6);
    expect(r.total).toBeGreaterThan(0);
  });
  it('ranks by absolute effect on central SBP and returns the top 3', () => {
    const b = { ...DEFAULTS, cAo: 12, height: DEFAULTS.height + 1, radius: 90, gamma: DEFAULTS.gamma + 0.01 };
    const all = sbpContributions(DEFAULTS, b).items;
    for (let i = 1; i < all.length; i++) expect(Math.abs(all[i - 1].dSBP)).toBeGreaterThanOrEqual(Math.abs(all[i].dSBP));
    const top = topContributions(DEFAULTS, b);
    expect(top).toHaveLength(3);
    expect(top.map(t => t.key)).toEqual(all.slice(0, 3).map(t => t.key));
    expect(top.map(t => t.key)).not.toContain(all[3].key);
    expect(top[0].key).toBe('radius');
  });
  it('young vs ISH: aortic stiffness is among the top contributors', () => {
    const a = { ...DEFAULTS, ...PRESETS['Young adult (20 y)'] }, b = { ...DEFAULTS, ...PRESETS['Isolated systolic HTN (80 y)'] };
    const top = topContributions(a, b).map(t => t.key);
    expect(top).toContain('cAo');
  });
});
