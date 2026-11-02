// Stage 1 placeholder: shows that the ported model runs in the browser.
import { simulate } from './model';
import { runValidation, verdictSequence } from './model/validation';
import { DEFAULTS, PRESETS } from './config/physiology';

const out = document.getElementById('out');
if (out) {
  const rows = Object.entries(PRESETS).map(([name, o]) => {
    const { m } = simulate({ ...DEFAULTS, ...o });
    return `<tr><td>${name}</td><td>${m.Ps.toFixed(0)}/${m.Pd.toFixed(0)}</td><td>${m.bSBP.toFixed(0)}/${m.bDBP.toFixed(0)}</td>` +
      `<td>${m.map.toFixed(0)}</td><td>${m.AIx.toFixed(1)}</td><td>${m.type}</td></tr>`;
  }).join('');
  const v = verdictSequence(runValidation());
  out.innerHTML = `<table cellpadding="4"><tr><th align="left">Profile</th><th>Central BP</th><th>Cuff BP</th><th>MAP</th><th>AIx %</th><th>Type</th></tr>${rows}</table>
    <p>Validation: ${v.filter(x => x === 'pass').length} match, ${v.filter(x => x === 'near').length} close, ${v.filter(x => x === 'fail').length} off.</p>`;
}
