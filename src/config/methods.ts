/* Methods tab: equations (from v1), v2 engine and drug methods, illustrative drug values,
   differences from the v2 specification, limitations and references. */
import { ALL_DRUGS, BAROREFLEX, CITATIONS, DRUG_EMAX, DRUG_KINETICS, ENGINE, MODEL, SV_HR_COUPLING, RESPONSE, STUDY_PROFILES, STUDY_TARGETS, PRESETS, DEFAULTS, PHYS, weisslerMs } from './physiology';
import { CALIB, CAMPENS_AA, PWV_NORMAL, SVI_CMR, bsaDuBois } from '../model/calibrate';
import { HERBERT_NORMAL, TAU_FREE_REF, TAU_REF } from '../model/validationStudy';

/** Reference data behind the calibration and the study profiles, as tables. */
function studyDataHtml(): string {
  const th = (cells: string[]) => `<tr>${cells.map(c => `<th>${c}</th>`).join('')}</tr>`;
  const td = (cells: (string | number)[]) => `<tr>${cells.map((c, i) => `<td${i ? ' class="n"' : ''}>${c}</td>`).join('')}</tr>`;
  const table = (head: string[], rows: (string | number)[][]) => `<div class="table-wrap"><table class="vt">${th(head)}${rows.map(td).join('')}</table></div>`;
  const decades = ['< 30', '30–39', '40–49', '50–59', '60–69', '≥ 70'];
  const svDec = ['20–29', '30–39', '40–49', '50–59', '60–69', '70–79'];
  const profiles = Object.entries(STUDY_PROFILES).map(([name, sp]) => {
    const p = { ...DEFAULTS, ...PRESETS[name] };
    const svr = p.svrRef / Math.pow(p.radius / 100, 4) * PHYS.DYN;
    return [name, sp.height, sp.weight, bsaDuBois(sp.height, sp.weight).toFixed(2), sp.diam.toFixed(2), sp.cAo.toFixed(1), sp.sv,
      `${sp.radius} % (${svr.toFixed(0)})`, sp.gamma.toFixed(2), (p.etScale * weisslerMs(p.hr, sp.sex)).toFixed(0), p.hr,
      STUDY_TARGETS[name].cSBP, STUDY_TARGETS[name].aix.toFixed(1)];
  });
  return `
<h4>A · Ascending-aorta diameter equations (Campens 2014, Table 2, Du Bois BSA)</h4>
${table(['Sex', 'a', 'b (log₁₀ age)', 'c (BSA)', 'SEE (log₁₀)'], [
    ['Men', CAMPENS_AA.male.a, CAMPENS_AA.male.b, CAMPENS_AA.male.c, CAMPENS_AA.male.see],
    ['Women', CAMPENS_AA.female.a, CAMPENS_AA.female.b, CAMPENS_AA.female.c, CAMPENS_AA.female.see]])}
<p class="fine">Mean D (mm) = 10^(a + b·log₁₀ age + c·BSA); normal range = mean × 10^(±1.96 · SEE). Leading-edge, end-diastolic, measured at the right pulmonary artery.</p>
<h4>B · Carotid–femoral PWV, normal values (RVASC 2010, Table 4; n = 1 455, optimal/normal BP, no risk factors)</h4>
${table(['Age (y)', 'Mean (m/s)', 'Mean ± 2 SD (m/s)', 'Used at age'], PWV_NORMAL.map((r, i) => [decades[i], r.mean, `${r.lo}–${r.hi}`, r.age]))}
<p class="fine">Interpolated linearly between decade midpoints and held flat below 25 y and above 75 y. Used as the intrinsic aortic PWV at MAP 93 mmHg; the operating value then moves with MAP.</p>
<h4>C · Stroke volume index (Maceira 2006, Tables 2–3, SSFP CMR)</h4>
${table(['Age (y)', 'Men SV/BSA (mL/m²)', 'Women SV/BSA (mL/m²)', `Model men (× ${CALIB.svScale})`, `Model women (× ${CALIB.svScale})`],
    SVI_CMR.male.map((r, i) => [svDec[i], r[1], SVI_CMR.female[i][1], (r[1] * CALIB.svScale).toFixed(1), (SVI_CMR.female[i][1] * CALIB.svScale).toFixed(1)]))}
<h4>D · Central SBP and amplification, "normal" population (Herbert 2014; mean, 10th–90th percentile, mmHg)</h4>
${table(['Age (y)', 'Men cSBP', 'Women cSBP', 'Men cuff − central', 'Women cuff − central'],
    HERBERT_NORMAL.male.map((r, i) => { const f = HERBERT_NORMAL.female[i]; return [r.decade,
      `${r.cSBP[0]} (${r.cSBP[1]}–${r.cSBP[2]})`, `${f.cSBP[0]} (${f.cSBP[1]}–${f.cSBP[2]})`, `${r.amp[0]} (${r.amp[1]}–${r.amp[2]})`, `${f.amp[0]} (${f.amp[1]}–${f.amp[2]})`]; }))}
<p class="fine">Mean central SBP is the fitting target for each profile; the amplification percentiles are used only to check the model.</p>
<h4>E · Augmentation-index reference equations (Janner 2010; SphygmoCor, low-risk cohort)</h4>
<div class="eq">Men: AIx = 79.20 + 0.63·age − 0.002·age² − 0.28·HR − 0.39·height(cm)</div>
<div class="eq">Women: AIx = 56.28 + 0.90·age − 0.005·age² − 0.34·HR − 0.24·height(cm)</div>
<h4>F · Diastolic decay, invasive reference values</h4>
${table(['Fit', 'τ (s)', 'P∞ (mmHg)', 'Source'], [
    ['Asymptote fixed at 0 mmHg', `${TAU_REF.mean} ± ${TAU_REF.sd}`, '0 (assumed)', 'Chemla 2017, n = 16'],
    ['Asymptote fitted', `${TAU_FREE_REF.mean} ± ${TAU_FREE_REF.sd}`, `${TAU_FREE_REF.pInf} ± ${TAU_FREE_REF.pInfSd}`, 'Yamakado 2018, n = 71 normal subjects, 20–80 y']])}
<h4>G · Study-profile inputs</h4>
${table(['Profile', 'Height (cm)', 'Weight (kg)', 'BSA (m²)', 'Aorta (cm)', 'Aortic PWV (m/s)', 'SV (mL)', 'Arteriolar radius (SVR, dyn·s·cm⁻⁵)', 'Γ', 'LVET (ms)', 'HR', 'Target cSBP', 'Target AIx (%)'], profiles)}
<p class="fine">Aorta, PWV and SV are calibrated (tables A–C). Arteriolar radius and Γ are fitted to the last two columns (tables D–E). Other inputs keep their defaults: muscular-artery PWV ${DEFAULTS.cMus} m/s, reflection-site position 1.00, LVEDP ${DEFAULTS.lvedp} mmHg.</p>`;
}

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
  <li><b>Stroke volume when an acute drug slows the heart</b> (illustrative): a longer filling time raises stroke volume, SV × (HR before / HR after)<sup>${SV_HR_COUPLING.exponent}</sup>. It applies to HR falls caused by the six acute drugs, including the phenylephrine baroreflex. It does not apply to the seven long-term v1 drugs, which keep their exact v1 effects. With it, esmolol at defaults lowers MAP by about 19 % instead of 30 %.</li>
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

<h3>9 · Patient calibration and healthy study profiles (v2.1)</h3>
<p>Changing <b>sex, age, height or weight</b> recalculates three inputs from healthy reference data. The other inputs keep their values, and any slider can still be moved by hand afterwards.</p>
<div class="eq">BSA = 0.007184 × weight<sup>0.425</sup> × height<sup>0.725</sup><span class="src">Du Bois 1916</span></div>
<div class="eq">log₁₀ D<sub>AA</sub>(mm) = a + b·log₁₀(age) + c·BSA &nbsp; men a 1.033, b 0.188, c 0.070; women 1.001, 0.177, 0.086<span class="src">Campens 2014, Table 2 (leading edge, end-diastole)</span></div>
<div class="eq">aortic PWV = mean carotid–femoral PWV of the age decade, interpolated: 6.2 · 6.5 · 7.2 · 8.3 · 10.3 · 10.9 m/s (&lt;30 … ≥70 y)<span class="src">RVASC 2010, Table 4 normal values</span></div>
<div class="eq">SV = SV/BSA (by sex and age decile) × 0.70 × BSA<span class="src">Maceira 2006, Tables 2–3</span></div>
<p>The 0.70 factor brings CMR stroke volume (which runs higher than Doppler or thermodilution stroke volume) to the model's flow level: v1's default 45-year-old man ejects 72 mL with BSA 1.90 m², 0.70 × Maceira's 54 mL/m². The age and sex differences come from the source unchanged. No sex term is used for PWV because the collaboration found the adjusted difference under 0.1 m/s. Age and weight act only through this calibration; sex also selects the women's Weissler line.</p>
<p>The eight <b>healthy study profiles</b> (men and women at 25, 45, 65 and 80 y; heart rate 70 bpm; ejection 300 ms; typical healthy-weight height and weight) are calibrated as above, and then two inputs are fitted per profile: arteriolar radius (SVR) so that central SBP equals the mean of Herbert et al. 2014's normal population for that sex and decade, and reflection coefficient Γ so that AIx equals Janner et al. 2010's reference equation for that sex, age, heart rate and height. Everything else is a prediction, compared with reference data on the Validation tab.</p>

<h4 style="margin-top:1.2em">Reference data</h4>
${studyDataHtml()}

<h3>10 · Ejection duration and heart rate up to 180 bpm (v2.1)</h3>
<div class="eq">LVET = Weissler(HR, sex) × setting; men 413 − 1.7·HR, women 418 − 1.6·HR ms; then 150 ms ≤ LVET ≤ 0.6 × cycle<span class="src">Weissler 1968</span></div>
<p>The slider shows LVET in milliseconds and starts at 300 ms. The value stored is the setting (0.8–1.2 × Weissler), so ejection still shortens as heart rate rises; changing sex keeps the milliseconds you set. Weissler's regression was derived and validated from about 50 to 150 bpm. At 180 bpm it would give 107 ms, so the model holds ejection at its 150 ms floor; treat values above 150 bpm as extrapolation. The heart is a flow source, so raising heart rate with stroke volume unchanged raises cardiac output and MAP in proportion. In real tachycardia stroke volume usually falls, so lower SV to match the scenario you are modelling.</p>

<h3>11 · Diastolic decay (v2.1)</h3>
<p>The pressure fall after aortic-valve closure is fitted over the last two-thirds of diastole (which leaves out the incisura and early reflected-wave oscillation; decay-time method, Liu 1986).</p>
<div class="eq">P(t) = P₀·e<sup>−t/τ</sup> &nbsp;(asymptote 0 mmHg; least squares on ln P)<span class="src">two-element Windkessel; invasive τ ≈ 1.37 ± 0.31 s, Chemla 2017</span></div>
<div class="eq">P(t) = P∞ + A·e<sup>−t/τ</sup> &nbsp;(asymptote fitted)<span class="src">invasive τ ≈ 0.44 ± 0.11 s, P∞ ≈ 58 ± 8 mmHg, Yamakado 2018</span></div>
<div class="eq">decay rate = (P at start of window − end-diastolic P) / window duration &nbsp;[mmHg/s]</div>
<p>Both time constants are reported because published values depend heavily on whether the asymptote is fixed at zero. Compare the fitted τ with the Windkessel prediction RC = SVR × C shown alongside. The dashed grey curve on the central-pressure chart is the zero-asymptote fit.</p>

<h3>12 · Cardiac cycle diagram (v2.2)</h3>
<p>The Cardiac cycle tab draws a Wiggers diagram for the active patient's current beat, on one time axis starting at QRS onset, with a cursor that sweeps through the beat in real time or slowed down. <b>From the model:</b> aortic pressure, aortic flow, ejection time, heart rate, stroke volume and LVEDP. <b>Schematic</b> (typical healthy-adult values, tied to the modelled beat): everything else.</p>
<div class="eq">mitral closure = QRS onset + 50 ms; aortic opening = mitral closure + 45 ms (isovolumic contraction); aortic closure = aortic opening + LVET</div>
<div class="eq">ejection: P<sub>LV</sub> = P<sub>Ao</sub> + 4·Q/Q<sub>peak</sub> + 3·min(0, dQ/dt)/|dQ/dt|<sub>max</sub> mmHg &nbsp;(gradient ≈ 4 mmHg at peak flow, reversing slightly as flow decelerates)</div>
<div class="eq">isovolumic relaxation: P<sub>LV</sub> = P<sub>Ao</sub>(closure)·e<sup>−t/τ</sup>, τ = 40 ms, until P<sub>LV</sub> = left-atrial v-wave pressure (LVEDP + 5) → mitral opening</div>
<div class="eq">LV volume: EDV = SV / 0.60; falls by ∫Q dt (exactly SV) in ejection; fills 78 % passively (rapid filling, τ 60 ms, then diastasis) and 22 % in atrial systole</div>
<p>Isovolumic relaxation is capped at 45 % of diastole; at very high heart rates τ is shortened so the LV still meets atrial pressure at mitral opening, and the caption says so. Isovolumic contraction and the electromechanical delay are held constant, although both shorten slightly with heart rate in real hearts. The ECG shows timing only. With sound on, S1 and S2 are synthesised as short damped tones with a falling pitch plus low-passed noise (S1 ≈ 70 Hz, 140 ms; S2 ≈ 110 Hz, 100 ms, pitched slightly above real heart sounds so laptop speakers can play them), triggered when the cursor passes mitral and aortic closure.</p>
<p>Display: a running strip (2.5 beats scrolling right to left like the monitor, newest at the right) or one beat with a sweeping cursor; real time or ½, ¼, ⅛ speed. The tab has its own play/pause (Space or K on this tab), a scrubber, ±1 and ±10 ms steps (, and . keys; Shift for 10 ms), jump-to-event buttons, and click-to-pause on the diagram. At high heart rates the tab follows the current beat; if heart rate changes, the cursor keeps the same fraction of the beat.</p>

<h3>13 · Physiologic response modes (v2.3)</h3>
<p>Each patient has a <b>Physiologic response</b> setting and a <b>resting heart rate</b> it refers to (set from the profile; 70 bpm by default). It acts in the live simulator after drugs; the Sweep tab and the reference tables always use Independent so a single input can be studied alone.</p>
<ul>
  <li><b>Independent</b> (default): every input acts on its own. The heart is a flow source, so raising HR with SV unchanged raises cardiac output and MAP in proportion.</li>
  <li><b>Pacing</b>: cardiac output is held as the set heart rate moves from rest: SV<sub>eff</sub> = SV × HR<sub>rest</sub>/HR (shorter filling time), as in atrial-pacing studies (Wilkinson 2000).</li>
  <li><b>Exercise</b>: above resting HR, SV rises by up to ${(RESPONSE.exSvGain * 100).toFixed(0)} % over the first ${RESPONSE.exSvSpan} bpm, and SVR falls (muscle vasodilation) so MAP rises only ${(RESPONSE.exMapPerBpm * 1000).toFixed(1)} % per 10 bpm: SVR<sub>eff</sub> = SVR × MAP<sub>target</sub> / (MAP<sub>rest</sub> × CO ratio).</li>
  <li><b>Physiologic</b>: pacing-type SV plus a baroreflex on SVR: SVR<sub>eff</sub> = SVR × (MAP<sub>set</sub>/MAP<sub>open</sub>)<sup>${RESPONSE.baroFraction}</sup>, which corrects ${(RESPONSE.baroFraction * 100).toFixed(0)} % of a MAP change (closed-loop gain ≈ 1.5). MAP<sub>set</sub> is the patient's own inputs at resting HR without drugs, so moving the sliders sets a new resting state and the reflex buffers heart-rate changes and drugs.</li>
</ul>
<p>The SV and exercise couplings follow the heart rate you set; heart-rate changes caused by drugs keep each drug's own stroke-volume effect, so drug pharmacology is not counted twice. The phenylephrine heart-rate reflex and the illustrative SV rise when a drug slows the heart apply in every mode. All couplings are simple, typical-value rules, not a model of the autonomic nervous system; above ≈ 150 bpm they are extrapolations (in real tachycardia cardiac output eventually falls).</p>

<h3>14 · Assumptions &amp; limitations</h3>
<ul>
  <li>Study profiles: pulse-pressure amplification (cuff − central SBP) is about right at 25–45 y but high at 65–80 y (≈ 13–15 mmHg vs means of 6–8 and 90th percentiles of 12–17 mmHg; Herbert 2014), because the model uses one fixed upper-limb transfer function. At 65–80 y cuff DBP is ≈ 60–63 mmHg and cuff SBP ≈ 128–132 mmHg.</li>
  <li>Zero-asymptote τ is longer than invasive values in the young profiles (2.0–2.7 s vs 1.37 ± 0.31 s). The comparison cohort was older catheterised patients, and the model's late diastole flattens toward ≈ 50–65 mmHg (see the fitted asymptote). With the asymptote fitted, τ is 0.19–0.22 s at 65–80 y, just under the invasive range (0.23–0.65 s).</li>
  <li>Single effective reflection site; the real tree has distributed reflections. Absolute Δtp values in youth are shorter than some invasive reports — trends, not absolute numbers, are the point.</li>
  <li>The heart is a flow source: stroke volume does not change with afterload, and changes with filling time only through the illustrative rule above for acute drugs. Moving the HR slider by hand, or a long-term v1 drug that slows HR, lowers MAP in proportion.</li>
  <li>MAP = CO × SVR, so aortic stiffness changes pulse pressure and central systolic pressure but not MAP or its percentage fall with a vasodilator such as propofol. The model has no mechanism by which a stiff aorta worsens hypotension.</li>
  <li>Linear model; no venous pressure, no autoregulation. The only reflex is the phenylephrine baroreflex.</li>
  <li>Drug effects are illustrative parameter shifts, not pharmacokinetic models.</li>
  <li>Reflection magnitude depends heavily on the separation method; compare directions, not absolute values.</li>
</ul>

<h3>15 · References</h3>
<ol>${Object.values(CITATIONS).map(c => `<li>${c}</li>`).join('')}</ol>`;
}
