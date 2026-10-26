/* =====================================================================
   Static content: control definitions, metric metadata, equations text.
   ===================================================================== */
(function (global) {
  'use strict';

  const CONTROLS = [
    { group: 'Heart', color: 'var(--accent)', items: [
      { key: 'hr', label: 'Heart rate', min: 40, max: 130, step: 1, unit: 'bpm', f: 0,
        tip: 'Sets cycle length and, via the Weissler relation, ejection time (LVET ≈ 413 − 1.7·HR ms). Slower HR lengthens systole, so the reflected wave lands earlier relative to ejection and AIx rises.' },
      { key: 'sv', label: 'Stroke volume', min: 30, max: 120, step: 1, unit: 'mL', f: 0,
        tip: 'Volume ejected per beat. Scales the flow wave, hence the forward pressure wave (water-hammer: ΔP = Zc·ΔQ) and cardiac output.' },
      { key: 'etScale', label: 'Ejection duration', min: 0.8, max: 1.2, step: 0.01, unit: '×', f: 2,
        tip: 'Multiplier on the Weissler LVET. Longer ejection keeps the ventricle exposed to the returning reflected wave for longer (larger Δtr and wasted energy).' }
    ]},
    { group: 'Arterioles (resistance)', color: 'var(--ink-3)', items: [
      { key: 'radius', label: 'Arteriolar radius', min: 75, max: 125, step: 0.5, unit: '%', f: 1,
        tip: 'Poiseuille: R = 8μL/πr⁴, so SVR scales with radius⁻⁴. A 10 % increase in radius lowers SVR by ~32 %. Mainly moves mean pressure (MAP = CO × SVR).' }
    ]},
    { group: 'Elastic arteries (aorta)', color: 'var(--fwd)', items: [
      { key: 'cAo', label: 'Aortic PWV (intrinsic)', min: 4, max: 16, step: 0.1, unit: 'm/s', f: 1,
        tip: 'Stiffness of the central elastic arteries at a reference MAP of 93 mmHg. Raises characteristic impedance (Zc = ρc/A), lowers compliance (C ∝ 1/ρc²) and speeds wave return. The operating value also rises passively with MAP.' },
      { key: 'diam', label: 'Aortic diameter', min: 2.0, max: 4.2, step: 0.05, unit: 'cm', f: 2,
        tip: 'Larger lumen lowers Zc (Zc = ρc/A) and adds compliance — the aorta dilates with age, partly offsetting stiffening.' }
    ]},
    { group: 'Muscular arteries & reflection', color: 'var(--bwd)', items: [
      { key: 'cMus', label: 'Muscular-artery PWV', min: 5, max: 14, step: 0.1, unit: 'm/s', f: 1,
        tip: 'Smooth-muscle tone of the muscular conduits (femoral, popliteal, brachial). Vasodilators lower it, delaying the reflected wave (Nichols & Singh 2002). Also sets arm-wave speed (amplification).' },
      { key: 'gamma', label: 'Reflection coefficient Γ', min: 0.1, max: 0.9, step: 0.01, unit: '', f: 2,
        tip: 'Fraction of the forward wave reflected at the effective reflection site (impedance mismatch). Vasodilators lower it; vasoconstrictors raise it.' },
      { key: 'lpScale', label: 'Reflection-site position', min: 0.7, max: 1.5, step: 0.01, unit: '×', f: 2,
        tip: 'Scales the effective distance to the major reflection site (Lp = 0.27 × height × factor). Values > 1 shift the site distally (as described in youth).' }
    ]},
    { group: 'Patient', color: 'var(--brach)', items: [
      { key: 'height', label: 'Height', min: 140, max: 205, step: 1, unit: 'cm', f: 0,
        tip: 'Body height sets the path length to the reflection site and the arm path. Shorter people have earlier reflections and a higher AIx (Nichols & Singh 2002).' }
    ]}
  ];

  // metric metadata: key, label, unit, decimals, tooltip, status function
  const S = (ok, warn) => v => v <= ok ? 'ok' : v <= warn ? 'warn' : 'bad';
  const SL = (ok, warn) => v => v >= ok ? 'ok' : v >= warn ? 'warn' : 'bad';
  const METRICS = [
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
      { k: 'type', l: 'Waveform type (Murgo)', u: '', txt: true, tip: 'A: reflected wave returns early, Ps > Pi. B: small positive augmentation. C: returns after peak (young, negative AIx).' }
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
      { k: 'tau', l: 'Diastolic time constant RC', u: 's', f: 2, tip: 'τ = SVR × C. Shorter τ = faster diastolic run-off = lower DBP.' },
      { k: 'cAoOp', l: 'Aortic PWV (operating)', u: 'm/s', f: 1, tip: 'Intrinsic PWV adjusted passively for MAP (elastic arteries stiffen at higher distending pressure).' },
      { k: 'ep', l: 'Peterson modulus Ep', u: 'mmHg', f: 0, tip: 'Ep = D·ΔP/ΔD ≈ 2ρc² (Eq. 6, Nichols & Edwards).' }
    ]},
    { g: 'Ventricle & coronary supply', items: [
      { k: 'et', l: 'Ejection time (LVET)', u: 'ms', f: 0, tip: 'Weissler LVET ≈ 413 − 1.7·HR, times the ejection-duration multiplier.' },
      { k: 'tti', l: 'Tension-time index (TTI)', u: 'mmHg·s', f: 1, tip: 'Area under systolic pressure — index of myocardial O₂ demand.' },
      { k: 'dpti', l: 'Diastolic pressure-time (DPTI)', u: 'mmHg·s', f: 1, tip: 'Area of (P − LVEDP) in diastole — index of subendocardial perfusion.' },
      { k: 'sevr', l: 'SEVR (DPTI/TTI)', u: '%', f: 0, st: SL(130, 100), tip: 'Buckberg subendocardial viability ratio. Low values indicate a supply–demand mismatch (Nichols & Edwards).' },
      { k: 'svf', l: 'Forward stroke component SVf', u: 'mL', f: 1, tip: 'SVm = SVf − SVr (Eq. 13). Flow carried by the forward wave.' },
      { k: 'svrefl', l: 'Reflected stroke component SVr', u: 'mL', f: 1, tip: 'Flow cancelled by the reflected wave (it subtracts from flow while adding to pressure).' }
    ]}
  ];

  const KPIS = [
    { k: 'cuff', l: 'Cuff BP', v: m => `${m.bSBP.toFixed(0)}/${m.bDBP.toFixed(0)}`, d: (m, b) => m.bSBP - b.bSBP, u: 'mmHg', st: m => S(129, 139)(m.bSBP), tip: 'Brachial systolic/diastolic — what a sphygmomanometer reads.' },
    { k: 'central', l: 'Central BP', v: m => `${m.Ps.toFixed(0)}/${m.Pd.toFixed(0)}`, d: (m, b) => m.Ps - b.Ps, u: 'mmHg', st: m => S(124, 139)(m.Ps), tip: 'Ascending-aortic systolic/diastolic — the pressure the LV actually faces.' },
    { k: 'map', l: 'MAP', v: m => m.map.toFixed(0), d: (m, b) => m.map - b.map, u: 'mmHg', st: m => (m.map < 70 || m.map > 105) ? 'warn' : 'ok', tip: 'Mean arterial pressure = CO × SVR.' },
    { k: 'pp', l: 'Central PP', v: m => m.PP.toFixed(0), d: (m, b) => m.PP - b.PP, u: 'mmHg', st: m => S(45, 50)(m.PP), tip: 'Ps − Pd in the aorta.' },
    { k: 'aix', l: 'AIx', v: m => m.AIx.toFixed(0), d: (m, b) => m.AIx - b.AIx, u: '%', st: m => S(20, 30)(m.AIx), tip: '(Ps − Pi)/PP.' },
    { k: 'ppa', l: 'PP amplif.', v: m => m.ppa.toFixed(2), d: (m, b) => m.ppa - b.ppa, u: '×', f: 2, st: m => SL(1.3, 1.1)(m.ppa), tip: 'Brachial PP / central PP.' },
    { k: 'pwv', l: 'Aortic PWV', v: m => m.cAoOp.toFixed(1), d: (m, b) => m.cAoOp - b.cAoOp, u: 'm/s', f: 1, st: m => S(8, 10)(m.cAoOp), tip: 'Operating aortic PWV (10 m/s is the conventional threshold of increased stiffness).' },
    { k: 'dtp', l: 'Δtp', v: m => m.dtp.toFixed(0), d: (m, b) => m.dtp - b.dtp, u: 'ms', tip: 'Round-trip travel time of the reflected wave.' },
    { k: 'ew', l: 'ΔEw', v: m => (m.Ew / 1000).toFixed(1), d: (m, b) => (m.Ew - b.Ew) / 1000, u: '×10³', f: 1, st: m => S(5000, 12000)(m.Ew), tip: 'Wasted LV pressure energy, dyn·s/cm².' },
    { k: 'sevr', l: 'SEVR', v: m => m.sevr.toFixed(0), d: (m, b) => m.sevr - b.sevr, u: '%', st: m => SL(130, 100)(m.sevr), tip: 'Subendocardial viability ratio (DPTI/TTI).' }
  ];

  const EQUATIONS = `
<div class="about"><h2 style="margin-top:0">About Pulse Lab Simulator</h2>
<p>Created by Dov Greenwald (2026) to teach and present the physiology of arterial stiffness, wave reflection and central blood pressure.</p>
<p><b>Educational use only.</b> This is a simplified mathematical model, tuned to reproduce published trends. It is not a medical device, it has not been validated on individual patients, and it must not be used for diagnosis or treatment decisions. Drug effects are illustrative directions, not doses or predictions.</p>
<p>Physiology and equations are drawn from the papers listed under References below.</p></div>
<h2>Equations &amp; methods</h2>
<p>Every number in the simulator is computed from the relations below. The main sources are Nichols &amp; Edwards 2001 (J Cardiovasc Pharmacol Ther), Nichols &amp; Singh 2002 (Curr Opin Cardiol), Townsend et al. 2015 (J Clin Hypertens) and Townsend 2015 (Methodist DeBakey Cardiovasc J) — plus standard hemodynamic relations noted where used.</p>

<h3>1 · Steady (mean) flow</h3>
<div class="eq">R = (P₁ − P₂)/Q = 8 μ L / (π r⁴)<span class="src">Poiseuille · N&amp;E 2001</span></div>
<div class="eq">MAP = CO × SVR = SV × HR × SVR<span class="src">Eq. 1 · N&amp;E 2001</span></div>
<div class="eq">MAP ≈ Pd + (Ps − Pd)/3 &nbsp;⇒&nbsp; Pd = 1.5·SV·HR·R − 0.5·Ps<span class="src">Eqs. 3–4 · N&amp;E 2001</span></div>

<h3>2 · Wall stiffness and the forward wave</h3>
<div class="eq">Ep = D (Ps − Pd) / ΔD &nbsp;⇒&nbsp; PP = Ep·ΔD/D<span class="src">Eqs. 6–7 · N&amp;E 2001</span></div>
<div class="eq">Ps = R·CO + (2/3)·Ep·ΔD/D &nbsp;&nbsp; Pd = R·CO − (1/3)·Ep·ΔD/D<span class="src">Eqs. 10–11 (self-consistent form)</span></div>
<div class="eq">ΔP = c₀ ρ ΔQ / (π r²) = Zc · ΔQ &nbsp;&nbsp;(Pi − Pd) = c₀ · ρ · peak flow / A<span class="src">Water-hammer · Eq. 2 N&amp;E; N&amp;S 2002</span></div>
<div class="eq">Zc = ρ c₀ / A &nbsp;&nbsp; c₀ = √(A·ΔP / ρ·ΔA) &nbsp;&nbsp; C ≈ V / (ρ c₀²) &nbsp;&nbsp; Ep ≈ 2ρc₀²<span class="src">Bramwell–Hill 1922 (standard)</span></div>

<h3>3 · Wave reflection</h3>
<div class="eq">PP = (Pi − Pd) + (Ps − Pi) &nbsp; = forward + reflected<span class="src">Eq. 12 · superposition</span></div>
<div class="eq">Lp = c₀·Δtp / 2 &nbsp;&nbsp; Δtp = 2 Lp / c₀<span class="src">N&amp;E 2001; N&amp;S 2002</span></div>
<div class="eq">AIx = (Ps − Pi) / (Ps − Pd) = AP / PP<span class="src">N&amp;S 2002; Townsend 2015</span></div>
<div class="eq">ΔEw = Δtr · (Ps − Pi) · π / 2 &nbsp;&nbsp;(× 1333 → dyn·s/cm²)<span class="src">N&amp;S 2002</span></div>
<div class="eq">SVm = SVf − SVr<span class="src">Eq. 13 · N&amp;E 2001</span></div>
<div class="eq">Pf = (P + Zc·Q)/2 &nbsp;&nbsp; Pb = (P − Zc·Q)/2 &nbsp;&nbsp; RM = |Pb| / |Pf| × 100<span class="src">Wave separation · Townsend (MESA)</span></div>

<h3>4 · Clinical indices</h3>
<div class="eq">PPA = brachial PP / central PP &nbsp;(Townsend reports (PPA − 1) × 100 %)<span class="src">Townsend 2015</span></div>
<div class="eq">LSPTI / ESPTI = ∫ last ⅓ systole P dt ÷ ∫ first ⅔ systole P dt<span class="src">Townsend 2015 (MESA)</span></div>
<div class="eq">AIx@75 = AIx + 0.39 · (HR − 75)<span class="src">Wilkinson et al. J Physiol 2000</span></div>
<div class="eq">SEVR = DPTI / TTI = ∫diastole (P − LVEDP) dt ÷ ∫systole P dt<span class="src">Buckberg index (standard)</span></div>
<div class="eq">LVET ≈ 413 − 1.7 · HR &nbsp;(ms)<span class="src">Weissler systolic time intervals (standard)</span></div>

<h3>5 · How the simulator solves it</h3>
<p>The left ventricle is modelled as a <b>flow source</b> Q(t) (smooth ejection profile, area = SV, duration = LVET). It ejects into a uniform aortic transmission line with characteristic impedance Z<sub>c</sub> and wave speed c, terminated at distance L<sub>p</sub> by a three-element Windkessel (Z<sub>t</sub> + R ∥ C). Z<sub>t</sub> is chosen so the high-frequency reflection coefficient equals the Γ slider; R makes total resistance equal SVR; C makes total compliance equal V/ρc². For one periodic beat the equations are solved exactly per harmonic (FFT, 1024 samples):</p>
<div class="eq">Pf(ω) = Zc Q(ω) / (1 − Γ(ω) e<sup>−iωΔtp</sup>) &nbsp;&nbsp; Pb(ω) = Γ(ω) e<sup>−iωΔtp</sup> Pf(ω) &nbsp;&nbsp; P = Pf + Pb</div>
<div class="eq">Z<sub>in</sub>(ω) = Zc (1 + Γe<sup>−iωΔtp</sup>) / (1 − Γe<sup>−iωΔtp</sup>) &nbsp;→&nbsp; Z<sub>in</sub>(0) = SVR, so MAP = CO × SVR exactly</div>
<p>A small frequency-dependent attenuation represents viscoelastic loss. The reflected wave travels at a <b>path PWV</b> — the harmonic mean of aortic (65 % of the path) and muscular-artery PWV — so drugs that relax muscular arteries delay reflection without touching aortic stiffness, as Nichols describes. Brachial and radial waves are obtained with a second transmission-line transfer function along the arm (muscular PWV, fixed terminal reflection), which reproduces pressure amplification. Elastic-artery PWV rises passively with MAP (≈1 % per mmHg).</p>

<h3>6 · Assumptions &amp; limitations</h3>
<ul>
  <li>Single effective reflection site; the real tree has distributed reflections. Absolute Δtp values in youth are shorter than some invasive reports (e.g. 332 ms at age 19 in Nichols &amp; Singh, Fig. 2) — trends, not absolute numbers, are the point.</li>
  <li>The heart is a flow source: stroke volume does not fall automatically with higher afterload. SV<sub>r</sub> shows the reflected flow component instead.</li>
  <li>Linear, non-pulsatile-viscosity model; no venous pressure, no baroreflex, no autoregulation.</li>
  <li>Drug effects are illustrative parameter shifts chosen to match the published directions (Townsend Table 1), not pharmacokinetic models.</li>
  <li>Reflection magnitude (RM) depends heavily on the separation method; compare directions, not absolute values against MESA.</li>
</ul>

<h3>References</h3>
<ol>
  <li>Nichols WW, Edwards DG. Arterial elastance and wave reflection augmentation of systolic blood pressure: deleterious effects and implications for therapy. J Cardiovasc Pharmacol Ther 2001;6(1):5–21.</li>
  <li>Nichols WW, Singh BM. Augmentation index as a measure of peripheral vascular disease state. Curr Opin Cardiol 2002;17:543–551.</li>
  <li>Townsend RR, Black HR, Chirinos JA, et al. Clinical use of pulse wave analysis: proceedings from a symposium sponsored by North American Artery. J Clin Hypertens 2015;17:503–513.</li>
  <li>Townsend RR. Novel uses of office-based measures of arterial compliance. Methodist DeBakey Cardiovasc J 2015;11(4):219–222.</li>
  <li>Wilkinson IB, MacCallum H, Flint L, et al. The influence of heart rate on augmentation index and central arterial pressure in humans. J Physiol 2000;525:263–270.</li>
  <li>Nichols WW, O'Rourke MF, Vlachopoulos C. McDonald's Blood Flow in Arteries. 6th ed. Hodder Arnold; 2011.</li>
</ol>`;

  global.Content = { CONTROLS, METRICS, KPIS, EQUATIONS };
})(window);
