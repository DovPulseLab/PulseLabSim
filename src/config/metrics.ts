/* Metric definitions (from v1 js/content.js): labels, units, decimals, definitions and
   reference-range status, plus the metric cards and Explain-drawer details. */
import type { Indices } from '../model/indices';
import type { BeatResult } from '../model/solve';

export type Status = 'ok' | 'warn' | 'bad' | '';
export type MetricKey = keyof Indices;

export interface Metric {
  k: MetricKey; l: string; u: string; f: number; tip: string;
  st?: (v: number) => Status;
  txt?: boolean;
}

const S = (ok: number, warn: number) => (v: number): Status => v <= ok ? 'ok' : v <= warn ? 'warn' : 'bad';
const SL = (ok: number, warn: number) => (v: number): Status => v >= ok ? 'ok' : v >= warn ? 'warn' : 'bad';

export const METRICS: { g: string; items: Metric[] }[] = [
  { g: 'Brachial cuff pressure', items: [
    { k: 'bSBP', l: 'Brachial SBP', u: 'mmHg', f: 0, st: S(129, 139), tip: 'Peak of the simulated brachial wave — what a cuff would read.' },
    { k: 'bDBP', l: 'Brachial DBP', u: 'mmHg', f: 0, st: v => v < 60 ? 'warn' : v < 80 ? 'ok' : v < 90 ? 'warn' : 'bad', tip: 'Diastolic pressure is nearly the same everywhere in the large arteries.' },
    { k: 'bPP', l: 'Brachial PP', u: 'mmHg', f: 0, st: S(60, 70), tip: 'Brachial SBP − DBP.' },
    { k: 'map', l: 'Mean arterial pressure', u: 'mmHg', f: 0, st: v => v < 70 ? 'warn' : v <= 100 ? 'ok' : v <= 110 ? 'warn' : 'bad', tip: 'MAP = CO × SVR (Eq. 1, Nichols & Edwards). Identical centrally and peripherally.' }
  ]},
  { g: 'Central aortic pressure', items: [
    { k: 'Ps', l: 'Central SBP (Ps)', u: 'mmHg', f: 0, st: S(124, 139), tip: 'Peak ascending-aortic pressure. ≈124 mmHg used as upper limit of normal (Townsend et al. 2015).' },
    { k: 'Pd', l: 'Central DBP (Pd)', u: 'mmHg', f: 0, st: v => v < 60 ? 'bad' : v < 70 ? 'warn' : 'ok', tip: 'Falls as elastic arteries stiffen (Eq. 11). Low DBP compromises coronary perfusion (Nichols & Edwards Fig. 6).' },
    { k: 'PP', l: 'Central PP', u: 'mmHg', f: 0, st: S(45, 50), tip: 'PP = (Pi − Pd) + (Ps − Pi). Highest quartile (>50 mmHg) carried most events in the Strong Heart Study.' },
    { k: 'Pi', l: 'Inflection pressure (Pi / P2)', u: 'mmHg', f: 0, tip: 'Pressure where the reflected wave begins to add (Type A). For Type C waves this is the late reflected shoulder P2.' },
    { k: 'AP', l: 'Augmentation pressure', u: 'mmHg', f: 1, tip: 'AP = Ps − Pi (negative when the reflected peak sits below the first systolic peak).' },
    { k: 'AIx', l: 'Augmentation index', u: '%', f: 1, st: S(20, 30), tip: 'AIx = (Ps − Pi)/(Ps − Pd). Composite of stiffness, reflection magnitude, timing, HR and height.' },
    { k: 'AIx75', l: 'AIx @ HR 75', u: '%', f: 1, st: S(20, 30), tip: 'Heart-rate normalised AIx: ≈3.9 % lower per 10 bpm rise (Wilkinson et al. 2000).' },
    { k: 'ppa', l: 'PP amplification (brachial/central)', u: '×', f: 2, st: SL(1.3, 1.1), tip: 'Typical ≥ 1.3 (Townsend et al. 2015); falls with age, stiffening and β-blockade.' },
    { k: 'type', l: 'Waveform type (Murgo)', u: '', f: 0, txt: true, tip: 'A: reflected wave returns early, Ps > Pi. B: small positive augmentation. C: returns after peak (young, negative AIx).' }
  ]},
  { g: 'Wave reflection & timing', items: [
    { k: 'dtp', l: 'Round-trip time Δtp', u: 'ms', f: 0, tip: 'Δtp = 2·Lp / c (Nichols). Time for the forward wave to reach the reflection site and return.' },
    { k: 'lp', l: 'Distance to reflection site Lp', u: 'cm', f: 0, tip: 'Lp = c·Δtp / 2.' },
    { k: 'cPath', l: 'Path PWV (aorta + muscular)', u: 'm/s', f: 1, tip: 'Harmonic mean of aortic (65 % of path) and muscular PWV — the speed the reflected wave actually travels.' },
    { k: 'dtr', l: 'Systolic duration of reflection Δtr', u: 'ms', f: 0, tip: 'Δtr = ET − Δtp, when the reflection returns in systole.' },
    { k: 'Ew', l: 'Wasted LV energy ΔEw', u: 'dyn·s/cm²', f: 0, st: S(5000, 12000), tip: 'ΔEw = Δtr·(Ps − Pi)·π/2 (Nichols & Singh 2002). Extra pressure work against the reflected wave.' },
    { k: 'fwdAmp', l: 'Forward wave amplitude (Pf)', u: 'mmHg', f: 1, tip: 'From wave separation, Pf = (P + Zc·Q)/2.' },
    { k: 'bwdAmp', l: 'Reflected wave amplitude (Pb)', u: 'mmHg', f: 1, tip: 'Pb = (P − Zc·Q)/2.' },
    { k: 'rm', l: 'Reflection magnitude Pb/Pf', u: '%', f: 0, tip: 'Backward/forward amplitude × 100 (Chirinos/MESA). Absolute values depend on method; use for direction of change.' },
    { k: 'lsEs', l: 'Late/early systolic load (LSPTI/ESPTI)', u: '', f: 2, st: S(0.58, 0.62), tip: 'Area under the last third of systole ÷ first two-thirds (MESA median ≈ 0.59). Predicts incident heart failure.' }
  ]},
  { g: 'Steady flow & arterial properties', items: [
    { k: 'co', l: 'Cardiac output', u: 'L/min', f: 2, tip: 'CO = SV × HR.' },
    { k: 'svrDyn', l: 'SVR', u: 'dyn·s·cm⁻⁵', f: 0, st: v => v < 800 ? 'warn' : v <= 1600 ? 'ok' : v <= 1900 ? 'warn' : 'bad', tip: 'Poiseuille resistance of the arterioles; R ∝ r⁻⁴.' },
    { k: 'svrWU', l: 'SVR (Wood units)', u: 'WU', f: 1, tip: 'mmHg·min/L.' },
    { k: 'zcDyn', l: 'Characteristic impedance Zc', u: 'dyn·s·cm⁻⁵', f: 0, tip: 'Zc = ρc/A. Index of proximal aortic stiffness; sets the forward wave for a given flow.' },
    { k: 'ctot', l: 'Total arterial compliance', u: 'mL/mmHg', f: 2, tip: 'C ≈ V / ρc² (Bramwell–Hill). Governs diastolic decay.' },
    { k: 'svpp', l: 'SV / PP', u: 'mL/mmHg', f: 2, tip: 'Simple clinical surrogate of compliance.' },
    { k: 'tau', l: 'Windkessel time constant τ = R·C', u: 's', f: 2, st: v => v < 0.75 ? 'warn' : v <= 2.0 ? 'ok' : 'warn', tip: 'τ = SVR × total compliance: the diastolic time constant set by the model\'s resistance and compliance. Shorter τ = faster diastolic run-off = lower DBP. Invasive τ (asymptote 0) ≈ 1.4 ± 0.3 s (Chemla 2017). This is the model\'s primary τ; the fitted τ below is measured from the waveform.' },
    { k: 'cAoOp', l: 'Aortic PWV (operating)', u: 'm/s', f: 1, tip: 'Intrinsic PWV adjusted passively for MAP (elastic arteries stiffen at higher distending pressure).' },
    { k: 'ep', l: 'Peterson modulus Ep', u: 'mmHg', f: 0, tip: 'Ep = D·ΔP/ΔD ≈ 2ρc² (Eq. 6, Nichols & Edwards).' }
  ]},
  { g: 'Diastolic decay', items: [
    { k: 'tauFit', l: 'Decay τ fitted to the waveform (asymptote 0)', u: 's', f: 2,
      tip: 'Measured from the waveform: P(t) = P0·e^(−t/τ) fitted to the last two-thirds of diastole (asymptote 0 mmHg), as done on catheter traces (≈ 1.4 ± 0.3 s; Chemla 2017). In this model it runs 1.2–2.6 × R·C, more when Γ is low, because the reflection setting also weakens the low-frequency (Windkessel) part of the load and late diastole flattens. Use τ = R·C for the time constant; use this value only alongside waveform-based measurements (Methods §14).' },
    { k: 'decayRate', l: 'Diastolic decay rate', u: 'mmHg/s', f: 0,
      tip: 'Mean fall of central pressure per second over the same window: (pressure at the start of the window − end-diastolic pressure) ÷ time. Rises with stiffer arteries, lower SVR and higher heart rate.' },
    { k: 'decayFall', l: 'Pressure fall over the fit window', u: 'mmHg', f: 1,
      tip: 'Pressure at the start of the fit window minus end-diastolic pressure.' },
    { k: 'tauFree', l: 'Decay τ, asymptote fitted', u: 's', f: 2,
      tip: 'Same window, fitting P(t) = P∞ + A·e^(−t/τ) with the asymptote P∞ free. Real aortic pressure decays toward ≈ 60–70 mmHg rather than 0, so this τ is much shorter: invasive studies report ≈ 0.35–0.45 s (Chemla 2017; Yamakado 2018).' },
    { k: 'pInf', l: 'Decay asymptote P∞', u: 'mmHg', f: 0,
      tip: 'The pressure the diastolic decay heads toward in the three-parameter fit. Invasive values ≈ 58 ± 8 mmHg (Yamakado 2018) and 71 ± 12 mmHg (Chemla 2017).' }
  ]},
  { g: 'Ventricle & coronary supply', items: [
    { k: 'et', l: 'Ejection time (LVET)', u: 'ms', f: 0, tip: 'Weissler LVET (413 − 1.7·HR ms in men, 418 − 1.6·HR in women) × the patient\'s ejection-duration setting, held between 150 ms and 60 % of the cycle.' },
    { k: 'tti', l: 'Tension-time index (TTI)', u: 'mmHg·s', f: 1, tip: 'Area under systolic pressure — index of myocardial O₂ demand.' },
    { k: 'dpti', l: 'Diastolic pressure-time (DPTI)', u: 'mmHg·s', f: 1, tip: 'Area of (P − LVEDP) in diastole — index of subendocardial perfusion.' },
    { k: 'sevr', l: 'SEVR (DPTI/TTI)', u: '%', f: 0, st: SL(130, 100), tip: 'Buckberg subendocardial viability ratio. Low values indicate a supply–demand mismatch (Nichols & Edwards).' },
    { k: 'svf', l: 'Forward stroke component SVf', u: 'mL', f: 1, tip: 'SVm = SVf − SVr (Eq. 13). Flow carried by the forward wave.' },
    { k: 'svrefl', l: 'Reflected stroke component SVr', u: 'mL', f: 1, tip: 'Flow cancelled by the reflected wave (it subtracts from flow while adding to pressure).' }
  ]}
];
export const METRIC_BY_KEY: Partial<Record<MetricKey, Metric>> = Object.fromEntries(METRICS.flatMap(g => g.items).map(m => [m.k, m]));

/** Right-hand metric cards (v1 KPI strip, plus heart rate). */
export interface Card {
  id: string; l: string; u: string; f: number;
  v: (r: BeatResult) => string;
  d: (r: BeatResult, b: BeatResult) => number;
  st?: (r: BeatResult) => Status;
  explain: string;      // Explain-drawer id
}
export const CARDS: Card[] = [
  { id: 'cuff', l: 'Cuff BP', v: r => `${r.m.bSBP.toFixed(0)}/${r.m.bDBP.toFixed(0)}`, d: (r, b) => r.m.bSBP - b.m.bSBP, u: 'mmHg', f: 0, st: r => S(129, 139)(r.m.bSBP), explain: 'bSBP' },
  { id: 'central', l: 'Central BP', v: r => `${r.m.Ps.toFixed(0)}/${r.m.Pd.toFixed(0)}`, d: (r, b) => r.m.Ps - b.m.Ps, u: 'mmHg', f: 0, st: r => S(124, 139)(r.m.Ps), explain: 'Ps' },
  { id: 'map', l: 'MAP', v: r => r.m.map.toFixed(0), d: (r, b) => r.m.map - b.m.map, u: 'mmHg', f: 0, st: r => (r.m.map < 70 || r.m.map > 105) ? 'warn' : 'ok', explain: 'map' },
  { id: 'hr', l: 'Heart rate', v: r => r.params.hr.toFixed(0), d: (r, b) => r.params.hr - b.params.hr, u: 'bpm', f: 0, explain: 'hr' },
  { id: 'pp', l: 'Central PP', v: r => r.m.PP.toFixed(0), d: (r, b) => r.m.PP - b.m.PP, u: 'mmHg', f: 0, st: r => S(45, 50)(r.m.PP), explain: 'PP' },
  { id: 'aix', l: 'AIx', v: r => r.m.AIx.toFixed(0), d: (r, b) => r.m.AIx - b.m.AIx, u: '%', f: 0, st: r => S(20, 30)(r.m.AIx), explain: 'AIx' },
  { id: 'ap', l: 'Aug. pressure', v: r => r.m.AP.toFixed(0), d: (r, b) => r.m.AP - b.m.AP, u: 'mmHg', f: 0, explain: 'AP' },
  { id: 'ppa', l: 'PP amplif.', v: r => r.m.ppa.toFixed(2), d: (r, b) => r.m.ppa - b.m.ppa, u: '×', f: 2, st: r => SL(1.3, 1.1)(r.m.ppa), explain: 'ppa' },
  { id: 'pwv', l: 'Aortic PWV', v: r => r.m.cAoOp.toFixed(1), d: (r, b) => r.m.cAoOp - b.m.cAoOp, u: 'm/s', f: 1, st: r => S(8, 10)(r.m.cAoOp), explain: 'cAoOp' },
  { id: 'dtp', l: 'Δtp', v: r => r.m.dtp.toFixed(0), d: (r, b) => r.m.dtp - b.m.dtp, u: 'ms', f: 0, explain: 'dtp' },
  { id: 'ew', l: 'ΔEw', v: r => (r.m.Ew / 1000).toFixed(1), d: (r, b) => (r.m.Ew - b.m.Ew) / 1000, u: '×10³', f: 1, st: r => S(5000, 12000)(r.m.Ew), explain: 'Ew' },
  { id: 'decay', l: 'τ = R·C', v: r => r.m.tau.toFixed(2), d: (r, b) => r.m.tau - b.m.tau, u: 's', f: 2, explain: 'tau' },
  { id: 'sevr', l: 'SEVR', v: r => r.m.sevr.toFixed(0), d: (r, b) => r.m.sevr - b.m.sevr, u: '%', f: 0, st: r => SL(130, 100)(r.m.sevr), explain: 'sevr' }
];
