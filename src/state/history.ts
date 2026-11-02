/* Undo/redo stack (50 steps). Consecutive changes with the same coalesce key
   (e.g. one slider drag) become a single step. Pure. */
import { ENGINE } from '../config/physiology';

export interface History<T> {
  past: T[];
  future: T[];
  lastKey: string | null;
}

export const newHistory = <T>(): History<T> => ({ past: [], future: [], lastKey: null });

/** Record `before` (the state prior to a change). */
export function record<T>(h: History<T>, before: T, coalesceKey: string | null = null, limit: number = ENGINE.historySteps): History<T> {
  if (coalesceKey && coalesceKey === h.lastKey) return { ...h, future: [] };
  const past = [...h.past, before];
  if (past.length > limit) past.splice(0, past.length - limit);
  return { past, future: [], lastKey: coalesceKey };
}

export function undo<T>(h: History<T>, current: T): { history: History<T>; state: T } | null {
  if (!h.past.length) return null;
  const state = h.past[h.past.length - 1];
  return { history: { past: h.past.slice(0, -1), future: [current, ...h.future], lastKey: null }, state };
}

export function redo<T>(h: History<T>, current: T): { history: History<T>; state: T } | null {
  if (!h.future.length) return null;
  const [state, ...rest] = h.future;
  return { history: { past: [...h.past, current], future: rest, lastKey: null }, state };
}
