# Pulse Lab Simulator

A browser-based educational simulator of arterial pulse wave analysis (PWA) and pulse wave
velocity (PWV). It runs a live, beat-by-beat circulation: change the heart, the arteries or give
a drug, and the central and brachial waveforms, the reflected wave and blood pressure respond in
real time. Built on the equations of Nichols & Edwards (2001), Nichols & Singh (2002) and
Townsend et al. (2015).

**Educational model only; not a medical device; not for diagnosis or treatment decisions.**
Created by Dov Greenwald, 2026.

- Live site: https://dovpulselab.github.io/PulseLabSim/
- Classic version (v1): https://dovpulselab.github.io/PulseLabSim/v1/

## Run it locally

Needs [Node.js](https://nodejs.org) 20.19+ or 22.12+.

```bash
npm install
npm run dev          # http://localhost:5173/PulseLabSim/
```

On a Mac you can also double-click `start.command`.

| Command | What it does |
|---|---|
| `npm run dev` | Development server with live reload |
| `npm test` | All unit tests, including the v1 regression snapshots and a headless UI test |
| `npm run build` | Type-check, build to `dist/`, and copy v1 into `dist/v1/` |
| `npm run preview` | Serve the built `dist/` at http://localhost:4173/PulseLabSim/ |
| `npm run snapshot:v1` | Regenerate the v1 reference outputs from `legacy-v1/js/` |

## What's inside

| Tab (key) | Use it to |
|---|---|
| **Simulator** (1) | Live central waveform with forward/reflected waves, feature points and shaded augmentation; arterial-tree animation, arm and flow plots, pressure budget, all indices |
| **Compare A vs B** (2) | Two patients on one clock: overlay, B − A difference, and the top 3 inputs that explain the central SBP difference |
| **Learn** (3) | Nine lessons with live figures, a glossary, and a cause → effect map that pulses as inputs change |
| **Sweep** (4) | One input across its range at 6 or 12 points: waveforms and any index vs the input (`[` `]` step) |
| **Impedance** (5) | Input impedance modulus and phase, Zc, Z₁ and the first minimum vs 1/(2·Δtp) |
| **Validation** (6) | Published numbers recomputed, age trends, drug directions and mechanistic checks |
| **Methods** (7) | Every equation, the live engine and drug methods, illustrative drug values, limitations |

Also: drugs as bolus or infusion events with onset/offset (13 drugs), guided cases with live goals
and scoring, pin baseline (`B`), undo/redo, shareable links (Copy link), exports (PNG, CSV, JSON),
Present mode (`P`), light/dark theme, Explain drawer (`E`) and a 60-second tour (`H`).

### New in v2.7 (age evidence recalibration)

- **Stroke volume from Doppler data**: calibration now uses WASE 2021 Doppler stroke-volume index
  by sex and age group (flat with age), replacing Maceira 2006 CMR × an unsourced 0.70 factor.
- **The age slider calibrates SVR and Γ too**: arteriolar radius and Γ follow age curves through the
  refitted healthy study profiles, so any age gives a calibrated healthy patient. Inputs outside
  their data's age range are held flat and listed as extrapolated.
- **Validation §11 and new profile rows**: cardiac index (WASE), SVR index (Redfield 2005),
  reflected-wave timing (Phan 2016), Zc across methods, and a MAP-plateau check (a known miss).
- **Methods §16**: data provenance for every age-dependent input and where the evidence disagrees.

### New in v2.1

- **Patient inputs**: sex, age, height and weight. Changing any of them recalculates aortic
  diameter (Campens 2014), aortic PWV (Reference Values for Arterial Stiffness Collaboration 2010)
  and stroke volume (Maceira 2006; WASE 2021 since v2.7); the sliders can still be adjusted afterwards.
- **Eight healthy study profiles**: men and women at 25, 45, 65 and 80 y, fitted to central SBP
  (Herbert 2014) and AIx (Janner 2010) and checked against other reference data on the Validation tab.
- **Ejection duration in ms**, starting at 300 ms and following heart rate (sex-specific Weissler lines).
- **Heart rate up to 180 bpm** (Weissler is extrapolated above 150 bpm; see Methods).
- **Diastolic decay**: fitted time constant τ (asymptote 0 and asymptote fitted), the asymptote P∞,
  and the mean decay rate in mmHg/s, with the fitted curve drawn on the central-pressure chart.

## Project layout

```
index.html            v2 entry page
src/config/           all constants: physiology, presets, drugs, kinetics, citations; content
src/model/            haemodynamic model (pure): solver, indices, impedance, features, validation
src/engine/           beat clock, transitions, drug kinetics, trend buffer (pure)
src/state/            store with undo/redo, URL hash, JSON import/export (pure)
src/cases/            guided cases, goal checks and scoring (pure)
src/render/           canvas charts and theming
src/ui/               layout shell, rail, tabs, drawer, start screen, cases UI
tests/                unit tests and fixtures (v1 snapshots)
legacy-v1/            the original v1 site, unchanged (published at /v1/)
scripts/              v1 snapshot generator, v1 copy step for the build
.github/workflows/    test, build and deploy to GitHub Pages
```

To change a preset, drug effect or time constant, edit `src/config/physiology.ts`. Drug magnitudes
are illustrative teaching values and are listed on the Methods tab.

## Deployment

`.github/workflows/deploy.yml` runs the tests and the build on every pull request into `main`,
and on every push to `main` it also deploys `dist/` to GitHub Pages.

One-time setup: in the repository's **Settings → Pages → Build and deployment**, set
**Source** to **GitHub Actions**.
