/* Research tab: run healthy patients across a heart-rate grid in each response mode and
   download the results as an Excel workbook. Runs in small steps so the page stays responsive. */
import { ID_COLUMNS, OUTPUT_LABELS, RESEARCH_AGES, RESEARCH_MODES, researchRuns, type ResearchOptions, type ResearchPatient, type ResearchRun } from '../../model/research';
import { researchWorkbook } from '../../state/researchWorkbook';
import { writeXlsx, XLSX_MIME } from '../../state/xlsx';
import type { Ctx } from '../context';
import { $, $$, download, toast } from '../dom';

const RATES = [200, 250, 500, 1000];
let running = false;

const seg = (id: string, items: [string, string][], on: string) =>
  `<div class="seg" role="group" id="${id}">${items.map(([v, l]) => `<button data-v="${v}" aria-pressed="${v === on}">${l}</button>`).join('')}</div>`;

export function buildResearch(_ctx: Ctx): void {
  $('#pane-research').innerHTML = `
  <div class="card prose" style="max-width:none">
    <h2>Research generator <span class="muted">run healthy patients across heart rates and export to Excel</span></h2>
    <p>Tick what you want in the report. Each patient is a healthy adult of the chosen sex and age, calibrated from the same reference data as the presets (aortic diameter, PWV, stroke volume, SVR, and with the ventricle, contractility). Every patient is run at every heart rate in each chosen mode, with no drugs. The workbook has a <b>Results</b> sheet (one row per patient × mode × heart rate), a <b>Patient profiles</b> sheet (values at rest), one <b>waveform</b> sheet per patient (aortic pressure and flow, synchronized, at the chosen sampling rate), and a README.</p>
    <div class="rs-grid">
      <label>Sex</label><div id="rsSexes"><label class="chk"><input type="checkbox" value="0" checked> Men</label><label class="chk"><input type="checkbox" value="1"> Women</label> <span class="muted">(both = each age for each sex)</span></div>
      <label>Ages (y)</label><div id="rsAges">${RESEARCH_AGES.map((a, i) => `<label class="chk"><input type="checkbox" data-slot="${i}" checked> <input type="number" class="rs-age" data-slot="${i}" value="${a}" min="18" max="90" step="1" aria-label="Age ${i + 1}"></label>`).join('')}<span class="muted">up to four; untick to leave one out</span></div>
      <label>Heart rates (bpm)</label><div>from <input type="number" id="rsHr0" value="60" min="40" max="180" step="5"> to <input type="number" id="rsHr1" value="120" min="40" max="180" step="5"> every <input type="number" id="rsHrStep" value="10" min="1" max="50" step="1"></div>
      <label>Modes</label><div id="rsModes">${RESEARCH_MODES.map(m => `<label class="chk"><input type="checkbox" value="${m.resp}" checked> ${m.label}</label>`).join('')}</div>
      <label>Heart model</label>${seg('rsHeart', [['1', 'Ventricle (v3)'], ['0', 'Fixed flow (v2)']], '1')}
      <label>Resting heart rate</label><div><input type="number" id="rsRest" value="70" min="40" max="120" step="1"> bpm <span class="muted">(profile values are at this rate; Pacing is anchored to it)</span></div>
      <label>Sheets</label><div><label class="chk"><input type="checkbox" id="rsProfiles" checked> Patient profiles</label><label class="chk"><input type="checkbox" id="rsWaves" checked> Waveforms (aortic pressure and flow)</label> at <select id="rsFs">${RATES.map(r => `<option value="${r}"${r === 250 ? ' selected' : ''}>${r} Hz</option>`).join('')}</select></div>
      <label>Report columns</label><div><div id="rsCols">${Object.entries(OUTPUT_LABELS).map(([k, l]) => `<label class="chk"><input type="checkbox" value="${k}" checked> ${l}</label>`).join('')}</div>
        <button class="btn sm" id="rsAll">All</button> <button class="btn sm" id="rsNone">None</button> <span class="muted">patient, sex, age, mode and heart rate are always included</span></div>
    </div>
    <p><button class="btn" id="rsRun">Run and download Excel</button> <span id="rsStatus" class="muted" aria-live="polite"></span></p>
    <div class="rs-bar" id="rsBar" hidden><div id="rsBarFill"></div></div>
    <p class="fine">Physiologic adds only baroreflex buffering of drug effects to the Pacing relation, so with no drugs it gives the same numbers as Pacing. EF, dP/dt max, LVEDP and LVESP need the Ventricle (v3) heart model; with Fixed flow those columns are blank. Ages below 25 y use the 25-year-old reference data. Higher sampling rates make larger files (1000 Hz ≈ 4 × the size of 250 Hz). Educational model output, not patient data.</p>
    <div id="rsSummary"></div>
  </div>`;

  $('#rsAll').addEventListener('click', () => $$<HTMLInputElement>('#rsCols input').forEach(i => { i.checked = true; }));
  $('#rsNone').addEventListener('click', () => $$<HTMLInputElement>('#rsCols input').forEach(i => { i.checked = false; }));
  for (const id of ['#rsHeart']) $(id).addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-v]'); if (!b) return;
    $$(`${id} button`).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  });
  $('#rsRun').addEventListener('click', () => { void run(); });
}

const pressed = (id: string) => Number($(`${id} button[aria-pressed="true"]`).dataset.v);
const checked = (id: string) => $$<HTMLInputElement>(`${id} input:checked`).map(i => Number(i.value));
const checked2 = (id: string) => $$<HTMLInputElement>(`${id} input:checked`).map(i => i.value);

export function readResearchOptions(): ResearchOptions | string {
  const sexes = checked('#rsSexes'), modes = checked('#rsModes');
  const ages = $$<HTMLInputElement>('#rsAges input[type=checkbox]:checked').map(c => Number($<HTMLInputElement>(`#rsAges input.rs-age[data-slot="${c.dataset.slot}"]`).value));
  if (!sexes.length) return 'choose men, women or both';
  if (ages.some(a => !Number.isFinite(a) || a < 18 || a > 90)) return 'ages must be 18–90 y';
  if (new Set(ages).size !== ages.length) return 'the ticked ages must differ';
  const h0 = Number(($('#rsHr0') as HTMLInputElement).value), h1 = Number(($('#rsHr1') as HTMLInputElement).value), st = Number(($('#rsHrStep') as HTMLInputElement).value);
  const rest = Number(($('#rsRest') as HTMLInputElement).value);
  if (!ages.length) return 'choose at least one age';
  if (!modes.length) return 'choose at least one mode';
  if (![h0, h1, st, rest].every(Number.isFinite) || st <= 0 || h1 < h0 || h0 < 40 || h1 > 180) return 'heart rates must run from 40 to 180 bpm with a positive step';
  if (rest < 40 || rest > 120) return 'resting heart rate must be 40–120 bpm';
  const hrs: number[] = []; for (let h = h0; h <= h1 + 1e-9; h += st) hrs.push(Math.round(h * 10) / 10);
  if (hrs.length > 40) return 'at most 40 heart rates per run';
  return { sexes, ages, hrs, modes, heart: pressed('#rsHeart'), hrRest: rest };
}

async function run(): Promise<void> {
  if (running) return;
  const o = readResearchOptions();
  if (typeof o === 'string') { toast(`Research run: ${o}.`, 'err'); return; }
  running = true;
  const btn = $<HTMLButtonElement>('#rsRun'); btn.disabled = true;
  $('#rsBar').hidden = false;
  const fill = $('#rsBarFill'), status = $('#rsStatus');
  const patients: ResearchPatient[] = [], runs: ResearchRun[] = [];
  const t0 = performance.now();
  try {
    let last = 0;
    for (const s of researchRuns(o)) {
      if (s.patient) patients.push(s.patient);
      if (s.run) runs.push(s.run);
      fill.style.width = `${(100 * s.done / s.total).toFixed(1)}%`;
      status.textContent = `Running ${s.done} / ${s.total}…`;
      if (performance.now() - last > 40) { await new Promise(r => setTimeout(r, 0)); last = performance.now(); }
    }
    status.textContent = 'Building workbook…';
    await new Promise(r => setTimeout(r, 0));
    const fs = Number(($('#rsFs') as HTMLSelectElement).value);
    const sheets = researchWorkbook(patients, runs, {
      fs, created: new Date().toISOString(), version: 'v3', options: o,
      columns: checked2('#rsCols'), profiles: ($('#rsProfiles') as HTMLInputElement).checked, waveforms: ($('#rsWaves') as HTMLInputElement).checked
    });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    download(`pulse-lab-research-${o.sexes.length > 1 ? 'men-women' : o.sexes[0] ? 'women' : 'men'}-${stamp}.xlsx`, new Blob([writeXlsx(sheets)], { type: XLSX_MIME }), XLSX_MIME);
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    status.textContent = `Done: ${runs.length} runs in ${secs} s. Workbook downloaded.`;
    summary(patients, runs);
  } catch (err) {
    status.textContent = '';
    toast(`Research run failed: ${(err as Error).message}`, 'err', 8000);
  } finally {
    running = false; btn.disabled = false; $('#rsBar').hidden = true; fill.style.width = '0';
  }
}

/** Small on-page check of the run: cuff BP and EF at each heart rate, first mode. */
function summary(patients: ResearchPatient[], runs: ResearchRun[]): void {
  const mode = runs[0]?.mode; if (!mode) { $('#rsSummary').innerHTML = ''; return; }
  const hrs = [...new Set(runs.map(r => r.hr))];
  const cell = (pid: string, hr: number) => {
    const r = runs.find(x => x.patient === pid && x.mode === mode && x.hr === hr); if (!r) return '—';
    const m = r.beat.m;
    return `${m.bSBP.toFixed(0)}/${m.bDBP.toFixed(0)}${Number.isFinite(m.ef) ? ` · ${m.ef.toFixed(0)} %` : ''}`;
  };
  $('#rsSummary').innerHTML = `<h3>Quick look: cuff BP${runs[0].beat.lv ? ' · EF' : ''}, ${mode} mode</h3>
    <div class="table-wrap"><table class="vt"><tr><th>Patient</th>${hrs.map(h => `<th>${h} bpm</th>`).join('')}</tr>
    ${patients.map(p => `<tr><td>${p.label}</td>${hrs.map(h => `<td class="n">${cell(p.id, h)}</td>`).join('')}</tr>`).join('')}</table></div>
    <p class="fine">Everything else is in the workbook.</p>`;
}
