import { describe, expect, it } from 'vitest';
import { decodeHash, encodeState } from '../src/state/url';
import { exportParameters, importParameters } from '../src/state/importJson';
import { checkInput, stepInput } from '../src/state/inputs';
import { createStore, reduce } from '../src/state/store';
import { newHistory } from '../src/state/history';
import { defaultState } from '../src/state/types';
import { DEFAULTS, PRESETS } from '../src/config/physiology';

function busyState() {
  const s = createStore();
  s.dispatch({ type: 'setClock', t: 42.5 });
  s.dispatch({ type: 'setInput', key: 'cAo', value: 11.3 });
  s.dispatch({ type: 'setInput', key: 'gamma', value: 0.61 });
  s.dispatch({ type: 'giveDrug', drug: 'ntg', mode: 'infusion' });
  s.dispatch({ type: 'giveDrug', drug: 'acei', mode: 'infusion', steady: true, rampS: 2.5 });
  s.dispatch({ type: 'setClock', t: 90 });
  s.dispatch({ type: 'stopDrug', id: 1 });
  s.dispatch({ type: 'setActive', patient: 'B' });
  s.dispatch({ type: 'loadPreset', preset: 'Isolated systolic HTN (80 y)' });
  s.dispatch({ type: 'giveDrug', drug: 'propofol', mode: 'bolus', dose: 0.5 });
  s.dispatch({ type: 'setTab', tab: 'imp' });
  s.dispatch({ type: 'setWarp', warp: 0.5 });
  s.dispatch({ type: 'setPaused', paused: true });
  s.dispatch({ type: 'pin', params: { ...DEFAULTS, cAo: 9.87654, hr: 61.2345 } });
  return s.get().app;
}

describe('inputs', () => {
  it('clamps out-of-range values with a warning and never returns NaN', () => {
    expect(checkInput('hr', 500)).toMatchObject({ value: 180 });
    expect(checkInput('hr', 500).warning).toMatch(/above the maximum/);
    expect(checkInput('gamma', -1).value).toBe(0.1);
    for (const bad of [NaN, Infinity, 'abc', null, undefined, {}]) {
      const r = checkInput('cAo', bad);
      expect(r.value).toBe(DEFAULTS.cAo);
      expect(r.warning).toBeTruthy();
    }
    expect(checkInput('sv', '80')).toEqual({ value: 80, warning: null });
  });
  it('± buttons move one step and stop at the limits', () => {
    expect(stepInput('gamma', 0.45, 1)).toBe(0.46);
    expect(stepInput('hr', 180, 1)).toBe(180);
    expect(stepInput('diam', 2.0, -1)).toBe(2.0);
  });
});

describe('URL hash', () => {
  it('round-trips every part of the state', () => {
    const s = busyState();
    const hash = encodeState(s);
    expect(hash.startsWith('#v=2&')).toBe(true);
    const r = decodeHash(hash);
    expect(r.error).toBeNull();
    expect(r.warnings).toEqual([]);
    expect(r.state).toEqual(s);
    expect(encodeState(r.state)).toBe(hash);
  });
  it('round-trips the defaults', () => {
    const s = defaultState();
    expect(decodeHash(encodeState(s)).state).toEqual(s);
  });
  it('an empty hash gives defaults with no message', () => {
    expect(decodeHash('')).toEqual({ state: defaultState(), warnings: [], error: null });
  });
  it('a corrupt or unversioned hash gives defaults and a message', () => {
    for (const bad of ['#garbage', '#v=1&tab=sim', '#v=9', '#%E0%A4%A']) {
      const r = decodeHash(bad);
      expect(r.state).toEqual(defaultState());
      expect(r.error).toMatch(/default/);
    }
  });
  it('clamps out-of-range values and skips unknown parts, with warnings', () => {
    const r = decodeHash('#v=2&A=0_h999_a7.5_zz1&Ad=nosuchdrug~i~0~~1_ntg~i~0~~1&tab=nope');
    expect(r.error).toBeNull();
    expect(r.state.patients.A.inputs.hr).toBe(180);
    expect(r.state.patients.A.events.map(e => e.drug)).toEqual(['ntg']);
    expect(r.warnings.join(' ')).toMatch(/maximum/);
    expect(r.warnings.join(' ')).toMatch(/nosuchdrug/);
    expect(r.warnings.join(' ')).toMatch(/tab/);
  });
});

describe('parameters JSON import', () => {
  it('round-trips its own export', () => {
    const s = busyState();
    const r = importParameters(JSON.stringify(exportParameters(s)));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.patients.A.inputs).toEqual(s.patients.A.inputs);
      expect(r.patients.B.preset).toBe(s.patients.B.preset);
      expect(r.patients.A.events.map(({ id: _i, ...e }) => e)).toEqual(s.patients.A.events.map(({ id: _i, ...e }) => e));
    }
  });
  it('reads a v1 export, turning drugs into steady-state events', () => {
    const v1 = { A: { preset: 'Default adult (45 y)', patient: { ...DEFAULTS, hr: 80 }, drugs: ['acei', 'bb'] },
      B: { preset: 'Older adult (70 y)', patient: { ...DEFAULTS, ...PRESETS['Older adult (70 y)'] }, drugs: [] } };
    const r = importParameters(v1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.patients.A.inputs.hr).toBe(80);
      expect(r.patients.A.events.map(e => [e.drug, e.steady])).toEqual([['acei', true], ['bb', true]]);
    }
  });
  const bad: [string, unknown, RegExp][] = [
    ['not JSON', '{oops', /file: is not valid JSON/],
    ['wrong format', { hello: 1 }, /format/],
    ['wrong version', { format: 'pulse-lab', version: 3, patients: {} }, /version/],
    ['missing patient B', { format: 'pulse-lab', version: 2, patients: { A: { inputs: {} } } }, /patients\.B/],
    ['text where a number belongs', { format: 'pulse-lab', version: 2, patients: { A: { inputs: { hr: 'fast' } }, B: { inputs: {} } } }, /patients\.A\.inputs\.hr/],
    ['unknown drug', { format: 'pulse-lab', version: 2, patients: { A: { inputs: {}, events: [{ drug: 'x', mode: 'bolus', t0: 0 }] }, B: { inputs: {} } } }, /patients\.A\.events\[0\]\.drug/],
    ['unknown profile', { format: 'pulse-lab', version: 2, patients: { A: { preset: 'Martian', inputs: {} }, B: { inputs: {} } } }, /patients\.A\.preset/]
  ];
  for (const [name, file, field] of bad) {
    it(`rejects ${name}, naming the field`, () => {
      const r = importParameters(file);
      expect(r.ok).toBe(false);
      if (!r.ok) { expect(r.error).toMatch(field); expect(r.error).toMatch(/Current settings kept/); }
    });
  }
  it('clamps an out-of-range number with a warning', () => {
    const r = importParameters({ format: 'pulse-lab', version: 2, patients: { A: { inputs: { cAo: 99 } }, B: { inputs: {} } } });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.patients.A.inputs.cAo).toBe(16); expect(r.warnings[0]).toMatch(/maximum/); }
  });
});

describe('undo / redo', () => {
  it('undoes and redoes input changes and drug events', () => {
    const s = createStore();
    s.dispatch({ type: 'setInput', key: 'hr', value: 90 });
    s.dispatch({ type: 'giveDrug', drug: 'esmolol', mode: 'bolus' });
    expect(s.get().app.patients.A.events).toHaveLength(1);
    s.dispatch({ type: 'undo' });
    expect(s.get().app.patients.A.events).toHaveLength(0);
    expect(s.get().app.patients.A.inputs.hr).toBe(90);
    s.dispatch({ type: 'undo' });
    expect(s.get().app.patients.A.inputs.hr).toBe(70);
    s.dispatch({ type: 'redo' }); s.dispatch({ type: 'redo' });
    expect(s.get().app.patients.A.inputs.hr).toBe(90);
    expect(s.get().app.patients.A.events).toHaveLength(1);
  });
  it('a new change clears the redo stack', () => {
    const s = createStore();
    s.dispatch({ type: 'setInput', key: 'hr', value: 90 });
    s.dispatch({ type: 'undo' });
    s.dispatch({ type: 'setInput', key: 'sv', value: 60 });
    s.dispatch({ type: 'redo' });
    expect(s.get().app.patients.A.inputs.hr).toBe(70);
  });
  it('keeps at most 50 steps', () => {
    const s = createStore();
    for (let i = 0; i < 60; i++) s.dispatch({ type: 'setInput', key: 'hr', value: 41 + i });
    expect(s.get().history.past).toHaveLength(50);
    for (let i = 0; i < 60; i++) s.dispatch({ type: 'undo' });
    expect(s.get().app.patients.A.inputs.hr).toBe(41 + 9);
  });
  it('one slider drag is one undo step', () => {
    const s = createStore();
    for (const v of [71, 72, 73, 74]) s.dispatch({ type: 'setInput', key: 'hr', value: v, coalesce: 'drag-1' });
    expect(s.get().history.past).toHaveLength(1);
    s.dispatch({ type: 'undo' });
    expect(s.get().app.patients.A.inputs.hr).toBe(70);
  });
  it('tab, clock and pin changes are not undo steps', () => {
    let st = { app: defaultState(), history: newHistory<ReturnType<typeof defaultState>['patients']>(), warnings: [] as string[] };
    st = reduce(st, { type: 'setTab', tab: 'sweep' });
    st = reduce(st, { type: 'setClock', t: 5 });
    expect(st.history.past).toHaveLength(0);
  });
});
