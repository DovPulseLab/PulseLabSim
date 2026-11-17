/* Vena caval occlusion card (Cardiac cycle tab): runs the transient preload reduction for the
   active patient on demand, draws the family of pressure–volume loops with the fitted ESPVR,
   isochrones and EDPVR (as in Suga & Sagawa's time-varying elastance figure), and exports
   the run to Excel. */
import type { Params } from '../config/physiology';
import { simulateVCO, type VCOResult } from '../model/vco';
import { DEFAULT_RATE } from '../model/waveformExport';
import { lineChart, type Series } from '../render/chart';
import { col, FONT } from '../render/theme';
import { vcoWorkbook } from '../state/vcoWorkbook';
import { writeXlsx, XLSX_MIME } from '../state/xlsx';
import type { Ctx } from './context';
import { $, download, toast } from './dom';

let last: { r: VCOResult; id: string; key: string } | null = null;
/** A run goes stale when the user's inputs, drug events or the run settings change (not with the
 *  small beat-to-beat drift of drug kinetics). */
const keyOf = (ctx: Ctx, drop: number, beats: number) => {
  const ps = ctx.store.get().app.patients[ctx.active()];
  return JSON.stringify([ctx.active(), ps.inputs, ps.events, drop, beats]);
};

export const VCO_CARD = `
  <div class="card" id="vcoCard">
    <div class="card-h">
      <h2>Vena caval occlusion <span class="muted" id="vcoSub">preload reduction → ESPVR</span></h2>
      <div class="cyc-tools">
        <label class="menu-opt">Fall in P<sub>es</sub> <select id="vcoDrop" aria-label="Requested fall in end-systolic pressure">
          ${[15, 20, 25, 30, 35].map(v => `<option value="${v}"${v === 25 ? ' selected' : ''}>${v} mmHg</option>`).join('')}</select></label>
        <label class="menu-opt">Beats <select id="vcoBeats" aria-label="Occlusion beats">
          ${[8, 10, 12, 15].map(v => `<option value="${v}"${v === 12 ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        <button class="btn sm" id="vcoRun">Run occlusion</button>
        <button class="btn sm" id="vcoXlsx" disabled title="Excel workbook of this run (sampling rate from the Export menu)">Export .xlsx</button>
      </div>
    </div>
    <div id="vcoBody">
      <div class="canvas-wrap" style="height:420px"><canvas id="cVCO" aria-label="Pressure–volume loops during vena caval occlusion"></canvas></div>
      <p class="caption" id="vcoCap">Run the occlusion to see this patient's loops shift left as filling falls.</p>
    </div>
    <p class="fine" id="vcoNote">Transient inferior vena caval occlusion: left-atrial filling pressure is lowered over the chosen number of beats until end-systolic pressure (P<sub>es</sub>) has fallen by the chosen amount (25 mmHg in Little et al. 1989 and Freeman et al. 1986). Heart rate, contractility and the arteries are held constant, as in the first beats after occlusion, before the baroreflex responds. End-systole is the point of maximal P/(V − V<sub>0</sub>) in each loop; the ESPVR is the line through those points, and the dotted isochrones join the points every loop reaches at the same time after the onset of contraction (Suga &amp; Sagawa 1974). The fitted E<sub>es</sub> is lower than the model's input E<sub>es</sub> because LV pressure falls with outflow (ejection effect), more so at higher preload. Needs the Ventricle (v3) heart.</p>
  </div>`;

function params(ctx: Ctx): Params | null {
  const b = ctx.live.beats[ctx.active()];
  return b?.res.lv ? b.res.params : null;
}

export function bindVCO(ctx: Ctx): void {
  $('#vcoRun').addEventListener('click', () => {
    const p = params(ctx);
    if (!p) { toast('Switch Heart model to Ventricle (v3) to run a caval occlusion.', 'err'); return; }
    const drop = Number(($('#vcoDrop') as HTMLSelectElement).value), beats = Number(($('#vcoBeats') as HTMLSelectElement).value);
    const btn = $('#vcoRun') as HTMLButtonElement; btn.disabled = true; btn.textContent = 'Running…';
    setTimeout(() => {   // let the button repaint before the ≈ 1 s solve
      try {
        last = { r: simulateVCO(p, { dropPes: drop, beats }), id: ctx.active(), key: keyOf(ctx, drop, beats) };
        ($('#vcoXlsx') as HTMLButtonElement).disabled = false;
        drawVCO(ctx);
      } catch (e) { toast(`Occlusion run failed: ${(e as Error).message}`, 'err'); }
      btn.disabled = false; btn.textContent = 'Run occlusion';
    }, 30);
  });
  $('#vcoXlsx').addEventListener('click', () => {
    if (!last) return;
    const fs = Number(document.querySelector<HTMLSelectElement>('#expFs')?.value ?? DEFAULT_RATE);
    const app = ctx.store.get().app;
    const sheets = vcoWorkbook(last.r, { fs, created: new Date().toISOString(), version: 'v3.1', patient: `Patient ${last.id} (${app.patients[last.id as 'A' | 'B'].preset})` });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    download(`pulse-lab-vco-${fs}Hz-${stamp}.xlsx`, new Blob([writeXlsx(sheets)], { type: XLSX_MIME }), XLSX_MIME);
    toast(`Exported the occlusion run at ${fs} Hz.`);
  });
}

/** Called on each beat: shows whether the last run still matches the active patient's inputs. */
export function beatVCO(ctx: Ctx): void {
  const p = params(ctx);
  ($('#vcoRun') as HTMLButtonElement).disabled = !p;
  $('#vcoSub').textContent = p ? `preload reduction → ESPVR · Patient ${ctx.active()}` : 'needs Ventricle (v3)';
  if (!last) return;
  const drop = Number(($('#vcoDrop') as HTMLSelectElement).value), beats = Number(($('#vcoBeats') as HTMLSelectElement).value);
  const stale = !p || last.key !== keyOf(ctx, drop, beats);
    const s = document.getElementById('vcoStale');
  if (s) s.style.display = stale ? '' : 'none';
}

export function drawVCO(_ctx: Ctx): void {
  const cv = document.getElementById('cVCO') as HTMLCanvasElement | null;
  if (!cv || !last) return;
  const r = last.r, B = r.beats;
  const allV = B.flatMap(b => b.v), allP = B.flatMap(b => b.p);
  const vMin = Math.min(...allV), vMax = Math.max(...allV), pMax = Math.max(...allP);
  const x0 = Math.min(0, Math.floor(Math.min(r.espvr.v0, vMin - 10) / 10) * 10), x1 = Math.ceil((vMax + 15) / 10) * 10;
  const y1 = Math.ceil(Math.max(pMax * 1.2, r.espvr.slope * (x1 - r.espvr.v0) * 0.8) / 10) * 10;
  const line = (slope: number, v0: number, from: number, to: number) => {
    const xs = [Math.max(from, v0), to], ys = xs.map(v => slope * (v - v0));
    if (ys[1] > y1) { xs[1] = v0 + y1 / slope; ys[1] = y1; }
    return { x: xs, y: ys };
  };
  const series: Series[] = [];
  // isochrones: from their own intercept (or the axis) to a little beyond the largest loop
  for (const iso of r.isochrones) {
    const l = line(iso.slope, iso.v0, x0, vMax + 12);
    series.push({ ...l, color: '--ink-3', width: 1, dash: [2, 3], noHover: true });
  }
  const es = line(r.espvr.slope, r.espvr.v0, r.espvr.v0, x1);
  series.push({ ...es, color: '--ink', width: 1.6, label: `ESPVR  Ees ${r.espvr.slope.toFixed(2)} mmHg/mL`, noHover: true });
  const edX: number[] = [], edY: number[] = [];
  for (let v = Math.max(x0, vMin - 5); v <= x1; v += 1) { const pe = r.edpvr(v); if (pe > y1 * 0.5) break; edX.push(v); edY.push(pe); }
  series.push({ x: edX, y: edY, color: '--ink-3', width: 1.2, dash: [6, 4], label: 'EDPVR', noHover: true });
  // occlusion beats first, the control beat last so it stays on top of the first occlusion beat (same filling)
  B.forEach((b, i) => { if (i > 0) series.push({ x: b.v, y: b.p, color: '--fwd', width: 1.3, alpha: 0.95 - 0.5 * i / B.length, label: i === 1 ? 'Occlusion beats' : undefined }); });
  series.push({ x: B[0].v, y: B[0].p, color: '--accent', width: 2.2, label: 'Control beat' });
  lineChart(cv, {
    series, xLabel: 'LV volume (mL)', yLabel: 'LV pressure (mmHg)', xMin: x0, xMax: x1, yMin: 0, yMax: y1,
    marks: B.map(b => ({ x: b.esv, y: b.esp, color: '--ink', label: '' })),
    legend: true, hover: true, hoverFmt: v => v.toFixed(0),
    overlay: (g, m) => {
      g.save(); g.fillStyle = col('--ink-2'); g.font = `11px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'middle';
      for (const iso of r.isochrones) {
        let vx = vMax + 12, py = iso.slope * (vx - iso.v0);
        if (py > y1) { vx = iso.v0 + y1 / iso.slope; py = y1; }
        g.fillText(`${Math.round(iso.t * 1000)} ms`, m.X(vx) + 3, m.Y(py));
      }
      g.restore();
    },
    ariaLabel: `Caval occlusion: ${B.length} loops, ESPVR slope ${r.espvr.slope.toFixed(2)} mmHg/mL, V0 ${r.espvr.v0.toFixed(0)} mL`
  });
  const b0 = B[0], bl = B[B.length - 1];
  $('#vcoCap').innerHTML =
    `<span id="vcoStale" style="display:none"><b>Inputs have changed since this run — run it again.</b> </span>` +
    `Patient ${last.id}: filling pressure ${r.pla0.toFixed(1)} → ${(r.pla0 - r.dPla).toFixed(1)} mmHg over ${B.length - 1} beats; ` +
    `EDV ${b0.edv.toFixed(0)} → ${bl.edv.toFixed(0)} mL, P<sub>es</sub> ${b0.esp.toFixed(0)} → ${bl.esp.toFixed(0)} mmHg (fall ${r.dropPes.toFixed(1)}${r.reached ? '' : `, short of the ${r.target} mmHg asked: filling pressure cannot fall further`}). ` +
    `<b>ESPVR: E<sub>es</sub> ${r.espvr.slope.toFixed(2)} mmHg/mL, V<sub>0</sub> ${r.espvr.v0.toFixed(0)} mL</b> (r² ${r.espvr.r2.toFixed(3)}); model input E<sub>es</sub> ${r.eesModel.toFixed(2)}, V<sub>0</sub> ${r.v0Model.toFixed(0)}. ` +
    `Isochrone slopes: ${r.isochrones.map(i => `${Math.round(i.t * 1000)} ms ${i.slope.toFixed(2)}`).join(', ')} mmHg/mL.`;
}
