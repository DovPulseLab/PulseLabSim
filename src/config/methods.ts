/* Methods tab: equations (from v1), v2 engine and drug methods, illustrative drug values,
   differences from the v2 specification, limitations and references. */
import { ALL_DRUGS, BAROREFLEX, CITATIONS, DRUG_EMAX, DRUG_KINETICS, ENGINE, MODEL, SV_HR_COUPLING, RESPONSE, baroFraction, exerciseMapSlope, STUDY_PROFILES, STUDY_TARGETS, PRESETS, DEFAULTS, PHYS, weisslerMs } from './physiology';
import { AGE_FIT, CALIB, CAL_DATA_RANGE, CAMPENS_AA, PWV_NORMAL, SVI_CMR, SVI_DOPPLER, SVI_DOPPLER_SD, WASE_DOPPLER_CI, WASE_GROUPS, WASE_HR, bsaDuBois } from '../model/calibrate';
import { HERBERT_NORMAL, PHAN_RWTT, REDFIELD_SVRI, TAU_FREE_REF, TAU_REF, ZC_REF } from '../model/validationStudy';

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
      STUDY_TARGETS[name].cSBP, STUDY_TARGETS[name].aix.toFixed(1), STUDY_TARGETS[name].cuffDBP ?? '—', sp.cMus.toFixed(1)];
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
<h4>C · Stroke volume index (Maceira 2006, Tables 2–3, SSFP CMR) — used for calibration</h4>
${table(['Age (y)', 'Men SV/BSA (mL/m²)', 'Women SV/BSA (mL/m²)', `Model men (× ${CALIB.svScale})`, `Model women (× ${CALIB.svScale})`],
    SVI_CMR.male.map((r, i) => [svDec[i], r[1], SVI_CMR.female[i][1], (r[1] * CALIB.svScale).toFixed(1), (SVI_CMR.female[i][1] * CALIB.svScale).toFixed(1)]))}
<h4>C′ · Comparison: stroke volume index, Doppler LVOT (WASE, Patel 2021, Table 4; n = 1 450 healthy adults)</h4>
${table(['Age group (y)', 'Plotted at age', 'Men SV/BSA (mL/m²)', 'Women SV/BSA (mL/m²)', 'Men CI (L/min/m²)', 'Women CI (L/min/m²)', 'Men / women HR'],
    WASE_GROUPS.map((g, i) => [g, SVI_DOPPLER.male[i][0], `${SVI_DOPPLER.male[i][1]} ± ${SVI_DOPPLER_SD.male[i]}`, `${SVI_DOPPLER.female[i][1]} ± ${SVI_DOPPLER_SD.female[i]}`,
      WASE_DOPPLER_CI.male[i], WASE_DOPPLER_CI.female[i], `${WASE_HR.male[i]} / ${WASE_HR.female[i]}`]))}
<p class="fine">Doppler SVI does not fall with age in WASE, while 2D, 3D and CMR volumetric SVI do. The model's Maceira × ${CALIB.svScale} values match WASE in the young and fall about 10–14 % below it by 80 y, within one SD. Calibrating to WASE was tried in v2.7 and reverted (§16).</p>
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
${table(['Profile', 'Height (cm)', 'Weight (kg)', 'BSA (m²)', 'Aorta (cm)', 'Aortic PWV (m/s)', 'SV (mL)', 'Arteriolar radius (SVR, dyn·s·cm⁻⁵)', 'Γ', 'LVET (ms)', 'HR', 'Herbert central SBP', 'Target AIx (%)', 'NHANES cuff DBP', 'Arm PWV (m/s)'], profiles)}
<p class="fine">Aorta, PWV, SV and arm PWV are calibrated (tables A–C, §9). Arteriolar radius and Γ are fitted to Herbert cuff SBP and Janner AIx (tables D–E) and form the age curves in table H. Other inputs keep their defaults: reflection-site position 1.00, LVEDP ${DEFAULTS.lvedp} mmHg.</p>
<h4>H · Age curves for arteriolar radius and Γ (v2.7, fitted at the study profiles)</h4>
${table(['Age (y)', 'Men radius (%)', 'Men Γ', 'Women radius (%)', 'Women Γ'],
    AGE_FIT.ages.map((a, i) => [a, AGE_FIT.male.radius[i], AGE_FIT.male.gamma[i], AGE_FIT.female.radius[i], AGE_FIT.female.gamma[i]]))}
<p class="fine">Interpolated linearly between these ages; held flat below 25 y and above 80 y. Fitted at HR 70 bpm and each profile's height, so a patient of different height or heart rate gets the same radius and Γ but not exactly the target SBP and AIx.</p>`;
}

const fx = (d: Record<string, number | undefined>) => {
  const parts: string[] = [];
  const mul = (k: string, label: string) => { const v = d[k]; if (v != null) parts.push(`${label} ×${v}`); };
  mul('radius', 'arteriolar radius'); mul('cMus', 'muscular PWV'); mul('cAo', 'aortic PWV'); mul('gamma', 'Γ');
  if (d.hrAdd != null) parts.push(`HR ${d.hrAdd > 0 ? '+' : ''}${d.hrAdd} bpm`);
  if (d.svAdd != null) parts.push(`SV ${d.svAdd > 0 ? '+' : ''}${d.svAdd} mL (v2 heart)`);
  mul('ees', 'Ees (v3)'); mul('preload', 'EDV (v3)');
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
<div class="eq">c_operating = c₀ · (1 + ${MODEL.kAo} · (MAP − ${MODEL.mapRef})) &nbsp;(aorta); ${MODEL.kMus} for muscular arteries<span class="src">passive pressure dependence (v1); slope checked against Butlin 2017, McNally 2024 (Validation §9)</span></div>

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
<p>Changing <b>sex, age, height or weight</b> recalculates six inputs from healthy reference data: aortic diameter, aortic PWV, stroke volume, arm PWV and (v2.7) arteriolar radius and Γ. The other inputs keep their values, and any slider can still be moved by hand afterwards.</p>
<div class="eq">BSA = 0.007184 × weight<sup>0.425</sup> × height<sup>0.725</sup><span class="src">Du Bois 1916</span></div>
<div class="eq">log₁₀ D<sub>AA</sub>(mm) = a + b·log₁₀(age) + c·BSA &nbsp; men a 1.033, b 0.188, c 0.070; women 1.001, 0.177, 0.086<span class="src">Campens 2014, Table 2 (leading edge, end-diastole)</span></div>
<div class="eq">aortic PWV = mean carotid–femoral PWV of the age decade, interpolated: 6.2 · 6.5 · 7.2 · 8.3 · 10.3 · 10.9 m/s (&lt;30 … ≥70 y)<span class="src">RVASC 2010, Table 4 normal values</span></div>
<div class="eq">SV = SV/BSA (by sex and age decile) × 0.70 × BSA<span class="src">Maceira 2006, Tables 2–3</span></div>
<div class="eq">arteriolar radius, Γ = fitted value at the study profiles for that sex, interpolated in age (table H)<span class="src">fitted to Herbert 2014 and Janner 2010 (v2.7)</span></div>
<div class="eq">muscular (arm) PWV = 9.0 + 0.048 × (age − 45) m/s<span class="src">slope: Avolio 1983 (upper limb, 4.8·age + 998 cm/s); anchored at v1's 9.0 m/s at 45 y (v2.5)</span></div>
<p>The 0.70 factor brings CMR stroke volume (which runs higher than Doppler or thermodilution stroke volume) to the model's flow level: v1's default 45-year-old man ejects 72 mL with BSA 1.90 m², 0.70 × Maceira's 54 mL/m². It has no published source; the age and sex differences come from Maceira unchanged (compare WASE Doppler data in table C′ and §16). No sex term is used for PWV because the collaboration found the adjusted difference under 0.1 m/s (CUiiDARTE 2021 reports men 0.14–0.63 m/s higher from 23 to 80 y; not adopted). Age and weight act only through this calibration; sex also selects the women's Weissler line.</p>
<p>The eight <b>healthy study profiles</b> (men and women at 25, 45, 65 and 80 y; heart rate 70 bpm; ejection 300 ms; typical healthy-weight height and weight) are calibrated as above, and then two inputs are fitted per profile: arteriolar radius (SVR) so that cuff SBP equals Herbert et al. 2014's healthy cuff SBP for that sex and decade (their central SBP + amplification), and reflection coefficient Γ so that AIx equals Janner et al. 2010's reference equation for that sex, age, heart rate and height. Everything else is a prediction compared with reference data on the Validation tab, including central SBP as a device would report it (Herbert) and cuff DBP (NHANES normotensive means, Wright 2011). v2.1–2.4 fitted SVR to Herbert's central SBP directly, which compared a device estimate with the model's true aortic pressure (§15).</p>

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
<p>Each patient has a <b>Physiologic response</b> setting and a <b>resting heart rate</b> it refers to (set from the profile; 70 bpm by default). It acts in the live simulator after drugs; Sweep and the reference tables always use Independent, so one input can be studied alone. Every coefficient is taken from published human data; x = set heart rate − resting heart rate.</p>
<div class="table-wrap"><table class="vt">
<tr><th>Mode</th><th>Rule</th><th>Data it comes from</th></tr>
<tr><td><b>Independent</b> (default)</td><td>Every input acts on its own. The heart is a flow source, so raising HR with SV unchanged raises cardiac output and MAP in proportion.</td><td>— (model definition)</td></tr>
<tr><td><b>Pacing</b></td><td>CO × (1 + ${(RESPONSE.pacingCoPerBpm * 100).toFixed(3)} %·x); MAP × (1 + ${(RESPONSE.pacingMapPerBpm * 100).toFixed(2)} %·x); SV and SVR are set so both hold</td><td>Right-atrial pacing at rest 80 → 121 bpm: cardiac index 3.67 → 3.72 L/min/m² (Ross, Linhart &amp; Braunwald 1965). Paced 70 → 90 bpm: brachial MAP 95.95 → 102.02 mmHg, +6.3 % over that one 20-bpm step (Lazim et al. 2025); the model extends it linearly outside 70–90 bpm, which is an assumption. MAP also rose with pacing 60 → 110 bpm (Wilkinson et al. 2000), but did not change in Parker et al. 1971 or Wisheart et al. 1973, so the size of the MAP rise is uncertain. Near-constant cardiac output is supported by all three of Ross 1965, Parker 1971 (SV 74 → 46 mL, CO ≈ 5.7 L/min) and Wisheart 1973.</td></tr>
<tr><td><b>Exercise</b> (x &gt; 0)</td><td>SV × ${(RESPONSE.exSv.sub / RESPONSE.exSv.rest).toFixed(2)} at x = ${RESPONSE.exSv.hrSub - RESPONSE.exSv.hrRest} (linear from rest), easing to × ${(RESPONSE.exSv.peak / RESPONSE.exSv.rest).toFixed(2)} at x = ${RESPONSE.exSv.hrPeak - RESPONSE.exSv.hrRest} and held beyond; MAP × (1 + ${(exerciseMapSlope * 100).toFixed(2)} %·x); SVR set to match</td><td>Upright cycling, invasive: stroke volume index ${RESPONSE.exSv.rest} → ${RESPONSE.exSv.sub} → ${RESPONSE.exSv.peak} mL/m² at HR ${RESPONSE.exSv.hrRest} → ${RESPONSE.exSv.hrSub} → ${RESPONSE.exSv.hrPeak} (Pandey et al. 2020, n = 104 healthy, 20–76 y). Intra-arterial MAP ${RESPONSE.exMap.rest} → ${RESPONSE.exMap.low} → ${RESPONSE.exMap.mod} mmHg at HR ${RESPONSE.exMap.hrRest} → ${RESPONSE.exMap.hrLow} → ${RESPONSE.exMap.hrMod} (Wheatley et al., n = 64, 18–32 y); slope = least-squares line through rest.</td></tr>
<tr><td><b>Physiologic</b></td><td>The pacing rule for heart rate, plus baroreflex buffering of the MAP change caused by drugs: SVR × (MAP<sub>no drugs</sub> / MAP<sub>with drugs</sub>)<sup>f</sup>, f = 1 − 1/BRB</td><td>BRB = potentiation of the pressor response to phenylephrine infusion during vs before ganglionic blockade. Men: ${RESPONSE.baro.menBrb[0]} at 25 y and ${RESPONSE.baro.menBrb[2]} at 65 y (Jones et al. 2003, incremental infusion, BRB<sub>slope</sub>; their bolus values were 5.1 and 2.1), ${RESPONSE.baro.menBrb[1]} at 41 y (Christou et al. 2003); interpolated, held beyond. Women: 47 % less buffering than men at 27–28 y (Christou et al. 2005, <b>bolus</b> protocol, 3.3 vs 6.3), applied as ${(RESPONSE.baro.womenExcessRatio * 100).toFixed(0)} % of the men's excess over 1 at every age. f: men ${(baroFraction(0, 25) * 100).toFixed(0)} % (25 y), ${(baroFraction(0, 45) * 100).toFixed(0)} % (45 y), ${(baroFraction(0, 65) * 100).toFixed(0)} % (≥ 65 y); women ${(baroFraction(1, 25) * 100).toFixed(0)} %, ${(baroFraction(1, 45) * 100).toFixed(0)} %, ${(baroFraction(1, 65) * 100).toFixed(0)} %.</td></tr>
</table></div>
<p><b>Assumptions and limits</b>, stated so you can judge them:</p>
<ul>
<li>The pacing studies used older patients with pacemakers or catheters (Lazim: 52 ± 10 y; Wilkinson 2000: 63 y; Ross: catheterised patients). The same relation is used at every age.</li>
<li>The two exercise sources disagree on stroke volume: Pandey (invasive, radionuclide) found SVI +38 % by 50 W, Wheatley (acetylene rebreathing) only +4 %. The Exercise mode follows Pandey for SV and Wheatley for MAP, so its SVR fall (computed) lies between the two studies (Validation §8). Both are <i>upright</i> exercise from upright rest; from supine rest the SV rise is smaller.</li>
<li>The heart-rate relations were measured up to ≈ 120 bpm (pacing) and ≈ 170–180 bpm (exercise); outside that they are extrapolated linearly.</li>
<li>The baroreflex acts here only through SVR. In people it also changes heart rate, contractility and venous tone. BRB was measured on the systolic pressure response; it is applied to MAP. The women's values at ages other than 27–28 y are an extrapolation of the sex ratio. That ratio comes from the bolus protocol and is applied to the men's infusion curve, which assumes the sex difference is the same in both protocols; Christou 2005 compared young women with young men only, so it is not a female age trajectory.</li>
<li>Physiologic mode buffers drug effects, not the heart-rate change itself, because the pacing data were measured in people with intact reflexes and so already include them.</li>
<li>The phenylephrine heart-rate reflex and the illustrative SV rise when a drug slows the heart apply in every mode.</li>
</ul>

<h3>14 · Model review (v2.4)</h3>
<p>An outside review raised six points. Each was tested against the model and published data:</p>
<div class="table-wrap"><table class="vt"><tr><th>Point</th><th>Finding</th><th>Change</th></tr>
<tr><td>At fixed SV and SVR, τ falls steeply with HR</td><td>Mostly real physiology: MAP rises with HR (flow source), and PWV rises with MAP, so compliance and R·C fall. The model's slope, 0.45 m/s per 10 mmHg MAP at PWV 7.5 m/s and 0.53 at 9.9 m/s, lies inside the measured 0.6 ± 0.3 (Butlin 2017) and 0.65, 95 % CI 0.46–0.83 (McNally 2024).</td><td>None to the law; data rows added (Validation §9).</td></tr>
<tr><td>Fitted τ is not the Windkessel R·C</td><td>Confirmed. The fitted τ runs 1.2–2.6 × R·C across the study profiles. Γ scales the reflection at every frequency, including near 0 Hz, where the arterial tree acts as one Windkessel; with Γ below 0.5 this weakens the low-frequency load, late diastole flattens, and the zero-asymptote fit lengthens.</td><td>v2.4: the τ card shows τ = R·C. v2.5: fixed at the source with a joint recalibration (§15).</td></tr>
<tr><td>AIx flat from 60 to 100 bpm at fixed SV</td><td>Expected: shorter ejection lowers AIx, but the higher MAP stiffens the aorta and returns the echo earlier. In Pacing mode AIx falls 3.6 % per 10 bpm from 60 to 110 bpm, against ≈ 4 % measured (Wilkinson 2000; Validation §8).</td><td>None.</td></tr>
<tr><td>P1/P2 are not found from the inflection point</td><td>True. The model uses the true arrival time of its reflected wave, which is what a device estimates from the inflection. A device-style inflection (d²P/dt²) was tested: it agreed within a few % at rest but jumped between beats at high HR, as device readings do.</td><td>None; the plot still marks the waveform inflection.</td></tr>
<tr><td>Forward and backward waves share the mean pressure equally</td><td>True; a display convention, because one pressure trace cannot be split without flow.</td><td>Curves labelled "model component".</td></tr>
<tr><td>Ejection time has no age term</td><td>Supported by data: in 1969 healthy adults LVET did not change with age in either sex (Alhakak 2023).</td><td>None; data row added.</td></tr>
</table></div>

<h3>15 · Recalibration (v2.5)</h3>
<p>The v2.4 review found one root cause behind two problems: Γ scaled the reflection at every frequency, including near 0 Hz, where the arterial tree acts as one Windkessel. Fixing it alone lowered diastolic pressure in older profiles, which traced to a second issue: the model's "cuff" was really intra-arterial pressure, compared with cuff-based norms. v2.5 changes four things together:</p>
<div class="table-wrap"><table class="vt"><tr><th>Change</th><th>Rule</th><th>Data</th></tr>
<tr><td>Reflection</td><td>scale on G(ω) = Γ/0.5 + (1 − Γ/0.5) / (1 + (f / ${MODEL.reflFc} Hz)²): full Windkessel near 0 Hz, Γ at the higher harmonics</td><td>Input impedance falls from SVR toward Zc over the first few harmonics (Murgo 1980; Westerhof 2009). The crossover is a model constant; 1.5–3 Hz changes cuff DBP by &lt; 1 mmHg RMS.</td></tr>
<tr><td>Zero-flow pressure</td><td>the arterioles drain toward Pzf = ${MODEL.pzfFrac} × MAP; pulsatile load R′ = SVR − Pzf/CO; MAP = CO × SVR still holds</td><td>Invasive diastolic decay heads to P∞ ≈ 58.5 ± 8.1 mmHg (Yamakado 2018, n = 71) or 71 ± 12 (Chemla 2017); effective resistance ≈ 70 % below SVR (Chemla 2017). ${MODEL.pzfFrac} × MAP gives a study-profile mean P∞ of ≈ 58 mmHg.</td></tr>
<tr><td>Cuff measurement</td><td>cuff SBP = intra-arterial brachial SBP − ${MODEL.cuff.sbp}; cuff DBP = intra-arterial DBP + ${MODEL.cuff.dbp} mmHg. Device central SBP = cuff DBP + (aortic PP) × cuff PP / true brachial PP</td><td>Invasive individual-participant meta-analysis, 74 studies, n = 3 073 (Picone 2017). Tonometry devices calibrate the pulse to cuff SBP/DBP, so their central SBP inherits the cuff error.</td></tr>
<tr><td>Arm PWV by age</td><td>9.0 + 0.048 × (age − 45) m/s, set by the calibration</td><td>Upper-limb PWV rises 0.048 m/s per year (Avolio 1983).</td></tr>
</table></div>
<p>The study profiles were then refitted: SVR to Herbert's healthy cuff SBP and Γ to Janner's AIx. Cuff DBP, device central SBP, amplification, the invasive Picone relations, τ and P∞ are all predictions (Validation §5). The v1 teaching profiles and drug effects were not refitted; all v1 validation checks still pass. The v1 laws remain in the code only for the regression test.</p>
<p><b>v2.6 · arm transfer function.</b> The upper-limb model's resonance sat at 2.5–3 Hz, while measured aorta → brachial transfer functions peak at 4–5 Hz (2.5× at 5 Hz, Karamanoglu 1993; 2.0× at 4 Hz, Westerhof 2007). v2.6 sets the effective arm reflection distance to 0.30 × height and the arm reflection to 0.60, which puts the peak at ≈ 2.6× near 4–4.5 Hz. The study profiles were refitted. Results: cuff DBP RMS error 3.9 → 2.5 mmHg against NHANES; at 65–80 y, intra-arterial brachial − aortic SBP 11–14 → 4–8 mmHg (Picone 8.0) and cuff − aortic SBP 5–9 → −3 to +2 mmHg (Picone 0.3); with pacing, cuff SBP now rises more than central SBP and amplification rises, as Wilkinson 2000 and 2002 found. One v1 teaching check (amplification by age, young 1.47 vs 1.7) moved from pass to near; the women's profiles at 45 and 80 y now amplify less than Picone's mostly male invasive cohort (2–4 vs 8 mmHg).</p>
<p><b>Ejection duration with pacing.</b> Paced ejection shortens 1.26 ms/bpm (Wilkinson 2000, Fig. 2B; r = −0.51), less than Weissler's 1.7 ms/bpm for spontaneous heart rate. Tested in the model, the paced slope reproduces Wilkinson's ejection durations but cuts the AIx response to ≈ 1 % per 10 bpm against ≈ 4 % measured, at every reflection setting tried, because the model's single reflection site makes AIx depend on heart rate mainly through ejection length. Pacing mode therefore keeps Weissler's slope: ejection shortens ≈ 35 % more than measured, and AIx falls 2.7 % per 10 bpm (default adult) against ≈ 4 %. Treat the AIx–HR slope as partly carried by ejection timing.</p>
<p><b>Wilkinson 2000 benchmark (Validation §10).</b> Diastolic rises match. Central and cuff SBP fall in the model but rose slightly in the patients, whose forward wave held its height. Wilkinson's patients had pacemakers and their cardiac output was not measured; in bradycardic pacemaker patients cardiac output rises with pacing rate (+35 % from 60 to 90 bpm, Yokota 2023), while in normal hearts it stays level (Ross 1965; Parker 1971). Given Yokota's stroke volumes, the model reproduces Wilkinson's central SBP (+2 vs +3 mmHg) and forward-wave height (+1 vs +2 mmHg). Pacing mode keeps the constant output of normal hearts, which fits the healthy profiles.</p>
<p><b>Still missing (v2.6):</b> the fitted free-asymptote τ is 0.43–0.54 × τ′ and 0.14–0.16 s at 65–80 y (Yamakado 0.44 ± 0.11 s); with pacing, AIx falls 2.1–2.7 % per 10 bpm against ≈ 4 % measured; during exercise brachial DBP falls (−8 / −21 mmHg) where Wheatley's stayed level; and with cardiac output held at 140–180 bpm the 25-year-old profile reaches AIx −57 to −67 % (people rarely go below ≈ −30 %). Against Wilkinson 2000's paced patients (Validation §10) the diastolic rise matches, but the model's forward wave shrinks with stroke volume while theirs stayed level, so cuff SBP falls where theirs rose and AIx falls 9 rather than 15 points from 60 to 100 bpm. v2.4 attributed that last miss to the reflection law, but the v2.5 reflection did not change it, so its cause lies elsewhere (most likely the fixed ejection-flow shape at very short ejection times).</p>

<h3>16 · Age evidence and data provenance (v2.7)</h3>
<p>v2.7 re-examined every age-dependent input against a compiled evidence review of healthy adults aged 20–90 (Cardiovascular Aging Evidence Report, Nov 2026). Arteriolar radius and Γ now follow age (table H, from the v2.5 profile fits), so the age slider gives a calibrated healthy patient at any age. Switching stroke volume to WASE Doppler data was tried and reverted (below). The evidence is mixed on several trends, so each Validation §11 row names the study the model is held to.</p>
<div class="table-wrap"><table class="vt"><tr><th>Input</th><th>Source (method)</th><th>Health definition</th><th>Sex-specific</th><th>Ages with data</th><th>What the model stores</th></tr>
<tr><td>Aortic diameter</td><td>Campens 2014 (2D echo, leading edge, end-diastole)</td><td>healthy, n = 849</td><td>yes</td><td>${CAL_DATA_RANGE.diam.join('–')} y</td><td>regression; extrapolated above 85 y; coefficients not yet audited against the full text</td></tr>
<tr><td>Aortic PWV</td><td>RVASC 2010 (carotid–femoral, standardized)</td><td>strict normal, n = 1 455</td><td>no (pooled)</td><td>decades &lt; 30 … ≥ 70 (sample to 85)</td><td>observed decade means at midpoints, interpolated; flat above ${CAL_DATA_RANGE.cAo[1]} y (≥ 70 pooled, so 80–90 y is extrapolated)</td></tr>
<tr><td>Stroke volume</td><td>Maceira 2006 (SSFP CMR) × 0.70</td><td>healthy, n = 120</td><td>yes</td><td>20–79 y deciles</td><td>observed decile means × an unsourced scale, interpolated; flat outside ${CAL_DATA_RANGE.sv.join('–')} y. Checked against WASE Doppler (flat with age)</td></tr>
<tr><td>Arm PWV</td><td>Avolio 1983 slope (upper limb), v1 anchor</td><td>community</td><td>no</td><td>adults</td><td>regression slope with an unsourced anchor; CUiiDARTE 2021 carotid–radial slopes are 0.0615 (men) and 0.0476 m/s per year (women), a different path</td></tr>
<tr><td>Arteriolar radius (SVR)</td><td>fitted: Herbert 2014 cuff SBP</td><td>strict normal</td><td>yes</td><td>25–80 y profiles</td><td>fitted, interpolated; checked against Redfield 2005 SVRI (regression, flat with age)</td></tr>
<tr><td>Γ</td><td>fitted: Janner 2010 AIx</td><td>low risk</td><td>yes</td><td>25–80 y profiles</td><td>fitted, interpolated. AIx also depends on ejection, HR and resistance, so Γ fitted to AIx can absorb other errors; it is not a measured reflection coefficient</td></tr>
<tr><td>Reflection distance</td><td>0.27 × height (v1)</td><td>—</td><td>—</td><td>all</td><td>fixed with age; Phan 2016 found no increase in effective reflecting distance with age</td></tr>
<tr><td>LVET</td><td>Weissler 1968 (HR, sex); Alhakak 2023</td><td>healthy, n = 1 969</td><td>yes</td><td>20 – &gt; 65 y</td><td>HR and sex only, no age term (Alhakak: no age change). The study profiles use 300 ms for both sexes by design</td></tr>
<tr><td>Baroreflex buffering</td><td>Jones 2003 (infusion), Christou 2003/2005 (bolus ratio)</td><td>healthy</td><td>men measured; women by ratio</td><td>25–65 y men</td><td>interpolated; flat outside; protocols mixed (§13)</td></tr>
</table></div>
<h4>Where the evidence disagrees, and the choice made</h4>
<ul>
<li><b>SVR with age.</b> Invasive data found +37 % from 20 to 60 y (Nichols 1985); Redfield 2005's healthier subgroup (n = 623, ≥ 45 y) found no age association in SVRI (men ≈ ${REDFIELD_SVRI.male[0][1]}, women ≈ ${REDFIELD_SVRI.female[0][1]} dyn·s·cm⁻⁵·m² at 55 y); Asklepios found resistance rising cross-sectionally but falling longitudinally. The profiles give men's SVRI ≈ 2 550–2 790 (flat) and women's ≈ 2 430–2 960 (rising, 20–29 % above Redfield at 45–80 y). Doppler stroke volume would flatten women's SVRI but lowers older MAP (below).</li>
<li><b>Reflection magnitude.</b> Cross-sectionally the backward wave rises with age (Azizzadeh 2024); in Framingham reflection fell after 50 (Mitchell 2010); longitudinally it fell (Asklepios). The model's Γ rises with age because it is fitted to AIx; treat it as a cross-sectional calibration, not a within-person law.</li>
<li><b>Reflection timing.</b> Reflected-wave transit time falls ${-PHAN_RWTT.wsa}–${-PHAN_RWTT.tl} ms per decade by pressure–flow analysis (Phan 2016) without a distal shift of the reflection site; inflection-point timing changes little and is not a transit time. The model's fixed reflection distance reproduces the pressure–flow trend.</li>
<li><b>Characteristic impedance.</b> Healthy values differ more by method than by age: median ${ZC_REF.phanMedian} dyn·s·cm⁻⁵ (MRI pressure–flow, Phan 2016) vs ${ZC_REF.mitchellMean} ± ${ZC_REF.mitchellSd} (Framingham). The model's ρc/A (≈ 105–160) sits between them; Zc and PWV need not share an age trajectory because the aorta widens.</li>
<li><b>Stroke volume and cardiac index.</b> Doppler SVI and CI are flat with age (WASE); 3D, 2D and CMR volumes fall. The model follows CMR (Maceira × 0.70), so its older profiles have 10–14 % less flow than WASE Doppler, still within one SD.</li>
<li><b>MAP after midlife.</b> MAP rises in early adulthood and then plateaus (Franklin 1997). In the 65-year-old man MAP is 8 mmHg below the 45-year-old's (women 4 mmHg). With WASE Doppler stroke volume (tried in v2.7) the gap widened to 8–9 mmHg in both sexes and cuff DBP fell 4–7 mmHg below NHANES, because the older profiles then reach their target SBP with a pulse pressure about 5 mmHg too wide; that change was reverted. Refitting with the RVASC <i>median</i> PWV narrows the gap only partly (Validation §11).</li>
<li><b>Ages above 80.</b> No source gives sex-specific healthy norms at 85–90 y. Above about 75–80 y the calibration holds every input flat; the rail lists which inputs are extrapolated at the chosen age.</li>
</ul>
<p class="fine">Not adopted, pending full-text checks: Herbert 2014's Table 2 values and Campens 2014's coefficients as coded; Azizzadeh 2024 forward/backward-wave equations (tables not retrieved); Redfield 2005 SVRI values (taken from the evidence report's transcription of the age regression).</p>

<h3>17 · Ventricle model (v3)</h3>
<p>Switching <b>Heart model</b> to <b>Ventricle (v3)</b> replaces the prescribed aortic flow with a time-varying elastance left ventricle coupled to the same arterial input impedance. Aortic flow, stroke volume, LV pressure and volume, the isovolumic phases and LVEDP then become outputs. With the default fixed-flow (v2) heart nothing changes, and the LV metrics read "—".</p>
<p><b>Chamber.</b> LV pressure P<sub>LV</sub> = [e(t)·E<sub>es</sub>·(V − V<sub>0</sub>) + (1 − e(t))·P<sub>ED</sub>(V)]·(1 − k<sub>s</sub>·Q). e(t) is the normalised activation, a double-Hill function of t / t<sub>max</sub> (shape of Stergiopulos 1996, refitted: c<sub>1</sub> 0.55, n<sub>1</sub> 1.9, c<sub>2</sub> 1.17, n<sub>2</sub> 15.5) with t<sub>max</sub> = (0.20 + 0.15·T)·1.05 s. E<sub>es</sub> is the end-systolic elastance (default 2.1 mmHg/mL; Chen 1998, Redfield 2005 report ≈ 1.5–3), V<sub>0</sub> = −20 mL (a modelling choice: the volume intercept of the linear ESPVR is small in normal human hearts and its sign varies between studies; with V<sub>0</sub> = 0 the model's E<sub>a</sub>/E<sub>es</sub> fell with age, against Chen 1998 and Redfield 2005). k<sub>s</sub> = 0.0009 s/mL is the ejection effect (Shroff 1985).</p>
<p><b>Filling (EDPVR).</b> P<sub>ED</sub>(V) = P<sub>ref</sub>·exp[a·(V/BSA − EDVI<sub>ref</sub>)], with P<sub>ref</sub> (PCWP), a (stiffness) and EDVI<sub>ref</sub> interpolated by age from the four healthy age groups of Fujimoto 2012 (a 0.038 → 0.068 m²/mL from 28 to 69 y). The <b>Preload</b> control scales EDV (× the age-typical EDVI·BSA); <b>LV stiffness</b> scales a.</p>
<p><b>Valves and coupling.</b> Aortic and mitral valves are diodes with small resistances (0.0025 and 0.006 mmHg·s/mL). During ejection aortic pressure is P<sub>Ao</sub> = Z<sub>c</sub>·Q + P<sub>delayed</sub>, where P<sub>delayed</sub> is the pressure generated by earlier flow through the reflected and Windkessel parts of the input impedance (the same Z<sub>in</sub> as v2). The beat is iterated to a periodic fixed point (relaxation 0.5, typically 15–25 passes). Left-atrial pressure is solved by bisection so that the beat ends at the set EDV, so <b>LVEDP is calculated, not entered</b>.</p>
<p><b>Outputs.</b> dP/dt max and min from the LV pressure trace; τ from a zero-asymptote exponential fit to isovolumic relaxation (from −dP/dt min to mitral opening); IVCT (mitral closure → aortic opening), LVET, IVRT; EDV, ESV, EF; LVESP (pressure at aortic closure); E<sub>a</sub> = LVESP / SV. The Cardiac cycle tab draws these modelled traces and a pressure–volume loop, and the Excel export adds LV pressure, LV volume, mitral flow and LV dP/dt columns.</p>
<p><b>Calibration.</b> For each study profile, E<sub>es</sub> is solved inside each step of the radius / reflection fit so that stroke volume, cuff SBP and AIx hit the same v2 targets (table V3_FIT; men E<sub>es</sub> 1.77 → 2.83, women 1.72 → 2.80 mmHg/mL from 25 to 80 y, a rise consistent with Redfield 2005 and Chen 1998). Other ages interpolate linearly, flat outside 25–80 y. The Validation tab (§12) compares the unfitted outputs with Fujimoto 2012 (EF, PCWP), Zhang &amp; Kovács 2009 (dP/dt, τ), Yamakado 1997 and Chen 1998 (E<sub>a</sub>/E<sub>es</sub>) and textbook IVRT.</p>
<p><b>Heart rate (stage 5).</b> t<sub>max</sub> is scaled by the Weissler LVET relative to its value at 70 bpm, with the v2 limits (≥ 150 ms, ≤ 60 % of the cycle), so systole shortens with rate as v2's ejection does and the ventricle relaxes fully before the next beat up to 180 bpm (filling pressure ≈ 13 mmHg at 180 bpm; with the earlier 0.2 + 0.15·T rule it reached 60 mmHg). Results at 70 bpm, and so the profile fits, are unchanged.</p>
<p><b>Drugs (stage 5).</b> With the ventricle on, a drug's stroke-volume change is not added; it acts through contractility (E<sub>es</sub>) and filling (EDV), with the same kinetics and Emax rules as the arterial effects. Sourced values for one full dose: nitroglycerin EDV × 0.89 (Burggraf &amp; Parker 1974); dobutamine 5 µg/kg/min E<sub>es</sub> × 1.55 (Borow 1982); esmolol E<sub>es</sub> × 0.70 (Kass 1993, measured in patients with LV hypertrophy, so possibly larger than in healthy hearts); propofol EDV × 0.88 with E<sub>es</sub> unchanged (de Wit 2016; Yamaura 2000; Schmidt 1999); phenylephrine EDV × 1.05 (Kalmar 2018); norepinephrine EDV × 1.07 and E<sub>es</sub> × 1.10 (Hamzaoui 2010). The fixed-flow rule that raises SV when a drug slows the heart is not used: the ventricle fills and ejects more at a slower rate by itself.</p>
<p><b>Baroreflex and response modes (stage 5).</b> The MAP behind the phenylephrine baroreflex and the Physiologic buffering is estimated from measured sensitivities of the model's stroke volume (d ln SV / d ln x: preload ${'0.70'}, E<sub>es</sub> 0.46, heart rate −0.45, SVR −0.45; spread ± 0.03 across the study profiles; within 2 % of full beats for every drug). Pacing and exercise targets are met with full beats of the patient without drugs (cached): pacing lowers EDV (as atrial pacing does in normal hearts; Rozenman 1984), exercise raises E<sub>es</sub> (sympathetic inotropy; Chantler 2008). Both reach the v2 cardiac-output and MAP targets within 1 %.</p>
<p class="fine">Limits: a single lumped elastance (no RV, no interventricular interaction, no mitral regurgitation); no force–frequency effect, so in pacing mode EF falls (63 → 49 % at 110 bpm) where it stays unchanged in normal hearts (Rozenman 1984); no load-dependent relaxation beyond the Hill shape and the ejection effect; LA pressure is constant through the beat apart from a schematic atrial kick in the diagram. Drug magnitudes come from single studies, often in patients rather than healthy adults (see each drug's source).</p>

<h3>18 · Assumptions &amp; limitations</h3>
<ul>
  <li>Study profiles: amplification and cuff values are now compared like-for-like (cuff with cuff, device with device); the remaining misses are listed in §15 and, for the age trends, §16.</li>
  <li>Diastolic decay: see §15 for the remaining misses. Zero-asymptote τ is longer than invasive values in the young profiles (2.0–2.7 s vs 1.37 ± 0.31 s). The comparison cohort was older catheterised patients, and the model's late diastole flattens toward ≈ 50–65 mmHg (see the fitted asymptote). With the asymptote fitted, τ is 0.19–0.22 s at 65–80 y, just under the invasive range (0.23–0.65 s).</li>
  <li>Single effective reflection site; the real tree has distributed reflections. Absolute Δtp values in youth are shorter than some invasive reports — trends, not absolute numbers, are the point.</li>
  <li>With the fixed-flow (v2) heart, the heart is a flow source: stroke volume does not change with afterload, and changes with filling time only through the illustrative rule above for acute drugs. Moving the HR slider by hand, or a long-term v1 drug that slows HR, lowers MAP in proportion. The Ventricle (v3) model (§17) removes this: stroke volume then responds to afterload and filling.</li>
  <li>MAP = CO × SVR, so aortic stiffness changes pulse pressure and central systolic pressure but not MAP or its percentage fall with a vasodilator such as propofol. The model has no mechanism by which a stiff aorta worsens hypotension.</li>
  <li>Linear model; no venous pressure, no autoregulation. The only reflex is the phenylephrine baroreflex.</li>
  <li>Drug effects are illustrative parameter shifts, not pharmacokinetic models.</li>
  <li>Reflection magnitude depends heavily on the separation method; compare directions, not absolute values.</li>
</ul>

<h3>19 · References</h3>
<ol>${Object.values(CITATIONS).map(c => `<li>${c}</li>`).join('')}</ol>`;
}
