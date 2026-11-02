/* Exports (central PNG, waveforms CSV, metrics CSV, trends CSV, parameters JSON),
   JSON import with schema errors shown, and Copy link. */
import { METRICS } from '../config/metrics';
import { col } from '../render/theme';
import { exportParameters, importParameters } from '../state/importJson';
import { encodeState } from '../state/url';
import type { Ctx } from './context';
import { $, download, toast } from './dom';

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const csvCell = (v: unknown) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function exportAs(ctx: Ctx, kind: string): void {
  const A = ctx.live.beats.A!.res, B = ctx.live.beats.B!.res;
  if (kind === 'png') {
    const src = document.querySelector<HTMLCanvasElement>(ctx.tab() === 'cmp' ? '#cCmpCentral' : '#cCentral');
    if (!src || !src.width) { toast('Open the Simulator or Compare tab to export the central waveform.', 'err'); return; }
    const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    const g = c.getContext('2d')!; g.fillStyle = col('--panel'); g.fillRect(0, 0, c.width, c.height); g.drawImage(src, 0, 0);
    c.toBlob(b => b && download(`pulse-lab-central-${stamp()}.png`, b, 'image/png'), 'image/png');
  } else if (kind === 'csv') {
    const rows = ['time_A_ms,aortic_A,forward_A,reflected_A,flow_A,brachial_A,radial_A,time_B_ms,aortic_B,forward_B,reflected_B,flow_B,brachial_B,radial_B'];
    A.t.forEach((t, i) => rows.push([t * 1000, A.p[i], A.pf[i], A.pb[i], A.q[i], A.brachial[i], A.radial[i], B.t[i] * 1000, B.p[i], B.pf[i], B.pb[i], B.q[i], B.brachial[i], B.radial[i]].map(v => v.toFixed(3)).join(',')));
    download(`pulse-lab-waveforms-${stamp()}.csv`, rows.join('\n'), 'text/csv');
  } else if (kind === 'metrics') {
    const rows = ['group,metric,unit,patient_A,patient_B'];
    for (const g of METRICS) for (const it of g.items) {
      const a = A.m[it.k], b = B.m[it.k];
      rows.push([g.g, it.l, it.u, typeof a === 'number' ? a.toFixed(4) : a, typeof b === 'number' ? b.toFixed(4) : b].map(csvCell).join(','));
    }
    download(`pulse-lab-metrics-${stamp()}.csv`, rows.join('\n'), 'text/csv');
  } else if (kind === 'trends') {
    const keys = ['t', 'hr', 'sbp', 'dbp', 'map', 'pp', 'cSBP', 'cDBP', 'cPP', 'bPP', 'aix', 'pwv'] as const;
    const head = ['patient', 't_s', 'hr_bpm', 'cuff_sbp', 'cuff_dbp', 'map', 'cuff_pp', 'central_sbp', 'central_dbp', 'central_pp', 'brachial_pp', 'aix_pct', 'aortic_pwv_ms'];
    const rows = [head.join(',')];
    for (const id of ['A', 'B'] as const) for (const s of ctx.live.sims[id].trend.window()) rows.push([id, ...keys.map(k => s[k].toFixed(k === 't' ? 2 : 3))].join(','));
    download(`pulse-lab-trends-${stamp()}.csv`, rows.join('\n'), 'text/csv');
  } else if (kind === 'json') {
    const f = exportParameters(ctx.store.get().app, { A: ctx.live.beats.A!.effect.params, B: ctx.live.beats.B!.effect.params });
    download(`pulse-lab-parameters-${stamp()}.json`, JSON.stringify(f, null, 2), 'application/json');
  }
}

export async function importFile(ctx: Ctx, file: File): Promise<void> {
  let text: string;
  try { text = await file.text(); } catch { toast('Could not read the file.', 'err'); return; }
  ctx.syncClock();
  const r = importParameters(text, ctx.store.get().app.t);
  if (!r.ok) { toast(`Import rejected — ${r.error}. Current settings kept.`, 'err', 8000); return; }
  ctx.store.dispatch({ type: 'setPatients', patients: r.patients });
  toast(`Imported ${file.name}.` + (r.warnings.length ? ` ${r.warnings.length} value${r.warnings.length > 1 ? 's' : ''} adjusted: ${r.warnings.slice(0, 3).join('; ')}${r.warnings.length > 3 ? '…' : ''}` : ''));
}

export function linkUrl(ctx: Ctx): string {
  ctx.syncClock();
  return location.href.split('#')[0] + encodeState(ctx.store.get().app);
}

export async function copyLink(ctx: Ctx): Promise<void> {
  const url = linkUrl(ctx);
  history.replaceState(null, '', url);
  try { await navigator.clipboard.writeText(url); toast('Link copied. It reopens this exact state, including drugs and time.'); }
  catch { toast('Copy failed; the link is in the address bar.', 'err'); }
}
