/* Explain drawer entries: definition, formula, normal adult range, which inputs move it
   (from the cause → effect graph) and citation. Ranges are typical adult teaching values. */
import { ALL_CONTROLS, ALL_DRUGS, CITATIONS, type ParamKey } from './physiology';
import { METRICS } from './metrics';
import { upstreamInputs } from './causal';

export interface ExplainEntry {
  id: string;
  title: string;
  definition: string;
  formula: string;
  normal: string;
  movedBy: string[];
  cite: string;
}

interface Extra { formula?: string; normal?: string; node?: string; cite?: string; }

const C = CITATIONS;
const EXTRA: Record<string, Extra> = {
  bSBP: { formula: 'max of the brachial wave = central wave × arm transfer function', normal: '< 130 mmHg (ACC/AHA 2017)', node: 'bsbp', cite: C.T2015a },
  bDBP: { formula: 'min of the brachial wave', normal: '< 80 mmHg', node: 'dbp', cite: C.T2015a },
  bPP: { formula: 'brachial SBP − DBP', normal: '≈ 40–60 mmHg', node: 'bsbp', cite: C.T2015a },
  map: { formula: 'MAP = CO × SVR / 80 + CVP  (CVP = 0 in this model)', normal: '70–100 mmHg', node: 'map', cite: C.NE2001 },
  Ps: { formula: 'peak of the central aortic wave', normal: '≤ 124 mmHg', node: 'sbp', cite: C.T2015a },
  Pd: { formula: 'minimum of the central wave', normal: '60–80 mmHg', node: 'dbp', cite: C.NE2001 },
  PP: { formula: 'PP = Ps − Pd = (Pi − Pd) + (Ps − Pi)', normal: '< 50 mmHg', node: 'pp', cite: C.NE2001 },
  Pi: { formula: 'pressure at the reflected-wave arrival (inflection)', normal: '—', node: 'sbp', cite: C.NS2002 },
  AP: { formula: 'AP = P2 − P1 (second minus first systolic peak)', normal: '≈ 0–15 mmHg in middle age', node: 'aix', cite: C.NS2002 },
  AIx: { formula: 'AIx = (P2 − P1) / PP × 100', normal: 'negative in youth; ≈ 10–30 % in middle age', node: 'aix', cite: C.NS2002 },
  AIx75: { formula: 'AIx@75 = AIx + 0.39 × (HR − 75)', normal: 'as AIx', node: 'aix', cite: C.W2000 },
  ppa: { formula: 'PPA = brachial PP / central PP', normal: '≥ 1.3', node: 'ppa', cite: C.T2015a },
  type: { formula: 'A: AP/PP > 12 %; B: 0–12 %; C: AP ≤ 0', normal: 'C in youth, A with age', node: 'aix', cite: C.NS2002 },
  dtp: { formula: 'Δtp = 2 · Lp / path PWV', normal: '≈ 120–330 ms (shorter with stiffness)', node: 'dtp', cite: C.NE2001 },
  lp: { formula: 'Lp = 0.27 × height × position factor', normal: '≈ 40–60 cm', node: 'lp', cite: C.NS2002 },
  cPath: { formula: '1 / (0.65 / c_aorta + 0.35 / c_muscular)', normal: '≈ 6–11 m/s', node: 'dtp', cite: C.NS2002 },
  dtr: { formula: 'Δtr = ET − Δtp (when the echo returns in systole)', normal: '—', node: 'ew', cite: C.NS2002 },
  Ew: { formula: 'ΔEw = Δtr × AP × π/2 × 1333', normal: '< 5 000 dyn·s/cm²', node: 'ew', cite: C.NS2002 },
  fwdAmp: { formula: 'Pf = (P + Zc·Q) / 2, amplitude = max − min', normal: '≈ 25–40 mmHg', node: 'fwd', cite: C.T2015a },
  bwdAmp: { formula: 'Pb = (P − Zc·Q) / 2, amplitude = max − min', normal: '≈ 10–25 mmHg', node: 'bwd', cite: C.T2015a },
  rm: { formula: 'RM = Pb amplitude / Pf amplitude × 100', normal: '≈ 30–50 % (method dependent)', node: 'bwd', cite: C.T2015a },
  lsEs: { formula: '∫ last ⅓ systole P dt ÷ ∫ first ⅔ systole P dt', normal: '≈ 0.59 (MESA median)', node: 'lses', cite: C.T2015a },
  co: { formula: 'CO = SV × HR', normal: '4–8 L/min', node: 'co', cite: C.NE2001 },
  svrDyn: { formula: 'SVR = SVR_ref / (radius/100)⁴', normal: '800–1 600 dyn·s·cm⁻⁵', node: 'svr', cite: C.NE2001 },
  svrWU: { formula: 'SVR in mmHg·min/L', normal: '10–20 WU', node: 'svr', cite: C.NE2001 },
  zcDyn: { formula: 'Zc = ρ · c / A', normal: '≈ 5–10 % of SVR', node: 'zc', cite: C.NE2001 },
  ctot: { formula: 'C ≈ V_eff × (D/2.8)² / (ρ c²)', normal: '≈ 1–2 mL/mmHg', node: 'comp', cite: C.McDonald },
  svpp: { formula: 'SV / PP', normal: '> 1.1 mL/mmHg', node: 'comp', cite: C.T2015b },
  tau: { formula: 'τ = SVR × C', normal: '≈ 1–2 s', node: 'comp', cite: C.McDonald },
  cAoOp: { formula: 'c = c₀ × (1 + 0.006 × (MAP − 93))', normal: '< 10 m/s', node: 'cao', cite: C.NE2001 },
  ep: { formula: 'Ep ≈ 2 ρ c²', normal: '—', node: 'cao', cite: C.NE2001 },
  et: { formula: 'LVET = (413 − 1.7·HR) ms × multiplier', normal: '≈ 280–330 ms', node: 'et', cite: C.McDonald },
  tti: { formula: '∫ systole P dt', normal: '—', node: 'sevr', cite: C.NE2001 },
  dpti: { formula: '∫ diastole (P − LVEDP) dt', normal: '—', node: 'sevr', cite: C.NE2001 },
  sevr: { formula: 'SEVR = DPTI / TTI × 100', normal: '> 130 %', node: 'sevr', cite: C.NE2001 },
  svf: { formula: 'SVf = ∫ (Pf − Pf₀) / Zc dt over ejection', normal: '—', node: 'fwd', cite: C.NE2001 },
  svrefl: { formula: 'SVr = ∫ (Pb − Pb₀) / Zc dt over ejection', normal: '—', node: 'bwd', cite: C.NE2001 }
};

const SLIDER_NORMAL: Partial<Record<ParamKey, string>> = {
  hr: '60–100 bpm at rest', sv: '60–100 mL', etScale: '1.0 (Weissler)', radius: '100 % (SVR ≈ 1 470 dyn·s·cm⁻⁵)',
  cAo: '5–10 m/s (rises with age)', diam: '2.5–3.5 cm', cMus: '8–10 m/s', gamma: '0.3–0.6', lpScale: '0.9–1.3', height: 'any'
};

const CURVES: ExplainEntry[] = [
  { id: 'curve:central', title: 'Central aortic pressure', definition: 'Pressure in the ascending aorta over one heartbeat — the load the left ventricle actually faces.', formula: 'P(t) = Pf(t) + Pb(t)', normal: '≈ 120/70 mmHg or lower', movedBy: upstreamInputs('sbp'), cite: C.NE2001 },
  { id: 'curve:forward', title: 'Forward wave', definition: 'The pressure wave generated by ejection, before any reflection.', formula: 'Pf = (P + Zc·Q) / 2', normal: '—', movedBy: upstreamInputs('fwd'), cite: C.T2015a },
  { id: 'curve:reflected', title: 'Reflected wave', definition: 'The echo returning from the effective reflection site in the lower body.', formula: 'Pb = (P − Zc·Q) / 2 = G·e^(−iωΔtp)·Pf', normal: '—', movedBy: upstreamInputs('bwd'), cite: C.NS2002 },
  { id: 'curve:brachial', title: 'Brachial (cuff) pressure', definition: 'Pressure in the upper arm: the central wave after travelling along the muscular arm arteries, which amplifies it.', formula: 'P_brachial(ω) = H_arm(ω) · P(ω)', normal: '< 130/80 mmHg', movedBy: upstreamInputs('bsbp'), cite: C.T2015a },
  { id: 'curve:flow', title: 'Aortic flow', definition: 'Blood flow out of the left ventricle during ejection; the model treats the heart as a flow source.', formula: 'Q(t) ∝ x^0.75 (1 − x)^1.55, area = SV', normal: 'peak ≈ 300–500 mL/s', movedBy: ['Heart rate', 'Stroke volume'], cite: C.NE2001 }
];

function build(): Map<string, ExplainEntry> {
  const out = new Map<string, ExplainEntry>();
  for (const g of METRICS) for (const m of g.items) {
    const x = EXTRA[m.k] ?? {};
    out.set(m.k, {
      id: m.k, title: m.l + (m.u ? ` (${m.u})` : ''), definition: m.tip, formula: x.formula ?? '—', normal: x.normal ?? '—',
      movedBy: x.node ? upstreamInputs(x.node) : [], cite: x.cite ?? C.NE2001
    });
  }
  for (const c of ALL_CONTROLS) {
    const drugs = Object.values(ALL_DRUGS).filter(d => {
      const fx = d.fx as Record<string, number | undefined>;
      return fx[c.key] != null || (c.key === 'hr' && fx.hrAdd != null) || (c.key === 'sv' && fx.svAdd != null);
    }).map(d => d.short);
    out.set(c.key, {
      id: c.key, title: `${c.label}${c.unit ? ` (${c.unit})` : ''} — input`, definition: c.tip,
      formula: `slider ${c.min}–${c.max}, step ${c.step}`, normal: SLIDER_NORMAL[c.key] ?? '—',
      movedBy: drugs.length ? drugs.map(d => `drug: ${d}`) : ['set directly (no drug changes it)'],
      cite: C.NE2001
    });
  }
  // heart rate card
  out.set('hr', { ...out.get('hr')!, title: 'Heart rate (bpm)' });
  for (const e of CURVES) out.set(e.id, e);
  return out;
}

export const EXPLAIN = build();
export const explainFor = (id: string): ExplainEntry | undefined => EXPLAIN.get(id);
