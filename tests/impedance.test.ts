import { describe, expect, it } from 'vitest';
import { impedanceFromBeat, inputImpedance, simulate, summarizeImpedance } from '../src/model';
import { abs } from '../src/model/complex';
import { DEFAULTS, PHYS } from '../src/config/physiology';

describe('input impedance (defaults)', () => {
  const r = simulate(DEFAULTS);
  const harm = impedanceFromBeat(r);
  const s = summarizeImpedance(r.d, harm);

  it('covers 0–10 Hz at the heart-rate harmonics', () => {
    expect(harm[0].f).toBe(0);
    expect(harm[harm.length - 1].f).toBeLessThanOrEqual(10);
    expect(harm.length).toBeGreaterThanOrEqual(8);
  });
  it('|Z| at 0 Hz equals SVR (MAP / mean flow)', () => {
    expect(s.z0).toBeCloseTo(r.m.svrDyn, 3);
  });
  it('FFT(P)/FFT(Q) equals the model input impedance at every harmonic above 0 Hz', () => {
    for (const h of harm.slice(1)) expect(h.mod).toBeCloseTo(abs(inputImpedance(r.d, h.f)), 9);
  });
  it('first minimum sits near 1 / (2·Δtp) (±15 %)', () => {
    expect(Math.abs(s.firstMinHz / s.predictedMinHz - 1)).toBeLessThanOrEqual(0.15);
  });
  it('mean modulus 2–10 Hz matches Zc = ρc/A (±10 %)', () => {
    const zcRhoCA = PHYS.RHO * r.d.cAoOp / (r.d.A * 1e-4) / PHYS.MMHG / 1e6 * PHYS.DYN;
    expect(Math.abs(s.zcEstimate / zcRhoCA - 1)).toBeLessThanOrEqual(0.10);
  });
});
