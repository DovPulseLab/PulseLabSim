import { describe, expect, it } from 'vitest';
import { ease, inputsAt, retarget } from '../src/engine/transition';
import { applyDrugEffects, effectLevel, emaxEffect, type DrugEvent } from '../src/engine/kinetics';
import { TrendBuffer, TREND_CAPACITY, Ring } from '../src/engine/trends';
import { newPatientSim, nextBeat, setTargets, catchUp } from '../src/engine/patient';
import { newClock, tick, setPaused } from '../src/engine/clock';
import { applyDrugs, derive, simulate } from '../src/model';
import { ALL_CONTROLS, DEFAULTS, DRUGS, DRUG_KINETICS, PRESETS, SV_HR_COUPLING, type Params } from '../src/config/physiology';

const ev = (o: Partial<DrugEvent> & { drug: string }): DrugEvent => ({ id: 1, mode: 'infusion', t0: 0, tStop: null, dose: 1, ...o });

describe('transitions', () => {
  it('cosine ease is monotonic from 0 to 1', () => {
    const xs = Array.from({ length: 101 }, (_, i) => ease(i / 100));
    expect(xs[0]).toBe(0); expect(xs[100]).toBe(1);
    xs.forEach((v, i) => { if (i) expect(v).toBeGreaterThanOrEqual(xs[i - 1]); });
  });
  it('an input change reaches its target in exactly 3 beats, monotonically', () => {
    const cur: Params = { ...DEFAULTS };
    const tgt: Params = { ...DEFAULTS, cAo: 12, hr: 50 };
    const ramps = retarget({}, cur, tgt, 10);
    const vals = [10, 11, 12, 13, 14].map(b => inputsAt(tgt, ramps, b).params);
    expect(vals[0].cAo).toBe(7.5);
    expect(vals[1].cAo).toBeGreaterThan(7.5); expect(vals[1].cAo).toBeLessThan(12);
    expect(vals[2].cAo).toBeGreaterThan(vals[1].cAo);
    expect(vals[3].cAo).toBe(12); expect(vals[3].hr).toBe(50);
    expect(vals[4].cAo).toBe(12);
    expect(vals[2].hr).toBeLessThan(vals[1].hr);
    expect(inputsAt(tgt, ramps, 13).ramps).toEqual({});
  });
  it('a new change mid-ramp starts from the current value (no jump)', () => {
    const tgt1: Params = { ...DEFAULTS, cAo: 12 };
    let ramps = retarget({}, { ...DEFAULTS }, tgt1, 0);
    const mid = inputsAt(tgt1, ramps, 1).params;
    const tgt2: Params = { ...DEFAULTS, cAo: 5 };
    ramps = retarget(ramps, mid, tgt2, 1);
    expect(inputsAt(tgt2, ramps, 1).params.cAo).toBe(mid.cAo);
    expect(inputsAt(tgt2, ramps, 4).params.cAo).toBe(5);
  });
  it('the live patient reaches the new steady state on the 3rd beat', () => {
    let sim = newPatientSim({ ...DEFAULTS });
    sim = nextBeat(sim).sim;
    sim = setTargets(sim, { ...DEFAULTS, gamma: 0.8 });
    const aix: number[] = [];
    for (let i = 0; i < 4; i++) { const r = nextBeat(sim); sim = r.sim; aix.push(r.beat.res.m.AIx); }
    const target = simulate({ ...DEFAULTS, gamma: 0.8 }).m.AIx;
    expect(aix[0]).toBeLessThan(aix[1]); expect(aix[1]).toBeLessThan(aix[2]);
    expect(aix[2]).toBe(target); expect(aix[3]).toBe(target);
  });
});

describe('drug kinetics', () => {
  it('uses the spec time constants for NTG and esmolol', () => {
    expect(DRUG_KINETICS.ntg).toMatchObject({ tauOn: 60, tauOff: 180 });
    expect(DRUG_KINETICS.esmolol).toMatchObject({ tauOn: 60, tauOff: 600 });
  });
  it('infusion onset is first order (63 % at τon) and offset decays with τoff', () => {
    const e = ev({ drug: 'ntg', t0: 100, tStop: 400 });
    expect(effectLevel(e, 99)).toBe(0);
    expect(effectLevel(e, 160)).toBeCloseTo(1 - Math.exp(-1), 10);
    const atStop = effectLevel(e, 400);
    expect(effectLevel(e, 580)).toBeCloseTo(atStop * Math.exp(-1), 10);
    expect(effectLevel(e, 400 + 5 * 180)).toBeLessThan(0.01 * atStop);
  });
  it('a bolus rises then falls, peaking at full effect', () => {
    const e = ev({ drug: 'propofol', mode: 'bolus', t0: 0 });
    const ts = Array.from({ length: 1200 }, (_, i) => i);
    const ls = ts.map(t => effectLevel(e, t));
    const peak = Math.max(...ls);
    expect(peak).toBeCloseTo(1, 3);
    const iPeak = ls.indexOf(peak);
    expect(iPeak).toBeGreaterThan(0);
    for (let i = 1; i <= iPeak; i++) expect(ls[i]).toBeGreaterThanOrEqual(ls[i - 1]);
    for (let i = iPeak + 1; i < ls.length; i++) expect(ls[i]).toBeLessThanOrEqual(ls[i - 1]);
  });
  it('several drugs combine additively in log space', () => {
    const t = 1e6;                                     // effectively steady state
    // SV additions are compared before the separate HR → SV rise
    const noRise = (r: ReturnType<typeof applyDrugEffects>) => ({ ...r.params, sv: r.params.sv - r.svRise });
    const a = noRise(applyDrugEffects({ ...DEFAULTS }, [ev({ drug: 'ntg' })], t));
    const b = noRise(applyDrugEffects({ ...DEFAULTS }, [ev({ id: 2, drug: 'propofol' })], t));
    const ab = noRise(applyDrugEffects({ ...DEFAULTS }, [ev({ drug: 'ntg' }), ev({ id: 2, drug: 'propofol' })], t));
    const lr = (p: Params) => Math.log(p.cMus / DEFAULTS.cMus);
    expect(lr(ab)).toBeCloseTo(lr(a) + lr(b), 10);
    expect(ab.sv - DEFAULTS.sv).toBeCloseTo((a.sv - DEFAULTS.sv) + (b.sv - DEFAULTS.sv), 10);
    // a partial effect E gives E × the full log change
    const half = applyDrugEffects({ ...DEFAULTS }, [ev({ drug: 'ntg', dose: 0.5 })], t);
    expect(lr(half.params)).toBeCloseTo(lr(a) * half.levels[0].effect, 10);
  });
  it('repeat doses of one drug saturate toward a single maximum (Emax) and show as one entry', () => {
    expect(emaxEffect(0)).toBe(0);
    expect(emaxEffect(1)).toBe(1);
    const cs = [0.25, 0.5, 1, 2, 4, 8, 100];
    const es = cs.map(c => emaxEffect(c));
    es.forEach((e, i) => { if (i) expect(e).toBeGreaterThan(es[i - 1]); expect(e).toBeLessThan(1.2); });
    const t = 1e6;
    const four = [1, 2, 3, 4].map(id => ev({ id, drug: 'esmolol' }));
    const r = applyDrugEffects({ ...DEFAULTS }, four, t);
    expect(r.levels).toHaveLength(1);
    expect(r.levels[0]).toMatchObject({ drug: 'esmolol', ids: [1, 2, 3, 4] });
    expect(r.levels[0].exposure).toBeCloseTo(4, 6);
    expect(r.levels[0].effect).toBeCloseTo(emaxEffect(4), 10);
    expect(r.params.hr).toBeGreaterThanOrEqual(DEFAULTS.hr - 18 * 1.2);
    const one = applyDrugEffects({ ...DEFAULTS }, [ev({ drug: 'esmolol' })], t).params.hr;
    expect(DEFAULTS.hr - r.params.hr).toBeLessThan(1.2 * (DEFAULTS.hr - one));
  });
  it('clamps inputs to the slider ranges', () => {
    const t = 1e6;
    const base = { ...DEFAULTS, hr: 125 };
    const r = applyDrugEffects(base, [ev({ drug: 'dobutamine', dose: 2 })], t);
    expect(r.params.hr).toBe(ALL_CONTROLS.find(c => c.key === 'hr')!.max);
    expect(r.clamped).toContain('hr');
    for (const c of ALL_CONTROLS) {
      expect(r.params[c.key]).toBeGreaterThanOrEqual(c.min);
      expect(r.params[c.key]).toBeLessThanOrEqual(c.max);
    }
  });
  it('phenylephrine adds a baroreflex fall of 0.3 bpm per mmHg MAP rise, capped at 20', () => {
    const t = 1e6;
    const r = applyDrugEffects({ ...DEFAULTS }, [ev({ drug: 'phe' })], t);
    const noReflex = { ...r.params, hr: DEFAULTS.hr, sv: r.params.sv - r.svRise };
    const rise = derive(noReflex).map - derive({ ...DEFAULTS }).map;
    expect(rise).toBeGreaterThan(0);
    expect(r.reflexBpm).toBeCloseTo(-Math.min(20, 0.3 * rise), 10);
    expect(r.params.hr).toBeCloseTo(DEFAULTS.hr + r.reflexBpm, 10);
    const big = applyDrugEffects({ ...DEFAULTS }, [ev({ drug: 'phe', dose: 2 })], t);
    expect(big.reflexBpm).toBeGreaterThanOrEqual(-20);
    // no reflex without phenylephrine
    expect(applyDrugEffects({ ...DEFAULTS }, [ev({ drug: 'norepinephrine' })], t).reflexBpm).toBe(0);
  });
  it('v1 long-term drugs started at steady state match v1 applyDrugs exactly', () => {
    for (const name of Object.keys(PRESETS)) {
      const base: Params = { ...DEFAULTS, ...PRESETS[name] };
      const sets = [...Object.keys(DRUGS).map(k => [k]), Object.keys(DRUGS)];
      for (const keys of sets) {
        const evs = keys.map((k, i) => ev({ id: i + 1, drug: k, steady: true, rampS: 0, t0: 5 }));
        const live = applyDrugEffects(base, evs, 5).params;
        const v1 = applyDrugs(base, keys);
        for (const k of Object.keys(v1) as (keyof Params)[]) expect(live[k], `${name} ${keys} ${k}`).toBe(v1[k]);
      }
    }
  });
  it('a live NTG infusion lowers central SBP gradually', () => {
    let sim = newPatientSim({ ...DEFAULTS, ...PRESETS['Essential HTN (55 y)'] }, [ev({ drug: 'ntg', t0: 0 })]);
    const sbp: number[] = [];
    while (sim.nextT < 300) { const r = nextBeat(sim); sim = r.sim; sbp.push(r.beat.res.m.Ps); }
    expect(sbp[sbp.length - 1]).toBeLessThan(sbp[0] - 5);
    for (let i = 1; i < sbp.length; i++) expect(sbp[i]).toBeLessThanOrEqual(sbp[i - 1] + 1e-9);
  });
});

describe('trend ring buffer', () => {
  it('ring keeps the newest items once full', () => {
    const r = new Ring<number>(3);
    [1, 2, 3, 4, 5].forEach(x => r.push(x));
    expect(r.toArray()).toEqual([3, 4, 5]);
    expect(r.length).toBe(3);
  });
  it('holds 10 minutes and wraps after that', () => {
    const tb = new TrendBuffer();
    const sample = (t: number) => ({ t, hr: 130, sbp: 0, dbp: 0, map: 0, pp: 0, cSBP: 0, cDBP: 0, cPP: 0, bPP: 0, aix: 0, pwv: 0 });
    for (let t = 0; t < 900; t += 60 / 130) tb.push(sample(t));   // 15 min at the fastest HR
    expect(tb.length).toBeLessThanOrEqual(TREND_CAPACITY);
    const w = tb.window();
    expect(w[w.length - 1].t - w[0].t).toBeLessThanOrEqual(600);
    expect(w[w.length - 1].t - w[0].t).toBeGreaterThan(599);
  });
  it('the live patient adds one sample per beat', () => {
    let sim = newPatientSim({ ...DEFAULTS });
    for (let i = 0; i < 5; i++) sim = nextBeat(sim).sim;
    expect(sim.trend.length).toBe(5);
  });
});

describe('beat clock', () => {
  it('advances with warp, stops when paused, and caps long gaps', () => {
    let c = newClock();
    c = tick(c, 0.1); expect(c.t).toBeCloseTo(0.1);
    c = { ...c, warp: 0.25 }; c = tick(c, 0.2); expect(c.t).toBeCloseTo(0.15);
    c = setPaused(c, true); c = tick(c, 1); expect(c.t).toBeCloseTo(0.15);
    c = setPaused(c, false); c = { ...c, warp: 1 }; c = tick(c, 10); expect(c.t).toBeCloseTo(0.4);
  });
  it('catchUp generates the beats due and skips ahead when far behind', () => {
    let sim = newPatientSim({ ...DEFAULTS });
    const r = catchUp(sim, 60 / 70 * 2.5);
    expect(r.beats.length).toBe(3);                  // beats at 0, T, 2T
    sim = r.sim;
    const far = catchUp(sim, 1000, 4);
    expect(far.beats.length).toBe(4);
    expect(far.sim.nextT).toBe(1000);
  });
});

describe('stroke volume rise when an acute drug slows the heart', () => {
  const steady = (drug: string, dose = 1): DrugEvent[] => [{ id: 1, drug, mode: 'infusion', t0: 0, tStop: null, dose, steady: true, rampS: 0 }];
  it('esmolol: SV rises by (HR0/HR1)^0.5 and MAP falls about 15–22 % at defaults', () => {
    const e = applyDrugEffects(DEFAULTS, steady('esmolol'), 1000);
    expect(e.params.hr).toBeLessThan(DEFAULTS.hr);
    const svNoRise = e.params.sv - e.svRise;
    expect(e.params.sv).toBeCloseTo(svNoRise * Math.pow(DEFAULTS.hr / e.params.hr, SV_HR_COUPLING.exponent), 6);
    const fall = 1 - simulate(e.params).m.map / simulate(DEFAULTS).m.map;
    expect(fall).toBeGreaterThan(0.15); expect(fall).toBeLessThan(0.22);
  });
  it('no SV change for drugs that do not lower HR', () => {
    expect(applyDrugEffects(DEFAULTS, steady('ntg'), 1000).svRise).toBe(0);
    expect(applyDrugEffects(DEFAULTS, steady('dobutamine'), 1000).svRise).toBe(0);
  });
  it('the phenylephrine baroreflex HR fall also raises SV', () => {
    const e = applyDrugEffects(DEFAULTS, steady('phe'), 1000);
    expect(e.reflexBpm).toBeLessThan(0); expect(e.svRise).toBeGreaterThan(0);
  });
  it('long-term v1 drugs keep exact v1 effects (no SV rise)', () => {
    for (const k of Object.keys(DRUGS)) {
      const e = applyDrugEffects(DEFAULTS, steady(k), 1000);
      expect(e.svRise).toBe(0);
      expect(e.params).toEqual(applyDrugs(DEFAULTS, [k]));
    }
  });
  it('propofol bolus lowers MAP 25–30 % at its peak, at defaults', () => {
    const m0 = simulate(DEFAULTS).m.map;
    let lo = Infinity;
    for (let t = 0; t <= 300; t += 2) lo = Math.min(lo, simulate(applyDrugEffects(DEFAULTS, [{ id: 1, drug: 'propofol', mode: 'bolus', t0: 0, tStop: null, dose: 1 }], t).params).m.map);
    const fall = 1 - lo / m0;
    expect(fall).toBeGreaterThan(0.25); expect(fall).toBeLessThan(0.30);
  });
});
