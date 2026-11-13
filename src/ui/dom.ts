export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
};
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] => Array.from(root.querySelectorAll<T>(sel));
export const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const fmt = (v: number, f: number): string => (!Number.isFinite(v) ? '—' : Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(f));
/** "▲ +3" / "▼ −2" / "±0" with a class for colour (green up, red down) */
export function delta(dv: number, f: number): { cls: 'up' | 'dn' | 'same'; text: string } {
  if (Math.abs(dv) < Math.pow(10, -f) / 2) return { cls: 'same', text: '±0' };
  return dv > 0 ? { cls: 'up', text: `▲ +${fmt(dv, f)}` } : { cls: 'dn', text: `▼ −${fmt(-dv, f)}` };
}

const toastRoot = () => document.getElementById('toast');
export function toast(msg: string, kind: 'info' | 'err' = 'info', ms = 4500): void {
  const root = toastRoot(); if (!root) return;
  const d = document.createElement('div');
  d.textContent = msg; if (kind === 'err') d.className = 'err';
  root.appendChild(d);
  setTimeout(() => d.remove(), ms);
}

export function download(name: string, data: string | Blob, type = 'text/plain'): void {
  const a = document.createElement('a');
  a.href = typeof data === 'string' && data.startsWith('data:') ? data : URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
