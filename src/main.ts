/* Pulse Lab Simulator v2: bootstrap, render loop, keyboard and wiring. */
import './ui/style.css';
import type { Warp } from './engine/clock';
import { simulate } from './model/solve';
import { redrawChart } from './render/chart';
import { clearColourCache } from './render/theme';
import { createStore, type Action } from './state/store';
import { TABS, type TabId } from './state/types';
import { decodeHash, encodeState } from './state/url';
import { buildCards, renderCards } from './ui/cards';
import type { Ctx } from './ui/context';
import { $, $$, toast } from './ui/dom';
import { buildDrawer, closeDrawer, drawerOpen, explainFocused, openDrawer, renderDrawer } from './ui/drawer';
import { copyLink, exportAs, importFile } from './ui/io';
import { initLayout, initTheme, togglePresent, toggleTheme } from './ui/layout';
import { Live } from './ui/live';
import { drawMonitor } from './ui/monitor';
import { buildRail, renderRail, renderRailBeat } from './ui/rail';
import { buildShell } from './ui/shell';
import { endTour, showStart, startSeen, startTour, tourActive } from './ui/start';
import { buildCmp, renderCmp } from './ui/tabs/cmp';
import { buildImp, renderImp } from './ui/tabs/imp';
import { buildLearn, renderLearnBeat, renderLesson, setCausalRef } from './ui/tabs/learn';
import { beatSim, buildSim, renderSim, tickSim } from './ui/tabs/sim';
import { renderMethods, renderValidation } from './ui/tabs/static';
import { buildSweep, renderSweep, stepSweep } from './ui/tabs/sweep';
import { buildTrend, renderTrend } from './ui/trend';

initTheme();
buildShell(document.getElementById('root')!);

const decoded = decodeHash(location.hash);
const store = createStore(decoded.state);
const live = new Live(decoded.state);

const ctx: Ctx = {
  store, live,
  active: () => store.get().app.active,
  tab: () => store.get().app.tab,
  explain: id => openDrawer(ctx, id),
  syncClock: () => store.dispatch({ type: 'setClock', t: live.clock.t })
};

buildRail(ctx); buildCards(); buildTrend(ctx); buildDrawer();
buildSim(ctx); buildCmp(ctx); buildLearn(ctx); buildSweep(ctx); buildImp(ctx);
renderLesson();

/* ---------- rendering ---------- */
const BEAT_TABS: Partial<Record<TabId, () => void>> = {
  sim: () => beatSim(ctx), cmp: () => renderCmp(ctx), learn: () => renderLearnBeat(ctx),
  sweep: () => renderSweep(ctx), imp: () => renderImp(ctx)
};

/** Everything that depends on the latest beat. */
function renderBeatViews(): void {
  renderCards(ctx); renderRailBeat(ctx); renderTrend(ctx); renderDrawer(ctx);
  BEAT_TABS[ctx.tab()]?.();
}

function renderTop(): void {
  const s = store.get(), app = s.app;
  $('#liveBtn').classList.toggle('paused', app.paused);
  $('#liveTxt').textContent = app.paused ? 'Paused' : 'Live';
  $('#liveBtn').setAttribute('aria-label', app.paused ? 'Paused: press to resume' : 'Live: press to pause');
  $<HTMLButtonElement>('#stepBtn').disabled = !app.paused;
  $$('#warp button').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.warp) === app.warp)));
  $<HTMLButtonElement>('#undoBtn').disabled = !s.history.past.length;
  $<HTMLButtonElement>('#redoBtn').disabled = !s.history.future.length;
  $('#pinBtn').textContent = app.pinned ? `Re-pin baseline (${app.pinned.patient})` : 'Pin baseline';
  $('#clearPin').hidden = !app.pinned;
  for (const t of TABS) {
    $(`#tab-${t}`).setAttribute('aria-selected', String(t === app.tab));
    $(`#pane-${t}`).hidden = t !== app.tab;
  }
}

function showTab(tab: TabId): void {
  if (tab === 'valid') renderValidation();
  else if (tab === 'eq') renderMethods();
  else if (tab === 'learn') { renderLesson(); renderLearnBeat(ctx); }
  BEAT_TABS[tab]?.();
}

/** Redraw all visible canvases (after resize, theme or Present). */
function renderAll(): void {
  clearColourCache();
  renderTrend(ctx);
  showTab(ctx.tab());
  for (const c of $$<HTMLCanvasElement>('canvas')) if (c.offsetParent) redrawChart(c);
}

/* ---------- store → live runtime ---------- */
const PATIENT_ACTIONS = new Set<Action['type']>(['setInput', 'loadPreset', 'resetPatient', 'giveDrug', 'stopDrug', 'removeDrug', 'setPatients', 'undo', 'redo']);
let lastCoalesce: string | undefined;
let urlTimer = 0;

store.subscribe((s, a) => {
  const app = s.app;
  if (PATIENT_ACTIONS.has(a.type)) {
    // reference beat for the cause → effect map: the beat just before this change
    const coalesce = a.type === 'setInput' ? a.coalesce : undefined;
    if (!coalesce || coalesce !== lastCoalesce) setCausalRef(live.beats[app.active]?.res ?? null);
    lastCoalesce = coalesce;
    live.sync(app);
  }
  switch (a.type) {
    case 'replace': live.reset(app); break;
    case 'setPaused': live.setPaused(a.paused); break;
    case 'setWarp': live.setWarp(a.warp); break;
    case 'pin': live.pinned = simulate(a.params); break;
    case 'clearPin': live.pinned = null; break;
    case 'setActive': setCausalRef(null); break;
  }
  if (s.warnings.length) toast(s.warnings.join(' · '), 'err');
  if (a.type !== 'setClock') {
    renderTop(); renderRail(ctx);
    if (a.type === 'setTab') showTab(app.tab);
    else renderBeatViews();
  }
  clearTimeout(urlTimer);
  urlTimer = window.setTimeout(() => history.replaceState(null, '', encodeState(store.get().app)), 400);
});

/* ---------- beats and frames ---------- */
let dirty = true;
live.onBeat(id => { if (id === ctx.active() || ctx.tab() === 'cmp') dirty = true; });

let last = performance.now();
function frame(now: number): void {
  live.frame(Math.min(0.25, (now - last) / 1000));
  last = now;
  const id = ctx.active();
  const mon = $<HTMLCanvasElement>('#monitor');
  if (mon.offsetParent) {
    drawMonitor(mon, live.recent[id], live.clock.t);
    const b = live.beats[id];
    if (b) $('#monReadout').textContent = `Patient ${id} · HR ${b.res.params.hr.toFixed(0)} · cuff ${b.res.m.bSBP.toFixed(0)}/${b.res.m.bDBP.toFixed(0)} · MAP ${b.res.m.map.toFixed(0)}`;
  }
  if (dirty) { dirty = false; renderBeatViews(); }
  if (ctx.tab() === 'sim') tickSim(ctx, now);
  requestAnimationFrame(frame);
}

/* ---------- top bar ---------- */
const setPaused = (p: boolean) => { ctx.syncClock(); store.dispatch({ type: 'setPaused', paused: p }); };
const pin = () => { const b = live.beats[ctx.active()]; if (b) store.dispatch({ type: 'pin', params: b.effect.params }); };
const stepBeat = () => { if (!live.clock.paused) setPaused(true); live.step(ctx.active()); ctx.syncClock(); dirty = true; };
const present = () => { togglePresent(); requestAnimationFrame(renderAll); };

$('.tabs').addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]'); if (b) store.dispatch({ type: 'setTab', tab: b.dataset.tab as TabId }); });
$('#liveBtn').addEventListener('click', () => setPaused(!live.clock.paused));
$('#stepBtn').addEventListener('click', stepBeat);
$('#warp').addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-warp]'); if (b) store.dispatch({ type: 'setWarp', warp: Number(b.dataset.warp) as Warp }); });
$('#undoBtn').addEventListener('click', () => store.dispatch({ type: 'undo' }));
$('#redoBtn').addEventListener('click', () => store.dispatch({ type: 'redo' }));
$('#pinBtn').addEventListener('click', pin);
$('#clearPin').addEventListener('click', () => store.dispatch({ type: 'clearPin' }));
$('#copyLink').addEventListener('click', () => void copyLink(ctx));
$('#presentBtn').addEventListener('click', present);
$('#themeBtn').addEventListener('click', () => { toggleTheme(); renderAll(); });
$('#helpBtn').addEventListener('click', () => startTour());
const menu = $('#exportMenu'), menuBtn = $('#exportBtn');
const closeMenu = () => { menu.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false'); };
menuBtn.addEventListener('click', e => { e.stopPropagation(); const o = menu.classList.toggle('open'); menuBtn.setAttribute('aria-expanded', String(o)); if (o) menu.querySelector<HTMLElement>('button')?.focus(); });
menu.addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-exp]'); if (b) { exportAs(ctx, b.dataset.exp!); closeMenu(); } });
document.addEventListener('click', e => { if (!(e.target as HTMLElement).closest('.menu')) closeMenu(); });
$<HTMLInputElement>('#importFile').addEventListener('change', e => {
  const inp = e.target as HTMLInputElement, f = inp.files?.[0];
  if (f) void importFile(ctx, f).finally(() => { inp.value = ''; closeMenu(); });
});

// any element with data-explain opens the drawer
document.addEventListener('click', e => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-explain]');
  if (el && !el.closest('#drawer')) ctx.explain(el.dataset.explain!);
});

/* ---------- keyboard ---------- */
document.addEventListener('keydown', e => {
  const t = (e.target instanceof HTMLElement ? e.target : document.body);
  const typing = t.matches('input[type=number], input[type=text], select, textarea') || t.isContentEditable;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') { if (typing) return; e.preventDefault(); store.dispatch({ type: e.shiftKey ? 'redo' : 'undo' }); return; }
  if (mod && e.key.toLowerCase() === 'y') { if (typing) return; e.preventDefault(); store.dispatch({ type: 'redo' }); return; }
  if (e.key === 'Escape') { if (tourActive()) endTour(); else if (drawerOpen()) closeDrawer(); else closeMenu(); return; }
  if (mod || e.altKey || typing || !$('#startOverlay').hidden) return;
  // range sliders keep arrow keys; other keys still work while a slider has focus
  const k = e.key;
  if (k >= '1' && k <= '7') { store.dispatch({ type: 'setTab', tab: TABS[Number(k) - 1] }); e.preventDefault(); return; }
  switch (k) {
    case ' ': if (t.matches('button, a, summary, [role=button]')) return; e.preventDefault(); setPaused(!live.clock.paused); break;
    case '.': stepBeat(); break;
    case 'b': case 'B': pin(); break;
    case 'r': case 'R': store.dispatch({ type: 'resetPatient' }); break;
    case 'p': case 'P': present(); break;
    case 'e': case 'E': explainFocused(ctx); break;
    case 'h': case 'H': case '?': startTour(); break;
    case '[': if (ctx.tab() === 'sweep') stepSweep(ctx, -1); break;
    case ']': if (ctx.tab() === 'sweep') stepSweep(ctx, 1); break;
    default: return;
  }
});

/* ---------- layout, resize ---------- */
let resizeRaf = 0;
const onResize = () => { cancelAnimationFrame(resizeRaf); resizeRaf = requestAnimationFrame(renderAll); };
initLayout(onResize);
window.addEventListener('resize', onResize);

/* ---------- start ---------- */
renderTop(); renderRail(ctx); showTab(ctx.tab());
if (decoded.error) toast(`Link could not be used (${decoded.error}). Defaults loaded.`, 'err', 8000);
else if (decoded.warnings.length) toast(`Link loaded with changes: ${decoded.warnings.slice(0, 3).join('; ')}`, 'err', 8000);
if (!location.hash && !startSeen()) showStart(ctx);
requestAnimationFrame(frame);
