/* Cardiac cycle tab: an animated Wiggers diagram for the active patient's current beat.
   ECG, LV / aortic / left-atrial pressure, aortic flow and LV volume on one time axis, with
   phases, valve events and heart sounds.
   - Running strip (default): beats scroll right → left like the monitor, newest at the right.
   - One beat: a cursor sweeps through a single beat.
   It has its own play/pause (independent of the live clock), a scrubber, ±1 / ±10 ms steps,
   jump-to-event buttons and click-to-inspect, and plays synthesised S1/S2 when sound is on.
   Aortic pressure and flow come from the model; the rest is schematic (src/model/cycle.ts). */
import { buildCycle, indexAt, phaseAt, type Cycle } from '../../model/cycle';
import { col, FONT, setupCanvas } from '../../render/theme';
import type { BeatResult } from '../../model/solve';
import type { Ctx } from '../context';
import { $, $$ } from '../dom';
import { HeartSounds } from '../heartSounds';

type Speed = 1 | 0.5 | 0.25 | 0.125;
type Mode = 'strip' | 'beat';
let speed: Speed = 1, mode: Mode = 'strip';
const show = { la: true, ecg: true, sounds: true };
let cyc: Cycle | null = null, cycFor: BeatResult | null = null;
/** cycle time (s) since the tab started, continuous across beats; display time = now mod T */
let now = 0, lastFrame = 0, playing = true;
/** inspected point while paused (absolute cycle time), or null = follow `now` */
let inspect: number | null = null;
const sounds = new HeartSounds();
/** beats shown across the running strip */
const STRIP_BEATS = 2.5;

const STEP_MS = [-10, -1, 1, 10];

export function buildCycleTab(ctx: Ctx): void {
  $('#pane-cycle').innerHTML = `
  <div class="card">
    <div class="card-h">
      <h2>Cardiac cycle <span class="muted" id="cycSub">Wiggers diagram</span></h2>
      <div class="cyc-tools">
        <button class="btn sm cyc-play" id="cycPlay" aria-pressed="true" title="Play or pause the cardiac cycle (Space or K)">❚❚ Pause</button>
        <div class="seg" role="group" aria-label="Display" id="cycMode">
          <button data-mode="strip" aria-pressed="true">Running strip</button><button data-mode="beat" aria-pressed="false">One beat</button></div>
        <div class="seg" role="group" aria-label="Animation speed" id="cycSpeed">
          <button data-speed="1" aria-pressed="true">Real time</button><button data-speed="0.5" aria-pressed="false">½×</button>
          <button data-speed="0.25" aria-pressed="false">¼×</button><button data-speed="0.125" aria-pressed="false">⅛×</button></div>
        <button class="btn sm" id="cycSound" aria-pressed="false" title="Play the first and second heart sounds (S1, S2)">🔇 Sound off</button>
      </div>
    </div>
    <div class="cyc-scrub" id="cycScrub">
      <span class="muted">Time in beat</span>
      <input type="range" id="cycRange" min="0" max="857" step="1" value="0" aria-label="Time in the beat (ms from QRS onset)">
      ${STEP_MS.map(s => `<button class="btn sm" data-stepms="${s}" title="${s > 0 ? 'Forward' : 'Back'} ${Math.abs(s)} ms">${s > 0 ? '+' : '−'}${Math.abs(s)} ms</button>`).join('')}
      <span class="muted">Jump to</span>
      <span id="cycJump"></span>
    </div>
    <div class="cyc-now" id="cycNow" aria-live="off"></div>
    <div class="canvas-wrap" style="height:max(440px, calc(100vh - 510px))"><canvas id="cCycle" aria-label="Animated cardiac cycle; click to pause at a point"></canvas></div>
    <div class="toggles cyc-show" id="cycToggles">
      <label><input type="checkbox" data-sh="ecg" checked> ECG</label>
      <label><input type="checkbox" data-sh="la" checked> Left atrium</label>
      <label><input type="checkbox" data-sh="sounds" checked> S1 / S2 markers</label>
      <span class="muted">Click the diagram to pause at that point · Space or K play/pause · , and . step 1 ms (Shift 10 ms)</span>
    </div>
    <p class="caption" id="cycCap"></p>
    <p class="fine">MVC / MVO = mitral valve closes / opens; AVO / AVC = aortic valve opens / closes; S1 and S2 = first and second heart sounds (synthesised "lub" and "dub", timing only). Aortic pressure and aortic flow are the simulator's own output for this patient. LV and left-atrial pressure outside ejection, LV volume during filling, the ECG and the heart sounds are schematic, built from typical healthy-adult timings (isovolumic contraction 45 ms, LV relaxation τ 40 ms, ejection fraction 60 %, atrial share of filling 22 %) and tied to the modelled beat: the aortic valve opens when LV pressure reaches aortic diastolic pressure and closes at the end of ejection, and LV volume falls by exactly the stroke volume. See Methods §12; the Validation tab (§7) checks these timings against normal ranges.</p>
  </div>`;

  $('#cycPlay').addEventListener('click', () => setPlaying(!playing));
  // after a click on any control here, drop focus so Space keeps meaning play/pause
  $('#pane-cycle').addEventListener('click', e => { const b = (e.target as HTMLElement).closest('button'); if (b) (b as HTMLButtonElement).blur(); });
  $('#cycMode').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-mode]'); if (!b) return;
    mode = b.dataset.mode as Mode;
    $$('#cycMode button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  });
  $('#cycSpeed').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-speed]'); if (!b) return;
    speed = Number(b.dataset.speed) as Speed;
    $$('#cycSpeed button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  });
  $('#cycSound').addEventListener('click', () => {
    const on = sounds.toggle();
    const btn = $('#cycSound'); btn.setAttribute('aria-pressed', String(on)); btn.textContent = on ? '🔊 Sound on' : '🔇 Sound off';
  });
  $('#cycToggles').addEventListener('change', e => { const i = e.target as HTMLInputElement; if (i.dataset.sh) show[i.dataset.sh as keyof typeof show] = i.checked; });
  $('#cycRange').addEventListener('input', () => {
    if (!cyc) return;
    pauseAt(beatStart(cursor()) + Number(($('#cycRange') as HTMLInputElement).value) / 1000);
  });
  $('#cycScrub').addEventListener('click', e => {
    const t = e.target as HTMLElement;
    const st = t.closest<HTMLElement>('[data-stepms]');
    if (st) { stepMs(Number(st.dataset.stepms)); return; }
    const j = t.closest<HTMLElement>('[data-jump]');
    if (j && cyc) pauseAt(beatStart(cursor()) + Number(j.dataset.jump));
  });
  $('#cCycle').addEventListener('click', e => {
    if (!cyc) return;
    const cv = e.currentTarget as HTMLCanvasElement, r = cv.getBoundingClientRect();
    const t = timeAtX(e.clientX - r.left, r.width);
    if (t != null) pauseAt(t);
  });
}

/* ---------- time and pause ---------- */
const cursor = () => inspect ?? now;
const beatStart = (t: number) => cyc ? Math.floor(t / cyc.T) * cyc.T : 0;

function setPlaying(p: boolean): void {
  playing = p;
  if (p) inspect = null;
  const b = $('#cycPlay');
  b.setAttribute('aria-pressed', String(p));
  b.textContent = p ? '❚❚ Pause' : '▶ Play';
  $('#cycScrub').classList.toggle('paused', !p);
}
function pauseAt(t: number): void {
  if (playing) setPlaying(false);
  // in the running strip the inspected point must stay inside the visible window:
  // a point later than the newest sample moves back one beat, one off the left moves forward
  if (mode === 'strip' && cyc) {
    const lo = now - STRIP_BEATS * cyc.T;
    while (t > now) t -= cyc.T;
    while (t < lo) t += cyc.T;
    t = Math.min(now, t);
  }
  inspect = t;
}
/** Keyboard and button stepping while paused (pauses first if running). */
export function stepMs(ms: number): void { pauseAt(cursor() + ms / 1000); }
export function toggleCyclePlay(): void { setPlaying(!playing); }

/* ---------- per beat ---------- */
/** Rebuild the cycle when the active patient's beat changes (called on each beat). */
export function beatCycle(ctx: Ctx): void {
  const b = ctx.live.beats[ctx.active()]; if (!b) return;
  if (b.res !== cycFor) {
    const oldT = cyc?.T;
    cyc = buildCycle(b.res); cycFor = b.res;
    // keep the same point of the beat when the cycle length changes
    if (oldT && Math.abs(oldT - cyc.T) > 1e-9) {
      const k = Math.floor(now / oldT), ph = (now - k * oldT) / oldT;
      now = k * cyc.T + ph * cyc.T;
      if (inspect != null) { const ki = Math.floor(inspect / oldT); inspect = ki * cyc.T + (inspect - ki * oldT) / oldT * cyc.T; }
    }
  }
  const c = cyc!, m = b.res.m;
  $('#cycSub').textContent = `Wiggers diagram · Patient ${ctx.active()} · HR ${b.res.params.hr.toFixed(0)} bpm · cycle ${(c.T * 1000).toFixed(0)} ms`;
  const range = $('#cycRange') as HTMLInputElement; range.max = String(Math.round(c.T * 1000));
  const jumps: [string, number][] = [['MVC', c.tMC], ['AVO', c.tAO], ['Peak flow', c.t[c.q.indexOf(Math.max(...c.q))]], ['AVC', c.tAC], ['MVO', c.tMO], ['Atrial', c.phases.find(p => p.id === 'atrial' && p.t0 > 0)?.t0 ?? 0]];
  const html = jumps.map(([l, t]) => `<button class="btn sm" data-jump="${t.toFixed(4)}">${l}</button>`).join('');
  const jel = $('#cycJump'); if (jel.dataset.html !== html) { jel.innerHTML = html; jel.dataset.html = html; }
  const sys = (c.tAC - c.tMC) * 1000, dia = c.T * 1000 - sys;
  $('#cycCap').innerHTML = `Systole (mitral closure → aortic closure) ${sys.toFixed(0)} ms, diastole ${dia.toFixed(0)} ms (${(100 * dia / (c.T * 1000)).toFixed(0)} % of the cycle). ` +
    `Ejection ${m.et.toFixed(0)} ms; isovolumic relaxation ${((c.tMO - c.tAC) * 1000).toFixed(0)} ms. ` +
    `Aortic pressure ${m.Ps.toFixed(0)}/${m.Pd.toFixed(0)} mmHg; EDV ${c.edv.toFixed(0)} mL, ESV ${c.esv.toFixed(0)} mL, SV ${c.sv.toFixed(0)} mL.` +
    (c.tauIVR < 0.039 ? ` <b>Diastole is very short at this heart rate:</b> relaxation has been compressed to τ ${(c.tauIVR * 1000).toFixed(0)} ms and filling time is limited.` : '');
}

/* ---------- per frame ---------- */
export function tickCycle(ctx: Ctx, frameNow: number): void {
  const canvas = document.getElementById('cCycle') as HTMLCanvasElement | null;
  const dtReal = lastFrame ? Math.min(0.1, (frameNow - lastFrame) / 1000) : 0;
  lastFrame = frameNow;
  if (!canvas || !canvas.offsetParent) return;
  const b = ctx.live.beats[ctx.active()]; if (!b) return;
  if (b.res !== cycFor) beatCycle(ctx);
  const c = cyc!;
  if (playing) {
    const before = now;
    now += dtReal * speed;
    if (sounds.on) {
      // play S1 / S2 when the time crosses them (any beat)
      for (let k = Math.floor(before / c.T); k <= Math.floor(now / c.T); k++) {
        for (const [t, which] of [[c.sounds.s1, 1], [c.sounds.s2, 2]] as const) {
          const at = k * c.T + t;
          if (at > before && at <= now) sounds.play(which);
        }
      }
    }
  }
  const t = cursor();
  draw(canvas, c, t);
  readout(c, t);
  const range = $('#cycRange') as HTMLInputElement;
  if (document.activeElement !== range) range.value = String(Math.round((t - beatStart(t)) * 1000));
}

function readout(c: Cycle, tAbs: number): void {
  const t = tAbs - beatStart(tAbs);
  const i = indexAt(c, t), ph = phaseAt(c, t);
  const tt = c.t[i];
  const aoOpen = tt >= c.tAO && tt <= c.tAC, mvOpen = tt >= c.tMO || tt < c.tMC;
  const valve = (name: string, open: boolean) => `<span class="valve ${open ? 'open' : 'shut'}">${name} ${open ? 'open' : 'closed'}</span>`;
  const html = `${playing ? '' : '<span class="paused-tag">❚❚ Paused</span>'}<span class="ph ${ph.systole ? 'sys' : 'dia'}">${ph.systole ? 'Systole' : 'Diastole'} · <b>${ph.label}</b></span>
    ${valve('Mitral', mvOpen)}${valve('Aortic', aoOpen)}
    <span class="mono">t ${(tt * 1000).toFixed(0)} ms · LV ${c.lv[i].toFixed(0)} · Ao ${c.ao[i].toFixed(0)} · LA ${c.la[i].toFixed(0)} mmHg · flow ${c.q[i].toFixed(0)} mL/s · volume ${c.vol[i].toFixed(0)} mL</span>`;
  const el = $('#cycNow');
  if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
}

/* ---------- drawing ---------- */
const PHASE_FILL: Record<string, string> = {
  ivc: 'rgba(0,114,178,0.10)', ejRapid: 'rgba(180,35,47,0.10)', ejReduced: 'rgba(180,35,47,0.05)',
  ivr: 'rgba(0,114,178,0.10)', fillRapid: 'rgba(0,158,115,0.10)', diastasis: 'rgba(0,158,115,0.04)', atrial: 'rgba(230,159,0,0.12)'
};
const L = 64, R = 18, TOP = 52, BOTTOM = 30;
let lastWindow: { t0: number; t1: number } | null = null;

function timeAtX(x: number, w: number): number | null {
  if (!lastWindow || x < L || x > w - R) return null;
  return lastWindow.t0 + (lastWindow.t1 - lastWindow.t0) * (x - L) / (w - L - R);
}

function draw(canvas: HTMLCanvasElement, c: Cycle, tCursor: number): void {
  const { ctx: g, w, h } = setupCanvas(canvas);
  // time window (absolute cycle time): strip = the last 2.5 beats ending at `now`; beat = the cursor's beat
  const t1 = mode === 'strip' ? now : beatStart(tCursor) + c.T;
  const t0 = mode === 'strip' ? now - STRIP_BEATS * c.T : beatStart(tCursor);
  lastWindow = { t0, t1 };
  const X = (t: number) => L + (w - L - R) * (t - t0) / (t1 - t0);
  const drawnTo = mode === 'strip' ? now : tCursor;   // trace drawn up to here; faint after (beat mode only)
  const panels = [...(show.ecg ? [{ id: 'ecg', f: 0.12 }] : []), { id: 'p', f: 0.46 }, { id: 'q', f: 0.18 }, { id: 'v', f: 0.20 }];
  const fsum = panels.reduce((a, p) => a + p.f, 0), gap = 12;
  const avail = h - TOP - BOTTOM - gap * (panels.length - 1);
  let y = TOP;
  const box: Record<string, { y0: number; y1: number }> = {};
  for (const p of panels) { const hh = avail * p.f / fsum; box[p.id] = { y0: y, y1: y + hh }; y += hh + gap; }
  const ink = col('--ink'), ink2 = col('--ink-2'), ink3 = col('--ink-3'), line = col('--line');
  const kFirst = Math.floor(t0 / c.T), kLast = Math.floor((t1 - 1e-9) / c.T);
  const tiles: number[] = []; for (let k = kFirst; k <= kLast; k++) tiles.push(k * c.T);
  const curPhase = phaseAt(c, tCursor - beatStart(tCursor));
  g.save(); g.beginPath(); g.rect(L, 0, w - L - R, h); g.clip();

  // phase bands and labels, per beat
  for (const s of tiles) for (const ph of c.phases) {
    const a = X(s + ph.t0), b = X(s + ph.t1);
    if (b < L || a > w - R) continue;
    g.fillStyle = PHASE_FILL[ph.id]; g.fillRect(a, TOP - 4, b - a, h - TOP - BOTTOM + 4);
    const cur = ph.id === curPhase.id && tCursor >= s + ph.t0 && tCursor < s + ph.t1;
    const wpx = b - a;
    if (wpx > 34) {
      g.fillStyle = cur ? ink : ink3; g.font = `${cur ? 'bold ' : ''}11px ${FONT}`; g.textAlign = 'center';
      g.fillText(wpx > 90 ? ph.label : ph.short, (Math.max(a, L) + Math.min(b, w - R)) / 2, 14);
    }
  }
  // systole / diastole bar
  for (const s of tiles) {
    g.globalAlpha = 0.85; g.fillStyle = col('--accent'); g.fillRect(X(s + c.tMC), 20, X(s + c.tAC) - X(s + c.tMC), 4);
    g.globalAlpha = 0.6; g.fillStyle = col('--fwd'); g.fillRect(X(s + c.tAC), 20, X(s + c.T + c.tMC) - X(s + c.tAC), 4);
    g.globalAlpha = 1;
  }
  // valve events
  const TAG: Record<string, string> = { MC: 'MVC', AO: 'AVO', AC: 'AVC', MO: 'MVO' };
  for (const s of tiles) {
    let lastTagX = -1e9;
    for (const ev of c.events) {
      const x = X(s + ev.t); if (x < L - 1 || x > w - R + 1) continue;
      const on = Math.abs(tCursor - (s + ev.t)) < 0.03;
      g.strokeStyle = on ? ink : ink3; g.setLineDash([3, 3]); g.lineWidth = on ? 1.5 : 1;
      g.beginPath(); g.moveTo(x, TOP - 10); g.lineTo(x, h - BOTTOM); g.stroke(); g.setLineDash([]);
      g.font = `${on ? 'bold ' : ''}10.5px ${FONT}`; g.fillStyle = on ? ink : ink2; g.textAlign = 'center';
      const tx = Math.max(x, lastTagX + 30); g.fillText(TAG[ev.id], tx, TOP - 14); lastTagX = tx;
    }
  }
  g.restore();
  g.font = `11px ${FONT}`;

  // value of a series at absolute time t (linear interpolation on the beat grid)
  const at = (ys: number[], t: number) => {
    const u = (t - beatStart(t)) / c.dt, i = Math.floor(u), f = u - i;
    return ys[Math.min(c.n, i)] * (1 - f) + ys[Math.min(c.n, i + 1)] * f;
  };
  const series = (id: string, ys: number[], color: string, opts: { lo: number; hi: number; width?: number; dash?: number[] }) => {
    const b = box[id]; const Y = (v: number) => b.y1 - (b.y1 - b.y0) * (v - opts.lo) / (opts.hi - opts.lo);
    const pxStep = 1.5, dtPx = (t1 - t0) / (w - L - R) * pxStep;
    const path = (ta: number, tb: number) => { g.beginPath(); let first = true; for (let t = ta; t <= tb + 1e-9; t += dtPx) { const px = X(t), py = Y(at(ys, t)); if (first) { g.moveTo(px, py); first = false; } else g.lineTo(px, py); } g.stroke(); };
    g.setLineDash(opts.dash ?? []); g.strokeStyle = color; g.lineWidth = opts.width ?? 2; g.lineJoin = 'round';
    if (mode === 'beat') { g.globalAlpha = 0.22; path(t0, t1); g.globalAlpha = 1; }
    path(t0, Math.min(t1, drawnTo));
    g.setLineDash([]);
    if (tCursor >= t0 && tCursor <= t1) { g.fillStyle = color; g.beginPath(); g.arc(X(tCursor), Y(at(ys, tCursor)), 4.5, 0, Math.PI * 2); g.fill(); }
  };
  const frame = (id: string, label: string, ticks: number[], lo: number, hi: number) => {
    const b = box[id]; const Y = (v: number) => b.y1 - (b.y1 - b.y0) * (v - lo) / (hi - lo);
    g.strokeStyle = line; g.lineWidth = 1; g.strokeRect(L, b.y0, w - L - R, b.y1 - b.y0);
    g.fillStyle = ink3; g.textAlign = 'right';
    for (const tv of ticks) { const yy = Y(tv); if (yy < b.y0 - 1 || yy > b.y1 + 1) continue; g.fillText(tv.toFixed(0), L - 6, yy + 4); g.strokeStyle = line; g.globalAlpha = 0.5; g.beginPath(); g.moveTo(L, yy); g.lineTo(w - R, yy); g.stroke(); g.globalAlpha = 1; }
    g.save(); g.translate(14, (b.y0 + b.y1) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillStyle = ink2; g.fillText(label, 0, 0); g.restore();
  };
  const nice = (lo: number, hi: number, n = 4) => { const step = Math.pow(10, Math.floor(Math.log10((hi - lo) / n))); const s = [1, 2, 5, 10].map(k => k * step).find(k => (hi - lo) / k <= n) ?? step * 10; const out: number[] = []; for (let v = Math.ceil(lo / s) * s; v <= hi; v += s) out.push(v); return out; };

  // ECG
  if (show.ecg) {
    frame('ecg', 'ECG', [], -0.35, 1.15);
    series('ecg', c.ecg, ink, { lo: -0.35, hi: 1.15, width: 1.6 });
    const b = box.ecg; g.textAlign = 'center';
    for (const s of tiles) {
      g.fillStyle = ink3; g.font = `11px ${FONT}`;
      for (const [t, l] of [[c.T - 0.14, 'P'], [0.035, 'R'], [c.tAC - 0.05, 'T']] as const) { const x = X(s + t); if (x > L && x < w - R) g.fillText(l, x, b.y0 + 11); }
      if (show.sounds) for (const [t, l] of [[c.sounds.s1, 'S1'], [c.sounds.s2, 'S2']] as const) {
        const x = X(s + t); if (x < L || x > w - R) continue;
        const on = Math.abs(tCursor - (s + t)) < 0.04 || (playing && now - (s + t) >= 0 && now - (s + t) < 0.12 * Math.max(speed, 0.25));
        g.fillStyle = on ? col('--accent') : ink2; g.font = `${on ? 'bold 13px' : '11px'} ${FONT}`;
        g.fillText(l, x + 14, b.y1 - 6); g.font = `11px ${FONT}`;
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
    g.fillStyle = col('--panel'); g.globalAlpha = 0.85; g.fillRect(L + 4, b.y0 + 3, 470, 18); g.globalAlpha = 1;
    for (const [cc, t] of items) { g.fillStyle = col(cc); g.fillRect(lx, b.y0 + 9, 16, 3); g.fillStyle = ink2; g.fillText(t, lx + 22, b.y0 + 14); lx += g.measureText(t).width + 44; }
    g.font = `11px ${FONT}`;
  }
  // flow
  const qHi = Math.max(...c.q) * 1.12;
  frame('q', 'Aortic flow (mL/s)', nice(0, qHi, 3), 0, qHi);
  series('q', c.q, col('--flow'), { lo: 0, hi: qHi, width: 2 });
  // volume
  const vLo = c.esv - 0.15 * c.sv, vHi = c.edv + 0.15 * c.sv;
  frame('v', 'LV volume (mL)', nice(vLo, vHi, 3), vLo, vHi);
  series('v', c.vol, col('--fwd'), { lo: vLo, hi: vHi, width: 2 });
  if (mode === 'beat') {
    const b = box.v; g.fillStyle = ink3; g.textAlign = 'right';
    const Y = (v: number) => b.y1 - (b.y1 - b.y0) * (v - vLo) / (vHi - vLo);
    g.fillText(`EDV ${c.edv.toFixed(0)}`, X(t0 + c.tAO) - 4, Y(c.edv) - 4);
    g.textAlign = 'left'; g.fillText(`ESV ${c.esv.toFixed(0)}`, X(t0 + c.tAC) + 4, Y(c.esv) + 13);
  }

  // time axis: ms within each beat (strip) or from QRS onset (one beat)
  g.fillStyle = ink3; g.textAlign = 'center';
  if (mode === 'beat') {
    for (const tv of nice(0, c.T * 1000, 8)) g.fillText(String(tv), X(t0 + tv / 1000), h - BOTTOM + 16);
    g.fillText('Time from QRS onset (ms)', (L + w - R) / 2, h - 4);
  } else {
    for (const s of tiles) { const x = X(s); if (x >= L && x <= w - R) { g.fillText('QRS', x, h - BOTTOM + 16); } }
    g.fillText(`Running strip · ${STRIP_BEATS} beats · newest at the right · ${speed === 1 ? 'real time' : `${speed}× speed`}`, (L + w - R) / 2, h - 4);
  }
  // cursor
  if (tCursor >= t0 && tCursor <= t1) {
    g.strokeStyle = ink; g.lineWidth = playing ? 1.2 : 2; g.globalAlpha = playing ? 0.6 : 0.9;
    g.beginPath(); g.moveTo(X(tCursor), TOP - 4); g.lineTo(X(tCursor), h - BOTTOM); g.stroke(); g.globalAlpha = 1;
  }
}
