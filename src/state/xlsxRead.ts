/* =====================================================================
   Minimal .xlsx reader, no dependencies: enough to read back a Pulse Lab
   workbook, including one opened and re-saved in Excel, Numbers, LibreOffice
   or Google Sheets. Reads every worksheet into rows of numbers and strings
   (shared strings, inline strings, formula results). Styles, formulas and
   dates are not interpreted. Unzips stored and deflated entries; deflate
   uses the platform's DecompressionStream (browsers, Node ≥ 18).
   ===================================================================== */
import type { Cell, Sheet } from './xlsx';

const dec = new TextDecoder();

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Entries of a ZIP archive, read from its central directory. */
export async function unzip(buf: Uint8Array): Promise<Map<string, Uint8Array>> {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not an .xlsx file (no ZIP directory found)');
  const n = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let k = 0; k < n; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('damaged .xlsx file');
    const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true);
    const nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lho = v.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nl));
    const start = lho + 30 + v.getUint16(lho + 26, true) + v.getUint16(lho + 28, true);
    const raw = buf.subarray(start, start + csize);
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, await inflateRaw(raw));
    else throw new Error(`unsupported compression in ${name}`);
    p += 46 + nl + xl + cl;
  }
  return out;
}

const unesc = (s: string) => s.replace(/&(lt|gt|quot|apos|amp|#x?[0-9a-fA-F]+);/g, (_, e: string) =>
  e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'quot' ? '"' : e === 'apos' ? "'" : e === 'amp' ? '&'
    : String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));
/** Text of every <t> in a fragment (rich text runs joined), phonetic runs skipped. */
const textOf = (xml: string) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => unesc(m[1])).join('');
const attr = (tag: string, a: string) => tag.match(new RegExp(`\\b${a}="([^"]*)"`))?.[1];
const colIndex = (ref: string) => { let c = 0; for (const ch of ref.replace(/\d+$/, '')) c = c * 26 + ch.charCodeAt(0) - 64; return c - 1; };

function readSheet(xml: string, shared: string[]): Cell[][] {
  const rows: Cell[][] = [];
  let rAuto = 0;
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const ri = Number(attr(rm[1], 'r') ?? rAuto + 1) - 1; rAuto = ri + 1;
    const row: Cell[] = [];
    let cAuto = 0;
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cm[1], 'r'), ci = ref ? colIndex(ref) : cAuto; cAuto = ci + 1;
      const t = attr(cm[1], 't'), body = cm[2] ?? '';
      const vv = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let val: Cell;
      if (t === 'inlineStr') val = textOf(body.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? '');
      else if (t === 's') val = vv != null ? shared[Number(vv)] ?? '' : '';
      else if (t === 'str' || t === 'e') val = vv != null ? unesc(vv) : '';
      else if (t === 'b') val = vv === '1' ? 'TRUE' : 'FALSE';
      else val = vv != null && vv !== '' ? Number(vv) : null;
      row[ci] = val;
    }
    rows[ri] = row;
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

/** Every worksheet of an .xlsx file, in workbook order. */
export async function readXlsx(bytes: Uint8Array): Promise<Sheet[]> {
  const z = await unzip(bytes);
  const txt = (n: string) => { const b = z.get(n); return b ? dec.decode(b) : undefined; };
  const wb = txt('xl/workbook.xml'); if (!wb) throw new Error('not an Excel workbook (xl/workbook.xml missing)');
  const rels = new Map<string, string>();
  for (const m of (txt('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id'), target = attr(m[0], 'Target');
    if (id && target) rels.set(id, target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, ''));
  }
  const shared = [...(txt('xl/sharedStrings.xml') ?? '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m => textOf(m[1]));
  const sheets: Sheet[] = [];
  let i = 0;
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    i++;
    const name = unesc(attr(m[0], 'name') ?? `Sheet${i}`);
    const rid = attr(m[0], 'r:id') ?? m[0].match(/\b\w+:id="([^"]*)"/)?.[1];
    const path = (rid && rels.get(rid)) ?? `xl/worksheets/sheet${i}.xml`;
    const xml = txt(path); if (xml == null) continue;
    sheets.push({ name, rows: readSheet(xml, shared) });
  }
  return sheets;
}
