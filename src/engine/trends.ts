/* Per-beat trend samples over the last 10 minutes, in a fixed-size ring buffer. */
import { ALL_CONTROLS, ENGINE } from '../config/physiology';

export interface TrendSample {
  t: number;      // s, beat start
  hr: number;
  sbp: number;    // brachial (cuff) SBP
  dbp: number;    // brachial DBP
  map: number;
  pp: number;     // brachial PP
  cSBP: number;
  cDBP: number;
  cPP: number;
  bPP: number;
  aix: number;
  pwv: number;    // operating aortic PWV
}

export class Ring<T> {
  private buf: (T | undefined)[];
  private start = 0;
  private len = 0;
  constructor(readonly capacity: number) { this.buf = new Array(capacity); }
  push(x: T): void {
    if (this.len < this.capacity) { this.buf[(this.start + this.len) % this.capacity] = x; this.len++; }
    else { this.buf[this.start] = x; this.start = (this.start + 1) % this.capacity; }
  }
  get length(): number { return this.len; }
  /** oldest first */
  toArray(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.len; i++) out.push(this.buf[(this.start + i) % this.capacity] as T);
    return out;
  }
  last(): T | undefined { return this.len ? this.buf[(this.start + this.len - 1) % this.capacity] : undefined; }
  clear(): void { this.start = 0; this.len = 0; }
}

const HR_MAX = ALL_CONTROLS.find(c => c.key === 'hr')!.max;
/** Enough slots for 10 min at the highest possible heart rate. */
export const TREND_CAPACITY = Math.ceil(ENGINE.trendWindowS * HR_MAX / 60) + 16;

export class TrendBuffer {
  private ring = new Ring<TrendSample>(TREND_CAPACITY);
  push(s: TrendSample): void { this.ring.push(s); }
  /** samples within the window ending at the newest sample */
  window(seconds: number = ENGINE.trendWindowS): TrendSample[] {
    const all = this.ring.toArray();
    const last = all[all.length - 1];
    return last ? all.filter(s => s.t >= last.t - seconds) : [];
  }
  get length(): number { return this.ring.length; }
  clear(): void { this.ring.clear(); }
}
