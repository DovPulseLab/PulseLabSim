/* Right-hand metric cards with change vs the pinned baseline (▲ green / ▼ red, by direction). */
import { CARDS } from '../config/metrics';
import type { Ctx } from './context';
import { $, delta } from './dom';

export function buildCards(): void {
  const root = $('#cards');
  root.innerHTML = CARDS.map(c => `<button class="mcard" data-explain="${c.explain}" id="card-${c.id}" aria-label="${c.l}: open explanation">
    <div class="k">${c.l}</div><div class="v"><span class="num"></span><small>${c.u}</small></div><div class="d same">&nbsp;</div></button>`).join('') +
    `<div class="cards-note" id="cardsNote"></div>`;
}

export function renderCards(ctx: Ctx): void {
  const beat = ctx.live.beats[ctx.active()]; if (!beat) return;
  const r = beat.res, base = ctx.live.pinned;
  for (const c of CARDS) {
    const el = $(`#card-${c.id}`);
    el.querySelector('.num')!.textContent = c.v(r);
    el.className = `mcard ${c.st ? c.st(r) : ''}`;
    const d = el.querySelector('.d')!;
    if (base) { const x = delta(c.d(r, base), c.f); d.className = `d ${x.cls}`; d.textContent = x.text; }
    else { d.className = 'd same'; d.innerHTML = '&nbsp;'; }
  }
  $('#cardsNote').textContent = base ? `Patient ${ctx.active()} · Δ = change vs pinned baseline (▲ up, ▼ down; colour shows direction only)` : `Patient ${ctx.active()} · press B to pin a baseline`;
}
