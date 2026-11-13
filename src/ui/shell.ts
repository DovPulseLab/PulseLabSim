/* Static page structure. Tabs are keyed 1–8. */
import type { TabId } from '../state/types';
import { DEFAULT_BEATS, DEFAULT_RATE, EXPORT_BEATS, EXPORT_RATES } from '../model/waveformExport';

export const TAB_LABELS: [TabId, string][] = [
  ['sim', 'Simulator'], ['cycle', 'Cardiac cycle'], ['cmp', 'Compare A vs B'], ['learn', 'Learn'], ['sweep', 'Sweep'],
  ['imp', 'Impedance'], ['valid', 'Validation'], ['eq', 'Methods']
];

export const DISCLAIMER = 'Educational model only; not a medical device; not for diagnosis or treatment decisions.';
export const CREDIT = 'Created by Dov Greenwald, 2026';

export function buildShell(root: HTMLElement): void {
  root.innerHTML = `
<div class="app" id="app">
  <header class="topbar">
    <div class="brand">
      <div class="logo" aria-hidden="true"><svg viewBox="0 0 40 24" width="36" height="22"><path d="M1 18 C6 18 7 3 11 3 C14 3 14 10 17 10 C20 10 20 6 23 6 C27 6 27 18 39 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></div>
      <h1>Pulse Lab Simulator</h1>
    </div>
    <nav class="tabs" role="tablist" aria-label="Views">
      ${TAB_LABELS.map(([id, l], i) => `<button class="tab" role="tab" id="tab-${id}" aria-controls="pane-${id}" aria-selected="false" data-tab="${id}"><span class="k">${i + 1}</span>${l}</button>`).join('')}
    </nav>
    <div class="toolbar">
      <button class="live" id="liveBtn" aria-live="polite" title="Pause / resume (Space)"><span class="dot"></span><span id="liveTxt">Live</span></button>
      <button class="btn icon" id="stepBtn" title="Step one beat while paused (.)" aria-label="Step one beat">⏭</button>
      <div class="seg" role="group" aria-label="Time warp" id="warp">
        <button data-warp="0.25" aria-pressed="false">×¼</button><button data-warp="0.5" aria-pressed="false">×½</button><button data-warp="1" aria-pressed="true">×1</button>
      </div>
      <button class="btn icon hide-narrow" id="undoBtn" title="Undo (Ctrl+Z)" aria-label="Undo">↶</button>
      <button class="btn icon hide-narrow" id="redoBtn" title="Redo (Ctrl+Shift+Z)" aria-label="Redo">↷</button>
      <button class="btn" id="casesBtn" title="Guided clinical cases">Cases</button>
      <button class="btn" id="pinBtn" title="Pin the current beat as a baseline (B)">Pin baseline</button>
      <button class="btn sm" id="clearPin" title="Remove the baseline" hidden>Clear</button>
      <div class="menu">
        <button class="btn" id="exportBtn" aria-haspopup="true" aria-expanded="false">Export ▾</button>
        <div class="menu-list" id="exportMenu" role="menu">
          <button data-exp="png" role="menuitem">Central waveform (PNG)</button>
          <button data-exp="csv" role="menuitem">Waveforms (CSV)</button>
          <button data-exp="metrics" role="menuitem">Metrics (CSV)</button>
          <button data-exp="trends" role="menuitem">Trends, last 10 min (CSV)</button>
          <button data-exp="json" role="menuitem">Parameters (JSON)</button>
          <hr>
          <div class="menu-sub">Synchronized aortic pressure &amp; flow</div>
          <div class="menu-opts">
            <label class="menu-opt">Rate <select id="expFs" aria-label="Sampling rate">${EXPORT_RATES.map(r => `<option value="${r}"${r === DEFAULT_RATE ? ' selected' : ''}>${r} Hz</option>`).join('')}</select></label>
            <label class="menu-opt">Beats <select id="expBeats" aria-label="Number of beats">${EXPORT_BEATS.map(b => `<option value="${b}"${b === DEFAULT_BEATS ? ' selected' : ''}>${b}</option>`).join('')}</select></label>
          </div>
          <button data-exp="xlsx" role="menuitem">Pressure &amp; flow waveforms (Excel)</button>
          <hr>
          <label role="menuitem">Import parameters (JSON)… <input type="file" id="importFile" accept=".json,application/json" class="sr-only"></label>
        </div>
      </div>
      <button class="btn" id="copyLink" title="Copy a link to this exact state">Copy link</button>
      <button class="btn hide-narrow" id="presentBtn" title="Larger type for projection (P)">Present</button>
      <button class="btn icon" id="themeBtn" title="Light / dark theme" aria-label="Toggle light or dark theme">◐</button>
      <button class="btn icon" id="helpBtn" title="Tour and keyboard shortcuts (H)" aria-label="Help">?</button>
    </div>
  </header>

  <aside class="rail" id="rail" aria-label="Patient controls">
    <button class="rail-handle" id="railHandle" aria-expanded="false">Controls</button>
    <div class="pt-switch" id="ptSwitch" role="tablist" aria-label="Patient to edit"></div>
    <div class="side-row">
      <label class="field">Starting profile <select id="preset"></select></label>
      <button class="btn" id="resetBtn" title="Reset this patient (R)">Reset</button>
    </div>
    <div id="controls"></div>
  </aside>
  <div class="rz v rz1" data-rz="rail" tabindex="0" role="separator" aria-orientation="vertical" aria-label="Resize controls panel"></div>

  <main class="main" id="main">
    <section class="case-panel" id="casePanel" aria-label="Guided case" aria-live="polite" hidden></section>
    ${TAB_LABELS.map(([id]) => `<section class="tabpane" id="pane-${id}" role="tabpanel" aria-labelledby="tab-${id}" hidden></section>`).join('')}
  </main>
  <div class="rz v rz2" data-rz="cards" tabindex="0" role="separator" aria-orientation="vertical" aria-label="Resize metric cards"></div>
  <aside class="cards" id="cards" aria-label="Key measures"></aside>

  <div class="rz h rz3" data-rz="bottom" tabindex="0" role="separator" aria-orientation="horizontal" aria-label="Resize monitor and trend"></div>
  <section class="bottom" id="bottom" aria-label="Monitor and trends">
    <div class="card monitor-card">
      <div class="card-h"><h2>Monitor <span class="muted">· 25 mm/s · <span style="color:#7ee2b8">central</span> / <span style="color:#ffd166">cuff (brachial)</span></span></h2><span class="muted" id="monReadout"></span></div>
      <div class="canvas-wrap monitor-wrap"><canvas id="monitor" aria-label="Scrolling central and brachial pressure traces"></canvas></div>
    </div>
    <div class="card">
      <div class="card-h"><h2>Trends <span class="muted">· per beat, last 10 min · drag to zoom</span></h2><div class="trend-tools" id="trendTools"></div></div>
      <div class="canvas-wrap"><canvas id="trend"></canvas></div>
    </div>
  </section>
  <footer class="site-foot"><span><b>${DISCLAIMER}</b></span><span>${CREDIT} · <a href="${import.meta.env.BASE_URL}v1/">Classic version (v1)</a> · Keys: 1–8 tabs · Space pause · . step · B baseline · E explain · H help</span></footer>
</div>
<aside class="drawer" id="drawer" aria-label="Explanation" aria-hidden="true"><header><h2 id="drawerTitle">Explain</h2><button class="btn icon" id="drawerClose" aria-label="Close explanation">✕</button></header><div class="body" id="drawerBody"></div></aside>
<div class="overlay" id="startOverlay" hidden></div>
<div class="tour-ring" id="tourRing" hidden></div>
<div class="tour" id="tour" role="dialog" aria-live="polite" hidden></div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>`;
}
