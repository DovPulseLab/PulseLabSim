/* Cardiac cycle tab: an animated Wiggers diagram for the active patient's current beat.
   ECG, LV / aortic / left-atrial pressure, aortic flow and LV volume on one time axis, with
   the phases, valve events and heart sounds. A cursor sweeps through each beat in time with
   the live heartbeat, or slowed down. Aortic pressure and flow come from the model; the rest
   is schematic (src/model/cycle.ts). */
import { buildCycle, indexAt, phaseAt, type Cycle } from '../../model/cycle';
import { col, FONT, setupCanvas } from '../../render/theme';
import type { BeatResult } from '../../model/solve';
import type { Ctx } from '../context';
import { $, $$ } from '../dom';

type Speed = 1 | 0.5 | 0.25 | 0.125;
let speed: Speed = 0.25;
const show = { la: true, ecg: true, sounds: true };
let cyc: Cycle | null = null, cycFor: BeatResult | null = null;
let slowT = 0, lastNow = 0;

export function buildCycleTab(ctx: Ctx): void {
  $('#pane-cycle').innerHTML = `
  <div class="card">
    <div class="card-h">
      <h2>Cardiac cycle <span class="muted" id="cycSub">Wiggers diagram · one beat</span></h2>
      <div class="cyc-tools">
        <div class="seg" role="group" aria-label="Animation speed" id="cycSpeed">
          <button data-speed="1" aria-pressed="false">Real time</button><button data-speed="0.5" aria-pressed="false">½×</button>
          <button data-speed="0.25" aria-pressed="true">¼×</button><button data-speed="0.125" aria-pressed="false">⅛×</button></div>
        <div class="toggles" id="cycToggles">
          <label><input type="checkbox" data-sh="ecg" checked> ECG</label>
          <label><input type="checkbox" data-sh="la" checked> Left atrium</label>
          <label><input type="checkbox" data-sh="sounds" checked> Heart sounds</label>
        </div>
      </div>
    </div>
    <div class="cyc-now" id="cycNow" aria-live="off"></div>
    <div class="canvas-wrap" style="height:max(440px, calc(100vh - 470px))"><canvas id="cCycle" aria-label="Animated cardiac cycle"></canvas></div>
    <p class="caption" id="cycCap"></p>
    <p class="fine">MVC / MVO = mitral valve closes / opens; AVO / AVC = aortic valve opens / closes; S1 and S2 mark the first and second heart sounds. Aortic pressure and aortic flow are the simulator's own output for this patient. LV and left-atrial pressure outside ejection, LV volume during filling, the ECG and the heart sounds are schematic, built from typical healthy-adult timings (isovolumic contraction 45 ms, LV relaxation τ 40 ms, ejection fraction 60 %, atrial share of filling 22 %) and tied to the modelled beat: the aortic valve opens when LV pressure reaches aortic diastolic pressure and closes at the end of ejection, and LV volume falls by exactly the stroke volume. See Methods §12. The Validation tab (§7) checks these timings against normal ranges.</p>
  </div>`;
  $('#cycSpeed').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-speed]'); if (!b) return;
    speed = Number(b.dataset.speed) as Speed;
    $$('#cycSpeed button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  });
  $('#cycToggles').addEventListener('change', e => { const i = e.target as HTMLInputElement; show[i.dataset.sh as keyof typeof show] = i.checked; });
}

/** Rebuild the cycle when the active patient's beat changes (called on each beat). */
export function beatCycle(ctx: Ctx): void {
  const b = ctx.live.beats[ctx.active()]; if (!b) return;
  if (b.res !== cycFor) { cyc = buildCycle(b.res); cycFor = b.res; }
  const c = cyc!, m = b.res.m;
  $('#cycSub').textContent = `Wiggers diagram · Patient ${ctx.active()} · HR ${b.res.params.hr.toFixed(0)} bpm · cycle ${(c.T * 1000).toFixed(0)} ms`;
  const sys = (c.tAC - c.tMC) * 1000, dia = c.T * 1000 - sys;
  $('#cycCap').innerHTML = `Systole (mitral closure → aortic closure) ${sys.toFixed(0)} ms, diastole ${dia.toFixed(0)} ms (${(100 * dia / (c.T * 1000)).toFixed(0)} % of the cycle). ` +
    `Ejection ${m.et.toFixed(0)} ms; isovolumic relaxation ${((c.tMO - c.tAC) * 1000).toFixed(0)} ms. ` +
    `Aortic pressure ${m.Ps.toFixed(0)}/${m.Pd.toFixed(0)} mmHg; EDV ${c.edv.toFixed(0)} mL, ESV ${c.esv.toFixed(0)} mL, SV ${c.sv.toFixed(0)} mL.` +
    (c.tauIVR < 0.039 ? ` <b>Diastole is very short at this heart rate:</b> relaxation has been compressed to τ ${(c.tauIVR * 1000).toFixed(0)} ms and filling time is limited.` : '');
}

/** Animation frame (while the tab is visible). */
export function tickCycle(ctx: Ctx, now: number): void {
  const canvas = document.getElementById('cCycle') as HTMLCanvasElement | null;
  if (!canvas || !canvas.offsetParent) { lastNow = now; return; }
  const b = ctx.live.beats[ctx.active()];
  if (!b) return;
  if (b.res !== cycFor) beatCycle(ctx);
  const c = cyc!;
  const paused = ctx.live.clock.paused;
  let tDisp: number;
  if (speed === 1) {
    // in step with the live beat: model time since the start of ejection
    const since = Math.max(0, ctx.live.clock.t - b.tStart);
    tDisp = (since + c.tAO) % c.T;
  } else {
    if (!paused) slowT += Math.min(0.1, (now - lastNow) / 1000) * speed;
    tDisp = slowT % c.T;
  }
  lastNow = now;
  draw(canvas, c, tDisp);
  readout(c, tDisp);
}

function readout(c: Cycle, t: number): void {
  const i = indexAt(c, t), ph = phaseAt(c, t);
  const tt = c.t[i];
  const aoOpen = tt >= c.tAO && tt <= c.tAC, mvOpen = tt >= c.tMO || tt < c.tMC;
  const valve = (name: string, open: boolean) => `<span class="valve ${open ? 'open' : 'shut'}">${name} ${open ? 'open' : 'closed'}</span>`;
  const html = `<span class="ph ${ph.systole ? 'sys' : 'dia'}">${ph.systole ? 'Systole' : 'Diastole'} · <b>${ph.label}</b></span>
    ${valve('Mitral', mvOpen)}${valve('Aortic', aoOpen)}
    <span class="mono">LV ${c.lv[i].toFixed(0)} · Ao ${c.ao[i].toFixed(0)} · LA ${c.la[i].toFixed(0)} mmHg · flow ${c.q[i].toFixed(0)} mL/s · volume ${c.vol[i].toFixed(0)} mL · t ${(tt * 1000).toFixed(0)} ms</span>`;
  const el = $('#cycNow');
  if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
}

const PHASE_FILL: Record<string, string> = {
  ivc: 'rgba(0,114,178,0.10)', ejRapid: 'rgba(180,35,47,0.10)', ejReduced: 'rgba(180,35,47,0.05)',
  ivr: 'rgba(0,114,178,0.10)', fillRapid: 'rgba(0,158,115,0.10)', diastasis: 'rgba(0,158,115,0.04)', atrial: 'rgba(230,159,0,0.12)'
};

function draw(canvas: HTMLCanvasElement, c: Cycle, tNow: number): void {
  const { ctx: g, w, h } = setupCanvas(canvas);
  const L = 64, R = 18, top = 52, bottom = 30;
  const panels = [
    ...(show.ecg ? [{ id: 'ecg', f: 0.12 }] : []),
    { id: 'p', f: 0.46 }, { id: 'q', f: 0.18 }, { id: 'v', f: 0.20 }
  ];
  const fsum = panels.reduce((a, p) => a + p.f, 0), gap = 12;
  const avail = h - top - bottom - gap * (panels.length - 1);
  let y = top;
  const box: Record<string, { y0: number; y1: number }> = {};
  for (const p of panels) { const hh = avail * p.f / fsum; box[p.id] = { y0: y, y1: y + hh }; y += hh + gap; }
  const X = (t: number) => L + (w - L - R) * t / c.T;
  const iNow = indexAt(c, tNow), xNow = X(c.t[iNow]);
  const ink = col('--ink'), ink2 = col('--ink-2'), ink3 = col('--ink-3'), line = col('--line');
  g.font = `11px ${FONT}`;

  // phase bands across the whole height, and labels on top
  for (const ph of c.phases) {
    g.fillStyle = PHASE_FILL[ph.id]; g.fillRect(X(ph.t0), top - 4, X(ph.t1) - X(ph.t0), h - top - bottom + 4);
    const cur = tNow >= ph.t0 && tNow < ph.t1;
    const wpx = X(ph.t1) - X(ph.t0);
    if (wpx > 34) {
      g.fillStyle = cur ? ink : ink3; g.font = `${cur ? 'bold ' : ''}11px ${FONT}`; g.textAlign = 'center';
      g.fillText(wpx > 80 ? ph.label : ph.short, (X(ph.t0) + X(ph.t1)) / 2, 14);
    }
  }
  // systole / diastole bar
  g.fillStyle = col('--accent'); g.globalAlpha = 0.85; g.fillRect(X(c.tMC), 20, X(c.tAC) - X(c.tMC), 4); g.globalAlpha = 1;
  g.fillStyle = col('--fwd'); g.globalAlpha = 0.6; g.fillRect(X(c.tAC), 20, X(c.T) - X(c.tAC), 4); g.fillRect(X(0), 20, X(c.tMC) - X(0), 4); g.globalAlpha = 1;
  g.font = `11px ${FONT}`;

  // valve events: dashed line through every panel, short tag above the panels
  const TAG: Record<string, string> = { MC: 'MVC', AO: 'AVO', AC: 'AVC', MO: 'MVO' };
  let lastTagX = -1e9;
  for (const ev of c.events) {
    const x = X(ev.t), on = Math.abs(tNow - ev.t) < 0.03;
    g.strokeStyle = on ? ink : ink3; g.setLineDash([3, 3]); g.lineWidth = on ? 1.5 : 1;
    g.beginPath(); g.moveTo(x, top - 10); g.lineTo(x, h - bottom); g.stroke(); g.setLineDash([]);
    g.font = `${on ? 'bold ' : ''}10.5px ${FONT}`; g.fillStyle = on ? ink : ink2; g.textAlign = 'center';
    const tx = Math.max(x, lastTagX + 30); g.fillText(TAG[ev.id], tx, top - 14); lastTagX = tx;
  }
  g.font = `11px ${FONT}`;

  const series = (id: string, ys: number[], color: string, opts: { lo: number; hi: number; width?: number; dash?: number[] }) => {
    const b = box[id]; const Y = (v: number) => b.y1 - (b.y1 - b.y0) * (v - opts.lo) / (opts.hi - opts.lo);
    const path = (i0: number, i1: number) => { g.beginPath(); for (let i = i0; i <= i1; i++) { const px = X(c.t[i]), py = Y(ys[i]); if (i === i0) g.moveTo(px, py); else g.lineTo(px, py); } g.stroke(); };
    g.setLineDash(opts.dash ?? []); g.strokeStyle = color; g.lineWidth = opts.width ?? 2;
    g.globalAlpha = 0.22; path(0, c.n);              // whole beat, faint
    g.globalAlpha = 1; path(0, iNow);                  // traced so far
    g.setLineDash([]);
    g.fillStyle = color; g.beginPath(); g.arc(xNow, Y(ys[iNow]), 4.5, 0, Math.PI * 2); g.fill();
    return Y;
  };
  const frame = (id: string, label: string, ticks: number[], lo: number, hi: number, fmt = (v: number) => v.toFixed(0)) => {
    const b = box[id]; const Y = (v: number) => b.y1 - (b.y1 - b.y0) * (v - lo) / (hi - lo);
    g.strokeStyle = line; g.lineWidth = 1; g.strokeRect(L, b.y0, w - L - R, b.y1 - b.y0);
    g.fillStyle = ink3; g.textAlign = 'right';
    for (const tv of ticks) { const yy = Y(tv); if (yy < b.y0 - 1 || yy > b.y1 + 1) continue; g.fillText(fmt(tv), L - 6, yy + 4); g.strokeStyle = line; g.globalAlpha = 0.5; g.beginPath(); g.moveTo(L, yy); g.lineTo(w - R, yy); g.stroke(); g.globalAlpha = 1; }
    g.save(); g.translate(14, (b.y0 + b.y1) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillStyle = ink2; g.fillText(label, 0, 0); g.restore();
  };
  const nice = (lo: number, hi: number, n = 4) => { const step = Math.pow(10, Math.floor(Math.log10((hi - lo) / n))); const s = [1, 2, 5, 10].map(k => k * step).find(k => (hi - lo) / k <= n) ?? step * 10; const out: number[] = []; for (let v = Math.ceil(lo / s) * s; v <= hi; v += s) out.push(v); return out; };

  // ECG
  if (show.ecg) {
    frame('ecg', 'ECG', [], -0.35, 1.15);
    series('ecg', c.ecg, ink, { lo: -0.35, hi: 1.15, width: 1.6 });
    const b = box.ecg; g.fillStyle = ink3; g.textAlign = 'center';
    const lbl = (t: number, s: string, yy: number) => g.fillText(s, X(t), yy);
    lbl(c.T - 0.14, 'P', b.y0 + 12); lbl(0.035, 'R', b.y0 + 10); lbl(c.tAC - 0.05, 'T', b.y0 + 12);
    if (show.sounds) {
      for (const [t, s] of [[c.sounds.s1, 'S1'], [c.sounds.s2, 'S2']] as const) {
        const x = X(t), on = Math.abs(tNow - t) < 0.04;
        g.fillStyle = on ? col('--accent') : ink2; g.font = `${on ? 'bold 13px' : '11px'} ${FONT}`;
        g.fillText(s, x + 14, b.y1 - 6); g.font = `11px ${FONT}`;
        g.strokeStyle = on ? col('--accent') : ink3; g.lineWidth = on ? 2 : 1;
        for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(x + k * 2.5, b.y1 - 4 - (on ? 9 : 5) * (1 - Math.abs(k) / 3)); g.lineTo(x + k * 2.5, b.y1 - 4); g.stroke(); }
      }
    }
  }
  // pressures
  const pHi = Math.max(...c.lv, ...c.ao) * 1.22, pLo = 0;
  frame('p', 'Pressure (mmHg)', nice(pLo, pHi, 5), pLo, pHi);
  series('p', c.ao, col('--comp'), { lo: pLo, hi: pHi, width: 2.6 });
  series('p', c.lv, col('--accent'), { lo: pLo, hi: pHi, width: 2.2 });
  if (show.la) series('p', c.la, col('--brach'), { lo: pLo, hi: pHi, width: 1.8, dash: [5, 3] });
  {
    const b = box.p; g.textAlign = 'left'; g.font = `12px ${FONT}`;
    const items: [string, string][] = [['--comp', 'Aortic pressure (model)'], ['--accent', 'LV pressure'], ...(show.la ? [['--brach', 'Left atrial pressure'] as [string, string]] : [])];
    let lx = L + 10;
    for (const [cc, t] of items) { g.fillStyle = col(cc); g.fillRect(lx, b.y0 + 9, 16, 3); g.fillStyle = ink2; g.fillText(t, lx + 22, b.y0 + 14); lx += g.measureText(t).width + 44; }

  }
  // flow
  const qHi = Math.max(...c.q) * 1.12;
  frame('q', 'Aortic flow (mL/s)', nice(0, qHi, 3), 0, qHi);
  series('q', c.q, col('--flow'), { lo: 0, hi: qHi, width: 2 });
  // volume
  const vLo = c.esv - 0.15 * c.sv, vHi = c.edv + 0.15 * c.sv;
  frame('v', 'LV volume (mL)', nice(vLo, vHi, 3), vLo, vHi);
  series('v', c.vol, col('--fwd'), { lo: vLo, hi: vHi, width: 2 });
  {
    const b = box.v; g.fillStyle = ink3; g.textAlign = 'right'; g.font = `11px ${FONT}`;
    const Y = (v: number) => b.y1 - (b.y1 - b.y0) * (v - vLo) / (vHi - vLo);
    g.fillText(`EDV ${c.edv.toFixed(0)}`, X(c.tAO) - 4, Y(c.edv) - 4);
    g.textAlign = 'left'; g.fillText(`ESV ${c.esv.toFixed(0)}`, X(c.tAC) + 4, Y(c.esv) + 13);
  }

  // time axis
  g.fillStyle = ink3; g.textAlign = 'center';
  for (const tv of nice(0, c.T * 1000, 8)) g.fillText(String(tv), X(tv / 1000), h - bottom + 16);
  g.fillText('Time from QRS onset (ms)', (L + w - R) / 2, h - 4);
  // cursor
  g.strokeStyle = ink; g.lineWidth = 1.2; g.globalAlpha = 0.6;
  g.beginPath(); g.moveTo(xNow, top - 4); g.lineTo(xNow, h - bottom); g.stroke(); g.globalAlpha = 1;
}
