/* Methods tab: equations (from v1), v2 engine and drug methods, illustrative drug values,
   differences from the v2 specification, limitations and references. */
import { ALL_DRUGS, BAROREFLEX, CITATIONS, DRUG_EMAX, DRUG_KINETICS, ENGINE, MODEL } from './physiology';

const fx = (d: Record<string, number | undefined>) => {
  const parts: string[] = [];
  const mul = (k: string, label: string) => { const v = d[k]; if (v != null) parts.push(`${label} ×${v}`); };
  mul('radius', 'arteriolar radius'); mul('cMus', 'muscular PWV'); mul('cAo', 'aortic PWV'); mul('gamma', 'Γ');
  if (d.hrAdd != null) parts.push(`HR ${d.hrAdd > 0 ? '+' : ''}${d.hrAdd} bpm`);
  if (d.svAdd != null) parts.push(`SV ${d.svAdd > 0 ? '+' : ''}${d.svAdd} mL`);
  return parts.join(', ');
};

export function methodsHtml(): string {
  const drugRows = Object.entries(ALL_DRUGS).map(([k, d]) => {
    const kin = DRUG_KINETICS[k];
    return `<tr><td>${d.label}${kin.chronic ? ' <span class="muted">(long-term, v1)</span>' : ''}</td><td>${fx(d.fx as Record<string, number | undefined>)}</td>
      <td class="n">${kin.tauOn}</td><td class="n">${kin.tauOff}</td><td>${kin.modes.join(', ')}${kin.chronic ? ', steady state' : ''}</td></tr>`;
  }).join('');
  return `
<div class="about"><h2 style="margin-top:0">About Pulse Lab Simulator</h2>
<p>Created by Dov Greenwald (2026) to teach and present the physiology of arterial stiffness, wave reflection and central blood pressure.</p>
<p><b>Educational model only.</b> This is a simplified mathematical model, tuned to reproduce published trends. It is not a medical device, it has not been validated on individual patients, and it must not be used for diagnosis or treatment decisions. Drug effects are illustrative directions, not doses or predictions.</p></div>
<h2>Equations &amp; methods</h2>
<p>Every number in the simulator is computed from the relations below. The main sources are Nichols &amp; Edwards 2001, Nichols &amp; Singh 2002, Townsend et al. 2015 and Townsend 2015, plus standard haemodynamic relations noted where used.</p>

<h3>1 · Steady (mean) flow</h3>
<div class="eq">R = (P₁ − P₂)/Q = 8 μ L / (π r⁴)<span class="src">Poiseuille · N&amp;E 2001</span></div>
<div class="eq">MAP = CO × SVR / 80 + CVP &nbsp;(CVP = 0 here; CO in L/min, SVR in dyn·s·cm⁻⁵)<span class="src">Eq. 1 · N&amp;E 2001</span></div>
<div class="eq">MAP ≈ Pd + (Ps − Pd)/3 &nbsp;⇒&nbsp; Pd = 1.5·SV·HR·R − 0.5·Ps<span class="src">Eqs. 3–4 · N&amp;E 2001</span></div>

<h3>2 · Wall stiffness and the forward wave</h3>
<div class="eq">Ep = D (Ps − Pd) / ΔD &nbsp;⇒&nbsp; PP = Ep·ΔD/D<span class="src">Eqs. 6–7 · N&amp;E 2001</span></div>
<div class="eq">ΔP = c₀ ρ ΔQ / (π r²) = Zc · ΔQ<span class="src">Water-hammer · Eq. 2 N&amp;E; N&amp;S 2002</span></div>
<div class="eq">Zc = ρ c₀ / A &nbsp;&nbsp; C ≈ V / (ρ c₀²) &nbsp;&nbsp; Ep ≈ 2ρc₀²<span class="src">Bramwell–Hill 1922</span></div>
<div class="eq">c_operating = c₀ · (1 + ${MODEL.kAo} · (MAP − ${MODEL.mapRef})) &nbsp;(aorta); ${MODEL.kMus} for muscular arteries<span class="src">passive pressure dependence (v1)</span></div>

<h3>3 · Wave reflection</h3>
<div class="eq">PP = (Pi − Pd) + (Ps − Pi) &nbsp; = forward + reflected<span class="src">Eq. 12 · superposition</span></div>
<div class="eq">Δtp = 2 Lp / c_path, &nbsp; Lp = ${MODEL.lpPerHeight} × height × position factor<span class="src">N&amp;E 2001; N&amp;S 2002</span></div>
<div class="eq">AIx = (P2 − P1) / PP × 100 &nbsp;&nbsp; AP = P2 − P1<span class="src">N&amp;S 2002; Townsend 2015</span></div>
<div class="eq">ΔEw = Δtr · (Ps − Pi) · π / 2 &nbsp;(× 1333 → dyn·s/cm²)<span class="src">N&amp;S 2002</span></div>
<div class="eq">Pf = (P + Zc·Q)/2 &nbsp;&nbsp; Pb = (P − Zc·Q)/2 &nbsp;&nbsp; RM = |Pb| / |Pf| × 100<span class="src">Wave separation · Townsend (MESA)</span></div>

<h3>4 · Clinical indices</h3>
<div class="eq">PPA = brachial PP / central PP<span class="src">Townsend 2015</span></div>
<div class="eq">LSPTI / ESPTI = ∫ last ⅓ systole P dt ÷ ∫ first ⅔ systole P dt<span class="src">Townsend 2015 (MESA)</span></div>
<div class="eq">AIx@75 = AIx + ${MODEL.aix75PerBpm} · (HR − 75)<span class="src">Wilkinson et al. J Physiol 2000</span></div>
<div class="eq">SEVR = DPTI / TTI = ∫diastole (P − LVEDP) dt ÷ ∫systole P dt<span class="src">Buckberg index</span></div>
<div class="eq">LVET ≈ ${MODEL.lvetA} − ${MODEL.lvetB} · HR &nbsp;(ms)<span class="src">Weissler systolic time intervals</span></div>

<h3>5 · How one beat is solved</h3>
<p>The left ventricle is a <b>flow source</b> Q(t) (smooth ejection profile, area = SV, duration = LVET) ejecting into a uniform aortic transmission line (Z<sub>c</sub>, wave speed c), terminated at L<sub>p</sub> by a three-element Windkessel (Z<sub>t</sub> + R ∥ C). For one periodic beat the equations are solved exactly per harmonic (FFT, ${1024} samples):</p>
<div class="eq">Pf(ω) = Zc Q(ω) / (1 − Γ(ω) e<sup>−iωΔtp</sup>) &nbsp;&nbsp; Pb(ω) = Γ(ω) e<sup>−iωΔtp</sup> Pf(ω) &nbsp;&nbsp; P = Pf + Pb</div>
<div class="eq">Z<sub>in</sub>(ω) = Zc (1 + Γe<sup>−iωΔtp</sup>) / (1 − Γe<sup>−iωΔtp</sup>); the Impedance tab computes it from the beat as FFT(P) / FFT(Q), so Z(0) = SVR</div>
<p>The reflected wave travels at a <b>path PWV</b> — the harmonic mean of aortic (65 % of the path) and muscular-artery PWV. Brachial and radial waves come from a second transmission-line transfer function along the arm (muscular PWV, fixed terminal reflection). The MAP → stiffness feedback is solved by fixed-point iteration (at most 8 steps, tolerance 0.1 mmHg); because the heart is a flow source, MAP = CO × SVR does not depend on PWV, so it settles in two steps.</p>

<h3>6 · Live beat engine (v2)</h3>
<ul>
  <li>A new steady-state beat is solved at the start of every heartbeat, at the current heart rate. Time runs at ×0.25, ×0.5 or ×1; Space pauses and “.” steps one beat.</li>
  <li>Every input change eases to its new value over ${ENGINE.rampBeats} beats with a cosine curve, so waveforms morph rather than jump.</li>
  <li>Per-beat trends (SBP, DBP, MAP, PP, HR, AIx, central and brachial PP, PWV) are kept for the last ${ENGINE.trendWindowS / 60} minutes.</li>
  <li>Feature points: foot (tangent at the steepest upstroke), systolic peak, inflection and dicrotic notch. Derivatives are computed spectrally and low-passed at 16 Hz. The inflection is the largest positive peak of d²P/dt² during ejection; if it falls after the systolic peak the inflection is shown as “n/a” (type C) and the point is marked as the late systolic shoulder.</li>
</ul>

<h3>7 · Drugs on a timeline (v2)</h3>
<ul>
  <li>Each drug acts only on model inputs (arteriolar radius → SVR, muscular PWV, aortic PWV, Γ, HR, SV).</li>
  <li><b>Onset and offset</b> are first order: an infusion reaches 1 − e<sup>−t/τon</sup> of its full effect and decays as e<sup>−t/τoff</sup> after it is stopped. A bolus follows a rise-and-fall (Bateman) curve that peaks at full effect.</li>
  <li><b>Repeat doses of one drug saturate</b> (Emax model): exposure C is the sum of all doses' current levels, and effect E = E<sub>max</sub>·C / (EC₅₀ + C) with E<sub>max</sub> = ${DRUG_EMAX.emax} and EC₅₀ = ${(DRUG_EMAX.emax - 1).toFixed(1)}, so one full dose gives exactly the v1 effect and no amount exceeds ${Math.round(DRUG_EMAX.emax * 100)} %. “Drug effect %” on screen is E × 100.</li>
  <li><b>Different drugs combine in log space</b>: each multiplier is raised to E and the factors multiply; HR and SV changes scale with E. Inputs are then clamped to the slider ranges.</li>
  <li><b>Phenylephrine baroreflex</b>: HR falls ${BAROREFLEX.bpmPerMmHg} bpm per mmHg of MAP rise caused by phenylephrine, at most ${BAROREFLEX.maxFall} bpm.</li>
  <li>The seven v1 long-term drugs can start “at steady state”, which reproduces the v1 effect exactly.</li>
</ul>
<h4>Drug effects and time constants — illustrative teaching values</h4>
<p class="fine">Directions: Nichols &amp; Singh 2002; Townsend et al. 2015, Table 1 (vasodilators, β-blockade); standard pharmacology for inotropes, vasopressors and propofol. Magnitudes and time constants are chosen for teaching and are flagged <code>illustrative: true</code> in the configuration.</p>
<table class="vt"><tr><th>Drug</th><th>Full effect (one dose)</th><th>τon (s)</th><th>τoff (s)</th><th>Given as</th></tr>${drugRows}</table>

<h3>8 · Differences from the v2 specification</h3>
<ul>
  <li><b>AIx@75</b> uses v1's ${MODEL.aix75PerBpm} %/bpm (Wilkinson 2000), not 0.48 %/bpm, so results match v1.</li>
  <li><b>AIx</b> uses v1's method: P1 is the highest pressure before the model's known echo arrival time and P2 the highest after it. The 4th-derivative shoulder method is not used for AIx.</li>
  <li><b>Inflection marker</b> uses the 2nd derivative rather than the 4th: with this model's ejection profile the 4th derivative rings and its zero crossings do not track the reflected wave.</li>
  <li><b>Pulse pressure amplification</b> does not fall with aortic PWV alone, because the arm uses a fixed transfer function; it falls across the age profiles as published (see Validation).</li>
  <li><b>Impedance at 0 Hz</b>: v1's impedance chart showed |Z(0)| below SVR (reflection scaling was applied at 0 Hz too). v2 computes impedance from the beat, so Z(0) = SVR. Pressures were never affected.</li>
</ul>

<h3>9 · Assumptions &amp; limitations</h3>
<ul>
  <li>Single effective reflection site; the real tree has distributed reflections. Absolute Δtp values in youth are shorter than some invasive reports — trends, not absolute numbers, are the point.</li>
  <li>The heart is a flow source: stroke volume does not change automatically with afterload or with filling time. A drug that only slows HR therefore lowers MAP in proportion (e.g. esmolol at defaults lowers MAP by about 30 %).</li>
  <li>Linear model; no venous pressure, no autoregulation. The only reflex is the phenylephrine baroreflex.</li>
  <li>Drug effects are illustrative parameter shifts, not pharmacokinetic models.</li>
  <li>Reflection magnitude depends heavily on the separation method; compare directions, not absolute values.</li>
</ul>

<h3>References</h3>
<ol>${Object.values(CITATIONS).map(c => `<li>${c}</li>`).join('')}</ol>`;
}
