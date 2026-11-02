import { describe, expect, it } from 'vitest';
import v1 from './fixtures/v1-validation.json';
import { runValidation, verdictSequence } from '../src/model/validation';

describe('Validation tab (ported from v1)', () => {
  const report = runValidation();
  it('gives the same verdict as v1 for every check', () => {
    expect(verdictSequence(report)).toEqual(v1.verdicts);
  });
  it('has no failed checks (v1: 40 pass, 2 close)', () => {
    const seq = verdictSequence(report);
    expect(seq.filter(v => v === 'fail')).toHaveLength(0);
    expect(seq.filter(v => v === 'pass')).toHaveLength(40);
  });
});
