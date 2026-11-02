/* Per-beat trend plot (last 10 min): selectable series with a colour legend, hover readout,
   drag to zoom (double-click resets) and drug markers with stacked, non-overlapping labels. */
import { ALL_DRUGS } from '../config/physiology';
import type { TrendSample } from '../engine/trends';
import { lineChart, type Series } from '../render/chart';
import { col } from '../render/theme';
import type { Ctx } from './context';
import { $, esc } from './dom';

interface TrendDef { k: keyof TrendSample; l: string; c: string; y2?: boolean; on: boolean; }
const DEFS: TrendDef[] = [
  { k: 'cSBP', l: 'Central SBP', c: '--trend-1', on: true },
  { k: 'sbp', l: 'Cuff SBP', c: '--trend-2', on: true },
  { k: 'dbp', l: 'Cuff DBP', c: '--trend-7', on: true },
  { k: 'map', l: 'MAP', c: '--trend-3', on: true },
  { k: 'cPP', l: 'Central PP', c: '--trend-5', on: false },
  { k: 'bPP', l: 'Cuff PP', c: '--trend-8', on: false },
  { k: 'hr', l: 'HR (bpm, right axis)', c: '--trend-4', y2: true, on: true },
  { k: 'aix', l: 'AIx (%, right axis)', c: '--trend-6', y2: true, on: false },
  { k: 'pwv', l: 'Aortic PWV (m/s, right axis)', c: '--radial', y2: true, on: false }
];

let zoom: [number, number] | null = null;

export function buildTrend(ctx: Ctx): void {
  const tools = $('#trendTools');
  tools.innerHTML = DEFS.map((d, i) => `<button class="chip" data-tr="${i}" aria-pressed="${d.on}"><i style="background:var(${d.c})"></i>${esc(d.l.replace(/ \(.*\)/, ''))}</button>`).join('') +
    `<button class="btn sm" id="trendReset" hidden>Reset zoom</button>`;
  tools.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tr]');
    if (b) { const d = DEFS[Number(b.dataset.tr)]; d.on = !d.on; b.setAttribute('aria-pressed', String(d.on)); renderTrend(ctx); }
    if ((e.target as HTMLElement).id === 'trendReset') { zoom = null; renderTrend(ctx); }
  });
}

const mmss = (t: number) => { const s = Math.max(0, Math.round(t)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function trendSamples(ctx: Ctx): TrendSample[] { return ctx.live.sims[ctx.active()].trend.window(); }

export function renderTrend(ctx: Ctx): void {
  const data = trendSamples(ctx);
  $('#trendReset').hidden = !zoom;
  if (data.length < 2) return;
  const t0 = zoom ? zoom[0] : data[0].t, t1 = zoom ? zoom[1] : Math.max(data[data.length - 1].t, data[0].t + 30);
  const xs = data.map(s => s.t);
  const on = DEFS.filter(d => d.on);
  const series: Series[] = on.map(d => ({ x: xs, y: data.map(s => s[d.k] as number), color: d.c, width: d.k === 'cSBP' ? 2.2 : 1.7, label: d.l, y2: d.y2 }));
  const events = ctx.store.get().app.patients[ctx.active()].events;
  lineChart($<HTMLCanvasElement>('#trend'), {
    series, xMin: t0, xMax: t1, xFmt: mmss, hoverX: v => `t = ${mmss(v)}`, hoverFmt: v => v.toFixed(1),
    y2: on.some(d => d.y2) ? { color: '--ink-3' } : undefined, yLabel: 'mmHg', headroom: 0.3,
    legend: true, ariaLabel: 'Per-beat trends over the last 10 minutes',
    onZoom: r => { zoom = r; renderTrend(ctx); },
    overlay: (c, map) => {
      // drug markers; labels stacked into rows so they never overlap
      const rows: number[] = [];
      const top = map.pad.t + 2;
      c.font = `${map.small}px sans-serif`; c.textBaseline = 'top';
      for (const ev of [...events].sort((a, b) => a.t0 - b.t0)) {
        if (ev.t0 < map.xMin || ev.t0 > map.xMax) continue;
        const x = map.X(ev.t0), text = `${ALL_DRUGS[ev.drug].short} ${ev.mode === 'bolus' ? 'bolus' : ev.steady ? 'start' : 'infusion'}`;
        const tw = c.measureText(text).width;
        let row = rows.findIndex(end => end < x);
        if (row < 0) { row = rows.length; rows.push(0); }
        rows[row] = x + 4 + tw + 6;
        const y = top + row * (map.small + 3);
        c.strokeStyle = col('--ink-3'); c.setLineDash([]); c.globalAlpha = 0.7;
        c.beginPath(); c.moveTo(x + .5, y); c.lineTo(x + .5, map.pad.t + map.ph); c.stroke();
        if (ev.tStop != null && ev.tStop >= map.xMin && ev.tStop <= map.xMax) {
          c.setLineDash([3, 3]); c.beginPath(); c.moveTo(map.X(ev.tStop) + .5, y); c.lineTo(map.X(ev.tStop) + .5, map.pad.t + map.ph); c.stroke(); c.setLineDash([]);
        }
        c.globalAlpha = 1;
        c.fillStyle = col('--panel'); c.fillRect(x + 2, y - 1, tw + 4, map.small + 2);
        c.fillStyle = col('--ink-2'); c.fillText(text, x + 4, y);
      }
    }
  });
}
