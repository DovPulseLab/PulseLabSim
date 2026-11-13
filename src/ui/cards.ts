/* Right-hand metric cards with change vs the pinned baseline (▲ green / ▼ red, by direction). */
import { CARDS } from '../config/metrics';
import type { Ctx } from './context';
import { $, delta } from './dom';

export function buildCards(): void {
  const root = $('#cards');
  const card = (c: typeof CARDS[number]) => `<button class="mcard${c.lv ? ' lv' : ''}" data-explain="${c.explain}" id="card-${c.id}" aria-label="${c.l}: open explanation"${c.lv ? ' hidden' : ''}>
    <div class="k">${c.l}</div><div class="v"><span class="num"></span><small>${c.u}</small></div><div class="d same">&nbsp;</div></button>`;
  root.innerHTML = CARDS.filter(c => !c.lv).map(card).join('') +
    `<div class="cards-sec" id="cardsLV" hidden>Left ventricle <span>(Ventricle v3)</span></div>` +
    CARDS.filter(c => c.lv).map(card).join('') +
    `<div class="cards-note" id="cardsNote"></div>`;
}

export function renderCards(ctx: Ctx): void {
  const beat = ctx.live.beats[ctx.active()]; if (!beat) return;
  const r = beat.res, base = ctx.live.pinned;
  const lvOn = !!r.lv;
  $('#cardsLV').hidden = !lvOn;
  for (const c of CARDS) {
    const el = $(`#card-${c.id}`);
    if (c.lv) { el.hidden = !lvOn; if (!lvOn) continue; }
    el.querySelector('.num')!.textContent = c.v(r);
    el.className = `mcard${c.lv ? ' lv' : ''} ${c.st ? c.st(r) : ''}`;
    const d = el.querySelector('.d')!;
    const dv = base ? c.d(r, base) : NaN;
    // no change shown against a baseline pinned with the fixed-flow heart (its LV values are blank)
    if (base && Number.isFinite(dv)) { const x = delta(dv, c.f); d.className = `d ${x.cls}`; d.textContent = x.text; }
    else { d.className = 'd same'; d.innerHTML = '&nbsp;'; }
  }
  $('#cardsNote').textContent = base ? `Patient ${ctx.active()} · Δ = change vs pinned baseline (▲ up, ▼ down; colour shows direction only)` : `Patient ${ctx.active()} · press B to pin a baseline`;
}
