/* Learn tab lessons and glossary (ported from v1 js/lessons.js). Each lesson has a live
   figure built from the model and a "Try it" scenario that loads patients A and B. */
import { DEFAULTS, PRESETS, type Params } from './physiology';
import { simulate } from '../model/solve';
import { applyDrugs } from '../model/drugsSteady';
import type { ChartConfig } from '../render/chart';
import type { TabId } from '../state/types';

export interface PatientSpec { preset: string; over?: Partial<Params>; drugs?: string[]; }
export interface Lesson {
  id: string; title: string; lead: string; body: string[]; analogy: string; eq: string;
  fig: () => { cap: string; cfg: ChartConfig };
  tryIt: { label: string; tab?: TabId; A: PatientSpec; B?: PatientSpec; look: string };
}

const sim = (preset: string, over: Partial<Params> = {}, drugs: string[] = []) =>
  simulate(applyDrugs({ ...DEFAULTS, ...(PRESETS[preset] ?? {}), ...over }, drugs));
const ms = (a: number[]) => a.map(v => v * 1000);
const hx = (v: number) => v.toFixed(0) + ' ms';

export const LESSONS: Lesson[] = [
  {
    id: 'wave', title: 'The pulse is a wave',
    lead: 'Every heartbeat sends a pressure wave racing down your arteries, far faster than the blood itself moves.',
    body: [
      'When the left ventricle squeezes, it pushes about 70 mL of blood into the aorta. The aorta is stretchy, so it bulges, and that bulge travels along the artery wall as a wave. That travelling bulge is the pulse you feel at your wrist.',
      'The blood moves at well under 1 metre per second. The pressure wave moves at about 5 to 12 metres per second. That speed is the pulse wave velocity, or PWV.',
      'The figure shows one heartbeat: blood flow out of the heart (red) and the pressure it creates in the aorta (black). Flow stops when the aortic valve closes, but pressure only drifts down slowly through diastole.'
    ],
    analogy: 'Flick one end of a rope. A bump runs to the other end, yet the rope itself barely moves forward.',
    eq: 'Pulse wave velocity = distance travelled ÷ travel time',
    fig: () => { const r = sim('Default adult (45 y)'); return { cap: 'Default adult: aortic flow and pressure over one heartbeat.', cfg: {
      series: [{ x: ms(r.t), y: r.p, color: '--comp', width: 2.6, label: 'Aortic pressure (mmHg)' }, { x: ms(r.t), y: r.q, color: '--flow', width: 2, label: 'Flow out of the heart (mL/s, right axis)', y2: true, fill: '--flow-soft', fillBase: 0 }],
      y2: { color: '--flow', min: 0 }, xLabel: 'Time (ms)', yLabel: 'mmHg', hoverX: hx } }; },
    tryIt: { label: 'Watch the wave travel', tab: 'sim', A: { preset: 'Default adult (45 y)' }, look: 'In the arterial tree on the Simulator tab, the blue dot is the forward wave and the orange dot is its echo.' }
  },
  {
    id: 'echo', title: 'Echoes: the reflected wave',
    lead: 'The pressure you measure is the wave sent by the heart plus an echo that bounces back from the lower body.',
    body: [
      'Arteries branch, narrow and change stiffness. Every change bounces part of the wave back toward the heart. These small echoes add up into one reflected wave.',
      'At any moment, the pressure in the aorta equals the forward wave plus the reflected wave. Engineers call this superposition. You can see it in the figure: the dashed blue forward wave and the dotted orange echo add up to the black measured wave.',
      'How strong the echo is depends on how much the arteries\' properties change at the reflection sites. Relaxing the muscular arteries (as many blood pressure drugs do) makes the echo weaker.'
    ],
    analogy: 'Shout in a canyon. You hear your voice and then its echo. If the wall is close, the echo overlaps your voice.',
    eq: 'Measured pressure = forward wave + reflected wave.  Pulse pressure = (Pi − Pd) + (Ps − Pi)',
    fig: () => { const r = sim('Default adult (45 y)'), P0 = r.p[0];
      return { cap: 'Default adult: the measured wave is the sum of the forward wave and its echo.', cfg: { series: [
        { x: ms(r.t), y: r.pf.map(v => v - r.pf[0] + P0), color: '--fwd', width: 2, dash: [7, 4], label: 'Forward wave' },
        { x: ms(r.t), y: r.pb.map(v => v - r.pb[0] + P0), color: '--bwd', width: 2, dash: [2, 3], label: 'Echo (reflected wave)' },
        { x: ms(r.t), y: r.p, color: '--comp', width: 2.8, label: 'Measured' }], xLabel: 'Time (ms)', yLabel: 'mmHg', hoverX: hx } }; },
    tryIt: { label: 'Compare strong vs weak echoes', A: { preset: 'Default adult (45 y)' }, B: { preset: 'Default adult (45 y)', over: { gamma: 0.2 } },
      look: 'Patient B has the same arteries but a weaker echo (reflection coefficient 0.20). The late hump on B\'s central wave shrinks and the augmentation index falls.' }
  },
  {
    id: 'timing', title: 'Timing is everything',
    lead: 'Whether the echo helps or hurts depends on when it arrives. In diastole it helps the heart; in systole it adds to the heart\'s work.',
    body: [
      'In a young person with elastic arteries, the wave travels slowly, so the echo returns after the aortic valve has closed. It props up diastolic pressure, and diastole is when the heart muscle receives its own blood supply.',
      'With age the arteries stiffen, the wave travels faster, and the echo returns earlier, while the heart is still ejecting. Now the ventricle has to push against it. The extra pressure it adds is called augmentation.',
      'The figure compares a 20-year-old with an 80-year-old. Look at where each wave peaks, and at the late shoulder in the older patient.'
    ],
    analogy: 'Pushing a child on a swing. Push at the right moment and it helps. Push at the wrong moment and you fight the swing.',
    eq: 'Echo return time Δtp = 2 × distance to reflection site ÷ PWV',
    fig: () => { const y = sim('Young adult (20 y)'), o = sim('Isolated systolic HTN (80 y)');
      return { cap: `Echo returns at ${y.m.dtp.toFixed(0)} ms in the 20-year-old vs ${o.m.dtp.toFixed(0)} ms in the 80-year-old.`, cfg: { series: [
        { x: ms(y.t), y: y.p, color: '--pa', width: 2.6, label: 'Age 20' }, { x: ms(o.t), y: o.p, color: '--pb', width: 2.6, label: 'Age 80' }],
        vlines: [{ x: y.m.dtp, color: '--pa', dash: [3, 3], label: 'echo (20 y)', dy: 20 }, { x: o.m.dtp, color: '--pb', dash: [3, 3], label: 'echo (80 y)' }],
        xLabel: 'Time (ms)', yLabel: 'mmHg', hoverX: hx } }; },
    tryIt: { label: 'Compare age 20 vs age 80', A: { preset: 'Young adult (20 y)' }, B: { preset: 'Isolated systolic HTN (80 y)' },
      look: 'B\'s echo arrives early in systole and builds a late peak (high AIx, high wasted energy). A\'s echo arrives late and the augmentation index is negative.' }
  },
  {
    id: 'stiff', title: 'Stiffness and pulse wave velocity',
    lead: 'Stiffer arteries carry the wave faster. PWV is the most widely used single measure of arterial stiffness.',
    body: [
      'Elastin keeps young aortas stretchy. Over decades, elastin frays and fragments, and much stiffer collagen takes over the load (collagen is at least 500 times stiffer).',
      'A stiffer tube carries the wave faster, stores less blood with each beat, and lets pressure fall faster in diastole. Systolic pressure rises, diastolic pressure falls, and pulse pressure widens, even though the average pressure can stay the same.',
      'An aortic (carotid–femoral) PWV above about 10 m/s is generally treated as increased stiffness.'
    ],
    analogy: 'Tap a tight drum skin and a loose one. On the tight one, the vibration races across.',
    eq: 'PWV² ≈ wall stiffness ÷ blood density  (Bramwell–Hill). Stiffer wall → faster wave.',
    fig: () => { const pal = ['--seq-1', '--seq-2', '--seq-3', '--seq-4'];
      const series = [5, 8, 11, 14].map((c, i) => { const r = sim('Default adult (45 y)', { cAo: c }); return { x: ms(r.t), y: r.p, color: pal[i], width: 2.3, label: `PWV ${c} m/s` }; });
      return { cap: 'Same heart, same resistance, four levels of aortic stiffness.', cfg: { series, xLabel: 'Time (ms)', yLabel: 'mmHg', hoverX: hx } }; },
    tryIt: { label: 'Compare elastic vs stiff aorta', A: { preset: 'Default adult (45 y)', over: { cAo: 6 } }, B: { preset: 'Default adult (45 y)', over: { cAo: 13 } },
      look: 'Both patients have nearly the same MAP, but B has higher systolic, lower diastolic and a much wider pulse pressure.' }
  },
  {
    id: 'map', title: 'Average pressure: flow × resistance',
    lead: 'Mean arterial pressure is set by how much blood the heart pumps and how narrow the tiny arterioles are.',
    body: [
      'Average pressure works like water in a garden hose: pressure = flow × resistance. Almost all of the resistance sits in the arterioles, the smallest arteries.',
      'Resistance depends on the radius to the fourth power (Poiseuille\'s law). So a small change in radius has a big effect: arterioles 10 % narrower give about 50 % more resistance.',
      'Notice the difference from stiffness. Resistance lifts the whole waveform, including diastolic pressure. Stiffness widens the waveform, pushing systolic up and diastolic down.'
    ],
    analogy: 'Putting your thumb over the end of a garden hose.',
    eq: 'MAP = cardiac output × SVR,   SVR ∝ 1 ÷ radius⁴',
    fig: () => { const xs: number[] = [], map: number[] = [], dbp: number[] = [], sbp: number[] = [];
      for (let r = 85; r <= 115; r += 1) { const m = sim('Default adult (45 y)', { radius: r }).m; xs.push(r); map.push(m.map); dbp.push(m.Pd); sbp.push(m.Ps); }
      return { cap: 'Widening the arterioles lowers MAP, systolic and diastolic together.', cfg: { series: [
        { x: xs, y: sbp, color: '--accent', width: 2.4, label: 'Central SBP' }, { x: xs, y: map, color: '--comp', width: 2.4, label: 'MAP' }, { x: xs, y: dbp, color: '--fwd', width: 2.4, label: 'DBP' }],
        xLabel: 'Arteriolar radius (% of normal)', yLabel: 'mmHg', hoverX: v => v.toFixed(0) + ' %' } }; },
    tryIt: { label: 'Compare normal vs constricted arterioles', A: { preset: 'Default adult (45 y)' }, B: { preset: 'Default adult (45 y)', over: { radius: 93 } },
      look: 'B\'s arterioles are 7 % narrower. SVR rises by about a third, and the whole waveform moves up: MAP and diastolic rise together.' }
  },
  {
    id: 'cuff', title: 'Cuff pressure vs central pressure',
    lead: 'The cuff on your arm does not read the pressure your heart actually faces.',
    body: [
      'As the wave travels out to the arm it gets taller. This is pulse pressure amplification, and it makes brachial systolic pressure higher than aortic systolic pressure.',
      'Amplification is largest in young people and shrinks with age. So two people with the same cuff reading can have quite different central pressures, and central pressure is what loads the heart, brain and kidneys.',
      'This is why Nichols warned that drug benefits can be "grossly underestimated" by the cuff: some drugs lower central pressure much more than arm pressure.'
    ],
    analogy: 'Ocean waves grow taller as they run into shallow water near the beach.',
    eq: 'Amplification = brachial pulse pressure ÷ central pulse pressure  (healthy ≈ 1.3 or more)',
    fig: () => { const r = sim('Young adult (20 y)');
      return { cap: `Age 20: cuff ${r.m.bSBP.toFixed(0)}/${r.m.bDBP.toFixed(0)} vs central ${r.m.Ps.toFixed(0)}/${r.m.Pd.toFixed(0)} mmHg (amplification ${r.m.ppa.toFixed(2)}×).`, cfg: { series: [
        { x: ms(r.t), y: r.p, color: '--comp', width: 2.6, label: 'Aorta (central)' }, { x: ms(r.t), y: r.brachial, color: '--brach', width: 2.6, label: 'Brachial (cuff)' }],
        xLabel: 'Time (ms)', yLabel: 'mmHg', hoverX: hx } }; },
    tryIt: { label: 'Compare before and after a nitrate', A: { preset: 'Essential HTN (55 y)' }, B: { preset: 'Essential HTN (55 y)', drugs: ['nitrate'] },
      look: 'Compare the cuff SBP row with the central SBP row: the nitrate lowers central pressure and AIx much more than the cuff shows.' }
  },
  {
    id: 'aix', title: 'Reading the augmentation index',
    lead: 'The augmentation index (AIx) tells you what share of the pulse pressure comes from the echo.',
    body: [
      'Find the shoulder (Pi) where the echo starts adding pressure, and the peak (Ps). The difference is the augmentation pressure (AP). Divide it by the pulse pressure to get AIx.',
      'AIx is negative in young people (the echo peak is lower than the first peak), around 20–30 % in middle age, and higher in stiff or hypertensive arteries.',
      'AIx is not a pure stiffness measure. It also falls with a faster heart rate and rises in shorter people, whose reflection sites are closer. Compare like with like, or use AIx corrected to a heart rate of 75.'
    ],
    analogy: 'Measuring how much of a wave\'s height came from its echo rather than from the original push.',
    eq: 'AIx = augmentation pressure ÷ pulse pressure × 100 %.  Example: AP 10 mmHg, PP 40 mmHg → AIx 25 %.',
    fig: () => { const r = sim('Older adult (70 y)'), m = r.m, t = ms(r.t);
      return { cap: `Age 70: AP ${m.AP.toFixed(0)} mmHg ÷ PP ${m.PP.toFixed(0)} mmHg = AIx ${m.AIx.toFixed(0)} %.`, cfg: { series: [{ x: t, y: r.p, color: '--comp', width: 2.8, label: 'Central pressure' }],
        marks: [{ x: t[m.iPk], y: m.Ps, label: 'Ps', color: '--accent' }, { x: t[m.i1], y: m.P1, label: 'Pi', color: '--bwd', pos: 'left' }, { x: t[t.length - 1] * 0.98, y: m.Pd, label: 'Pd', color: '--fwd' }],
        brackets: [{ x: t[m.iPk] + 30, y0: m.P1, y1: m.Ps, label: `AP ${m.AP.toFixed(0)}`, color: '--bwd' }, { x: t[t.length - 1] * 0.93, y0: m.Pd, y1: m.Ps, label: `PP ${m.PP.toFixed(0)}`, color: '--ink-2', align: 'right' }],
        xLabel: 'Time (ms)', yLabel: 'mmHg', headroom: 0.2, hoverX: hx } }; },
    tryIt: { label: 'Compare tall vs short patient', A: { preset: 'Tall stature (195 cm)' }, B: { preset: 'Short stature (155 cm)' },
      look: 'Identical arteries, different height. The shorter patient\'s echo returns sooner, so AIx is higher.' }
  },
  {
    id: 'load', title: 'The heart\'s workload and its own blood supply',
    lead: 'Early echoes make the heart work harder, while low diastolic pressure gives the heart muscle less blood.',
    body: [
      'The heart muscle gets most of its own blood flow during diastole. Stiff arteries raise systolic pressure (more work and more oxygen needed) and lower diastolic pressure (less supply).',
      'Wasted energy (ΔEw) estimates the extra work the ventricle spends pushing against the echo. SEVR compares supply (the diastolic pressure area) with demand (the systolic pressure area).',
      'Over years, this mismatch thickens the heart muscle (left ventricular hypertrophy) and can lead to heart failure. In MESA, a high late-systolic load predicted incident heart failure.'
    ],
    analogy: 'Being asked to run uphill while someone pinches your water bottle\'s straw.',
    eq: 'Wasted energy ΔEw = Δtr × (Ps − Pi) × π/2.   SEVR = diastolic pressure-time ÷ systolic pressure-time',
    fig: () => { const xs: number[] = [], ew: number[] = [], sevr: number[] = [];
      for (let c = 5; c <= 15; c += 0.5) { const m = sim('Default adult (45 y)', { cAo: c }).m; xs.push(c); ew.push(m.Ew / 1000); sevr.push(m.sevr); }
      return { cap: 'As the aorta stiffens, wasted energy climbs and the supply/demand ratio falls.', cfg: { series: [
        { x: xs, y: ew, color: '--bwd', width: 2.6, label: 'Wasted energy ΔEw (×10³ dyn·s/cm²)' }, { x: xs, y: sevr, color: '--fwd', width: 2.4, dash: [6, 3], label: 'SEVR % (right axis)', y2: true }],
        y2: { color: '--fwd' }, xLabel: 'Aortic PWV (m/s)', yLabel: 'ΔEw', hoverX: v => v.toFixed(1) + ' m/s', hoverFmt: v => v.toFixed(1) } }; },
    tryIt: { label: 'Compare a young and an old heart\'s load', A: { preset: 'Young adult (20 y)' }, B: { preset: 'Isolated systolic HTN (80 y)' },
      look: 'Look at the wasted energy, late/early systolic load and central DBP rows in the table.' }
  },
  {
    id: 'drugs', title: 'How blood pressure drugs differ',
    lead: 'Two drugs can lower the cuff reading by a similar amount yet have quite different effects on the heart\'s real load.',
    body: [
      'Vasodilators (ACE inhibitors, ARBs, calcium-channel blockers and nitrates) relax the muscular arteries. The echo travels more slowly and is weaker, so central pressure falls more than cuff pressure.',
      'Beta-blockers mainly slow the heart. A slower heart lengthens systole, so more of the echo lands inside it: AIx tends to rise, and central pressure falls less than the cuff suggests.',
      'This pattern was seen in the CAFÉ substudy of ASCOT: the amlodipine-based regimen lowered central systolic pressure about 4 mmHg more than the atenolol-based one, despite nearly identical cuff readings.'
    ],
    analogy: 'Turning down the volume of an echo, versus simply talking more slowly.',
    eq: 'Townsend 2015, Table 1: ACEi / ARB / CCB lower central SBP and AIx; β-blockers lower central SBP little and raise AIx; nitrates lower AIx the most.',
    fig: () => { const b = sim('Essential HTN (55 y)', {}, ['bb']), c = sim('Essential HTN (55 y)', {}, ['ccb']);
      return { cap: `Essential HTN. Atenolol: cuff ${b.m.bSBP.toFixed(0)}, central ${b.m.Ps.toFixed(0)}, AIx ${b.m.AIx.toFixed(0)} %. Amlodipine: cuff ${c.m.bSBP.toFixed(0)}, central ${c.m.Ps.toFixed(0)}, AIx ${c.m.AIx.toFixed(0)} %.`, cfg: { series: [
        { x: ms(b.t), y: b.p, color: '--pa', width: 2.6, label: 'β-blocker (atenolol)' }, { x: ms(c.t), y: c.p, color: '--pb', width: 2.6, label: 'CCB (amlodipine)' }],
        xLabel: 'Time (ms)', yLabel: 'Central pressure (mmHg)', hoverX: hx } }; },
    tryIt: { label: 'Compare β-blocker vs calcium-channel blocker', A: { preset: 'Essential HTN (55 y)', drugs: ['bb'] }, B: { preset: 'Essential HTN (55 y)', drugs: ['ccb'] },
      look: 'Check the cuff SBP, central SBP and AIx rows: the vasodilator does more for the heart than the cuff difference suggests.' }
  }
];

export const GLOSSARY: [string, string][] = [
  ['Aorta', 'The large elastic artery leaving the heart. It cushions each beat like a balloon.'],
  ['Arterioles', 'The smallest arteries. Their width sets peripheral resistance (SVR).'],
  ['Pulse wave velocity (PWV)', 'How fast the pressure wave travels along the artery. Higher means stiffer.'],
  ['Forward wave', 'The pressure wave created directly by the heart\'s ejection.'],
  ['Reflected wave (echo)', 'The part of the wave bounced back from branches and narrowings, mostly in the lower body.'],
  ['Ps, Pi, Pd', 'Peak systolic pressure; the inflection where the echo starts adding; minimum diastolic pressure.'],
  ['Pulse pressure (PP)', 'Systolic minus diastolic pressure.'],
  ['Augmentation pressure (AP)', 'The extra pressure added by the echo (Ps − Pi).'],
  ['Augmentation index (AIx)', 'AP as a percentage of pulse pressure.'],
  ['Mean arterial pressure (MAP)', 'The average pressure over a heartbeat = cardiac output × SVR.'],
  ['SVR', 'Systemic vascular resistance, mostly set by arteriolar radius (∝ 1/r⁴).'],
  ['Compliance', 'How much an artery stretches for a rise in pressure. The opposite of stiffness.'],
  ['Characteristic impedance (Zc)', 'The aorta\'s resistance to pulsatile flow. Rises with stiffness and a narrower aorta.'],
  ['Δtp', 'Round-trip time for the wave to reach the reflection site and come back.'],
  ['Amplification', 'How much taller the pulse is in the arm than in the aorta.'],
  ['Central pressure', 'Pressure in the ascending aorta, the pressure the heart pushes against.'],
  ['Wasted energy (ΔEw)', 'Extra work the ventricle does against the echo during systole.'],
  ['SEVR', 'Subendocardial viability ratio: blood supply (diastole) vs demand (systole) for the heart muscle.'],
  ['Waveform type A / B / C', 'A: echo returns early and peaks above the first shoulder. B: small positive augmentation. C: echo returns late (young people, negative AIx).'],
  ['Drug effect %', 'A drug\'s combined effect now, as a percentage of one standard dose at full effect. Repeat doses add up but saturate at 120 %.']
];
