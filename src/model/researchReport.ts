/* =====================================================================
   Research report: reads the sheets of a Research workbook (from a run just
   made, or an uploaded .xlsx) and works out what the report shows: run
   details, trends with heart rate and age, flags, and one data block per
   patient and mode. Pure: no DOM. Works from the sheets alone, so an
   uploaded workbook and a fresh run give the same report.
   ===================================================================== */
import type { Cell, Sheet } from '../state/xlsx';

export type Row = Record<string, number | string>;

export interface ReportPatient {
  id: string; sex: string; age: number;
  profile: Record<string, number | string>;   // Patient profiles sheet, by measure name
}

export interface Trend {
  key: string; label: string; unit: string;
  mode: string;
  /** per patient: slope per 10 bpm, r², value at the lowest and highest heart rate */
  per: { patient: string; slope10: number; r2: number; lo: number; hi: number; hrLo: number; hrHi: number }[];
}

export interface Fit { patient: string; mode: string; hr: number | string; ees: number; v0: number; r2: number; eesInput: number; pesFall: number; }

export interface ResearchReport {
  meta: Record<string, string>;      // README rows
  heartModel: 'v3' | 'v2';
  units: Record<string, string>;
  rows: Row[];                       // Results sheet, one object per row
  patients: ReportPatient[];
  modes: string[];
  hrs: number[];
  trends: Trend[];
  findings: string[];
  flags: string[];
  fits: Fit[];
}

/** Measures reported, in display order: key in Results, label, decimals. */
export const REPORT_MEASURES: { key: string; label: string; dp: number; lv?: boolean }[] = [
  { key: 'cuff_SBP', label: 'Cuff SBP', dp: 0 }, { key: 'cuff_DBP', label: 'Cuff DBP', dp: 0 },
  { key: 'central_SBP', label: 'Central SBP', dp: 0 }, { key: 'central_DBP', label: 'Central DBP', dp: 0 },
  { key: 'central_PP', label: 'Central PP', dp: 0 }, { key: 'augmentation_pressure_AP', label: 'Augmentation pressure', dp: 1 },
  { key: 'AIx', label: 'AIx', dp: 1 }, { key: 'MAP', label: 'MAP', dp: 0 },
  { key: 'tau_RC', label: 'τ = R·C', dp: 2 }, { key: 'ejection_duration', label: 'Ejection duration', dp: 0 },
  { key: 'stroke_volume', label: 'Stroke volume', dp: 0 }, { key: 'cardiac_output', label: 'Cardiac output', dp: 2 },
  { key: 'SVR', label: 'SVR', dp: 0 },
  { key: 'EF', label: 'Ejection fraction', dp: 0, lv: true }, { key: 'LV_dPdt_max', label: 'LV dP/dt max', dp: 0, lv: true },
  { key: 'LVEDP', label: 'LVEDP', dp: 1, lv: true }, { key: 'LVESP', label: 'LVESP', dp: 0, lv: true },
  { key: 'EDV', label: 'EDV', dp: 0, lv: true }, { key: 'ESV', label: 'ESV', dp: 0, lv: true },
  { key: 'VCO_Ees', label: 'Fitted Ees (occlusion)', dp: 2, lv: true }
];

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (c: Cell) => (c == null ? '' : String(c)).trim();
const fmt = (v: number, dp = 1) => (Math.abs(v) < 0.5 * 10 ** -dp ? 0 : v).toFixed(dp);
const sign = (v: number, dp = 1) => (v > 0 ? '+' : v < 0 ? '−' : '±') + fmt(Math.abs(v), dp);

export function linReg(x: number[], y: number[]): { slope: number; r2: number } {
  const n = x.length; if (n < 2) return { slope: NaN, r2: NaN };
  const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return { slope: sxy / sxx, r2: syy > 0 ? (sxy * sxy) / (sxx * syy) : 1 };
}

function sheet(sheets: Sheet[], name: string): Sheet | undefined {
  return sheets.find(s => s.name.toLowerCase() === name.toLowerCase());
}

/** Build the report from a Research workbook's sheets. Throws if it is not one. */
export function buildReport(sheets: Sheet[]): ResearchReport {
  const res = sheet(sheets, 'Results');
  if (!res || res.rows.length < 3) throw new Error('this is not a Pulse Lab Research workbook (no Results sheet)');
  const head = res.rows[0].map(str), unitRow = res.rows[1].map(str);
  for (const need of ['patient', 'mode', 'heart_rate']) if (!head.includes(need)) throw new Error(`the Results sheet has no "${need}" column`);
  const units: Record<string, string> = {};
  head.forEach((h, i) => { if (h) units[h] = unitRow[i] ?? ''; });
  const rows: Row[] = res.rows.slice(2).filter(r => r.some(c => c != null && c !== '')).map(r => {
    const o: Row = {};
    head.forEach((h, i) => { if (!h) return; const c = r[i]; if (c == null || c === '') return; o[h] = typeof c === 'number' ? c : Number.isFinite(Number(c)) && String(c).trim() !== '' && !/[a-z]/i.test(String(c)) ? Number(c) : String(c); });
    return o;
  }).filter(o => o.patient != null && isNum(o.heart_rate));

  const meta: Record<string, string> = {};
  for (const r of sheet(sheets, 'README')?.rows ?? []) { const k = str(r[0]); if (k) meta[k] = str(r[1]); }

  // patient profiles: first row = Measure, Unit, ids…
  const prof = sheet(sheets, 'Patient profiles');
  const profiles: Record<string, Record<string, number | string>> = {};
  if (prof && prof.rows.length) {
    const ids = prof.rows[0].slice(2).map(str);
    for (const r of prof.rows.slice(1)) {
      const m = str(r[0]); if (!m) continue;
      ids.forEach((id, j) => { if (!id) return; (profiles[id] ??= {})[m] = (r[j + 2] ?? '') as number | string; });
    }
  }
  const ids = [...new Set(rows.map(r => String(r.patient)))];
  const patients: ReportPatient[] = ids.map(id => {
    const r = rows.find(x => x.patient === id)!;
    return { id, sex: String(r.sex ?? profiles[id]?.Sex ?? ''), age: Number(r.age ?? profiles[id]?.Age ?? NaN), profile: profiles[id] ?? {} };
  }).sort((a, b) => a.sex.localeCompare(b.sex) || a.age - b.age);
  const modes = [...new Set(rows.map(r => String(r.mode)))];
  const hrs = [...new Set(rows.map(r => r.heart_rate as number))].sort((a, b) => a - b);
  const heartModel: 'v3' | 'v2' = rows.some(r => isNum(r.EF)) ? 'v3' : 'v2';

  // trends with heart rate, per mode and patient
  const trends: Trend[] = [];
  for (const mode of modes) for (const m of REPORT_MEASURES) {
    if (!head.includes(m.key)) continue;
    const per: Trend['per'] = [];
    for (const p of patients) {
      const pts = rows.filter(r => r.patient === p.id && r.mode === mode && isNum(r[m.key])).sort((a, b) => (a.heart_rate as number) - (b.heart_rate as number));
      if (pts.length < 2) continue;
      const x = pts.map(r => r.heart_rate as number), y = pts.map(r => r[m.key] as number), f = linReg(x, y);
      per.push({ patient: p.id, slope10: f.slope * 10, r2: f.r2, lo: y[0], hi: y[y.length - 1], hrLo: x[0], hrHi: x[x.length - 1] });
    }
    if (per.length) trends.push({ key: m.key, label: m.label, unit: units[m.key] ?? '', mode, per });
  }

  // occlusion fits
  const fits: Fit[] = [];
  const fs = sheet(sheets, 'Occlusion fits');
  if (fs && fs.rows.length > 2) {
    const h = fs.rows[0].map(str), ix = (k: string) => h.indexOf(k);
    for (const r of fs.rows.slice(2)) {
      if (r[ix('patient')] == null) continue;
      fits.push({ patient: str(r[ix('patient')]), mode: str(r[ix('mode')]), hr: r[ix('heart_rate')] as number, ees: Number(r[ix('Ees_fitted')]), v0: Number(r[ix('V0_fitted')]),
        r2: Number(r[ix('r2')]), eesInput: Number(r[ix('Ees_input')]), pesFall: Number(r[ix('Pes_fall')]) });
    }
  }

  const rep: ResearchReport = { meta, heartModel, units, rows, patients, modes, hrs, trends, findings: [], flags: [], fits };
  rep.findings = findings(rep);
  rep.flags = flags(rep);
  return rep;
}

const trend = (r: ResearchReport, key: string, mode: string) => r.trends.find(t => t.key === key && t.mode === mode);
const range = (v: number[], dp: number) => { const a = Math.min(...v), b = Math.max(...v); return Math.abs(a - b) < 10 ** -dp ? sign(a, dp) : `${sign(a, dp)} to ${sign(b, dp)}`; };
const plab = (r: ResearchReport, id: string) => { const p = r.patients.find(x => x.id === id)!; return `${p.sex === 'female' ? 'woman' : 'man'} aged ${p.age}`; };
const valAt = (r: ResearchReport, id: string, mode: string, hr: number, key: string) => r.rows.find(x => x.patient === id && x.mode === mode && x.heart_rate === hr)?.[key];

/** Plain-language key findings, generated from the data. */
function findings(r: ResearchReport): string[] {
  const out: string[] = [];
  const mode = r.modes.includes('Pacing') ? 'Pacing' : r.modes[0];
  const lo = r.hrs[0], hi = r.hrs[r.hrs.length - 1];
  const n = r.patients.length;
  out.push(`${n} simulated healthy ${n === 1 ? 'adult' : 'adults'} (${r.patients.map(p => p.id).join(', ')}) were run at ${r.hrs.length} heart rates from ${lo} to ${hi} bpm in ${r.modes.length === 1 ? `${mode} mode` : `${r.modes.length} modes (${r.modes.join(', ')})`}, with the ${r.heartModel === 'v3' ? 'Ventricle (v3)' : 'Fixed flow (v2)'} heart. Trends below are for ${mode} mode, as change per 10 bpm (least-squares slope).`);
  const say = (key: string, what: string, dp: number, unit: string) => {
    const t = trend(r, key, mode); if (!t) return;
    const s = t.per.map(p => p.slope10), first = t.per[0], last = t.per[t.per.length - 1];
    const dir = s.every(v => v < 0) ? 'fell' : s.every(v => v > 0) ? 'rose' : 'changed';
    out.push(`**${what}** ${dir} with heart rate in every patient: ${range(s, dp)} ${unit} per 10 bpm (r² ≥ ${Math.min(...t.per.map(p => p.r2)).toFixed(2)}). ` +
      (t.per.length > 1 ? `In the ${plab(r, first.patient)} it went from ${fmt(first.lo, dp)} to ${fmt(first.hi, dp)} ${unit}; in the ${plab(r, last.patient)} from ${fmt(last.lo, dp)} to ${fmt(last.hi, dp)} ${unit}.`
        : `It went from ${fmt(first.lo, dp)} to ${fmt(first.hi, dp)} ${unit}.`));
  };
  say('AIx', 'Augmentation index', 1, '%-points');
  say('central_PP', 'Central pulse pressure', 1, 'mmHg');
  say('MAP', 'Mean arterial pressure', 1, 'mmHg');
  if (r.heartModel === 'v3') { say('EF', 'Ejection fraction', 1, '%-points'); say('LVEDP', 'LVEDP', 1, 'mmHg'); say('LV_dPdt_max', 'LV dP/dt max', 0, 'mmHg/s'); }
  // cardiac output stays flat in Pacing: say it is the mode's assumption
  const co = trend(r, 'cardiac_output', mode);
  if (co && mode === 'Pacing' && co.per.every(p => Math.abs(p.slope10) < 0.1)) out.push(`Cardiac output stayed nearly constant (${range(co.per.map(p => p.slope10), 2)} L/min per 10 bpm). This is how Pacing mode is defined (pacing changes heart rate at almost constant output), not a result of the model.`);
  // amplification
  const amp = r.patients.map(p => { const c = valAt(r, p.id, mode, lo, 'cuff_SBP'), cd = valAt(r, p.id, mode, lo, 'cuff_DBP'), pp = valAt(r, p.id, mode, lo, 'central_PP'); return isNum(c) && isNum(cd) && isNum(pp) ? (c - cd) / pp : NaN; });
  if (amp.some(Number.isFinite) && r.patients.length > 1) {
    const ok = amp.map((a, i) => ({ a, p: r.patients[i] })).filter(x => Number.isFinite(x.a));
    const first = ok[0], last = ok[ok.length - 1];
    const tail = first.p.sex === last.p.sex && last.p.age > first.p.age
      ? (last.a < first.a ? ': lower in older patients, so the cuff overstates central pulse pressure less with age.' : ': not lower in older patients here.') : '.';
    out.push(`Pulse-pressure amplification (cuff PP ÷ central PP) at ${lo} bpm was ${ok.map(x => `${x.a.toFixed(2)} (${x.p.id})`).join(', ')}${tail}`);
  }
  // age at resting heart rate
  if (r.patients.length > 1) {
    const rest = Number(r.meta['Resting heart rate']?.match(/\d+/)?.[0]) || r.hrs[Math.floor(r.hrs.length / 2)];
    const hrRef = r.hrs.reduce((a, b) => (Math.abs(b - rest) < Math.abs(a - rest) ? b : a));
    const bySex = new Map<string, ReportPatient[]>(); for (const p of r.patients) bySex.set(p.sex, [...(bySex.get(p.sex) ?? []), p]);
    for (const [sex, ps] of bySex) {
      if (ps.length < 2) continue;
      const a = ps[0], b = ps[ps.length - 1];
      const parts = [['central_PP', 'central PP', 0, ' mmHg'], ['AIx', 'AIx', 0, ' %'], ['central_SBP', 'central SBP', 0, ' mmHg']].flatMap(([k, l, dp, u]) => {
        const x = valAt(r, a.id, mode, hrRef, k as string), y = valAt(r, b.id, mode, hrRef, k as string);
        return isNum(x) && isNum(y) ? [`${l} ${fmt(x, dp as number)} → ${fmt(y, dp as number)}${u}`] : [];
      });
      const pw = (p: ReportPatient) => Number(p.profile['Aortic PWV at rest (operating)']);
      if (Number.isFinite(pw(a)) && Number.isFinite(pw(b))) parts.push(`aortic PWV ${pw(a).toFixed(1)} → ${pw(b).toFixed(1)} m/s`);
      if (parts.length) out.push(`**Age effect** (${sex === 'female' ? 'women' : 'men'}, ${a.age} → ${b.age} y, at ${hrRef} bpm): ${parts.join('; ')}.`);
    }
  }
  // literature context for the AIx–heart rate relation
  const ai = trend(r, 'AIx', mode);
  if (ai && mode === 'Pacing') {
    const mean = ai.per.reduce((s, p) => s + p.slope10, 0) / ai.per.length;
    out.push(`For reference, incremental pacing (60–110 bpm) in 22 adults with permanent pacemakers (mean age 63) lowered AIx by about 4 %-points per 10 bpm (Wilkinson et al., J Physiol 2000;525:263–270). The model's mean here is ${sign(mean, 1)} %-points per 10 bpm.`);
  }
  // mode comparison
  if (r.modes.length > 1) {
    const diffs = r.modes.filter(m => m !== mode).map(m => {
      const d = r.patients.map(p => { const a = valAt(r, p.id, m, hi, 'MAP'), b = valAt(r, p.id, mode, hi, 'MAP'); return isNum(a) && isNum(b) ? a - b : NaN; }).filter(Number.isFinite);
      return d.length ? `${m} ${range(d, 1)} mmHg` : '';
    }).filter(Boolean);
    if (diffs.length) out.push(`**Modes:** at ${hi} bpm, MAP compared with ${mode}: ${diffs.join('; ')}.`);
  }
  if (r.fits.length) {
    const rest = r.fits.filter(f => f.mode === 'Rest');
    const use = rest.length ? rest : r.fits;
    out.push(`**Vena caval occlusion:** fitted ESPVR slope (Ees) ${use.map(f => `${f.ees.toFixed(2)} (${f.patient}${rest.length ? '' : ` ${f.mode} ${f.hr}`})`).join(', ')} mmHg/mL, r² ≥ ${Math.min(...use.map(f => f.r2)).toFixed(3)}; model input ${[...new Set(use.map(f => f.eesInput.toFixed(2)))].join(', ')}. The fitted value is lower because LV pressure dips with outflow (ejection effect).`);
  }
  return out;
}

/** Results that deserve a second look before the data are used. */
function flags(r: ResearchReport): string[] {
  const out: string[] = [];
  const at = (k: string, test: (v: number) => boolean) => r.rows.filter(x => isNum(x[k]) && test(x[k] as number));
  const list = (rs: Row[]) => { const g = new Map<string, number[]>(); for (const x of rs) g.set(`${x.patient} ${x.mode}`, [...(g.get(`${x.patient} ${x.mode}`) ?? []), x.heart_rate as number]); return [...g].map(([k, h]) => `${k} (${h.join(', ')} bpm)`).join('; '); };
  const hiEdp = at('LVEDP', v => v > 15); if (hiEdp.length) out.push(`LVEDP above 15 mmHg, high for a healthy heart at rest: ${list(hiEdp)}.`);
  const ef = at('EF', v => v > 75 || v < 50); if (ef.length) out.push(`Ejection fraction outside 50–75 %: ${list(ef)}.`);
  const map = at('MAP', v => v < 65 || v > 110); if (map.length) out.push(`MAP outside 65–110 mmHg: ${list(map)}.`);
  const lim = r.rows.filter(x => typeof x.inputs_at_slider_limit === 'string' && x.inputs_at_slider_limit !== '');
  if (lim.length) {
    const NAMES: Record<string, string> = { gamma: 'the reflection coefficient Γ', radius: 'arteriolar radius', pwvAo: 'aortic PWV', pwvM: 'muscular-artery PWV', sv: 'stroke volume', hr: 'heart rate', ejDur: 'ejection duration', preload: 'preload', ees: 'contractility (Ees)' };
    const what = [...new Set(lim.flatMap(x => String(x.inputs_at_slider_limit).split(/[\s,;]+/).filter(Boolean)))].map(k => NAMES[k] ?? k).join(', ');
    out.push(`The response mode pushed ${what || 'an input'} to its slider limit, so the mode's rule could not be followed fully: ${list(lim)}.`);
  }
  for (const t of r.trends.filter(t => t.key === 'EF')) {
    const big = t.per.filter(p => p.lo - p.hi > 10); if (!big.length) continue;
    const d = big.map(p => p.lo - p.hi);
    out.push(`EF fell ${Math.round(Math.min(...d))}${Math.round(Math.max(...d)) !== Math.round(Math.min(...d)) ? `–${Math.round(Math.max(...d))}` : ''} points from ${big[0].hrLo} to ${big[0].hrHi} bpm (${t.mode}: ${big.map(p => p.patient).join(', ')}); paced hearts usually keep EF steadier.`);
  }
  if (r.patients.length > 1) {
    const efs = r.patients.map(p => ({ p, v: r.rows.find(x => x.patient === p.id && x.mode === r.modes[0] && x.heart_rate === r.hrs[0])?.EF })).filter(x => isNum(x.v));
    for (const sex of new Set(efs.map(x => x.p.sex))) {
      const s = efs.filter(x => x.p.sex === sex); if (s.length < 2) continue;
      const a = s[0], b = s[s.length - 1];
      if ((b.v as number) - (a.v as number) > 5) out.push(`EF rises with age (${a.p.id} ${fmt(a.v as number, 0)} % → ${b.p.id} ${fmt(b.v as number, 0)} % at ${r.hrs[0]} bpm); in population data EF changes little with age.`);
    }
  }
  return out;
}
