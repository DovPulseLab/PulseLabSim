/* Colours come from CSS custom properties so light/dark themes and Present mode just work.
   Palette: Okabe–Ito (colour-blind safe); see src/ui/style.css. */
const cache = new Map<string, string>();
let cacheKey = '';

/** Resolve "--name" to its current CSS value; other strings pass through. */
export function col(c: string | undefined): string {
  if (!c) return '#000';
  if (!c.startsWith('--')) return c;
  const key = document.documentElement.dataset.theme ?? '' ;
  if (key !== cacheKey) { cache.clear(); cacheKey = key; }
  let v = cache.get(c);
  if (v === undefined) {
    v = getComputedStyle(document.documentElement).getPropertyValue(c).trim() || '#888';
    cache.set(c, v);
  }
  return v;
}
export function clearColourCache(): void { cache.clear(); }

export function baseFontSize(): number {
  return parseFloat(getComputedStyle(document.body).fontSize) || 14;
}
export const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif';

/** Size a canvas for crisp high-DPI drawing; returns a context in CSS pixels. */
export function setupCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } {
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  const w = Math.max(40, r.width), h = Math.max(40, r.height);
  const W = Math.round(w * dpr), H = Math.round(h * dpr);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}
