import { describe, expect, it } from 'vitest';
import v1 from './fixtures/v1-validation.json';
import { runValidation, verdictSequence } from '../src/model/validation';

describe('Validation tab (ported from v1)', () => {
  const report = runValidation();
  it('gives the same verdict as v1 for every check', () => {
    // v2.6 calibrated the arm transfer function to invasive data (Karamanoglu 1993; Picone 2017); the
    // teaching profiles' amplification (young 1.47 vs 1.7) moved from pass to near. Every other verdict is v1's.
    const expected = [...v1.verdicts]; expected[24] = 'near';
    expect(verdictSequence(report)).toEqual(expected);
  });
  it('has no failed checks (v1: 40 pass, 2 close; v2.6: 39 pass, 3 close)', () => {
    const seq = verdictSequence(report);
    expect(seq.filter(v => v === 'fail')).toHaveLength(0);
    expect(seq.filter(v => v === 'pass')).toHaveLength(39);
  });
});
