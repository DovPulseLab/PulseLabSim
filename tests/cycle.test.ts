/* v2.2: cardiac cycle (Wiggers) construction. */
import { describe, expect, it } from 'vitest';
import { DEFAULTS, PRESETS } from '../src/config/physiology';
import { simulate } from '../src/model';
import { buildCycle, indexAt, phaseAt } from '../src/model/cycle';
import { runStudyValidation } from '../src/model/validationStudy';

describe('cardiac cycle', () => {
  it('events are in order and phases tile the cycle, 40–180 bpm', () => {
    for (const hr of [40, 60, 90, 130, 180]) {
      const c = buildCycle(simulate({ hr }));
      expect(0 < c.tMC && c.tMC < c.tAO && c.tAO < c.tAC && c.tAC < c.tMO && c.tMO < c.T).toBe(true);
      const ph = c.phases;
      expect(ph[0].t0).toBeCloseTo(0, 9);
      expect(ph[ph.length - 1].t1).toBeCloseTo(c.T, 9);
      for (let i = 1; i < ph.length; i++) expect(ph[i].t0).toBeCloseTo(ph[i - 1].t1, 9);
    }
  });
  it('curves are continuous and periodic for every preset', () => {
    for (const p of Object.values(PRESETS)) for (const hr of [60, 120, 180]) {
      const c = buildCycle(simulate({ ...DEFAULTS, ...p, hr }));
      for (const ys of [c.lv, c.la, c.vol, c.ao]) {
        expect(Math.abs(ys[c.n] - ys[0])).toBeLessThan(0.5);
        for (const v of ys) expect(Number.isFinite(v)).toBe(true);
      }
      let big = 0; for (let i = 1; i <= c.n; i++) big = Math.max(big, Math.abs(c.vol[i] - c.vol[i - 1]));
      expect(big).toBeLessThan(c.sv * 0.05);
    }
  });
  it('aortic pressure and flow are the model beat, shifted to start at QRS onset', () => {
    const r = simulate({}), c = buildCycle(r);
    expect(c.ao[indexAt(c, c.tAO)]).toBeCloseTo(r.p[0], 0);
    expect(Math.max(...c.q)).toBeCloseTo(Math.max(...r.q), -1);
    expect(c.q[indexAt(c, c.tMO)]).toBe(0);
  });
  it('volume: EDV − ESV = SV, EF 60 %', () => {
    const c = buildCycle(simulate({ sv: 80 }));
    expect(c.edv - c.esv).toBeCloseTo(80, 6);
    expect(Math.max(...c.vol)).toBeCloseTo(c.edv, 0);
    expect(Math.min(...c.vol)).toBeCloseTo(c.esv, 0);
  });
  it('phase lookup', () => {
    const c = buildCycle(simulate({}));
    expect(phaseAt(c, (c.tMC + c.tAO) / 2).id).toBe('ivc');
    expect(phaseAt(c, c.tAO + 0.01).id).toBe('ejRapid');
    expect(phaseAt(c, (c.tAC + c.tMO) / 2).id).toBe('ivr');
    expect(phaseAt(c, c.T - 0.01).id).toBe('atrial');
  });
  it('validation checks all pass', () => {
    for (const ch of runStudyValidation().cycle) expect(ch.verdict, ch.what).toBe('pass');
  });
});
