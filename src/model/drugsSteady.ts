import { DRUGS, MODEL, type Params } from '../config/physiology';

/** v1 applyDrugs: each drug's full (steady-state) effect, applied in order. */
export function applyDrugs(base: Params, active: readonly string[] = []): Params {
  const p: Params = Object.assign({}, base);
  for (const key of active) {
    const drug = DRUGS[key];
    if (!drug) throw new Error(`Unknown drug "${key}"`);
    const fx = drug.fx;
    if (fx.radius) p.radius *= fx.radius;
    if (fx.cMus) p.cMus *= fx.cMus;
    if (fx.cAo) p.cAo *= fx.cAo;
    if (fx.gamma) p.gamma *= fx.gamma;
    if (fx.hrAdd) p.hr += fx.hrAdd;
    if (fx.svAdd && p.heart !== 1) p.sv += fx.svAdd;
    if (fx.ees) p.ees *= fx.ees;
    if (fx.preload) p.preload *= fx.preload;
  }
  p.gamma = Math.min(MODEL.gammaMax, p.gamma);
  return p;
}
