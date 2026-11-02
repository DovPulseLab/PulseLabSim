// Records v1 outputs so the TypeScript port can be checked against them.
// Loads the untouched v1 files (js/model.js, js/validation.js, js/content.js) in a sandbox.
// Run: npm run snapshot:v1   (writes tests/fixtures/v1-snapshots.json and v1-validation.json)
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const load = f => readFileSync(new URL(f, root), 'utf8');

const ctx = vm.createContext({ Math, Object, Array, Float64Array, JSON, Number, String });
ctx.window = ctx;
vm.runInContext(load('js/model.js'), ctx, { filename: 'js/model.js' });
vm.runInContext(load('js/content.js'), ctx, { filename: 'js/content.js' });
vm.runInContext(load('js/validation.js'), ctx, { filename: 'js/validation.js' });
const PWA = ctx.PWA;
const CONTROLS = ctx.Content.CONTROLS;

const STEP = 8;                         // keep every 8th waveform sample
const r6 = v => (typeof v === 'number' ? Number(v.toPrecision(10)) : v);
const thin = a => a.filter((_, i) => i % STEP === 0).map(r6);

function record(label, input) {
  const r = PWA.simulate(input);
  const m = {};
  for (const [k, v] of Object.entries(r.m)) m[k] = r6(v);
  return {
    label, input: Object.fromEntries(Object.entries(input).map(([k, v]) => [k, r6(v)])),
    m,
    wave: { p: thin(r.p), pf: thin(r.pf), pb: thin(r.pb), brachial: thin(r.brachial), radial: thin(r.radial), q: thin(r.q) },
    zin: r.zin.filter(h => h.f <= 12).map(h => [r6(h.f), r6(h.mod)])
  };
}

const cases = [];
const drugKeys = Object.keys(PWA.DRUGS);
for (const name of Object.keys(PWA.PRESETS)) {
  const base = Object.assign({}, PWA.DEFAULTS, PWA.PRESETS[name]);
  cases.push(record(`${name} | no drug`, base));
  for (const k of drugKeys) cases.push(record(`${name} | ${k}`, PWA.applyDrugs(base, [k])));
  cases.push(record(`${name} | all drugs`, PWA.applyDrugs(base, drugKeys)));
}
for (const c of CONTROLS.flatMap(g => g.items)) {
  cases.push(record(`defaults | ${c.key} = min`, Object.assign({}, PWA.DEFAULTS, { [c.key]: c.min })));
  cases.push(record(`defaults | ${c.key} = max`, Object.assign({}, PWA.DEFAULTS, { [c.key]: c.max })));
}
cases.push(record('extreme | cAo, gamma, lpScale max; hr min',
  Object.assign({}, PWA.DEFAULTS, { cAo: 16, gamma: 0.9, lpScale: 1.5, hr: 40 })));

writeFileSync(new URL('tests/fixtures/v1-snapshots.json', root),
  JSON.stringify({ source: 'js/model.js (v1)', sampleStep: STEP, cases }));

// Validation verdicts, in the order v1 renders them
const html = ctx.Validation.html();
const verdicts = [];
const re = /<span class="(pass|near|fail)">/g;
let mm;
while ((mm = re.exec(html))) verdicts.push(mm[1]);
writeFileSync(new URL('tests/fixtures/v1-validation.json', root), JSON.stringify({ verdicts }, null, 0));

console.log(`v1 snapshot: ${cases.length} cases; validation verdicts: ${verdicts.length} ` +
  `(${verdicts.filter(v => v === 'pass').length} pass, ${verdicts.filter(v => v === 'near').length} near, ${verdicts.filter(v => v === 'fail').length} fail)`);
