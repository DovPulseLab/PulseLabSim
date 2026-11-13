// @vitest-environment happy-dom
/* Headless smoke test of the whole UI: boots main.ts in a simulated DOM (canvas calls are
   stubbed), then drives tabs, controls, drugs, pin, undo, sweep keys and a bad import.
   Catches runtime errors such as missing elements; it does not check visuals. */
import { beforeAll, describe, expect, it, vi } from 'vitest';

const errors: unknown[] = [];
let rafQueue: FrameRequestCallback[] = [];
let now = 0;

function stubCanvas(): void {
  const noop = () => undefined;
  const ctx = new Proxy({}, {
    get: (_t, k) => k === 'measureText' ? () => ({ width: 10 }) : k === 'getLineDash' ? () => [] : noop,
    set: () => true
  });
  // @ts-expect-error test stub
  HTMLCanvasElement.prototype.getContext = () => ctx;
  HTMLCanvasElement.prototype.toBlob = noop as never;
  Element.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 300, width: 600, height: 300, toJSON: noop } as DOMRect; };
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', { get() { return this.closest('[hidden]') ? null : document.body; }, configurable: true });
  // SVG path geometry
  const svgProto = (window as unknown as { SVGElement: typeof SVGElement }).SVGElement.prototype as unknown as Record<string, unknown>;
  svgProto.getTotalLength = () => 100;
  svgProto.getPointAtLength = () => ({ x: 1, y: 1 });
}

async function frames(n: number, dtMs = 50): Promise<void> {
  for (let i = 0; i < n; i++) {
    now += dtMs;
    const q = rafQueue; rafQueue = [];
    for (const f of q) f(now);
    await Promise.resolve();
  }
}

const click = (sel: string) => { const el = document.querySelector<HTMLElement>(sel); if (!el) throw new Error(`missing ${sel}`); el.click(); };
const TAB_IDS = ['sim', 'cycle', 'cmp', 'learn', 'sweep', 'imp', 'valid', 'eq', 'research'];
/** Every tab must open by click and by keys 1–9, from every other tab. */
async function checkAllTabs(when: string): Promise<void> {
  const visible = () => TAB_IDS.filter(t => !document.querySelector(`#pane-${t}`)!.hasAttribute('hidden'));
  for (const from of TAB_IDS) for (const [i, to] of TAB_IDS.entries()) {
    click(`#tab-${from}`); await frames(2, 250);
    expect(visible(), `${when}: click ${from}`).toEqual([from]);
    (document.activeElement as HTMLElement | null)?.blur?.();
    key(String(i + 1)); await frames(2, 250);
    expect(visible(), `${when}: key ${i + 1} from ${from}`).toEqual([to]);
    expect(document.querySelector(`#tab-${to}`)!.getAttribute('aria-selected'), when).toBe('true');
  }
}
const key = (k: string, opts: KeyboardEventInit = {}) => (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...opts }));

beforeAll(async () => {
  stubCanvas();
  window.addEventListener('error', e => errors.push(e.error ?? e.message));
  vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a); });
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { rafQueue.push(f); return rafQueue.length; });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined }));
  document.body.innerHTML = '<div id="root"></div>';
  await import('../src/main');
  await frames(5);
});

describe('UI smoke test', () => {
  it('boots with the start screen and live beats', async () => {
    expect(document.querySelector('#startOverlay')!.hasAttribute('hidden')).toBe(false);
    click('[data-start="free"]');
    click('#tourSkip');
    await frames(40);
    expect(document.querySelector('#card-cuff .num')!.textContent).toMatch(/\d+\/\d+/);
    expect(errors).toEqual([]);
  });

  it('every tab renders (keys 1–9)', async () => {
    for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) {
      key(k); await frames(25);
      const tab = TAB_IDS[Number(k) - 1];
      expect(document.querySelector(`#pane-${tab}`)!.hasAttribute('hidden')).toBe(false);
      expect(document.querySelector(`#pane-${tab}`)!.innerHTML.length).toBeGreaterThan(200);
    }
    expect(document.querySelector('#pane-valid')!.textContent).toContain('Formula checks');
    expect(errors).toEqual([]);
  }, 30000);   // the Validation tab runs the full v3 validation (≈ 100 ventricle beats) on first open

  it('inputs, drugs, pin, undo and explain work', async () => {
    key('1');
    const hr = document.querySelector<HTMLInputElement>('#num-hr')!;
    hr.value = '90'; hr.dispatchEvent(new Event('change', { bubbles: true }));
    await frames(60);
    expect(document.querySelector('#val-hr')!.textContent).toContain('90');
    key('b'); await frames(5);
    expect(document.querySelector('#clearPin')!.hasAttribute('hidden')).toBe(false);
    click('[data-give="esmolol"][data-mode="bolus"]');
    await frames(200, 100);
    expect(document.querySelector('#activeDrugs')!.textContent).toContain('%');
    expect(document.querySelector('#card-hr .d')!.textContent).toMatch(/▼/);
    key('z', { ctrlKey: true }); await frames(5);
    key('4'); await frames(30);
    expect(document.querySelectorAll('#causal .node-rect').length).toBeGreaterThan(20);
    click('#card-aix'); await frames(2);
    expect(document.querySelector('#drawer')!.classList.contains('open')).toBe(true);
    expect(document.querySelector('#drawerNow')!.textContent).toContain('Patient A');
    key('Escape');
    expect(errors).toEqual([]);
  }, 60_000);

  it('compare, lesson try-it, sweep stepping, pause/step and present', async () => {
    key('4'); click('[data-lesson="1"]'); click('#tryBtn'); await frames(30);
    expect(document.querySelector('#pane-cmp')!.hasAttribute('hidden')).toBe(false);
    expect(document.querySelector('#cmpDiffers')!.textContent!.length).toBeGreaterThan(10);
    click('[data-act="swap"]'); await frames(20);
    key('5'); key(']'); key(']'); key('['); await frames(5);
    expect(document.querySelector('#sweepSel')!.textContent).toContain('point 2/6');
    (document.activeElement as HTMLElement | null)?.blur?.();
    key(' '); await frames(3);
    expect(document.querySelector('#liveTxt')!.textContent).toBe('Paused');
    key('.'); key('.'); await frames(3);
    key(' '); key('p'); await frames(5); key('p');
    click('#themeBtn'); await frames(3);
    expect(errors).toEqual([]);
  }, 60_000);

  it('a corrupt JSON import is rejected and settings are kept', async () => {
    const before = document.querySelector<HTMLInputElement>('#num-hr')!.value;
    const { importFile } = await import('../src/ui/io');
    const file = new File(['{"format":"pulse-lab","version":2,"patients":{"A":{"preset":"Default adult (45 y)","inputs":{"hr":"fast"},"events":[]},"B":{}}}'], 'bad.json');
    // reach the ctx through a fresh import is not possible; use the file input instead
    const inp = document.querySelector<HTMLInputElement>('#importFile')!;
    Object.defineProperty(inp, 'files', { value: [file], configurable: true });
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 20)); await frames(3);
    expect(document.querySelector('#toast')!.textContent).toMatch(/Import rejected — patients\.A\.inputs\.hr/);
    expect(document.querySelector<HTMLInputElement>('#num-hr')!.value).toBe(before);
    expect(typeof importFile).toBe('function');
    expect(errors).toEqual([]);
  });

  it('a full guided case end to end: stiff aorta before induction', async () => {
    const { CASE_BY_ID } = await import('../src/cases/defs');
    key('1'); click('#casesBtn'); await frames(2);
    expect(document.querySelectorAll('[data-case]').length).toBe(5);
    click('[data-case="induction"]'); await frames(10, 250);
    const panel = document.querySelector('#casePanel')!;
    expect(panel.hasAttribute('hidden')).toBe(false);
    expect(panel.textContent).toContain('Propofol bolus given');
    expect(document.querySelector('#clearPin')!.hasAttribute('hidden')).toBe(false);   // pre-induction baseline pinned
    click('[data-dose="1"]');
    click('[data-give="propofol"][data-mode="bolus"]');
    await frames(120, 250);                                                         // 30 s
    click('[data-dose="0.5"]');
    click('[data-give="phe"][data-mode="infusion"]');
    await frames(700, 250);                                                         // ~3 min
    expect(panel.textContent).toContain('Goal reached');
    CASE_BY_ID.induction.questions.forEach((q, qi) => click(`[data-q="${qi}"][data-o="${q.correct}"]`));
    expect(panel.textContent).toContain('3/3 answered');
    click('#caseFinish'); await frames(2);
    const ov = document.querySelector('#startOverlay')!;
    expect(ov.textContent).toContain('case complete');
    expect(ov.textContent).toMatch(/Goal reached \(held 45 s\)40 \/ 40/);
    expect(ov.textContent).toContain('does not change the MAP fall');
    const total = Number(/(\d+) \/ 100/.exec(ov.querySelector('.score-big')!.textContent!)![1]);
    expect(total).toBeGreaterThanOrEqual(95);
    click('[data-end="close"]');
    expect(panel.hasAttribute('hidden')).toBe(true);
    expect(errors).toEqual([]);
  }, 60_000);

  it('a case without treatment does not reach the goal', async () => {
    click('#casesBtn'); click('[data-case="induction"]'); await frames(4, 250);
    click('[data-dose="1"]'); click('[data-give="propofol"][data-mode="bolus"]');
    await frames(600, 250);
    const panel = document.querySelector('#casePanel')!;
    expect(panel.textContent).not.toContain('Goal reached');
    expect(panel.textContent).toMatch(/lowest MAP so far 6[0-4]/);
    click('#caseFinish'); await frames(2);
    expect(document.querySelector('#startOverlay')!.textContent).toMatch(/Goal reached \(held 45 s\)0 \/ 40/);
    click('[data-end="close"]');
    expect(errors).toEqual([]);
  }, 60_000);

  it('every tab works (clicks and keys 1–9) while a guided case runs, after Quit and after Finish', async () => {
    click('#casesBtn'); click('[data-case="induction"]'); await frames(4, 250);
    click('[data-dose="1"]'); click('[data-give="propofol"][data-mode="bolus"]'); await frames(200, 250);
    await checkAllTabs('during case');
    expect(document.querySelector('#casePanel')!.hasAttribute('hidden')).toBe(false);
    click('#caseQuit'); await frames(2);
    expect(document.querySelector('#casePanel')!.hasAttribute('hidden')).toBe(true);
    await checkAllTabs('after Quit');
    click('#casesBtn'); click('[data-case="bb"]'); await frames(20, 250);
    key('3'); await frames(20, 250);
    click('#caseFinish'); await frames(2);
    click('[data-end="close"]'); await frames(2);
    await checkAllTabs('after Finish');
    expect(errors).toEqual([]);
  }, 120_000);

  it('the young athlete case is an exploration with three things to try', async () => {
    click('#casesBtn'); click('[data-case="athlete"]'); await frames(10, 250);
    const panel = document.querySelector('#casePanel')!;
    expect(panel.textContent).toContain('Explored 0 of 3');
    expect(panel.textContent).not.toContain('Goal:');
    const cAo = document.querySelector<HTMLInputElement>('#num-cAo')!;
    cAo.value = '9'; cAo.dispatchEvent(new Event('change', { bubbles: true }));
    await frames(60, 250);
    expect(panel.textContent).toContain('Explored 1 of 3');
    click('#caseFinish'); await frames(2);
    expect(document.querySelector('#startOverlay')!.textContent).toMatch(/Things explored: 1 of 320 \/ 60/);
    click('[data-end="close"]');
    expect(errors).toEqual([]);
  });

  it('the trend plot has one legend (the chips) and a sensible HR axis', async () => {
    expect(document.querySelectorAll('#trendTools .chip').length).toBe(9);
    expect(document.querySelector('#trendTools')!.textContent).toContain('right axis');
  });
});
