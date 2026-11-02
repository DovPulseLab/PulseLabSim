/* "Pressure budget" stacked bars (ported from v1 drawBudget): diastolic + forward wave
   + echo augmentation + arm amplification = cuff SBP. */
import type { Indices } from '../model/indices';
import { col, FONT, setupCanvas } from '../render/theme';

export type BudgetBar = [name: string, m: Indices, nameColor: string];

export function drawBudget(cv: HTMLCanvasElement, bars: BudgetBar[]): void {
  const s = setupCanvas(cv); if (!s) return;
  const { ctx, w: W, h: H } = s;
  ctx.clearRect(0, 0, W, H);
  const fs = Math.round((parseFloat(getComputedStyle(document.body).fontSize) || 14) * 0.8);
  ctx.font = `${fs}px ${FONT}`;
  const stacks = bars.map(([name, m, nc]) => {
    const fwd = m.type === 'C' ? m.PP : m.P1 - m.Pd, aug = m.type === 'C' ? 0 : m.AP, amp = Math.max(0, m.bSBP - m.Ps);
    return { name, nc, top: m.Ps + amp, segs: [
      { v: m.Pd, c: '--line', l: `diastolic ${m.Pd.toFixed(0)}`, dark: true },
      { v: fwd, c: '--fwd', l: `forward ${fwd.toFixed(0)}`, dark: false },
      { v: aug, c: '--bwd', l: aug > 1.5 ? `echo ${aug.toFixed(0)}` : '', dark: false },
      { v: amp, c: '--brach', l: `arm +${amp.toFixed(0)}`, dark: false }] };
  });
  const yMax = Math.max(...stacks.map(b => b.top)) * 1.12;
  const pl = 36, pr = 8, pt = 18, pb = 30, ph = H - pt - pb, pw = W - pl - pr;
  const Y = (v: number) => pt + (1 - v / yMax) * ph;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let v = 0; v <= yMax; v += 40) {
    ctx.strokeStyle = col('--line-2'); ctx.beginPath(); ctx.moveTo(pl, Y(v)); ctx.lineTo(pl + pw, Y(v)); ctx.stroke();
    ctx.fillStyle = col('--ink-3'); ctx.fillText(String(v), pl - 6, Y(v));
  }
  const bw = Math.min(130, pw / (stacks.length * 1.7)), gap = (pw - bw * stacks.length) / (stacks.length + 1);
  stacks.forEach((b, i) => {
    const x = pl + gap + i * (bw + gap); let acc = 0;
    for (const sg of b.segs) {
      if (sg.v <= 0.2) continue;
      const y0 = Y(acc), y1 = Y(acc + sg.v);
      ctx.fillStyle = col(sg.c); ctx.globalAlpha = sg.dark ? 1 : 0.88; ctx.fillRect(x, y1, bw, y0 - y1); ctx.globalAlpha = 1;
      if (sg.l && y0 - y1 > fs + 2) { ctx.fillStyle = sg.dark ? col('--ink-2') : '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(sg.l, x + bw / 2, (y0 + y1) / 2); }
      acc += sg.v;
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = col(b.nc); ctx.font = `600 ${fs}px ${FONT}`;
    ctx.fillText(b.name, x + bw / 2, pt + ph + 7);
    ctx.font = `${fs}px ${FONT}`; ctx.textBaseline = 'bottom'; ctx.fillStyle = col('--ink-2');
    ctx.fillText(`cuff SBP ${b.top.toFixed(0)}`, x + bw / 2, Y(b.top) - 3);
  });
}
