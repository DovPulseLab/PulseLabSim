/* Beat clock: simulated time advances with real time × warp unless paused. Pure. */
import { ENGINE } from '../config/physiology';

export type Warp = (typeof ENGINE.warps)[number];

export interface Clock {
  t: number;          // simulated seconds
  paused: boolean;
  warp: Warp;
}

export const newClock = (t = 0): Clock => ({ t, paused: false, warp: 1 });

/** Advance by a real-time interval (s). Long gaps (e.g. a background tab) are capped. */
export function tick(c: Clock, realDt: number, maxDt = 0.25): Clock {
  if (c.paused || !(realDt > 0)) return c;
  return { ...c, t: c.t + Math.min(realDt, maxDt) * c.warp };
}

export const setPaused = (c: Clock, paused: boolean): Clock => ({ ...c, paused });
export const setWarp = (c: Clock, warp: Warp): Clock => ({ ...c, warp });
