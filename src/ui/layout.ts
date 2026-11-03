/* Panel resizing (remembered for the session), Present mode and theme. */
import { clearColourCache } from '../render/theme';
import { $$ } from './dom';

const KEY = 'pulselab-v2-layout';
const LIMITS: Record<string, [string, number, number]> = {
  rail: ['--rail-w', 240, 560], cards: ['--cards-w', 160, 420], bottom: ['--bottom-h', 140, 600]
};

export function initLayout(onResize: () => void): void {
  const root = document.documentElement;
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as Record<string, number>;
    for (const [k, v] of Object.entries(saved)) if (LIMITS[k]) root.style.setProperty(LIMITS[k][0], `${v}px`);
  } catch { /* ignore */ }
  const save = () => {
    const out: Record<string, number> = {};
    for (const [k, [v]] of Object.entries(LIMITS)) { const px = parseFloat(root.style.getPropertyValue(v)); if (px) out[k] = px; }
    try { sessionStorage.setItem(KEY, JSON.stringify(out)); } catch { /* ignore */ }
  };
  const current = (k: string) => parseFloat(getComputedStyle(root).getPropertyValue(LIMITS[k][0])) || LIMITS[k][1];
  const set = (k: string, px: number) => { const [v, lo, hi] = LIMITS[k]; root.style.setProperty(v, `${Math.round(Math.min(hi, Math.max(lo, px)))}px`); };
  for (const h of $$<HTMLElement>('.rz')) {
    const k = h.dataset.rz!;
    // dragging the cards/bottom handle towards the panel makes it bigger
    const sign = k === 'rail' ? 1 : -1, vertical = k !== 'bottom';
    h.addEventListener('pointerdown', e => {
      e.preventDefault(); h.setPointerCapture(e.pointerId); h.classList.add('dragging');
      const start = vertical ? e.clientX : e.clientY, v0 = current(k);
      const move = (ev: PointerEvent) => { set(k, v0 + sign * ((vertical ? ev.clientX : ev.clientY) - start)); onResize(); };
      const up = () => { h.classList.remove('dragging'); h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); save(); onResize(); };
      h.addEventListener('pointermove', move); h.addEventListener('pointerup', up);
    });
    h.addEventListener('keydown', e => {
      const d = { ArrowLeft: -16, ArrowRight: 16, ArrowUp: -16, ArrowDown: 16 }[e.key]; if (!d) return;
      e.preventDefault(); set(k, current(k) + sign * d); save(); onResize();
    });
    h.addEventListener('dblclick', () => { root.style.removeProperty(LIMITS[k][0]); save(); onResize(); });
  }
}

export function togglePresent(): boolean {
  const on = document.body.classList.toggle('present');
  document.getElementById('presentBtn')?.classList.toggle('on', on);
  return on;
}

const THEME = 'pulselab-theme';
export function initTheme(): void {
  let t: string | null = null;
  try { t = localStorage.getItem(THEME); } catch { /* ignore */ }
  if (!t) t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
}
export function toggleTheme(): void {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(THEME, t); } catch { /* ignore */ }
  clearColourCache();
}
