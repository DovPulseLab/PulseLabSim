/* Explain drawer: definition, formula, normal adult range, what moves it, citation and
   the current value for the patient being edited. */
import { explainFor } from '../config/explain';
import { METRIC_BY_KEY, type MetricKey } from '../config/metrics';
import { ALL_CONTROLS } from '../config/physiology';
import type { Ctx } from './context';
import { $, esc, fmt } from './dom';

let current: string | null = null;
let opener: HTMLElement | null = null;

export function buildDrawer(): void {
  $('#drawerClose').addEventListener('click', closeDrawer);
}

export function openDrawer(ctx: Ctx, id: string): void {
  const e = explainFor(id);
  if (!e) return;
  if (!current) opener = document.activeElement as HTMLElement | null;
  current = id;
  $('#drawerTitle').textContent = e.title;
  $('#drawerBody').innerHTML = `<p>${esc(e.definition)}</p><dl>
    <dt>Now</dt><dd class="now" id="drawerNow"></dd>
    <dt>Formula</dt><dd class="formula">${esc(e.formula)}</dd>
    <dt>Normal adult range</dt><dd>${esc(e.normal)}</dd>
    <dt>What moves it</dt><dd>${e.movedBy.length ? e.movedBy.map(esc).join(', ') : '—'}</dd>
    <dt>Source</dt><dd>${esc(e.cite)}</dd></dl>
    <p class="fine">Typical adult teaching values; the model is educational only.</p>`;
  const d = $('#drawer'); d.classList.add('open'); d.setAttribute('aria-hidden', 'false');
  renderDrawer(ctx);
  $('#drawerClose').focus();
}

export function closeDrawer(): void {
  if (!current) return;
  current = null;
  const d = $('#drawer'); d.classList.remove('open'); d.setAttribute('aria-hidden', 'true');
  opener?.focus?.(); opener = null;
}

export const drawerOpen = () => current != null;

/** Refresh the live value (called each beat while open). */
export function renderDrawer(ctx: Ctx): void {
  if (!current) return;
  const beat = ctx.live.beats[ctx.active()]; if (!beat) return;
  const el = document.getElementById('drawerNow'); if (!el) return;
  const id = current, m = beat.res.m;
  const ctl = ALL_CONTROLS.find(c => c.key === id);
  let text = `Patient ${ctx.active()}: `;
  if (ctl) {
    const set = ctx.store.get().app.patients[ctx.active()].inputs[ctl.key], act = beat.effect.params[ctl.key];
    text += Math.abs(set - act) >= ctl.step / 2 ? `set ${set.toFixed(ctl.f)} → ${act.toFixed(ctl.f)} ${ctl.unit} after drugs` : `${set.toFixed(ctl.f)} ${ctl.unit}`;
  } else if (id in m) {
    const meta = METRIC_BY_KEY[id as MetricKey], v = m[id as MetricKey];
    text += typeof v === 'number' ? `${fmt(v, meta?.f ?? 1)} ${meta?.u ?? ''}` : String(v);
  } else if (id.startsWith('curve:')) {
    text += `central ${m.Ps.toFixed(0)}/${m.Pd.toFixed(0)}, cuff ${m.bSBP.toFixed(0)}/${m.bDBP.toFixed(0)} mmHg`;
  } else text = '—';
  el.textContent = text;
}

/** E key: explain whatever has focus or is hovered; otherwise the central waveform. */
export function explainFocused(ctx: Ctx): void {
  const el = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-explain]')
    ?? document.querySelector<HTMLElement>('[data-explain]:hover');
  ctx.explain(el?.dataset.explain ?? 'curve:central');
}
