/* Every model input must have a place in the rail, or buildRail throws (missing #in-key). */
import { describe, expect, it } from 'vitest';
import { ALL_CONTROLS } from '../src/config/physiology';
import { GROUPS } from '../src/ui/rail';

describe('rail groups', () => {
  it('list every control exactly once', () => {
    const keys = GROUPS.flatMap(g => g.keys);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(ALL_CONTROLS.map(c => c.key).sort());
  });
});
