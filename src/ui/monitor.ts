/* Bedside-style monitor strip: central and brachial pressure scrolling at 25 mm/s. */
import { setupCanvas, FONT, baseFontSize } from '../render/theme';
import type { Beat } from '../engine/patient';

const PX_PER_MM = 96 / 25.4;          // CSS pixels per millimetre
const SPEED = 25 * PX_PER_MM;          // px per second at 25 mm/s

function sampleAt(beats: Beat[], t: number, key: 'p' | 'brachial'): number | null {
  for (let i = beats.length - 1; i >= 0; i--) {
    const b = beats[i];
    if (t >= b.tStart) {
      const T = b.res.d.T;
      if (t >= b.tStart + T) return null;
      const n = b.res.p.length;
      return b.res[key][Math.min(n - 1, Math.floor((t - b.tStart) / T * n))];
    }
  }
  return null;
}

export function drawMonitor(canvas: HTMLCanvasElement, beats: Beat[], now: number): void {
  const { ctx, w, h } = setupCanvas(canvas);
  if (!beats.length) return;
  const small = Math.round(baseFontSize() * 0.75);
  let lo = Infinity, hi = -Infinity;
  for (const b of beats) { lo = Math.min(lo, b.res.m.Pd, b.res.m.bDBP); hi = Math.max(hi, b.res.m.Ps, b.res.m.bSBP); }
  lo = Math.floor((lo - 8) / 20) * 20; hi = Math.ceil((hi + 8) / 20) * 20;
  const padL = small * 3, padB = 4, padT = 6;
  const Y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (h - padT - padB);
  // grid: 5 mm squares like ECG paper (1 s = 5 big squares)
  ctx.strokeStyle = 'rgba(126, 226, 184, 0.10)'; ctx.lineWidth = 1;
  const big = 5 * PX_PER_MM * 5;
  const offset = (now * SPEED) % big;
  for (let x = w - offset; x > padL; x -= big) { ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, padT); ctx.lineTo(Math.round(x) + .5, h - padB); ctx.stroke(); }
  ctx.font = `${small}px ${FONT}`; ctx.fillStyle = 'rgba(200, 230, 215, 0.7)'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let v = lo; v <= hi; v += 20) {
    ctx.strokeStyle = 'rgba(126, 226, 184, 0.10)'; ctx.beginPath(); ctx.moveTo(padL, Y(v)); ctx.lineTo(w, Y(v)); ctx.stroke();
    ctx.fillText(String(v), padL - 4, Y(v));
  }
  const trace = (key: 'p' | 'brachial', color: string, width: number) => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.beginPath();
    let started = false;
    for (let x = w; x >= padL; x -= 1) {
      const v = sampleAt(beats, now - (w - x) / SPEED, key);
      if (v == null) { started = false; continue; }
      if (!started) { ctx.moveTo(x, Y(v)); started = true; } else ctx.lineTo(x, Y(v));
    }
    ctx.stroke();
  };
  trace('brachial', '#ffd166', 1.6);
  trace('p', '#7ee2b8', 2);
}
