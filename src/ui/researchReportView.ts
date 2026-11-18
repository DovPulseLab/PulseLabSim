/* Research report view: renders a ResearchReport as print-ready pages (US letter, landscape)
   in a full-screen overlay. "Save as PDF" uses the browser's print dialog, with print CSS
   that shows only the report. Charts are inline SVG so they stay sharp in the PDF. */
import { REPORT_MEASURES, type ResearchReport, type Row } from '../model/researchReport';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const md = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const f = (v: unknown, dp: number) => (isNum(v) ? (Math.abs(v) < 0.5 * 10 ** -dp ? 0 : v).toFixed(dp) : '—');
const sgn = (v: number, dp: number) => (!isNum(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(dp));

/** Ordinal colours, young → old (colour-blind safe, print safe). */
const AGE_COLORS = ['#2166ac', '#1b9e77', '#d95f02', '#b2182b', '#7570b3', '#666666'];

function niceTicks(lo: number, hi: number, n = 5): number[] {
  if (!(hi > lo)) { hi = lo + 1; lo -= 1; }
  const raw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map(k => k * mag).find(s => s >= raw)!;
  const out: number[] = []; for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

interface Line { x: number[]; y: number[]; color: string; dash?: boolean; label: string; }

/** Small SVG line chart with axes, gridlines and point markers. */
function svgChart(title: string, unit: string, lines: Line[], xLabel = 'Heart rate (bpm)', w = 236, h = 158): string {
  const L = 40, R = 8, T = 22, B = 30, pw = w - L - R, ph = h - T - B;
  const xs = lines.flatMap(l => l.x), ys = lines.flatMap(l => l.y).filter(isNum);
  if (!ys.length) return '';
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys); const pad = (y1 - y0) * 0.12 || Math.abs(y1) * 0.05 || 1; y0 -= pad; y1 += pad;
  const yt = niceTicks(y0, y1, 4); y0 = Math.min(y0, yt[0]); y1 = Math.max(y1, yt[yt.length - 1]);
  const xt = niceTicks(x0, x1, 5).filter(v => v >= x0 - 1e-9 && v <= x1 + 1e-9);
  const X = (v: number) => L + (x1 > x0 ? (v - x0) / (x1 - x0) : 0.5) * pw, Y = (v: number) => T + (1 - (v - y0) / (y1 - y0)) * ph;
  const ydp = Math.max(0, -Math.floor(Math.log10(Math.max(1e-9, (yt[1] ?? 1) - (yt[0] ?? 0)))));
  let s = `<svg viewBox="0 0 ${w} ${h}" width="100%" class="rp-chart" role="img" aria-label="${esc(title)}">`;
  s += `<text x="${L - 34}" y="13" class="rp-ct">${esc(title)}${unit ? ` <tspan class="rp-cu">(${esc(unit)})</tspan>` : ''}</text>`;
  for (const v of yt) s += `<line x1="${L}" x2="${L + pw}" y1="${Y(v)}" y2="${Y(v)}" class="rp-grid"/><text x="${L - 5}" y="${Y(v) + 3}" class="rp-tick" text-anchor="end">${v.toFixed(ydp)}</text>`;
  for (const v of xt) s += `<text x="${X(v)}" y="${T + ph + 12}" class="rp-tick" text-anchor="middle">${v}</text>`;
  s += `<line x1="${L}" x2="${L + pw}" y1="${T + ph}" y2="${T + ph}" class="rp-axis"/><line x1="${L}" x2="${L}" y1="${T}" y2="${T + ph}" class="rp-axis"/>`;
  s += `<text x="${L + pw / 2}" y="${h - 3}" class="rp-tick" text-anchor="middle">${esc(xLabel)}</text>`;
  for (const l of lines) {
    const pts = l.x.map((x, i) => [x, l.y[i]] as const).filter(([, y]) => isNum(y));
    if (!pts.length) continue;
    s += `<polyline fill="none" stroke="${l.color}" stroke-width="1.6"${l.dash ? ' stroke-dasharray="4 3"' : ''} points="${pts.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' ')}"/>`;
    for (const [x, y] of pts) s += `<circle cx="${X(x).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="1.9" fill="${l.dash ? '#fff' : l.color}" stroke="${l.color}" stroke-width="1"/>`;
  }
  return s + '</svg>';
}

function legend(r: ResearchReport, color: (id: string) => string): string {
  return `<div class="rp-legend">${r.patients.map(p => `<span><svg width="22" height="8"><line x1="1" x2="21" y1="4" y2="4" stroke="${color(p.id)}" stroke-width="2"${p.sex === 'female' ? ' stroke-dasharray="4 3"' : ''}/></svg>${esc(p.id)} · ${p.sex === 'female' ? 'woman' : 'man'}, ${p.age} y</span>`).join('')}</div>`;
}

const page = (body: string, n: number, total: () => string, title: string) =>
  `<section class="rp-page"><header class="rp-ph"><span>Pulse Lab Simulator · Research report</span><span>${esc(title)}</span></header>${body}<footer class="rp-pf"><span>Educational model output, not patient data. Not a medical device.</span><span>Page ${n} of <span class="rp-total">${total()}</span></span></footer></section>`;

/** The user's data-block layout: patient header, then one row per heart rate. */
function dataBlock(r: ResearchReport, pid: string, mode: string, part?: [number, number]): string {
  const p = r.patients.find(x => x.id === pid)!, pr = p.profile;
  const all = r.rows.filter(x => x.patient === pid && x.mode === mode).sort((a, b) => (a.heart_rate as number) - (b.heart_rate as number));
  const rows = part ? all.slice(part[0], part[1]) : all;
  if (!rows.length) return '';
  const lv = r.heartModel === 'v3';
  type Col = [string, string, (x: Row) => string];
  const cols: Col[] = ([
    ['HR', 'bpm', (x: Row) => f(x.heart_rate, 0)],
    ['Cuff BP', 'mmHg', (x: Row) => `${f(x.cuff_SBP, 0)}/${f(x.cuff_DBP, 0)}`],
    ['Central BP', 'mmHg', (x: Row) => `${f(x.central_SBP, 0)}/${f(x.central_DBP, 0)}`],
    ['Central PP', 'mmHg', (x: Row) => f(x.central_PP, 0)], ['AP', 'mmHg', (x: Row) => f(x.augmentation_pressure_AP, 2)],
    ['AIx', '%', (x: Row) => f(x.AIx, 0)], ['τ = R·C', 's', (x: Row) => f(x.tau_RC, 2)], ['Ejection', 'ms', (x: Row) => f(x.ejection_duration, 0)],
    ...(lv ? [['EF', '%', (x: Row) => f(x.EF, 0)], ['dP/dt max', 'mmHg/s', (x: Row) => f(x.LV_dPdt_max, 0)], ['LVEDP', 'mmHg', (x: Row) => f(x.LVEDP, 1)], ['LVESP', 'mmHg', (x: Row) => f(x.LVESP, 1)]] as [string, string, (x: Row) => string][] : []),
    ['SV', 'mL', (x: Row) => f(x.stroke_volume, 0)], ['CO', 'L/min', (x: Row) => f(x.cardiac_output, 2)], ['SVR', 'dyn·s·cm⁻⁵', (x: Row) => f(x.SVR, 0)], ['MAP', 'mmHg', (x: Row) => f(x.MAP, 0)],
    ...(lv ? [['EDV', 'mL', (x: Row) => f(x.EDV, 0)], ['ESV', 'mL', (x: Row) => f(x.ESV, 0)]] as [string, string, (x: Row) => string][] : [])
  ] as Col[]).filter(([, , g]) => rows.some(x => g(x).replace(/[—/]/g, '') !== ''));
  const kv = (k: string, v: string) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
  const num = (k: string, dp: number, u: string) => (isNum(pr[k]) ? `${f(pr[k], dp)} ${u}` : '—');
  return `<div class="rp-block">
    <div class="rp-bh"><div class="rp-bt"><b>${esc(pid)}</b> · ${esc(mode)} mode${part && part[0] > 0 ? ' (continued)' : ''}</div>
      <div class="rp-kv">${kv('Sex', p.sex === 'female' ? 'Female' : 'Male')}${kv('Age', `${p.age} y`)}${kv('Height / weight', `${f(pr.Height, 0)} cm, ${f(pr.Weight, 0)} kg`)}${kv('Stroke volume at rest', num('Stroke volume at rest', 0, 'mL'))}${kv('SVR at rest', num('SVR at rest', 0, 'dyn·s·cm⁻⁵'))}${kv('Aortic PWV', num('Aortic PWV at rest (operating)', 1, 'm/s'))}${kv('Aortic diameter', num('Aortic diameter', 2, 'cm'))}${isNum(pr['Ees (contractility)']) ? kv('Ees', num('Ees (contractility)', 2, 'mmHg/mL')) : ''}</div></div>
    <table class="rp-t"><thead><tr>${cols.map(([h, u]) => `<th>${esc(h)}<small>${esc(u)}</small></th>`).join('')}</tr></thead>
    <tbody>${rows.map(x => `<tr>${cols.map(([, , g]) => `<td>${g(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export function reportHtml(r: ResearchReport, source: string): string {
  const pages: string[] = [];
  let n = 0;
  const total = () => '__TOTAL__';
  const add = (title: string, body: string) => { n++; pages.push(page(body, n, total, title)); };
  const ageRank = new Map<string, number>();
  const ages = [...new Set(r.patients.map(p => p.age))].sort((a, b) => a - b);
  r.patients.forEach(p => ageRank.set(p.id, ages.indexOf(p.age)));
  const color = (id: string) => ages.length <= AGE_COLORS.length ? AGE_COLORS[ageRank.get(id)!] : `hsl(${220 - 200 * ageRank.get(id)! / Math.max(1, ages.length - 1)} 65% 42%)`;
  const mode0 = r.modes.includes('Pacing') ? 'Pacing' : r.modes[0];

  // 1 · summary
  const m = r.meta;
  const details: [string, string][] = [
    ['Patients', r.patients.map(p => `${p.id} (${p.sex === 'female' ? 'woman' : 'man'}, ${p.age} y)`).join(', ')],
    ['Heart rates', `${r.hrs.join(', ')} bpm`], ['Modes', r.modes.join(', ')],
    ['Heart model', r.heartModel === 'v3' ? 'Ventricle (v3): stroke volume, EF and LV pressures are model outputs' : 'Fixed flow (v2): no LV measures'],
    ['Resting heart rate', m['Resting heart rate']?.split(':')[0] ?? '—'],
    ['Simulator version', m['Simulator version'] ?? '—'], ['Run created', m.Created ? new Date(m.Created).toLocaleString() : '—'], ['Source', source]
  ];
  add('Summary', `<h1>Research report</h1><p class="rp-sub">${esc(r.patients.length)} simulated patients × ${r.hrs.length} heart rates × ${r.modes.length} mode${r.modes.length > 1 ? 's' : ''} · ${r.rows.length} runs</p>
    <div class="rp-cols"><div class="rp-c1"><h2>Key findings</h2><ul class="rp-find">${r.findings.map(x => `<li>${md(x)}</li>`).join('')}</ul></div>
    <div class="rp-c2"><h2>Run details</h2><table class="rp-kvt">${details.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
    ${r.flags.length ? `<h2>Check before use</h2><ul class="rp-flags">${r.flags.map(x => `<li>${md(x)}</li>`).join('')}</ul>` : '<h2>Check before use</h2><p class="rp-ok">No values outside the usual healthy ranges, and no inputs held at a slider limit.</p>'}</div></div>`);

  // 2 · change per 10 bpm + resting profile
  const slopeRows = REPORT_MEASURES.filter(mm => r.trends.some(t => t.key === mm.key && t.mode === mode0));
  const slopeTbl = `<table class="rp-t rp-st"><thead><tr><th class="l">Measure</th><th>Unit</th>${r.patients.map(p => `<th>${esc(p.id)}</th>`).join('')}</tr></thead><tbody>
    ${slopeRows.map(mm => { const t = r.trends.find(t => t.key === mm.key && t.mode === mode0)!; return `<tr><td class="l">${esc(mm.label)}</td><td>${esc(t.unit)}</td>${r.patients.map(p => { const q = t.per.find(x => x.patient === p.id); return `<td>${q ? `${sgn(q.slope10, mm.dp + 1 > 3 ? 0 : mm.dp + 1)}${q.r2 < 0.9 ? '<sup>†</sup>' : ''}` : '—'}</td>`; }).join('')}</tr>`; }).join('')}</tbody></table>`;
  const PROF: [string, string, number][] = [['Height', 'cm', 0], ['Weight', 'kg', 0], ['Stroke volume at rest', 'mL', 0], ['Cardiac output at rest', 'L/min', 2], ['SVR at rest', 'dyn·s·cm⁻⁵', 0], ['Aortic PWV at rest (operating)', 'm/s', 1], ['Aortic diameter', 'cm', 2], ['Reflection coefficient Γ', '', 2], ['Cuff BP at rest', 'mmHg', 0], ['Central BP at rest', 'mmHg', 0], ['AIx at rest', '%', 0], ['Ees (contractility)', 'mmHg/mL', 2], ['EF at rest', '%', 0], ['LVEDP at rest', 'mmHg', 1], ['Occlusion ESPVR slope Ees (fitted)', 'mmHg/mL', 2]];
  const profRows = PROF.filter(([k]) => r.patients.some(p => p.profile[k] != null && p.profile[k] !== ''));
  const profTbl = profRows.length ? `<table class="rp-t rp-st"><thead><tr><th class="l">At rest</th><th>Unit</th>${r.patients.map(p => `<th>${esc(p.id)}</th>`).join('')}</tr></thead><tbody>
    ${profRows.map(([k, u, dp]) => `<tr><td class="l">${esc(k.replace(' at rest', '').replace(' (operating)', ''))}</td><td>${esc(u)}</td>${r.patients.map(p => { const v = p.profile[k]; return `<td>${isNum(v) ? f(v, dp) : esc(v ?? '—')}</td>`; }).join('')}</tr>`).join('')}</tbody></table>` : '';
  add('Trends at a glance', `<h2>Change per 10 bpm (${esc(mode0)} mode)</h2><p class="rp-note">Least-squares slope of each measure against heart rate, per patient. <sup>†</sup> r² below 0.9: the change is not close to linear, so read the charts.</p>
    <div class="rp-cols"><div class="rp-c1">${slopeTbl}</div><div class="rp-c2">${profTbl ? `<h3>Patient profiles</h3>${profTbl}` : ''}</div></div>`);

  // 3 · trend charts, 8 per page, per mode
  const GROUPS: [string, string[]][] = [
    ['Blood pressure and arteries', ['cuff_SBP', 'cuff_DBP', 'central_SBP', 'central_DBP', 'central_PP', 'augmentation_pressure_AP', 'AIx', 'MAP', 'SVR', 'tau_RC', 'stroke_volume', 'cardiac_output']],
    ['Left ventricle', ['ejection_duration', 'EF', 'LV_dPdt_max', 'LVEDP', 'LVESP', 'EDV', 'ESV', 'VCO_Ees']]];
  for (const mode of r.modes) for (const [gname, keys] of GROUPS) {
    const charts = keys.filter(k => r.rows.some(x => x.mode === mode && isNum(x[k]))).map(k => {
      const mm = REPORT_MEASURES.find(q => q.key === k)!;
      const lines = r.patients.map(p => { const pts = r.rows.filter(x => x.patient === p.id && x.mode === mode).sort((a, b) => (a.heart_rate as number) - (b.heart_rate as number));
        return { x: pts.map(x => x.heart_rate as number), y: pts.map(x => x[k] as number), color: color(p.id), dash: p.sex === 'female', label: p.id }; });
      return svgChart(mm.label, r.units[k] ?? '', lines);
    }).filter(Boolean);
    for (let i = 0; i < charts.length; i += 12) add(`Trends · ${mode}`, `<h2>${esc(gname)} vs heart rate · ${esc(mode)} mode</h2>${legend(r, color)}<div class="rp-grid4">${charts.slice(i, i + 12).map(c => `<div>${c}</div>`).join('')}</div>`);
  }

  // 4 · data blocks in the user's layout, two per page when short
  // a page holds about 24 table rows: two blocks of up to 8 heart rates, else one block per page, split if longer
  const CHUNK = 22;
  const blocks = r.patients.flatMap(p => r.modes.flatMap(mode => r.hrs.length <= CHUNK ? [dataBlock(r, p.id, mode)]
    : Array.from({ length: Math.ceil(r.hrs.length / CHUNK) }, (_, k) => dataBlock(r, p.id, mode, [k * CHUNK, (k + 1) * CHUNK])))).filter(Boolean);
  const perPage = r.hrs.length <= 8 ? 2 : 1;
  for (let i = 0; i < blocks.length; i += perPage) add('Data by patient', `${i === 0 ? '<h2>Data by patient and mode</h2>' : ''}${blocks.slice(i, i + perPage).join('')}`);

  // 5 · occlusion
  if (r.fits.length) {
    const t = `<table class="rp-t rp-st"><thead><tr><th class="l">Patient</th><th>Mode</th><th>HR</th><th>Fitted Ees<small>mmHg/mL</small></th><th>V0<small>mL</small></th><th>r²</th><th>Input Ees<small>mmHg/mL</small></th><th>Fall in Pes<small>mmHg</small></th></tr></thead><tbody>
      ${r.fits.map(x => `<tr><td class="l">${esc(x.patient)}</td><td>${esc(x.mode)}</td><td>${esc(x.hr)}</td><td>${f(x.ees, 2)}</td><td>${f(x.v0, 1)}</td><td>${f(x.r2, 4)}</td><td>${f(x.eesInput, 2)}</td><td>${f(x.pesFall, 1)}</td></tr>`).join('')}</tbody></table>`;
    add('Vena caval occlusion', `<h2>Vena caval occlusion: ESPVR</h2><p class="rp-note">Filling pressure lowered over several beats until end-systolic pressure (Pes) fell by the set amount; the ESPVR is the least-squares line through each loop's maximal P/(V − V0) point. The fitted Ees is lower than the input because LV pressure dips with outflow (ejection effect).</p>${t}`);
  }

  // 6 · notes
  const NOTE_KEYS = ['Independent', 'Pacing', 'Physiologic', 'Waveform sheets', 'dP/dt', 'Vena caval occlusion'];
  const notes = NOTE_KEYS.filter(k => m[k]).map(k => `<tr><th>${esc(k)}</th><td>${esc(m[k])}</td></tr>`).join('');
  add('Notes', `<h2>Notes and definitions</h2><table class="rp-kvt rp-notes">${notes}
    <tr><th>Change per 10 bpm</th><td>Least-squares slope of the measure against heart rate across all heart rates run, multiplied by 10. r² shows how close to a straight line the change is.</td></tr>
    <tr><th>Key findings</th><td>Written automatically from the numbers in this workbook. Check them against the tables before quoting them.</td></tr>
    <tr><th>Model</th><td>Pulse Lab Simulator. Equations, sources, validation and limitations are in the Methods and Validation tabs of the simulator.</td></tr></table>`);
  return pages.join('').replaceAll('__TOTAL__', String(n));
}

const CSS = `
#reportView{position:fixed;inset:0;z-index:9000;background:#e9ebef;overflow:auto;color:#1c1f24;font:12px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
#reportView .rp-bar{position:sticky;top:0;z-index:2;display:flex;gap:8px;align-items:center;padding:10px 16px;background:#fff;border-bottom:1px solid #d5d9df}
#reportView .rp-bar b{margin-right:auto;font-size:14px}
#reportView .rp-bar button{font:inherit;font-size:13px;padding:6px 12px;border:1px solid #c5cad2;border-radius:6px;background:#fff;cursor:pointer}
#reportView .rp-bar button.pri{background:#1c1f24;color:#fff;border-color:#1c1f24}
#reportView .rp-pages{padding:20px 0 40px}
.rp-page{width:11in;height:8.5in;box-sizing:border-box;margin:0 auto 20px;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.15);padding:.42in .5in .5in;position:relative;overflow:hidden;display:flex;flex-direction:column}
.rp-ph{display:flex;justify-content:space-between;font-size:10px;color:#6b7280;border-bottom:2px solid #b2182b;padding-bottom:5px;margin-bottom:12px;text-transform:uppercase;letter-spacing:.06em}
.rp-pf{position:absolute;left:.5in;right:.5in;bottom:.25in;display:flex;justify-content:space-between;font-size:9.5px;color:#6b7280;border-top:1px solid #e1e4e8;padding-top:5px}
.rp-page h1{font:700 26px/1.2 Georgia,serif;margin:4px 0 2px}.rp-sub{color:#4b5563;margin:0 0 14px;font-size:13px}
.rp-page h2{font-size:14px;margin:4px 0 8px;color:#111}.rp-page h3{font-size:12.5px;margin:0 0 6px}
.rp-cols{display:flex;gap:24px}.rp-c1{flex:1.35;min-width:0}.rp-c2{flex:1;min-width:0}
.rp-find{margin:0;padding-left:18px}.rp-find li{margin:0 0 6px}
.rp-flags{margin:0;padding-left:18px;color:#7a2810;font-size:11.5px}.rp-flags li{margin:0 0 4px}.rp-ok{color:#1a7f37}
.rp-kvt{border-collapse:collapse;width:100%;margin-bottom:10px}.rp-kvt th{text-align:left;font-weight:600;color:#4b5563;padding:3px 10px 3px 0;vertical-align:top;white-space:nowrap}.rp-kvt td{padding:3px 0}
.rp-notes th{width:150px}.rp-notes td,.rp-notes th{padding:5px 10px 5px 0;border-bottom:1px solid #eceef1}
.rp-note{color:#4b5563;margin:0 0 10px}
.rp-t{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
.rp-t th{font-size:10.5px;font-weight:700;background:#f2f4f7;border-bottom:1.5px solid #9aa1ab;padding:4px 5px;text-align:right;white-space:nowrap}
.rp-t th small{display:block;font-weight:400;color:#6b7280;font-size:9px}
.rp-t td{padding:3px 5px;text-align:right;border-bottom:1px solid #eceef1;white-space:nowrap}
.rp-t tbody tr:nth-child(even) td{background:#fafbfc}
.rp-t .l{text-align:left}.rp-st td,.rp-st th{font-size:11px}
.rp-block{border:1px solid #d5d9df;border-radius:6px;padding:8px 10px;margin:0 0 14px;break-inside:avoid}
.rp-bh{display:flex;gap:16px;align-items:baseline;margin-bottom:6px;flex-wrap:wrap}.rp-bt{font-size:14px;white-space:nowrap}
.rp-kv{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:11px}.rp-kv span{color:#6b7280;margin-right:4px}
.rp-legend{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:11px;margin:0 0 6px}.rp-legend span{display:inline-flex;align-items:center;gap:5px}
.rp-grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:6px 18px}
.rp-chart{display:block}.rp-ct{font:600 10.5px system-ui,sans-serif;fill:#111}.rp-cu{font-weight:400;fill:#6b7280}
.rp-tick{font:9px system-ui,sans-serif;fill:#4b5563}.rp-grid{stroke:#eceef1;stroke-width:1}.rp-axis{stroke:#9aa1ab;stroke-width:1}
@media print{
  @page{size:11in 8.5in;margin:0}
  html,body.rp-printing{margin:0!important;padding:0!important;height:auto!important;min-height:0!important;overflow:visible!important;display:block!important;background:#fff!important}
  body.rp-printing>*:not(#reportView){display:none!important}
  body.rp-printing #reportView{position:static!important;inset:auto;overflow:visible!important;background:#fff!important}
  body.rp-printing #reportView .rp-bar{display:none!important}
  body.rp-printing #reportView .rp-pages{padding:0!important}
  body.rp-printing .rp-page{margin:0!important;box-shadow:none!important;height:8.46in;break-after:page;page-break-after:always}
  body.rp-printing .rp-page:last-child{break-after:auto;page-break-after:auto}
}`;

/** Show the report full-screen; Save as PDF prints only the report. */
export function openReport(r: ResearchReport, source: string, fileStem: string): void {
  document.getElementById('reportView')?.remove();
  if (!document.getElementById('rpCss')) { const st = document.createElement('style'); st.id = 'rpCss'; st.textContent = CSS; document.head.appendChild(st); }
  const v = document.createElement('div');
  v.id = 'reportView'; v.setAttribute('role', 'dialog'); v.setAttribute('aria-label', 'Research report');
  v.innerHTML = `<div class="rp-bar"><b>Research report</b><span class="rp-hint" style="color:#6b7280">In the print dialog choose “Save as PDF”.</span><button class="pri" id="rpPdf">Save as PDF</button><button id="rpClose">Close</button></div><div class="rp-pages">${reportHtml(r, source)}</div>`;
  document.body.appendChild(v);
  const close = () => { v.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  v.querySelector('#rpClose')!.addEventListener('click', close);
  v.querySelector('#rpPdf')!.addEventListener('click', () => printReport(fileStem));
}

export function printReport(fileStem: string): void {
  const t = document.title;
  document.title = fileStem;        // the PDF's default file name
  document.body.classList.add('rp-printing');
  const done = () => { document.body.classList.remove('rp-printing'); document.title = t; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
  setTimeout(done, 1500);           // browsers without afterprint
}
