# Pulse Lab Simulator

Interactive pulse-wave-analysis / PWV simulator built on the equations of
Nichols & Edwards (2001), Nichols & Singh (2002) and Townsend et al. (2015).
Everything runs locally in your browser — no internet, no installs.

## Launch on a Mac

**Option A — Terminal (recommended)**

```bash
cd ~/Downloads/pulse-lab-simulator        # wherever you unzipped it
bash start.command
```

Your browser opens at http://localhost:8765. Press `Ctrl+C` in Terminal to stop.

**Option B — no server at all**

```bash
open ~/Downloads/pulse-lab-simulator/index.html
```

**Option C — double-click `start.command` in Finder.**
If macOS says it is from an unidentified developer, either right-click → Open,
or run once in Terminal:

```bash
xattr -d com.apple.quarantine ~/Downloads/pulse-lab-simulator/start.command
```

## What's inside

| Tab | Use it to |
|---|---|
| **Compare A vs B** | Two patients side by side: overlaid central and arm waves, pressure budgets, a measure-by-measure table (B − A) and a list of what differs. Edit either patient from the switch at the top of the sidebar. |
| **Learn** | Nine plain-language lessons with a live chart, an analogy and the equation in words; each **Try it** button loads a comparison. Glossary at the end. |
| **Simulator** | Move sliders and add drugs; watch central/forward/reflected waves, the animated arterial tree, and every index update live. |
| **Cause & effect** | Network of every variable; nodes light up with the direction of change after each adjustment. |
| **Sweep** | Sweep any input across its range and plot pressures and indices against it, plus a family of waveforms. |
| **Impedance** | Aortic input impedance spectrum (Z₀ = SVR, Zc, Z₁, first minimum) and the three components of afterload. |
| **Validation** | Recomputes published numbers from the papers, compares age trends and drug directions, and tests mechanistic predictions. |
| **Equations & methods** | Every equation used, the solver, assumptions and limitations, references. |

## Presentation tips

- **Pin baseline** (or press `B`) stores the current state; every chart, KPI and table then shows the change.
- **Present** (or press `P`) enlarges the type for a projector; the ◐ button switches light/dark.
- **Export** saves the central waveform (PNG), the waveforms and metrics (CSV) and the parameters (JSON).
- Hover any slider label, KPI or metric name for a definition and its source.

## Files

```
index.html        page layout
css/style.css     styling (light & dark themes)
js/model.js       physics engine (transmission-line + Windkessel, FFT solver)
js/charts.js      canvas charting
js/schematic.js   animated arterial tree
js/causal.js      cause → effect network
js/content.js     slider/metric definitions, equations text
js/lessons.js     Learn tab lessons and glossary
js/validation.js  checks against the published papers
js/app.js         app controller: patients, compare, sweep, impedance, export
```

To change a preset or a drug effect, edit `PRESETS` or `DRUGS` near the end of `js/model.js`.
