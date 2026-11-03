/* The five guided cases. Numbers quoted in questions were computed with this model
   (they are approximate: the patient's state when you answer may differ). */
import { firstDoseAfterStart, shuffleQuestions } from './engine';
import type { CaseDef, CaseSnapshot, GoalPart } from './types';

const f0 = (v: number) => v.toFixed(0);
const lt = (label: string, v: number, lim: number, unit: string): GoalPart => ({ label, ok: v < lim, value: `${f0(v)} ${unit}` });
const ge = (label: string, v: number, lim: number, unit: string): GoalPart => ({ label, ok: v >= lim, value: `${f0(v)} ${unit}` });
const given = (s: CaseSnapshot, drug: string, label: string): GoalPart => {
  const t = firstDoseAfterStart(s, drug);
  return { label, ok: t != null, value: t == null ? 'not yet' : `at ${f0(t - s.tStart)} s` };
};

/** Written with the correct answer anywhere; options are shuffled per case below. */
const RAW: CaseDef[] = [
  {
    id: 'athlete', kind: 'explore', title: 'Young athlete',
    summary: 'Explore why the cuff reads higher than the aorta, and what moves the echo.',
    brief: 'A 20-year-old rower at rest. Heart rate 52, stroke volume 95 mL. The cuff reads about <b>117/65</b>, but central (aortic) pressure is only about <b>104/64</b>. The wave is type C. The resting state is pinned as the grey baseline, so you can compare as you explore.',
    setup: { preset: 'Young adult (20 y)', over: { hr: 52, sv: 95 }, pinStart: true },
    goal: {
      text: 'Explore: try each change below (in any order) and watch the central wave, AIx and the cuff vs central gap. There is no target value to hit.',
      holdS: 5,
      check: () => []
    },
    tasks: [
      { label: 'Age the aorta: aortic PWV ≥ 9 m/s', check: s => s.params.cAo >= 9 - 1e-9, value: s => `${s.params.cAo.toFixed(1)} m/s · AIx ${f0(s.m.AIx)} %` },
      { label: 'Aorta back to ≤ 6 m/s, reflection site ≤ 0.80×', check: s => s.params.cAo <= 6 + 1e-9 && s.params.lpScale <= 0.8 + 1e-9, value: s => `${s.params.lpScale.toFixed(2)}× · AIx ${f0(s.m.AIx)} %` },
      { label: 'Even more compliant aorta: PWV ≤ 4.5 m/s', check: s => s.params.cAo <= 4.5 + 1e-9, value: s => `${s.params.cAo.toFixed(1)} m/s · Δtp ${f0(s.m.dtp)} ms` }
    ],
    hints: ['Aortic PWV is under Large arteries; the reflection-site position is under Periphery.', 'Each change counts once it has been in place for 5 s. Watch the shaded augmentation and the cards.'],
    questions: [
      { q: 'At rest, cuff SBP is about 13 mmHg higher than central SBP. Why?',
        options: ['Cuff error', 'Amplification along the arm', 'Slow heart rate', 'Low SVR'],
        correct: 1, explain: 'In young, compliant arteries the pulse grows as it travels to the arm (PP amplification ≈ 1.3 here), so the cuff overestimates central systolic pressure.' },
      { q: 'AIx is negative at rest. When does the reflected wave reach the aorta?',
        options: ['Before ejection starts', 'Before the systolic peak', 'After the systolic peak', 'Never'],
        correct: 2, explain: 'The echo returns late (Δtp ≈ 210 ms here), after the peak, so it adds to late-systolic and diastolic pressure rather than to the peak.' },
      { q: 'With aortic PWV at 9 m/s, what happened to PP amplification?',
        options: ['It rose', 'It fell', 'No change'],
        correct: 1, explain: 'About 1.32 → 1.11. The echo now lands in systole and raises central SBP (about 104 → 149) more than cuff SBP, so the cuff–central gap shrinks.' }
    ],
    teaching: [
      'Young, compliant arteries return the echo late: AIx is negative and the wave is type C.',
      'Amplification is high in youth, so cuff SBP overestimates central SBP by 10–15 mmHg.',
      'A stiffer aorta or a closer reflection site moves the echo into systole: central SBP rises more than cuff SBP, and amplification falls.',
      'MAP hardly changes when only stiffness or reflection changes: these are pulsatile loads, not steady ones.'
    ]
  },
  {
    id: 'ish', kind: 'goal', showLowestMap: true, title: 'Elderly isolated systolic hypertension',
    summary: 'Lower central systolic pressure without dropping mean pressure too far.',
    brief: 'An 80-year-old with isolated systolic hypertension. Cuff about <b>159/59</b>, central about <b>142/61</b>, MAP 104. The aorta is stiff (PWV 11.5 m/s) and the echo returns early, in systole (AIx ≈ 65 %).',
    setup: { preset: 'Isolated systolic HTN (80 y)', pinStart: true },
    goal: {
      text: 'Bring central SBP below 130 without letting MAP fall below 65.',
      holdS: 20,
      check: s => [lt('Central SBP < 130', s.m.Ps, 130, 'mmHg'), ge('MAP ≥ 65', s.m.map, 65, 'mmHg')]
    },
    hints: ['Drugs act over minutes; watch the trend plot. Use time warp ×1.', 'Which drugs reduce wave reflection, not just resistance?'],
    questions: [
      { q: 'What mainly widens central pulse pressure here (about 81 mmHg)?',
        options: ['High SVR', 'Stiff aorta', 'Fast heart rate', 'Low stroke volume'],
        correct: 1, explain: 'Stiffness raises the characteristic impedance (a bigger forward wave) and shortens Δtp, so the echo lands in systole. Both widen PP; MAP is set by CO × SVR.' },
      { q: 'Which drug lowers central SBP with the smallest fall in MAP?',
        options: ['Nitroglycerin', 'Esmolol', 'Phenylephrine', 'Dobutamine'],
        correct: 0, explain: 'At full effect NTG lowers central SBP by about 21 mmHg while MAP falls about 13. Esmolol lowers central SBP by a similar amount, but MAP falls about 20.' },
      { q: 'With NTG at full effect, what happens to PP amplification?',
        options: ['It rises', 'It falls', 'No change'],
        correct: 0, explain: 'NTG weakens and delays reflection (lower Γ and muscular PWV): AIx about 65 → 36 % and amplification about 1.22 → 1.39.' }
    ],
    teaching: [
      'In isolated systolic hypertension, the problem is pulsatile load: a stiff aorta and early reflection.',
      'Drugs that reduce wave reflection (nitrates, ACEi/ARB, CCB) lower central SBP more per mmHg of MAP than drugs that only slow the heart.',
      'The cuff does not show this difference well. Central pressure and AIx do.',
      'Watch MAP: an older patient with a stiff aorta still needs adequate perfusion pressure.'
    ]
  },
  {
    id: 'ntg', kind: 'goal', title: 'Post-nitroglycerin',
    summary: 'What NTG did to the wave, and why more of it adds little.',
    brief: 'A 55-year-old with essential hypertension has a nitroglycerin infusion running at full effect. The grey dashed baseline is the same patient <b>before NTG</b> (cuff about 169/68, central 154/68). Now: cuff about <b>150/77</b>, central about <b>132/78</b>.',
    setup: { preset: 'Essential HTN (55 y)', onBoard: [{ drug: 'ntg' }], pinWithoutDrugs: true },
    goal: {
      text: 'Get central SBP below 125 with MAP still at least 75. NTG keeps running.',
      holdS: 20,
      check: s => [lt('Central SBP < 125', s.m.Ps, 125, 'mmHg'), ge('MAP ≥ 75', s.m.map, 75, 'mmHg')]
    },
    hints: ['Try a second NTG dose first, and watch how little it adds.', 'A second drug with a different mechanism helps: an ACEi or CCB (long-term), or esmolol.'],
    questions: [
      { q: 'NTG lowered central SBP by about 22 mmHg but MAP by only about 13. What explains the extra central fall?',
        options: ['Less wave reflection', 'Slower heart rate', 'Lower stroke volume', 'Higher SVR'],
        correct: 0, explain: 'NTG relaxes the muscular arteries: Γ and muscular PWV fall, so the echo is smaller and later (AIx about 46 → 21 %). That lowers the late-systolic peak more than the mean.' },
      { q: 'A second NTG dose lowers central SBP by only about 2 mmHg more. Why?',
        options: ['The effect saturates', 'The first dose is wearing off', 'Baroreflex', 'Cuff error'],
        correct: 0, explain: 'In this model, doses of one drug add into one exposure whose effect saturates at 120 % of a single dose (Emax). A drug with a different action works better.' },
      { q: 'After the NTG infusion stops, its effect wears off over…',
        options: ['Seconds', 'Minutes', 'Hours', 'Days'],
        correct: 1, explain: 'NTG is short-acting. The model uses an offset time constant of 180 s (illustrative).' }
    ],
    teaching: [
      'Nitrates lower central SBP and AIx much more than they lower MAP: they act mainly on wave reflection.',
      'Cuff SBP understates the central benefit. Amplification rises (about 1.18 → 1.35).',
      'Repeat doses of one drug saturate. Combining mechanisms gives more effect.',
      'Effects of short-acting infusions fade within minutes of stopping them.'
    ]
  },
  {
    id: 'bb', kind: 'goal', title: 'Beta-blockade',
    summary: 'Slow the heart and see why central pressure falls less than the cuff.',
    brief: 'A 55-year-old with essential hypertension, HR 74. Cuff about <b>169/68</b>, central about <b>154/68</b>. You will slow the heart with esmolol. The starting state is pinned as the grey baseline.',
    setup: { preset: 'Essential HTN (55 y)', pinStart: true },
    goal: {
      text: 'Use esmolol to bring heart rate to 60 bpm or below, with MAP at least 70.',
      holdS: 20,
      check: s => [
        given(s, 'esmolol', 'Esmolol given'),
        { label: 'HR ≤ 60', ok: s.params.hr <= 60.5, value: `${f0(s.params.hr)} bpm` },
        ge('MAP ≥ 70', s.m.map, 70, 'mmHg')
      ]
    },
    hints: ['Esmolol infusion takes about a minute and a half to bring HR below 60.', 'Compare the cards with the pinned baseline: which falls more, cuff or central SBP?'],
    questions: [
      { q: 'Heart rate fell by about 18 bpm. What happened to AIx?',
        options: ['Rose slightly', 'Fell sharply', 'Turned negative', 'Fell slightly'],
        correct: 0, explain: 'Slower HR lengthens ejection (about 287 → 318 ms), so the early echo adds to more of systole. AIx rises a little (about 46 → 47 %).' },
      { q: 'Which fell more with esmolol?',
        options: ['Cuff SBP', 'Central SBP', 'Both equally'],
        correct: 0, explain: 'Cuff SBP fell about 25 mmHg, central SBP about 22. β-blockade lowers brachial pressure more than central pressure (Townsend et al. 2015, Table 1).' },
      { q: 'MAP fell less than the heart-rate fall alone would predict. Why, in this model?',
        options: ['Stroke volume rises', 'SVR rises', 'The aorta stiffens', 'Vasodilation'],
        correct: 0, explain: 'When an acute drug slows the heart, the model raises SV by (HR before / HR after)^0.5, an illustrative stand-in for longer filling time. See Methods.' }
    ],
    teaching: [
      'Slowing the heart does not reduce wave reflection; it gives the early echo more systole to act on.',
      'β-blockers lower cuff pressure more than central pressure, so the cuff overstates their central benefit.',
      'AIx is heart-rate dependent: compare AIx@75 when heart rates differ.',
      'MAP falls with cardiac output; in this model a small, illustrative SV rise partly offsets the HR fall.'
    ]
  },
  {
    id: 'induction', kind: 'goal', showLowestMap: true, title: 'Stiff aorta before induction',
    summary: 'Propofol induction in an older patient on antihypertensives: watch MAP, pulse pressure and central pressure.',
    brief: 'An 80-year-old with a stiff aorta (PWV 11.5 m/s), on a long-term ACE inhibitor and calcium-channel blocker, is about to be anaesthetised. Before induction: cuff about <b>136/60</b>, central about <b>118/62</b>, central PP 56, MAP 88. The pre-induction state is pinned as the grey baseline. Give a propofol bolus to induce.',
    setup: { preset: 'Isolated systolic HTN (80 y)', onBoard: [{ drug: 'acei' }, { drug: 'ccb' }], pinStart: true },
    goal: {
      text: 'Induce with a propofol bolus, then keep MAP at 65 or above from one minute after induction.',
      holdS: 45,
      check: s => {
        const tb = firstDoseAfterStart(s, 'propofol');
        const since = tb == null ? null : s.t - tb;
        return [
          given(s, 'propofol', 'Propofol bolus given'),
          { label: '≥ 60 s after induction', ok: since != null && since >= 60, value: since == null ? '—' : `${f0(since)} s` },
          ge('MAP ≥ 65', s.m.map, 65, 'mmHg')
        ];
      }
    },
    hints: ['After the bolus, MAP bottoms out about 75 s later and recovers only slowly.', 'A half-dose phenylephrine infusion (½×) is enough here; norepinephrine also works. Watch central SBP and PP as well as MAP.'],
    questions: [
      { q: 'Before induction, what does the stiff aorta mainly raise?',
        options: ['Pulse pressure', 'Mean arterial pressure', 'Heart rate', 'Cardiac output'],
        correct: 0, explain: 'Stiffness is a pulsatile load: it widens PP (about 56 mmHg here) and raises central SBP through a bigger forward wave and an early echo. MAP is set by CO × SVR.' },
      { q: 'Propofol lowers MAP here by about 29 %. In this model, how would that fall differ with a compliant aorta?',
        options: ['About the same', 'Smaller', 'Larger', 'MAP would rise'],
        correct: 0, explain: 'MAP = CO × SVR does not depend on aortic stiffness here. The same patient with aortic PWV 7.5 m/s also falls from 88 to 62 mmHg. What differs is pulse pressure (about 40 → 26 instead of 56 → 37) and central SBP.' },
      { q: 'After phenylephrine, central SBP rises more than MAP. Why?',
        options: ['More wave reflection', 'Higher heart rate', 'Higher stroke volume', 'Aortic dilation'],
        correct: 0, explain: 'Phenylephrine constricts muscular arteries as well as arterioles: the echo gets bigger and earlier (AIx about 37 → 52 %), so central SBP climbs more than MAP (e.g. +24 vs +17 mmHg).' }
    ],
    teaching: [
      'In a stiff aorta, pulse pressure and central systolic pressure are high before induction, and they fall steeply with propofol (central SBP about 118 → 82, PP 56 → 37).',
      'Read the central wave, not just the cuff: central SBP and PP show the pulsatile load the ventricle faces.',
      'Phenylephrine restores MAP but also raises reflection, so central SBP and AIx rise more than MAP.',
      'Long-term vasodilators (ACEi, CCB) lower the starting MAP, so the same propofol fall reaches hypotension.'
    ],
    note: 'In this model, aortic stiffness does not change the MAP fall after propofol: MAP = CO × SVR, and neither depends on aortic PWV. The same patient with a compliant aorta falls from 88 to 62 mmHg too. Stiffness shows up as wider pulse pressure and higher central systolic pressure. The model has no mechanism by which a stiff aorta makes hypotension worse.'
  }
];

/** Answer order is shuffled with a fixed seed per case (stable and testable). */
export const CASES: CaseDef[] = RAW.map(c => shuffleQuestions(c));

export const CASE_BY_ID: Record<string, CaseDef> = Object.fromEntries(CASES.map(c => [c.id, c]));
