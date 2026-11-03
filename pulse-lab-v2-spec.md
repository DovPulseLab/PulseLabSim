Build a browser-based EDUCATIONAL simulator of arterial pulse wave analysis (PWA) and pulse wave
velocity (PWV) — Pulse Lab Simulator v2 — that runs a live, beat-by-beat circulation where inputs and
drugs change the waveforms in real time, for medical students, residents and research audiences.
Educational model only; not a medical device; not for diagnosis or treatment decisions. Show this on
the start screen and in the footer, with the credit line "Created by Dov Greenwald, 2026".

## Stack
- Vite + TypeScript (strict) + Canvas 2D for all plots (no chart library). Vitest for unit tests.
- No backend; all state in memory plus the URL hash. Must run with `npm install && npm run dev`;
  `npm run build` outputs a static site to `dist/` with base `/PulseLabSim/` for GitHub Pages.
- Keep core logic (haemodynamic model, wave separation, indices, impedance, drug kinetics, transitions,
  cases and scoring, URL state encode/decode) in PURE functions with no DOM/canvas code so it can be
  unit tested.
- Put every constant in one config file (src/config/physiology.ts): defaults, slider ranges, profile
  presets, drug effect directions and magnitudes, kinetics, citations. Units: mmHg, ml, bpm, m/s, s,
  cm, dyn·s·cm⁻⁵. Drug magnitudes are teaching values: flag them `illustrative: true` with the source
  for the direction (Nichols & Singh 2002; Townsend et al. 2015, Table 1) and list them on Methods.
- Carry over every v1 feature (Simulator, Compare A vs B, Learn cause & effect, Sweep, Impedance,
  Validation, Methods, pin baseline, exports, Present). v2 changes how they behave, not what exists.

## Suggested structure
src/main.ts              bootstrap, render loop (requestAnimationFrame), keyboard, wiring
src/config/physiology.ts all constants, ranges, presets, drugs, citations
src/model/               ejection flow, forward/reflected waves, central + brachial pressure, MAP/CO,
                         pressure-dependent PWV, impedance spectrum, indices (pure)
src/engine/              beat clock, smooth parameter transitions, drug kinetics, trend buffer (pure)
src/state/store.ts       single state object, subscribe/emit, undo/redo stack, URL hash sync
src/cases/               guided cases, questions, checks, scoring (pure)
src/ui/                  layout shell, control rail, plots, monitor strip, trends, metric cards,
                         explain drawer, tabs, compare, sweep, impedance, start screen, help
src/render/              canvas helpers: axes, crosshair, annotations, high-DPI scaling, themes
tests/                   unit tests

## Core features
- Inputs: keep every v1 slider with its v1 default, range, step and hover definition. Add a numeric
  box and ±step buttons to each. Out-of-range input (typed, URL, imported JSON) is clamped and a
  warning is shown; never NaN.
- Haemodynamic model (pure, deterministic): PORT the existing v1 solver from js/model.js
  (transmission-line + Windkessel, FFT frequency-domain solve, Nichols & Edwards 2001) into
  src/model/ as typed pure functions with identical outputs. Do NOT replace it with a simpler model.
  Before any other change, snapshot v1 outputs (all indices + waveforms) for every PRESET and every
  DRUG, and add a regression test that v2 matches them within 0.5 mmHg / 0.5 %. Move PRESETS, DRUGS
  and slider definitions (from js/content.js) into src/config/physiology.ts unchanged.
  Sanity checks the ported model must still satisfy: MAP = CO × SVR / 80 + CVP (±1 mmHg),
  Zc ≈ ρ·c / A, Δtp = 2L / PWV.
- Passive feedback: keep v1's MAP → elastic-artery stiffness coupling and its coefficient. Solve it by
  fixed-point iteration: max 8 iterations, tolerance 0.1 mmHg; if not converged, use the last value
  and log a warning (never NaN). The cause → effect map draws it as a dashed arrow.
- Indices (all shown in "All indices", each with formula in the Explain drawer): central and brachial
  SBP/DBP/PP, MAP, CO, AIx = (P2 − P1)/PP × 100 and AIx@75 (−4.8 % per 10 bpm above 75), augmented
  pressure, Δtp, PP amplification = brachial PP / central PP, Zc, forward/backward wave amplitudes
  (Pf, Pb), reflection magnitude Pb/Pf, SEVR (diastolic/systolic pressure-time integral).
  Feature points auto-detected per beat: foot, inflection (P1), peak (P2), dicrotic notch. If the
  inflection is not found (type C wave), mark it "n/a" and compute AIx from the shoulder by 4th
  derivative; never crash.
- Live beat engine: the clock generates beats continuously at HR. Any input change ramps to its new
  value over 3 beats (cosine ease), so waveforms morph instead of jumping. Pause (Space) freezes the
  clock; step one beat (.) while paused. Time warp ×0.25/×0.5/×1.
- Drugs as events on a timeline (not instant switches): bolus or infusion of nitroglycerin,
  phenylephrine, esmolol, dobutamine, propofol, norepinephrine. Each acts only on physiology inputs
  (muscular PWV, Γ, arteriolar radius → SVR, HR, SV) with first-order onset τon and offset τoff from
  config (e.g. NTG τon 60 s, τoff 180 s; esmolol τon 60 s, τoff 600 s). Effects of several drugs add
  in log space and are clamped to slider ranges. Phenylephrine adds a baroreflex HR fall
  (−0.3 bpm per mmHg MAP rise, max −20). Drug markers appear on the trend plot.
- Trends: per-beat SBP, DBP, MAP, PP, HR, AIx, central/brachial PP, PWV over the last 10 min
  (ring buffer, 1 sample/beat). Hover shows values; drag to zoom a time window.
- Pin baseline: overlays the pinned beat (grey dashed) on every waveform; Δ values shown on metric
  cards (green/red by direction, not by "good/bad").
- Compare A vs B: two independent patients running on the same clock; B − A difference plot; the
  "What differs" summary lists the top 3 inputs by contribution to ΔcSBP, computed by changing each
  differing input from A to B one at a time.
- Sweep: one input across its range at 6 (or 12) points, others held; shows waveforms plus a
  line plot of any chosen index vs the swept input.
- Impedance: modulus and phase of input impedance for harmonics 0–10 Hz from the current beat by
  FFT of pressure/flow. Mark Zc (mean modulus 2–10 Hz), Z1, and the first minimum, which must sit
  near 1/(2·Δtp) (±15%).
- Guided cases: young athlete, elderly isolated systolic hypertension, post-NTG, beta-blockade,
  stiff aorta before induction (propofol bolus → watch MAP fall). Each case loads a preset, gives a
  goal ("bring cSBP below 130 without MAP < 65"), asks 2–3 multiple-choice questions, checks the goal
  live, and ends with a score 0–100 and teaching points.
- Shareable state: all inputs, active tab, pinned baseline and drug timeline encode into the URL
  hash (compact, versioned `v=2`). "Copy link" button. Unknown or corrupt hash → defaults + message.
- Undo/redo for every input change and drug event (Ctrl+Z / Ctrl+Shift+Z, 50 steps).
- Exports (kept from v1): central waveform PNG, waveforms CSV, metrics CSV, parameters JSON; add
  trends CSV. Imported JSON is schema-validated; invalid files are rejected with the failing field.

## UI
- Start screen: disclaimer, credit line, 3 cards: "Free explore", "Guided cases", "Compare two
  patients"; a 60-second interactive tour (skippable, re-open with H).
- Layout shell: top bar (tabs, live/paused indicator, time warp, baseline, export, Present, theme);
  left control rail with collapsible groups Heart · Large arteries · Periphery · Drugs; centre main
  plot; right metric cards; bottom monitor strip (scrolling central + brachial traces, 25 mm/s) and
  trend plot. Panels resize by drag; layout remembered for the session.
- Plots: crosshair hover readout (time ms, pressure mmHg), labelled feature points, shaded augmented
  pressure, forward/reflected toggle, high-DPI crisp canvases, colour-blind-safe palette, light/dark.
- Explain drawer: click any metric, slider or curve → definition, formula, normal adult range,
  which inputs move it (from the cause-and-effect graph), citation.
- Learn map: nodes pulse ▲/▼ live as inputs ramp, with arrows animating in causal order.
- Present mode: hides the rail, enlarges fonts ×1.4, keeps central waveform, metric cards and trend.
- Responsive to 400 px wide: rail becomes a bottom sheet, cards scroll horizontally, no page
  horizontal scroll. All controls reachable by keyboard; visible focus; ARIA labels on sliders.
- Keys: 1–7 tabs · Space pause · . step beat · B pin baseline · R reset · P present · E explain ·
  H help · Ctrl+Z / Ctrl+Shift+Z undo/redo · [ ] previous/next sweep point.

## Tests, at minimum
v1 regression snapshots for every preset and drug; Validation tab checks from v1 still pass;
MAP = CO × SVR / 80 + CVP within 1 mmHg at defaults and at range extremes; forward + reflected +
decay equals measured at every sample; Δtp = 2L/PWV; AIx rises with aortic PWV and with Γ, falls with
HR; PP amplification falls as aortic PWV rises; MAP↔PWV iteration converges at defaults and reports
non-convergence without NaN; LVET formula and SV area of the flow curve (±1%); feature detection on
type A, B and C waves; impedance first minimum ≈ 1/(2·Δtp) ±15% and Zc matches ρc/A ±10%; transitions
reach target in 3 beats and are monotonic; drug kinetics onset/offset times, additive combination,
clamping, phenylephrine reflex; trend ring buffer wraps at 10 min; URL encode/decode round-trip and
corrupt-hash fallback; JSON import rejects bad schema; undo/redo; Compare contribution ranking;
case goal checks and scoring.

## Done when
`npm run build` (typecheck + build) and `npm test` pass; free explore, a full guided case, Compare
and Sweep run end to end at 60 fps on a laptop with no console errors; a shared link reopens the exact
same state; every v1 regression snapshot still matches; and a deliberately bad input (aortic PWV, Γ
and L at their maximums with HR at its minimum, or a corrupt imported JSON)
produces the expected result: early-returning reflection with AIx > 30% and widened central PP for the
extreme physiology, and a clear rejection message (with defaults kept) for the corrupt file.
