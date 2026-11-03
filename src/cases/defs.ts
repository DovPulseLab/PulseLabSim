/* The five guided cases. Numbers quoted in questions were computed with this model
   (they are approximate: the patient's state when you answer may differ). */
import { firstDoseAfterStart } from './engine';
import type { CaseDef, CaseSnapshot, GoalPart } from './types';

const f0 = (v: number) => v.toFixed(0);
const lt = (label: string, v: number, lim: number, unit: string): GoalPart => ({ label, ok: v < lim, value: `${f0(v)} ${unit}` });
const ge = (label: string, v: number, lim: number, unit: string): GoalPart => ({ label, ok: v >= lim, value: `${f0(v)} ${unit}` });
const given = (s: CaseSnapshot, drug: string, label: string): GoalPart => {
  const t = firstDoseAfterStart(s, drug);
  return { label, ok: t != null, value: t == null ? 'not yet' : `at ${f0(t - s.tStart)} s` };
};

export const CASES: CaseDef[] = [
  {
    id: 'athlete', title: 'Young athlete',
    summary: 'Why the cuff reads higher than the aorta, and when the echo arrives.',
    brief: 'A 20-year-old rower at rest. Heart rate 52, stroke volume 95 mL. The cuff reads about <b>117/65</b>, but central (aortic) pressure is only about <b>104/64</b>. The pressure wave is type C: AIx is negative.',
    setup: { preset: 'Young adult (20 y)', over: { hr: 52, sv: 95 }, pinStart: true },
    goal: {
      text: 'Make the reflected wave return during systole: AIx ≥ 10 % while central SBP stays ≤ 130 and MAP stays 65–105 mmHg.',
      holdS: 15,
      check: s => [
        ge('AIx ≥ 10 %', s.m.AIx, 10, '%'),
        { label: 'Central SBP ≤ 130', ok: s.m.Ps <= 130, value: `${f0(s.m.Ps)} mmHg` },
        { label: 'MAP 65–105', ok: s.m.map >= 65 && s.m.map <= 105, value: `${f0(s.m.map)} mmHg` }
      ]
    },
    hints: ['The echo returns after Δtp = 2 × reflection distance ÷ wave speed.', 'Try aortic PWV under Large arteries, or the reflection-site position under Periphery. Small steps: central SBP climbs fast.'],
    questions: [
      { q: 'The cuff reads about 117 systolic, but central systolic pressure is about 104. Why?',
        options: ['The cuff is inaccurate in athletes', 'The pulse is amplified as it travels out to the arm', 'Central pressure is measured in diastole', 'The slow heart rate lowers central pressure only'],
        correct: 1, explain: 'In young, compliant arteries the pulse grows as it travels to the arm (PP amplification ≈ 1.3 here), so the cuff overestimates central systolic pressure.' },
      { q: 'AIx is negative (a type C wave). What does that mean?',
        options: ['The reflected wave arrives after the systolic peak', 'There is no reflected wave', 'The left ventricle is failing', 'The aorta is stiff'],
        correct: 0, explain: 'The echo is there, but it returns late (Δtp ≈ 210 ms here), after the peak, so it adds to diastolic rather than systolic pressure.' },
      { q: 'Which single change brings the echo back during systole?',
        options: ['Raise stroke volume', 'Raise aortic PWV (stiffer aorta)', 'Widen the arterioles', 'Make the patient taller'],
        correct: 1, explain: 'A faster wave shortens Δtp. With aortic PWV around 7 m/s, the echo arrives in systole and AIx turns positive. Moving the reflection site closer works too.' }
    ],
    teaching: [
      'Young, compliant arteries return the echo late: AIx is negative and the wave is type C.',
      'Amplification is high in youth, so cuff SBP overestimates central SBP by 10–15 mmHg.',
      'As the aorta stiffens, the echo moves into systole. Central SBP rises more than cuff SBP, and amplification falls.',
      'MAP hardly changes when only stiffness changes: stiffness is a pulsatile load, not a steady one.'
    ]
  },
  {
    id: 'ish', showLowestMap: true, title: 'Elderly isolated systolic hypertension',
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
      { q: 'Why is central pulse pressure so wide here (about 81 mmHg)?',
        options: ['High peripheral resistance', 'Stiff aorta: a bigger forward wave plus an early echo that lands in systole', 'Fast heart rate', 'Low stroke volume'],
        correct: 1, explain: 'Stiffness raises the characteristic impedance (bigger forward wave) and shortens Δtp (echo in systole). Both widen PP; MAP is set by CO × SVR.' },
      { q: 'Which drug lowers central SBP with the smallest fall in MAP?',
        options: ['Nitroglycerin infusion', 'Esmolol', 'Phenylephrine', 'Dobutamine'],
        correct: 0, explain: 'At full effect NTG lowers central SBP by about 21 mmHg with MAP falling about 13. Esmolol lowers central SBP by a similar amount, but MAP falls about 20.' },
      { q: 'With NTG at full effect, what happens to AIx and amplification?',
        options: ['AIx falls, amplification rises', 'AIx rises, amplification falls', 'Both stay the same', 'Both fall'],
        correct: 0, explain: 'NTG weakens and delays reflection (lower Γ and muscular PWV): AIx about 65 → 36 %, amplification about 1.22 → 1.39.' }
    ],
    teaching: [
      'In isolated systolic hypertension, the problem is pulsatile load: a stiff aorta and early reflection.',
      'Drugs that reduce wave reflection (nitrates, ACEi/ARB, CCB) lower central SBP more per mmHg of MAP than drugs that only slow the heart.',
      'The cuff does not show this difference well. Central pressure and AIx do.',
      'Watch MAP: an older patient with a stiff aorta still needs adequate perfusion pressure.'
    ]
  },
  {
    id: 'ntg', title: 'Post-nitroglycerin',
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
      { q: 'Compared with the pre-NTG baseline, NTG lowered central SBP by about 22 mmHg but MAP by only about 13. Where does the extra central fall come from?',
        options: ['Less wave reflection: a smaller, later echo (AIx about 46 → 21 %)', 'A lower heart rate', 'A lower stroke volume alone', 'A higher SVR'],
        correct: 0, explain: 'NTG relaxes the muscular arteries: Γ and muscular PWV fall, so the echo is smaller and later. That lowers the late-systolic peak more than the mean.' },
      { q: 'A second NTG dose lowers central SBP by only about 2 mmHg more. Why?',
        options: ['Repeat doses of one drug saturate (Emax)', 'The first dose is wearing off', 'The baroreflex cancels it', 'The cuff is wrong'],
        correct: 0, explain: 'In this model, doses of one drug add into one exposure whose effect saturates at 120 % of a single dose. Adding a drug with a different action works better.' },
      { q: 'If you stop the NTG infusion, how fast does its effect wear off here?',
        options: ['Instantly', 'Over a few minutes (offset time constant 3 min)', 'Over days', 'It never wears off'],
        correct: 1, explain: 'NTG has a short half-life. The model uses an offset time constant of 180 s (illustrative).' }
    ],
    teaching: [
      'Nitrates lower central SBP and AIx much more than they lower MAP: they act mainly on wave reflection.',
      'Cuff SBP understates the central benefit. Amplification rises (about 1.18 → 1.35).',
      'Repeat doses of one drug saturate. Combining mechanisms gives more effect.',
      'Effects of short-acting infusions fade within minutes of stopping them.'
    ]
  },
  {
    id: 'bb', title: 'Beta-blockade',
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
        options: ['It rose slightly', 'It fell sharply', 'It became negative', 'Esmolol removed the echo'],
        correct: 0, explain: 'Slower HR lengthens ejection (about 287 → 318 ms), so the early echo adds to more of systole. AIx rises a little (about 46 → 47 %).' },
      { q: 'Did central SBP fall more or less than cuff SBP?',
        options: ['Less: about −22 vs −25 mmHg', 'More', 'Exactly the same', 'Central SBP rose'],
        correct: 0, explain: 'β-blockade lowers brachial pressure more than central pressure (Townsend et al. 2015, Table 1): the reflected wave is unchanged and lasts longer in systole.' },
      { q: 'MAP fell less than the heart-rate fall alone would suggest. Why, in this model?',
        options: ['Stroke volume rises a little with the longer filling time (illustrative rule)', 'SVR rose', 'The aorta stiffened', 'Esmolol is a vasodilator'],
        correct: 0, explain: 'When an acute drug slows the heart, the model raises SV by (HR before / HR after)^0.5, a simple stand-in for longer filling. See Methods.' }
    ],
    teaching: [
      'Slowing the heart does not reduce wave reflection; it gives the early echo more systole to act on.',
      'β-blockers lower cuff pressure more than central pressure, so the cuff overstates their central benefit.',
      'AIx is heart-rate dependent: compare AIx@75 when heart rates differ.',
      'MAP falls with cardiac output; in this model a small, illustrative SV rise partly offsets the HR fall.'
    ]
  },
  {
    id: 'induction', showLowestMap: true, title: 'Stiff aorta before induction',
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
      { q: 'Before induction, central PP is about 56 mmHg and AIx about 43 %. What does the stiff aorta mainly change?',
        options: ['Pulse pressure and central systolic pressure', 'Mean arterial pressure', 'Heart rate', 'Cardiac output'],
        correct: 0, explain: 'Stiffness is a pulsatile load: it widens PP and raises central SBP through a bigger forward wave and an early echo. MAP is set by CO × SVR.' },
      { q: 'Propofol lowers MAP here by about 29 % (88 → 62 mmHg). In this model, how would the fall differ if the aorta were compliant?',
        options: ['About the same: MAP = CO × SVR does not depend on aortic stiffness here', 'Much smaller', 'Much larger', 'MAP would rise'],
        correct: 0, explain: 'The same patient with aortic PWV 7.5 m/s also falls from 88 to 62 mmHg. What differs is pulse pressure (about 40 → 26 instead of 56 → 37) and central SBP.' },
      { q: 'After phenylephrine, central SBP rises more than MAP (e.g. +24 vs +17 mmHg). Why?',
        options: ['It increases wave reflection (Γ, muscular PWV) as well as resistance', 'It raises heart rate', 'It increases stroke volume', 'It dilates the aorta'],
        correct: 0, explain: 'Phenylephrine constricts muscular arteries as well as arterioles: the echo gets bigger and earlier, so AIx rises (about 37 → 52 %) and central SBP climbs more than MAP.' }
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

export const CASE_BY_ID: Record<string, CaseDef> = Object.fromEntries(CASES.map(c => [c.id, c]));
