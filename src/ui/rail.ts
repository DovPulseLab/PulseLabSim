/* Left control rail: patient A/B, profile, sliders (Heart · Large arteries · Periphery) and Drugs. */
import { ACUTE_DRUGS, ALL_CONTROLS, ALL_DRUGS, DRUGS, DRUG_EMAX, DRUG_KINETICS, ENGINE, PRESETS, type Control, type ParamKey } from '../config/physiology';
import { stepInput } from '../state/inputs';
import type { PatientId } from '../state/types';
import type { Ctx } from './context';
import { $, $$, esc } from './dom';

const GROUPS: { name: string; keys: ParamKey[] }[] = [
  { name: 'Heart', keys: ['hr', 'sv', 'etScale'] },
  { name: 'Large arteries', keys: ['cAo', 'diam'] },
  { name: 'Periphery', keys: ['radius', 'cMus', 'gamma', 'lpScale', 'height'] }
];
const CTRL = Object.fromEntries(ALL_CONTROLS.map(c => [c.key, c])) as Record<ParamKey, Control>;

let dose = 1;

export function buildRail(ctx: Ctx): void {
  const root = $('#controls');
  root.innerHTML = GROUPS.map(g => `<details class="group" open><summary>${g.name}<span class="chev" aria-hidden="true">▾</span></summary>
    ${g.keys.map(k => { const c = CTRL[k]; return `<div class="ctrl" data-key="${k}">
      <div class="ctrl-top"><button class="lbl" data-explain="${k}" title="${esc(c.tip)}">${c.label}</button><span class="ctrl-val" id="val-${k}"></span></div>
      <div class="ctrl-row">
        <input type="range" id="in-${k}" min="${c.min}" max="${c.max}" step="${c.step}" aria-label="${esc(c.label)}${c.unit ? ` (${c.unit})` : ''}">
        <button class="step" data-step="-1" aria-label="Decrease ${esc(c.label)}">−</button>
        <input type="number" id="num-${k}" min="${c.min}" max="${c.max}" step="${c.step}" aria-label="${esc(c.label)} value">
        <button class="step" data-step="1" aria-label="Increase ${esc(c.label)}">+</button>
      </div><div class="ctrl-derived" id="der-${k}"></div></div>`; }).join('')}
  </details>`).join('') + `<details class="group" open><summary>Drugs<span class="chev" aria-hidden="true">▾</span></summary>
    <div class="drug-tools"><span>Dose</span><div class="seg" role="group" aria-label="Dose" id="doseSeg">
      <button data-dose="0.5" aria-pressed="false">½×</button><button data-dose="1" aria-pressed="true">1×</button><button data-dose="2" aria-pressed="false">2×</button></div>
      <span class="muted">Effect % = share of one full dose (max ${Math.round(DRUG_EMAX.emax * 100)} %)</span></div>
    <div class="active-drugs" id="activeDrugs" aria-live="polite"></div>
    <div class="drug-sub">Acute (bolus or infusion)</div><div id="drugsAcute"></div>
    <div class="drug-sub">Long-term (v1 drugs)</div><div id="drugsChronic"></div>
    <p class="fine">Drug magnitudes and time constants are illustrative teaching values (see Methods).</p>
  </details>`;

  // sliders
  let dragId = 0;
  for (const c of ALL_CONTROLS) {
    const range = $<HTMLInputElement>(`#in-${c.key}`), num = $<HTMLInputElement>(`#num-${c.key}`);
    range.addEventListener('pointerdown', () => { dragId = Date.now(); });
    range.addEventListener('input', () => ctx.store.dispatch({ type: 'setInput', key: c.key, value: Number(range.value), coalesce: `drag-${c.key}-${dragId || Date.now()}` }));
    range.addEventListener('change', () => { dragId = 0; });
    num.addEventListener('change', () => ctx.store.dispatch({ type: 'setInput', key: c.key, value: num.value }));
    num.addEventListener('keydown', e => { if (e.key === 'Enter') num.blur(); });
  }
  root.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    const st = t.closest<HTMLElement>('[data-step]');
    if (st) {
      const key = st.closest<HTMLElement>('[data-key]')!.dataset.key as ParamKey;
      const cur = ctx.store.get().app.patients[ctx.active()].inputs[key];
      ctx.store.dispatch({ type: 'setInput', key, value: stepInput(key, cur, Number(st.dataset.step) as 1 | -1) });
      return;
    }
    const d = t.closest<HTMLElement>('[data-dose]');
    if (d) { dose = Number(d.dataset.dose); $$('#doseSeg button').forEach(b => b.setAttribute('aria-pressed', String(b === d))); return; }
    const give = t.closest<HTMLElement>('[data-give]');
    if (give) {
      ctx.syncClock();
      const drug = give.dataset.give!, mode = give.dataset.mode as 'bolus' | 'infusion';
      const steady = give.dataset.steady === '1';
      const T = ctx.live.beats[ctx.active()]?.res.d.T ?? 0.86;
      ctx.store.dispatch({ type: 'giveDrug', drug, mode, dose, steady, rampS: steady ? ENGINE.rampBeats * T : undefined });
      return;
    }
    const stop = t.closest<HTMLElement>('[data-stopdrug]');
    if (stop) {
      ctx.syncClock();
      const drug = stop.dataset.stopdrug!;
      for (const ev of ctx.store.get().app.patients[ctx.active()].events) if (ev.drug === drug && ev.mode === 'infusion' && ev.tStop == null) ctx.store.dispatch({ type: 'stopDrug', id: ev.id });
      return;
    }
    const rm = t.closest<HTMLElement>('[data-rmdrug]');
    if (rm) {
      const drug = rm.dataset.rmdrug!;
      for (const ev of ctx.store.get().app.patients[ctx.active()].events.filter(x => x.drug === drug)) ctx.store.dispatch({ type: 'removeDrug', id: ev.id });
    }
  });

  // patient switch, preset, reset
  $('#ptSwitch').addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-pt]'); if (b) ctx.store.dispatch({ type: 'setActive', patient: b.dataset.pt as PatientId }); });
  const sel = $<HTMLSelectElement>('#preset');
  sel.innerHTML = Object.keys(PRESETS).map(k => `<option>${esc(k)}</option>`).join('');
  sel.addEventListener('change', () => ctx.store.dispatch({ type: 'loadPreset', preset: sel.value }));
  $('#resetBtn').addEventListener('click', () => ctx.store.dispatch({ type: 'resetPatient' }));
  $('#railHandle').addEventListener('click', () => {
    const open = $('#rail').classList.toggle('sheet-open');
    $('#railHandle').setAttribute('aria-expanded', String(open));
  });
}

const drugText = (ctx: Ctx, id: PatientId) => {
  const evs = ctx.store.get().app.patients[id].events;
  const names = [...new Set(evs.map(e => ALL_DRUGS[e.drug].short))];
  return names.length ? names.join(' + ') : 'no drugs';
};
const shortPreset = (p: string) => p.replace(/\s*\(.*\)/, '') + (p.match(/\((.*)\)/) ? ', ' + p.match(/\((.*)\)/)![1] : '');

/** Re-render everything that depends on the store (not on beats). */
export function renderRail(ctx: Ctx): void {
  const app = ctx.store.get().app, id = ctx.active(), p = app.patients[id];
  $('#ptSwitch').innerHTML = (['A', 'B'] as PatientId[]).map(k => `<button class="pt" role="tab" data-pt="${k}" aria-selected="${k === id}">
    <span class="pt-name"><span class="pt-dot"></span>Patient ${k}</span><span class="pt-sub">${esc(shortPreset(app.patients[k].preset))} · ${esc(drugText(ctx, k))}</span></button>`).join('');
  $('#rail').classList.toggle('ptB', id === 'B');
  $<HTMLSelectElement>('#preset').value = p.preset;
  for (const c of ALL_CONTROLS) {
    const range = $<HTMLInputElement>(`#in-${c.key}`), num = $<HTMLInputElement>(`#num-${c.key}`);
    if (document.activeElement !== range) range.value = String(p.inputs[c.key]);
    if (document.activeElement !== num) num.value = String(Number(p.inputs[c.key].toFixed(Math.max(c.f, 2))));
  }
  const btn = (drug: string, mode: string, label: string, steady = false) =>
    `<button class="btn sm" data-give="${drug}" data-mode="${mode}"${steady ? ' data-steady="1"' : ''}>${label}</button>`;
  const running = (drug: string) => p.events.some(e => e.drug === drug && e.mode === 'infusion' && e.tStop == null);
  $('#drugsAcute').innerHTML = Object.entries(ACUTE_DRUGS).map(([k, d]) => `<div class="drug"><span class="nm">${d.label}<small>τ on ${DRUG_KINETICS[k].tauOn} s · off ${DRUG_KINETICS[k].tauOff} s</small></span><span class="acts">
      ${DRUG_KINETICS[k].modes.includes('bolus') ? btn(k, 'bolus', 'Bolus') : ''}
      ${running(k) ? `<button class="btn sm on" data-stopdrug="${k}">Stop</button>` : btn(k, 'infusion', 'Infuse')}</span></div>`).join('');
  $('#drugsChronic').innerHTML = Object.entries(DRUGS).map(([k, d]) => `<div class="drug"><span class="nm">${d.label}</span><span class="acts">
      ${running(k) ? `<button class="btn sm on" data-stopdrug="${k}">Stop</button>` : btn(k, 'infusion', 'Start', true)}</span></div>`).join('');
}

/** Per-beat updates: "set → actual" values, derived text and active-drug effect levels. */
export function renderRailBeat(ctx: Ctx): void {
  const id = ctx.active(), beat = ctx.live.beats[id]; if (!beat) return;
  const p = ctx.store.get().app.patients[id];
  const act = beat.effect.params, m = beat.res.m;
  for (const c of ALL_CONTROLS) {
    const set = p.inputs[c.key], a = act[c.key];
    const differs = Math.abs(a - set) >= c.step / 2;
    $(`#val-${c.key}`).innerHTML = differs
      ? `${set.toFixed(c.f)} → <span class="act" title="value after drugs">${a.toFixed(c.f)}</span> ${c.unit}`
      : `${set.toFixed(c.f)} ${c.unit}`;
  }
  const der: Partial<Record<ParamKey, string>> = {
    hr: `ejection ${m.et.toFixed(0)} ms · cycle ${(60000 / act.hr).toFixed(0)} ms${beat.effect.reflexBpm ? ` · baroreflex ${beat.effect.reflexBpm.toFixed(1)} bpm` : ''}`,
    sv: `cardiac output ${m.co.toFixed(2)} L/min${beat.effect.svRise > 0.05 ? ` · +${beat.effect.svRise.toFixed(1)} mL from slower HR` : ''}`, etScale: `ejection ${m.et.toFixed(0)} ms`,
    radius: `SVR ${m.svrDyn.toFixed(0)} dyn·s·cm⁻⁵`, cAo: `operating ${m.cAoOp.toFixed(1)} m/s at MAP ${m.map.toFixed(0)}`,
    diam: `compliance ${m.ctot.toFixed(2)} mL/mmHg`, cMus: `reflected-wave path ${m.cPath.toFixed(1)} m/s`,
    gamma: `echo amplitude ${m.bwdAmp.toFixed(1)} mmHg`, lpScale: `Lp ${m.lp.toFixed(0)} cm · Δtp ${m.dtp.toFixed(0)} ms`, height: `Lp ${m.lp.toFixed(0)} cm`
  };
  for (const c of ALL_CONTROLS) $(`#der-${c.key}`).textContent = der[c.key] ?? '';
  const levels = beat.effect.levels.filter(l => l.effect > 0.002 || p.events.some(e => e.drug === l.drug && e.mode === 'infusion' && e.tStop == null));
  const html = levels.map(l => {
    const d = ALL_DRUGS[l.drug], evs = p.events.filter(e => e.drug === l.drug);
    const run = evs.some(e => e.mode === 'infusion' && e.tStop == null);
    const pct = l.effect * 100;
    return `<div class="active-drug"><div class="row"><b>${d.short}</b><span class="mono">${pct.toFixed(0)} %</span></div>
      <div class="effbar" title="effect: ${pct.toFixed(0)} % of one full dose; the tick marks 100 %"><span style="width:${Math.min(100, pct / (DRUG_EMAX.emax * 100) * 100).toFixed(1)}%"></span><i></i></div>
      <div class="row"><span class="muted">${evs.length} dose${evs.length > 1 ? 's' : ''}${run ? ' · infusing' : ''}${clampNote(beat.effect.clamped)}</span><span>
      ${run ? `<button class="btn sm" data-stopdrug="${l.drug}">Stop</button>` : ''}<button class="btn sm" data-rmdrug="${l.drug}" title="Remove from the timeline">Remove</button></span></div></div>`;
  }).join('');
  const el = $('#activeDrugs');
  if (el.dataset.html !== html) { el.innerHTML = html || '<span class="muted" style="font-size:.86em">No drugs active.</span>'; el.dataset.html = html; }
}
const clampNote = (k: string[]) => k.length ? ` · held at limit: ${k.join(', ')}` : '';
