/* Left control rail: patient A/B, profile, sliders (Heart · Large arteries · Periphery) and Drugs. */
import { ACUTE_DRUGS, ALL_CONTROLS, ALL_DRUGS, DRUGS, DRUG_EMAX, DRUG_KINETICS, ENGINE, PRESETS, controlText, isStudyPreset, type Control, type ParamKey } from '../config/physiology';
import { calibrate } from '../model/calibrate';
import { stepInput } from '../state/inputs';
import type { PatientId } from '../state/types';
import type { Ctx } from './context';
import { $, $$, esc } from './dom';

const GROUPS: { name: string; keys: ParamKey[]; note?: string }[] = [
  { name: 'Patient', keys: ['sex', 'age', 'height', 'weight'],
    note: 'Changing sex, age, height or weight recalculates aortic diameter, aortic PWV and stroke volume from healthy reference data. You can still adjust those sliders afterwards.' },
  { name: 'Physiologic response', keys: ['resp', 'hrRest'],
    note: 'Independent lets each input act alone, for studying one variable at a time. Pacing, Exercise and Physiologic add the body\'s usual responses to a change in heart rate or a drug; the adjusted values show in red beside each slider.' },
  { name: 'Heart', keys: ['hr', 'sv', 'etScale'] },
  { name: 'Large arteries', keys: ['cAo', 'diam'] },
  { name: 'Periphery', keys: ['radius', 'cMus', 'gamma', 'lpScale'] }
];
const CTRL = Object.fromEntries(ALL_CONTROLS.map(c => [c.key, c])) as Record<ParamKey, Control>;

let dose = 1;

export function buildRail(ctx: Ctx): void {
  const root = $('#controls');
  root.innerHTML = GROUPS.map(g => `<details class="group" open><summary>${g.name}<span class="chev" aria-hidden="true">▾</span></summary>
    ${g.note ? `<p class="fine">${esc(g.note)}</p>` : ''}
    ${g.keys.map(k => { const c = CTRL[k]; return c.kind === 'toggle' ? `<div class="ctrl" data-key="${k}">
      <div class="ctrl-top"><button class="lbl" data-explain="${k}" title="${esc(c.tip)}">${c.label}</button><span class="ctrl-val" id="val-${k}"></span></div>
      <div class="seg" role="group" aria-label="${esc(c.label)}" id="seg-${k}">${(c.options ?? []).map((o, i) => `<button data-toggle="${k}" data-v="${i}" aria-pressed="false">${esc(o)}</button>`).join('')}</div>
      <div class="ctrl-derived" id="der-${k}"></div></div>` : `<div class="ctrl" data-key="${k}">
      <div class="ctrl-top"><button class="lbl" data-explain="${k}" title="${esc(c.tip)}">${c.label}</button><span class="ctrl-val" id="val-${k}"></span></div>
      <div class="ctrl-row">
        <input type="range" id="in-${k}" min="${c.min}" max="${c.max}" step="${c.view?.step ?? c.step}" aria-label="${esc(c.label)} (${esc(c.view?.unit ?? c.unit)})">
        <button class="step" data-step="-1" aria-label="Decrease ${esc(c.label)}">−</button>
        <input type="number" id="num-${k}" min="${c.min}" max="${c.max}" step="${c.view?.step ?? c.step}" aria-label="${esc(c.label)} value in ${esc(c.view?.unit ?? c.unit)}">
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

  // sliders (a control with a view, e.g. ejection duration in ms, converts on the way in)
  let dragId = 0;
  const inputs = () => ctx.store.get().app.patients[ctx.active()].inputs;
  const stored = (c: Control, raw: string | number): unknown => {
    if (!c.view) return raw;
    const x = Number(raw), p = inputs();
    if (!Number.isFinite(x) || String(raw).trim() === '') return raw;
    const lo = Math.ceil(c.view.to(c.min, p)), hi = Math.floor(c.view.to(c.max, p));
    return Number(c.view.from(Math.min(hi, Math.max(lo, x)), p).toFixed(6));
  };
  for (const c of ALL_CONTROLS) {
    if (c.kind === 'toggle') continue;
    const range = $<HTMLInputElement>(`#in-${c.key}`), num = $<HTMLInputElement>(`#num-${c.key}`);
    range.addEventListener('pointerdown', () => { dragId = Date.now(); });
    range.addEventListener('input', () => ctx.store.dispatch({ type: 'setInput', key: c.key, value: stored(c, Number(range.value)), coalesce: `drag-${c.key}-${dragId || Date.now()}` }));
    range.addEventListener('change', () => { dragId = 0; });
    num.addEventListener('change', () => ctx.store.dispatch({ type: 'setInput', key: c.key, value: stored(c, num.value) }));
    num.addEventListener('keydown', e => { if (e.key === 'Enter') num.blur(); });
  }
  root.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    const tg = t.closest<HTMLElement>('[data-toggle]');
    if (tg) { ctx.store.dispatch({ type: 'setInput', key: tg.dataset.toggle as ParamKey, value: Number(tg.dataset.v) }); return; }
    const st = t.closest<HTMLElement>('[data-step]');
    if (st) {
      const key = st.closest<HTMLElement>('[data-key]')!.dataset.key as ParamKey;
      const c = CTRL[key], p = inputs(), dir = Number(st.dataset.step) as 1 | -1;
      const value = c.view ? stored(c, Math.round(c.view.to(p[key], p)) + dir * c.view.step) : stepInput(key, p[key], dir);
      ctx.store.dispatch({ type: 'setInput', key, value });
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
  const names = Object.keys(PRESETS);
  const opts = (list: string[]) => list.map(k => `<option>${esc(k)}</option>`).join('');
  sel.innerHTML = `<optgroup label="Teaching profiles">${opts(names.filter(n => !isStudyPreset(n)))}</optgroup>
    <optgroup label="Healthy study profiles">${opts(names.filter(isStudyPreset))}</optgroup>`;
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
function respNote(r: { mode: number; svFactor: number; svrFactor: number; mapOpen: number; mapSet: number } | null, ins: { hr: number; hrRest: number }): string {
  if (!r) return 'each input acts on its own';
  const pct = (f: number) => `${f >= 1 ? '+' : '−'}${Math.abs(100 * (f - 1)).toFixed(0)} %`;
  const sv = Math.abs(r.svFactor - 1) > 0.005 ? `SV ${pct(r.svFactor)}` : 'SV unchanged';
  const svr = Math.abs(r.svrFactor - 1) > 0.005 ? `SVR ${pct(r.svrFactor)}` : 'SVR unchanged';
  if (r.mode === 1) return `cardiac output held: ${sv} at ${ins.hr.toFixed(0)} vs ${ins.hrRest.toFixed(0)} bpm rest`;
  if (r.mode === 2) return ins.hr > ins.hrRest ? `exercise: ${sv}, ${svr}, MAP target ${r.mapSet.toFixed(0)} mmHg` : 'exercise: acts only above resting HR';
  return `${sv} · baroreflex ${svr}${Math.abs(r.mapOpen - r.mapSet) < 0.5 ? `, MAP at set point ${r.mapSet.toFixed(0)} mmHg` : `, MAP ${r.mapOpen.toFixed(0)} pulled toward set point ${r.mapSet.toFixed(0)} mmHg`}`;
}

const shortPreset = (p: string): string => p.replace(/\s*\(.*\)/, '') + (p.match(/\((.*)\)/) ? ', ' + p.match(/\((.*)\)/)![1] : '');

/** Re-render everything that depends on the store (not on beats). */
export function renderRail(ctx: Ctx): void {
  const app = ctx.store.get().app, id = ctx.active(), p = app.patients[id];
  $('#ptSwitch').innerHTML = (['A', 'B'] as PatientId[]).map(k => `<button class="pt" role="tab" data-pt="${k}" aria-selected="${k === id}">
    <span class="pt-name"><span class="pt-dot"></span>Patient ${k}</span><span class="pt-sub">${esc(shortPreset(app.patients[k].preset))} · ${esc(drugText(ctx, k))}</span></button>`).join('');
  $('#rail').classList.toggle('ptB', id === 'B');
  $<HTMLSelectElement>('#preset').value = p.preset;
  for (const c of ALL_CONTROLS) {
    const v = p.inputs[c.key];
    if (c.kind === 'toggle') {
      $$(`#seg-${c.key} button`).forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.v) === Math.round(v))));
      continue;
    }
    const range = $<HTMLInputElement>(`#in-${c.key}`), num = $<HTMLInputElement>(`#num-${c.key}`);
    if (c.view) {
      // the ms range moves with HR and sex: 0.8–1.2 × the Weissler value
      const lo = Math.ceil(c.view.to(c.min, p.inputs)), hi = Math.floor(c.view.to(c.max, p.inputs));
      for (const el of [range, num]) { el.min = String(lo); el.max = String(hi); }
      const shown = Math.round(c.view.to(v, p.inputs));
      if (document.activeElement !== range) range.value = String(shown);
      if (document.activeElement !== num) num.value = String(shown);
      continue;
    }
    if (document.activeElement !== range) range.value = String(v);
    if (document.activeElement !== num) num.value = String(Number(v.toFixed(Math.max(c.f, 2))));
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
    const set = controlText(c, p.inputs[c.key], p.inputs), a = controlText(c, act[c.key], act);
    $(`#val-${c.key}`).innerHTML = a !== set
      ? `${esc(set)} → <span class="act" title="value after drugs">${esc(a)}</span>`
      : esc(set);
  }
  const cal = calibrate(p.inputs);
  const range2 = (r: [number, number], f: number) => `${r[0].toFixed(f)}–${r[1].toFixed(f)}`;
  const etNote = Math.abs(m.et - CTRL.etScale.view!.to(act.etScale, act)) >= 1
    ? `model uses ${m.et.toFixed(0)} ms (held between 150 ms and 60 % of the ${(60000 / act.hr).toFixed(0)} ms cycle)`
    : `${act.sex === 1 ? 'women' : 'men'}: Weissler ${(act.sex === 1 ? 418 - 1.6 * act.hr : 413 - 1.7 * act.hr).toFixed(0)} ms at ${act.hr.toFixed(0)} bpm`;
  const hrNote = act.hr > 150 ? ' · above 150 bpm the Weissler line is extrapolated'
    : act.hr > 120 && m.co > 8 ? ' · at high HR real stroke volume falls; lower SV to match your scenario' : '';
  const der: Partial<Record<ParamKey, string>> = {
    hr: `ejection ${m.et.toFixed(0)} ms · cycle ${(60000 / act.hr).toFixed(0)} ms${beat.effect.reflexBpm ? ` · baroreflex ${beat.effect.reflexBpm.toFixed(1)} bpm` : ''}${hrNote}`,
    sv: `cardiac output ${m.co.toFixed(2)} L/min · reference for age/sex/size ${cal.sv.toFixed(0)} mL${beat.effect.svRise > 0.05 ? ` · +${beat.effect.svRise.toFixed(1)} mL from slower HR` : ''}`,
    etScale: `${etNote} · setting ${act.etScale.toFixed(2)} × Weissler`,
    radius: `SVR ${m.svrDyn.toFixed(0)} dyn·s·cm⁻⁵`, cAo: `operating ${m.cAoOp.toFixed(1)} m/s at MAP ${m.map.toFixed(0)} · healthy ${p.inputs.age.toFixed(0)} y: ${cal.cAo.toFixed(1)} (${range2(cal.pwvRange, 1)}) m/s`,
    diam: `compliance ${m.ctot.toFixed(2)} mL/mmHg · predicted ${cal.diam.toFixed(2)} (${range2(cal.diamRange, 2)}) cm`, cMus: `reflected-wave path ${m.cPath.toFixed(1)} m/s`,
    gamma: `echo amplitude ${m.bwdAmp.toFixed(1)} mmHg`, lpScale: `Lp ${m.lp.toFixed(0)} cm · Δtp ${m.dtp.toFixed(0)} ms`, height: `Lp ${m.lp.toFixed(0)} cm`,
    sex: `ejection line ${act.sex === 1 ? '418 − 1.6·HR' : '413 − 1.7·HR'} ms`, age: 'sets the calibration only',
    resp: respNote(beat.effect.response, p.inputs),
    hrRest: Math.round(p.inputs.resp) === 0 ? 'used only by Pacing, Exercise and Physiologic' : `SV slider = stroke volume at ${p.inputs.hrRest.toFixed(0)} bpm`,
    weight: `BSA ${cal.bsa.toFixed(2)} m² (Du Bois) · BMI ${(p.inputs.weight / Math.pow(p.inputs.height / 100, 2)).toFixed(1)}`
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
