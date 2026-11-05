/* Start screen (disclaimer, credit, three ways in) and a short skippable tour (H reopens). */
import type { Ctx } from './context';
import { $ } from './dom';
import { CREDIT, DISCLAIMER } from './shell';

const SEEN = 'pulselab-v2-started';

export function showStart(ctx: Ctx, openCases: () => void): void {
  const ov = $('#startOverlay');
  ov.innerHTML = `<div class="start" role="dialog" aria-modal="true" aria-labelledby="startTitle">
    <h2 id="startTitle">Pulse Lab Simulator</h2>
    <p>A live, beat-by-beat model of the arterial pulse. Change the heart, the arteries or give a drug, and watch the waveform, the reflected wave and blood pressure respond.</p>
    <div class="disclaimer"><b>${DISCLAIMER}</b></div>
    <div class="start-cards">
      <button class="start-card" data-start="free"><b>Free explore</b><span>One patient, every control. Pin a baseline and change anything.</span></button>
      <button class="start-card" data-start="cases"><b>Guided cases</b><span>Five clinical cases: a goal to reach live, questions, a score and teaching points.</span></button>
      <button class="start-card" data-start="cmp"><b>Compare two patients</b><span>Patients A and B side by side, with what differs and why.</span></button>
    </div>
    <div class="start-foot"><span>${CREDIT}</span><span><label><input type="checkbox" id="startTour" checked> Show the 60-second tour</label></span></div>
  </div>`;
  ov.hidden = false;
  const first = ov.querySelector<HTMLElement>('[data-start="free"]')!; first.focus();
  const close = (mode: string) => {
    ov.hidden = true; ov.innerHTML = ''; ov.onclick = null; ov.onkeydown = null; ov.onchange = null;
    try { sessionStorage.setItem(SEEN, '1'); } catch { /* private mode */ }
    if (mode === 'cmp') ctx.store.dispatch({ type: 'setTab', tab: 'cmp' });
    else ctx.store.dispatch({ type: 'setTab', tab: 'sim' });
    if (mode === 'cases') { openCases(); return; }
    if (tourWanted) startTour();
  };
  let tourWanted = true;
  ov.onchange = e => { if ((e.target as HTMLElement).id === 'startTour') tourWanted = (e.target as HTMLInputElement).checked; };
  ov.onclick = e => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-start]'); if (b && !b.hasAttribute('disabled')) close(b.dataset.start!); };
  ov.onkeydown = e => { if (e.key === 'Escape') close('free'); };
}

export const startSeen = (): boolean => { try { return sessionStorage.getItem(SEEN) === '1'; } catch { return false; } };

interface Step { sel: string; text: string; }
const STEPS: Step[] = [
  { sel: '#cCentral', text: 'This is the central aortic pressure, beating live. Forward and reflected waves add up to the measured curve. Click any curve to explain it.' },
  { sel: '#controls', text: 'Change the heart, the large arteries or the periphery here. Each change eases in over 3 beats. Number boxes and ± buttons work too.' },
  { sel: '#drugsAcute', text: 'Give a drug as a bolus or an infusion. It acts with realistic onset and offset, and repeat doses saturate.' },
  { sel: '#pinBtn', text: 'Pin a baseline (B) to overlay the current beat in grey and see ▲/▼ changes on every card.' },
  { sel: '#casesBtn', text: 'Guided cases: five clinical scenarios with a live goal, questions, a score and teaching points.' },
  { sel: '#cards', text: 'Key measures. Click any card for its definition, formula, normal range and what moves it.' },
  { sel: '#trend', text: 'Trends over the last 10 minutes, one sample per beat. Drug markers sit on top. Drag to zoom.' },
  { sel: '.tabs', text: 'Watch the cardiac cycle, compare two patients, learn cause and effect, sweep an input, or look at impedance. Keys 1–8. Press H any time for this tour.' }
];
const STEP_MS = 7500;
let tourTimer = 0, tourIdx = 0, tourT0 = 0;

export function startTour(): void { tourIdx = 0; showStep(); }

export function endTour(): void {
  cancelAnimationFrame(tourTimer); tourTimer = 0;
  $('#tour').hidden = true; $('#tourRing').hidden = true;
}
export const tourActive = () => !$('#tour').hidden;

function showStep(): void {
  const s = STEPS[tourIdx];
  const target = document.querySelector<HTMLElement>(s.sel);
  const box = $('#tour'), ring = $('#tourRing');
  if (!target || !target.getClientRects().length) { if (tourIdx < STEPS.length - 1) { tourIdx++; showStep(); } else endTour(); return; }
  target.scrollIntoView({ block: 'nearest' });
  const r = target.getBoundingClientRect();
  Object.assign(ring.style, { left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` });
  ring.hidden = false;
  box.innerHTML = `<div>${s.text}</div><div class="tbar"><span id="tourBar" style="width:0"></span></div>
    <div class="tacts"><span>${tourIdx + 1} / ${STEPS.length}</span><span><button class="btn sm" id="tourSkip">Skip tour</button> <button class="btn sm" id="tourNext">${tourIdx === STEPS.length - 1 ? 'Done' : 'Next'}</button></span></div>`;
  box.hidden = false;
  const bw = Math.min(340, window.innerWidth - 24), bh = box.offsetHeight;
  let left = r.right + 12, top = r.top;
  if (left + bw > window.innerWidth - 12) { left = Math.max(12, Math.min(r.left, window.innerWidth - bw - 12)); top = r.bottom + 12; }
  if (top + bh > window.innerHeight - 12) top = Math.max(12, r.top - bh - 12);
  Object.assign(box.style, { left: `${left}px`, top: `${top}px` });
  $('#tourSkip').onclick = endTour;
  $('#tourNext').onclick = next;
  $('#tourNext').focus();
  tourT0 = performance.now();
  cancelAnimationFrame(tourTimer);
  const tick = (now: number) => {
    const f = (now - tourT0) / STEP_MS;
    const bar = document.getElementById('tourBar'); if (bar) bar.style.width = `${Math.min(100, f * 100)}%`;
    if (f >= 1) next(); else tourTimer = requestAnimationFrame(tick);
  };
  tourTimer = requestAnimationFrame(tick);
}
function next(): void { if (tourIdx >= STEPS.length - 1) endTour(); else { tourIdx++; showStep(); } }
