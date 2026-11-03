/* Guided cases UI: picker, live goal panel with questions, and the end screen. */
import { CASES, CASE_BY_ID } from '../cases/defs';
import { answer, caseSetup, finish, holdFraction, score, startProgress, stepProgress } from '../cases/engine';
import type { CaseDef, CaseProgress } from '../cases/types';
import type { Beat } from '../engine/patient';
import type { Ctx } from './context';
import { $, esc } from './dom';

let def: CaseDef | null = null;
let prog: CaseProgress | null = null;
let qHtml = '';

export const caseActive = () => def != null && prog != null && !prog.finished;

export function openCasePicker(ctx: Ctx): void {
  const ov = $('#startOverlay');
  ov.innerHTML = `<div class="start" role="dialog" aria-modal="true" aria-labelledby="pickTitle">
    <h2 id="pickTitle">Guided cases</h2>
    <p>Each case loads a patient into Patient A and gives you a goal. The goal is checked live, every beat, and must hold for a short time. Answer the questions as you go. Finish when you are ready to see your score and the teaching points.</p>
    <div class="case-list">${CASES.map((c, i) => `<button class="start-card" data-case="${c.id}"><span><b>${i + 1}. ${esc(c.title)}</b><br><span>${esc(c.summary)}</span></span><span class="btn sm">Start</span></button>`).join('')}</div>
    <div class="start-foot"><span>Score: goal reached ${40} · goal kept ${20} · answers ${40}</span><button class="btn" id="pickClose">Close</button></div></div>`;
  ov.hidden = false;
  ov.querySelector<HTMLElement>('[data-case]')!.focus();
  const close = () => { ov.hidden = true; ov.innerHTML = ''; ov.onclick = null; ov.onkeydown = null; };
  ov.onclick = e => {
    const t = e.target as HTMLElement;
    if (t.id === 'pickClose' || t === ov) { close(); return; }
    const b = t.closest<HTMLElement>('[data-case]'); if (b) { close(); startCase(ctx, b.dataset.case!); }
  };
  ov.onkeydown = e => { if (e.key === 'Escape') close(); };
}

export function startCase(ctx: Ctx, id: string): void {
  const d = CASE_BY_ID[id]; if (!d) return;
  ctx.syncClock();
  const app = ctx.store.get().app;
  const s = caseSetup(d, app.t, app.nextEventId);
  ctx.store.dispatch({ type: 'setActive', patient: 'A' });
  ctx.store.dispatch({ type: 'setPatients', patients: { A: { preset: d.setup.preset, inputs: s.inputs, events: s.events }, B: app.patients.B } });
  if (app.paused) ctx.store.dispatch({ type: 'setPaused', paused: false });
  def = d; prog = startProgress(d, app.t); qHtml = '';
  // start the case patient cleanly (no 3-beat ramp from the previous patient)
  ctx.live.reset(ctx.store.get().app);
  const baseline = s.baseline ?? (d.setup.pinStart ? ctx.live.beats.A!.effect.params : null);
  if (baseline) ctx.store.dispatch({ type: 'pin', params: baseline });
  else if (app.pinned) ctx.store.dispatch({ type: 'clearPin' });
  ctx.store.dispatch({ type: 'setTab', tab: 'sim' });
  renderCasePanel(ctx, true);
  $('#casePanel').scrollIntoView({ block: 'nearest' });
}

/** Called for every beat of patient A. */
export function caseBeat(ctx: Ctx, b: Beat): void {
  if (!def || !prog || prog.finished) return;
  const app = ctx.store.get().app;
  prog = stepProgress(def, prog, { t: b.tStart, tCase: b.tStart - prog.tStart, m: b.res.m, params: b.effect.params, events: app.patients.A.events, tStart: prog.tStart });
}

export function renderCasePanel(ctx: Ctx, full = false): void {
  const el = $('#casePanel');
  if (!def || !prog) { el.hidden = true; return; }
  el.hidden = false;
  if (full || !el.querySelector('#caseLive')) {
    el.innerHTML = `<div class="ch"><h2><span class="eyebrow">Guided case</span>${esc(def.title)}</h2>
      <span><button class="btn sm" id="caseRestart">Restart</button> <button class="btn sm primary" id="caseFinish">Finish case</button> <button class="btn sm" id="caseQuit">Quit</button></span></div>
      <div class="case-goal">Goal: ${esc(def.goal.text)}</div>
      <div id="caseLive"></div>
      <details ${full ? 'open' : ''}><summary>Patient and hints</summary><p class="brief">${def.brief}</p><ul class="brief">${def.hints.map(h => `<li>${esc(h)}</li>`).join('')}</ul></details>
      <details open id="caseQs"><summary>Questions</summary><div id="caseQList"></div></details>`;
    el.onclick = e => {
      const t = e.target as HTMLElement;
      if (t.id === 'caseFinish') endCase(ctx);
      else if (t.id === 'caseQuit') { def = null; prog = null; renderCasePanel(ctx); }
      else if (t.id === 'caseRestart') startCase(ctx, def!.id);
      else {
        const o = t.closest<HTMLElement>('[data-q]');
        if (o && prog) { prog = answer(prog, Number(o.dataset.q), Number(o.dataset.o)); renderQuestions(); }
      }
    };
    qHtml = '';
  }
  const t = ctx.live.clock.t, h = holdFraction(def, prog, t);
  const status = prog.reachedAt != null
    ? (prog.met ? '✓ Goal reached. Keep it there, answer the questions, then press Finish.' : '✓ Goal reached earlier, but not met now: bring it back (this counts toward the score).')
    : prog.met ? `Holding… ${Math.max(0, def.goal.holdS - (t - (prog.holdStart ?? t))).toFixed(0)} s to go` : `Not met yet. Must hold for ${def.goal.holdS} s.`;
  $('#caseLive').innerHTML = `<ul class="goal-parts">${prog.parts.map(p => `<li class="${p.ok ? 'ok' : ''}">${p.ok ? '✓' : '✗'} ${esc(p.label)} <span class="v">${esc(p.value)}</span></li>`).join('')}</ul>
    <div class="hold"><span class="bar" aria-hidden="true"><span style="width:${(h * 100).toFixed(0)}%"></span></span><span>${status}</span>
    ${def.showLowestMap && Number.isFinite(prog.lowestMap) ? `<span class="muted">· lowest MAP so far ${prog.lowestMap.toFixed(0)} mmHg</span>` : ''}</div>`;
  renderQuestions();
}

function renderQuestions(): void {
  if (!def || !prog) return;
  const p = prog;
  const html = def.questions.map((q, qi) => {
    const a = p.answers[qi];
    return `<div class="case-q"><p>${qi + 1}. ${esc(q.q)}</p><div class="opts" role="group">${q.options.map((o, oi) =>
      `<button class="opt ${a == null ? '' : oi === q.correct ? 'right' : oi === a ? 'wrong' : ''}" data-q="${qi}" data-o="${oi}" ${a == null ? '' : 'disabled'}>${a != null && oi === q.correct ? '✓ ' : a === oi ? '✗ ' : ''}${esc(o)}</button>`).join('')}</div>
      ${a == null ? '' : `<div class="why">${a === q.correct ? '<b>Correct.</b> ' : '<b>Not quite.</b> '}${esc(q.explain)}</div>`}</div>`;
  }).join('');
  if (html === qHtml) return;
  qHtml = html;
  $('#caseQList').innerHTML = html;
  const n = p.answers.filter(x => x != null).length;
  $('#caseQs').querySelector('summary')!.textContent = `Questions (${n}/${def.questions.length} answered)`;
}

function endCase(ctx: Ctx): void {
  if (!def || !prog) return;
  prog = finish(prog);
  const d = def, s = score(d, prog);
  const ov = $('#startOverlay');
  ov.innerHTML = `<div class="start" role="dialog" aria-modal="true" aria-labelledby="endTitle">
    <h2 id="endTitle">${esc(d.title)}: case complete</h2>
    <div class="score-big">${s.total} / 100</div>
    <div class="score-rows">
      <div><span>Goal reached (held ${d.goal.holdS} s)</span><b>${s.reached} / 40</b></div>
      <div><span>Goal kept after reaching it</span><b>${s.kept} / 20</b></div>
      <div><span>Questions: ${s.correct} of ${s.nQuestions} correct</span><b>${s.answers} / 40</b></div>
    </div>
    <h3>Teaching points</h3><ul>${d.teaching.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    ${d.note ? `<div class="note"><b>Model note.</b> ${esc(d.note)}</div>` : ''}
    <p class="fine">Educational model only; drug effects are illustrative teaching values.</p>
    <div class="start-foot"><span><button class="btn" data-end="retry">Try again</button> <button class="btn" data-end="pick">Another case</button></span><button class="btn primary" data-end="close">Keep exploring</button></div></div>`;
  ov.hidden = false;
  ov.querySelector<HTMLElement>('[data-end="close"]')!.focus();
  const close = () => { ov.hidden = true; ov.innerHTML = ''; ov.onclick = null; ov.onkeydown = null; };
  ov.onclick = e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-end]'); if (!b) return;
    close();
    if (b.dataset.end === 'retry') startCase(ctx, d.id);
    else if (b.dataset.end === 'pick') { def = null; prog = null; renderCasePanel(ctx); openCasePicker(ctx); }
    else { def = null; prog = null; renderCasePanel(ctx); }
  };
  ov.onkeydown = e => { if (e.key === 'Escape') { close(); def = null; prog = null; renderCasePanel(ctx); } };
}

/** For tests: current case state. */
export const caseState = () => ({ def, prog, score: def && prog ? score(def, prog) : null });
