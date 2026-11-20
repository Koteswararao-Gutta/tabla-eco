// One-off: turn the parsed WhatsApp catering orders into orders.json for run.mjs (mode "import"),
// plus report.md for the owner. Plain Node 22, no dependencies, no network.
//
//   node tools/whatsapp-import/build.mjs [--in /tmp/claude-0/wa] [--out tools/whatsapp-import]
//
// Reads <in>/parsed-{A,B,C,D}.json (a missing file is skipped with a warning). Any invalid order
// (bad date, unknown type, duplicate id, ...) stops the build: nothing is written.
//
// Shapes follow the app exactly (src/shared/data/types.ts, src/manager/catering/lines.ts, firestore.rules):
// no undefined anywhere, optional keys left out, null where the app clears a value. run.mjs adds `id`.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));

/** Everything due on or before this is history (completed and paid). */
export const NOW = Date.parse('2026-11-20T23:59:59-07:00');
/** Phoenix is UTC-7 all year (no daylight saving). */
const PHX_OFFSET_H = 7;
export const IMPORT_NOTE = 'Imported from the WhatsApp catering group';
const METHODS = ['cash', 'card', 'zelle', 'check'];

// ---------- small helpers ----------

/** "wa-" + key, lowercase, only a-z 0-9 and single dashes. */
export function orderId(key) {
  const k = String(key ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!k) throw new Error(`empty key: ${JSON.stringify(key)}`);
  return `wa-${k}`;
}

/** Phoenix local date and time as ms since epoch, or null when not a real date/time. */
export function phoenixMs(y, mo, d, h = 0, mi = 0, s = 0) {
  if (![y, mo, d, h, mi, s].every(Number.isInteger)) return null;
  if (mo < 1 || mo > 12 || d < 1 || h < 0 || h > 23 || mi < 0 || mi > 59 || s < 0 || s > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h + PHX_OFFSET_H, mi, s);
  const back = new Date(Date.UTC(y, mo - 1, d));
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null; // Feb 30 etc.
  return ms;
}

/** "2026-01-04" + "11:15" -> ms. Throws on a bad date; '' time -> 12:00 and defaulted = true. */
export function dueAtOf(date, time) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ''));
  if (!dm) throw new Error(`bad date ${JSON.stringify(date)}`);
  const [y, mo, d] = [+dm[1], +dm[2], +dm[3]];
  if (y < 2025 || y > 2026) throw new Error(`date ${date} is outside 2025-2026`);
  const t = String(time ?? '').trim();
  let h = 12, mi = 0;
  if (t) {
    const tm = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (!tm) throw new Error(`bad time ${JSON.stringify(time)}`);
    [h, mi] = [+tm[1], +tm[2]];
  }
  const ms = phoenixMs(y, mo, d, h, mi);
  if (ms === null) throw new Error(`not a real date/time: ${date} ${time}`);
  return { ms, defaulted: !t };
}

/** Time of a WhatsApp source: "[12/28/25, 9:08:09 PM] Name" or "00000006-PHOTO-2025-12-28-21-18-16.jpg"; null if neither. */
export function sourceMs(src) {
  const s = String(src ?? '').replace(/[‎‏‪-‮⁦-⁩]/g, '').replace(/[  ]/g, ' ');
  let m = /\[(\d{1,2})\/(\d{1,2})\/(\d{2}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP])\.?M\.?\]/i.exec(s);
  if (m) {
    let h = +m[4] % 12;
    if (m[7].toUpperCase() === 'P') h += 12;
    return phoenixMs(2000 + +m[3], +m[1], +m[2], h, +m[5], m[6] ? +m[6] : 0);
  }
  m = /PHOTO-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/i.exec(s);
  if (m) return phoenixMs(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]);
  return null;
}

const str = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A payment method as the app stores it, or null when not stated / not recognised. */
export function payMethod(raw) {
  const m = str(raw).toLowerCase();
  if (!m) return null;
  if (/zelle/.test(m)) return 'zelle';
  if (/cheque|check/.test(m)) return 'check';
  if (/card|credit|debit|visa|amex|master|\bcc\b/.test(m)) return 'card';
  if (/cash/.test(m)) return 'cash';
  return null;
}

/** Same as lineText in src/manager/catering/lines.ts (a line with text reads as typed). */
const UNITS = [
  ['Full tray', 'Full tray', 'Full trays'], ['Half tray', 'Half tray', 'Half trays'], ['Pieces', 'piece', 'pieces'],
  ['Servings', 'serving', 'servings'], ['Lbs', 'lb', 'lbs'], ['Quarts', 'quart', 'quarts'], ['Gallons', 'gallon', 'gallons'], ['Plates', 'plate', 'plates'],
];
export function lineText(l) {
  if (typeof l.text === 'string' && l.text.trim()) return l.text.trim();
  const u = UNITS.find((x) => x[0].toLowerCase() === l.unit.trim().toLowerCase());
  const qty = typeof l.qty === 'number' && Number.isFinite(l.qty) ? l.qty : null;
  const unit = (u ? (qty === 1 ? u[1] : u[2]) : l.unit.trim()) || '';
  let q;
  if (qty === null) q = u ? u[0] : unit;
  else {
    const n = Number.isInteger(qty) ? String(qty) : String(Math.round(qty * 100) / 100);
    q = unit ? `${n} ${unit}` : n;
  }
  const note = l.note.trim();
  return `${l.name.trim()}${q ? `, ${q}` : ''}${note ? ` (${note})` : ''}`;
}
export const linesText = (lines) => lines.map(lineText).filter(Boolean).join('\n');

/** Long digit runs (phone numbers) out of anything that goes in the report. */
export const noPhones = (s) => String(s).replace(/\+?\d[\d\s().-]{8,}\d/g, (m) => (m.replace(/\D/g, '').length >= 10 ? '[phone]' : m));

/** Money words: a note part with one of these is about payment, not food. */
const MONEY_RE = /\$|\b(?:cash|paid|unpaid|total|discount|advance|adv|balance|zelle|venmo|tax|price)\b|\d\s*\+\s*\d+\s*=/i;
const NUM = '\\d[\\d,]*(?:\\.\\d+)?';
const PRICE_RE = new RegExp(`\\(\\s*\\$\\s*${NUM}\\s*\\)|\\(\\s*${NUM}\\s*\\$\\s*\\)|\\$\\s*${NUM}|${NUM}\\s*\\$`, 'g');

/**
 * A line's text without prices ("Gobi 65 - 1 full tray 150$" -> "Gobi 65 - 1 full tray"). The kitchen sees the
 * line text, and amounts live only in orderAmounts. `tray`: the line is counted in trays, so a bare "(80)" is a price too.
 */
export function noPrice(text, { tray = false } = {}) {
  let t = String(text ?? '').replace(PRICE_RE, ' ');
  if (tray) t = t.replace(/\(\s*\d{2,4}\s*\)/g, ' ');
  return t.replace(/\(\s*\)/g, ' ').replace(/\s+/g, ' ').replace(/(?:\s*(?:-+>|—+>|[-–—:,]+)\s*)+$/, '').trim();
}

/** Order notes without the parts about money ("Total $765; $700 cash after discount." -> ''). */
export function noMoneyNotes(notes) {
  if (!MONEY_RE.test(String(notes ?? ''))) return String(notes ?? '').trim();
  const parts = String(notes ?? '').split(/(?<=[.;!])\s+|\s*;\s*|\n+/);
  return parts.filter((x) => x.trim() && !MONEY_RE.test(x)).join(' ').replace(/\s+/g, ' ').trim();
}

/** Menu ids from a Toast menu export ({groups:[{items:[{id,name}]}]}) as Map id -> name. */
export function menuIndex(menu) {
  const out = new Map();
  for (const g of menu?.groups ?? []) for (const i of g?.items ?? []) if (i?.id) out.set(i.id, String(i.name ?? '').trim());
  return out;
}

// ---------- one order ----------

/**
 * One parsed order -> { id, order, amount } for run.mjs, and what the report needs.
 * Throws (with the key) when the order can't be imported as is.
 */
export function buildOrder(p, { menu = null, now = NOW } = {}) {
  const key = p?.key;
  const fail = (msg) => { throw new Error(`${key ?? '(no key)'}: ${msg}`); };
  const id = orderId(key);
  const flags = (Array.isArray(p.flags) ? p.flags : []).map(str).filter(Boolean);
  const added = []; // what this build had to decide, listed in the report with the parser's flags

  let due;
  try { due = dueAtOf(p.date, p.time); } catch (e) { fail(e.message); }
  if (due.defaulted) added.push('no time given: set to 12:00 PM');
  if (p.type !== 'pickup' && p.type !== 'delivery') fail(`bad type ${JSON.stringify(p.type)}`);

  const times = (Array.isArray(p.sources) ? p.sources : []).map(sourceMs).filter((t) => t !== null);
  let createdAt;
  if (times.length) createdAt = Math.min(...times);
  else {
    createdAt = Math.min(due.ms, now);
    added.push('no message time in sources: created time set to the due time');
  }

  // Lines
  const rawLines = Array.isArray(p.lines) ? p.lines : [];
  const lines = [];
  let priced = 0;
  for (const [i, r] of rawLines.entries()) {
    if (!r || typeof r !== 'object') fail(`line ${i + 1} is not an object`);
    let dishId = typeof r.dishId === 'string' && r.dishId.trim() ? r.dishId.trim() : null;
    let name = str(r.name);
    const unit = str(r.unit);
    const rawText = str(r.text); // one line: the items text is split on newlines
    const text = noPrice(rawText, { tray: /tray/i.test(unit) });
    if (text !== rawText) priced++;
    let check = r.check === true;
    if (dishId && menu) {
      const menuName = menu.get(dishId);
      if (menuName === undefined) {
        added.push(`line ${i + 1}: dish id not on the menu, kept as typed ("${name || text}")`);
        dishId = null;
        check = true;
      } else if (!name) name = menuName.replace(/^\d+\.\s*/, '');
    }
    if (!name) name = text;
    if (!name) fail(`line ${i + 1} has no name and no text`);
    const qtyRaw = r.qty;
    const qty = qtyRaw === null || qtyRaw === undefined || qtyRaw === '' ? null : num(qtyRaw);
    if (qty === null && qtyRaw !== null && qtyRaw !== undefined && qtyRaw !== '') fail(`line ${i + 1} qty ${JSON.stringify(qtyRaw)} is not a number`);
    if (qty !== null && qty <= 0) fail(`line ${i + 1} qty ${qty} must be more than 0`);
    const line = { dishId, name, qty, unit, note: noPrice(str(r.note)) };
    if (text) line.text = text;
    if (check) line.check = true;
    lines.push(line);
  }
  if (!lines.length) added.push('no items');
  if (priced) added.push(`prices taken out of ${priced} line(s) (the kitchen sees line text; amounts are manager-only)`);
  const texts = lines.map(lineText);
  const twice = texts.filter((t, i) => texts.indexOf(t) !== i);
  if (twice.length) fail(`two lines read the same ("${twice[0]}"): give each its own text`);
  if (lines.length > 300) fail('more than 300 lines');
  const items = linesText(lines);

  const people = num(p.people);
  if (p.people !== null && p.people !== undefined && p.people !== '' && !(people && Number.isInteger(people) && people > 0)) {
    added.push(`people "${p.people}" is not a whole number: left empty`);
  }

  const status = due.ms <= now ? 'completed' : 'open';
  const order = {
    customerName: str(p.customerName),
    phone: String(p.phone ?? '').replace(/[^\d]/g, ''),
    dueAt: due.ms,
    type: p.type,
    people: people && Number.isInteger(people) && people > 0 ? people : null,
    items,
    lines,
    status,
    completedAt: status === 'completed' ? due.ms : null,
    createdAt,
    updatedAt: createdAt,
    history: [{ at: createdAt, by: 'manager', changes: [IMPORT_NOTE] }],
  };
  const address = str(p.address);
  if (p.type === 'delivery' && address) order.address = address;
  if (p.type === 'delivery' && !address) added.push('delivery with no address');
  const rawNotes = typeof p.notes === 'string' ? p.notes.trim() : '';
  const notes = noMoneyNotes(rawNotes);
  if (notes !== rawNotes) added.push(`money taken out of the notes ("${rawNotes}")`);
  if (notes) order.notes = notes;
  if (order.customerName.length > 200) fail('name longer than 200 letters');
  if (items.length > 20000) fail('items text longer than 20000 letters');

  // Amount and payments
  let amountValue = p.amount === null || p.amount === undefined || p.amount === '' ? null : num(p.amount);
  if (amountValue === null && p.amount !== null && p.amount !== undefined && p.amount !== '') fail(`amount ${JSON.stringify(p.amount)} is not a number`);
  if (amountValue !== null && (amountValue < 0 || amountValue > 1_000_000)) fail(`amount ${amountValue} out of range`);
  if (amountValue !== null) amountValue = Math.round(amountValue * 100) / 100;
  const pays = (Array.isArray(p.payments) ? p.payments : []).filter((x) => x && typeof x === 'object');
  const deposits = [];
  let paidMethod = null;
  let paidAt = null;
  for (const x of pays) {
    const m = payMethod(x.method);
    if (str(x.method) && !m) added.push(`payment method "${str(x.method)}" not recognised`);
    const at = sourceMs(x.source) ?? createdAt;
    if (x.kind === 'advance') {
      const a = num(x.amount);
      if (!(a > 0)) { added.push(`advance with no amount (${JSON.stringify(x.amount)}): left out`); continue; }
      if (!m) added.push(`advance $${a}: how it was paid not stated, saved as cash`);
      deposits.push({ amount: Math.round(a * 100) / 100, method: m ?? 'cash', takenBy: 'WhatsApp', at });
    } else if (x.kind === 'paid') {
      if (m) paidMethod = m;
      paidAt = at;
    } else added.push(`payment kind ${JSON.stringify(x.kind)} not used`);
  }
  if (deposits.length > 20) fail('more than 20 advances');

  let amount = null;
  if (status === 'completed') {
    amount = { amount: amountValue, paid: true, paidAt: due.ms, method: paidMethod, takenBy: null, updatedAt: createdAt };
  } else if (amountValue !== null || deposits.length || paidAt !== null) {
    amount = paidAt !== null
      ? { amount: amountValue, paid: true, paidAt, method: paidMethod, takenBy: null, updatedAt: createdAt }
      : { amount: amountValue, paid: false, paidAt: null, method: null, takenBy: null, updatedAt: createdAt };
    if (paidAt !== null) added.push('marked paid before the due date (the chat says so)');
  }
  if (amount && deposits.length) amount.deposits = deposits;

  return { id, order, amount, key: String(key), flags, added, date: p.date, time: str(p.time) };
}

// ---------- everything ----------

/** Special case: the Mamtha delivery on Nov 7 2026 had $520 typed in the app before this import. */
function applyMamtha(results, notes) {
  const hits = results.filter((r) => /^mam(a)?tha\b/i.test(r.order.customerName) && r.date === '2026-11-07');
  if (hits.length !== 1) {
    notes.push(`Mamtha (Nov 7, 2026): expected one order, found ${hits.length}. The $520 typed in the app was not applied.`);
    return;
  }
  const r = hits[0];
  if (r.amount?.amount != null) {
    notes.push(`Mamtha (Nov 7, 2026): the chat gives $${r.amount.amount}; the app's test entry had $520. The chat amount was kept.`);
    return;
  }
  r.amount = r.amount ?? { amount: null, paid: false, paidAt: null, method: null, takenBy: null, updatedAt: r.order.createdAt };
  r.amount.amount = 520;
  r.added.push('amount $520 taken from the test entry typed in the app (the chat gives no amount)');
  notes.push('Mamtha (Nov 7, 2026): the chat gives no amount, so $520 from the test entry typed in the app was used.');
}

/**
 * All parsed orders -> { list (for orders.json), report (markdown) }. `files` = [{name, orders}].
 * Throws with every problem listed when any order is invalid or two orders share an id.
 */
export function build(files, { menu = null, now = NOW, warnings = [], held = [] } = {}) {
  const errors = [];
  const results = [];
  const cancelled = [];
  const notes = [];
  for (const { name, orders } of files) {
    if (!Array.isArray(orders)) { errors.push(`${name}: not a JSON array`); continue; }
    for (const p of orders) {
      if (p?.cancelled === true) { cancelled.push({ ...p, file: name }); continue; }
      try { results.push({ ...buildOrder(p, { menu, now }), file: name }); } catch (e) { errors.push(`${name}: ${e.message}`); }
    }
  }
  const seen = new Map();
  for (const r of results) {
    if (seen.has(r.id)) errors.push(`duplicate id ${r.id} (${seen.get(r.id)} and ${r.file})`);
    else seen.set(r.id, r.file);
  }
  if (errors.length) throw new Error(`cannot build, ${errors.length} problem(s):\n  ${errors.join('\n  ')}`);

  applyMamtha(results, notes);
  results.sort((a, b) => a.order.dueAt - b.order.dueAt || a.id.localeCompare(b.id));
  const list = results.map(({ id, order, amount }) => ({ id, order, amount }));
  assertClean(list);
  return { list, report: report(results, cancelled, notes, warnings, now, held) };
}

/** No undefined, NaN or Infinity anywhere (Firestore refuses undefined). */
export function assertClean(v, path = '') {
  if (v === undefined) throw new Error(`undefined at ${path || '(root)'}`);
  if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`${v} at ${path}`);
  if (Array.isArray(v)) v.forEach((x, i) => assertClean(x, `${path}[${i}]`));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) assertClean(x, path ? `${path}.${k}` : k);
}

// ---------- report ----------

const fmtDue = (ms) =>
  new Date(ms).toLocaleString('en-US', { timeZone: 'America/Phoenix', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const money = (n) => (n == null ? '' : `$${Number.isInteger(n) ? n : n.toFixed(2)}`);
const nameOf = (n) => n || '(no name)';

function report(results, cancelled, notes, warnings, now, held = []) {
  const completed = results.filter((r) => r.order.status === 'completed');
  const open = results.filter((r) => r.order.status === 'open');
  const withAmount = results.filter((r) => r.amount?.amount != null);
  const lines = results.flatMap((r) => r.order.lines);
  const matched = lines.filter((l) => l.dishId).length;
  const toCheck = lines.filter((l) => l.check).length;
  const advances = results.reduce((n, r) => n + (r.amount?.deposits?.length ?? 0), 0);
  const flagged = results.filter((r) => r.flags.length || r.added.length);

  const out = [];
  out.push('# WhatsApp catering import', '');
  out.push(`Orders due on or before ${fmtDue(now)} are imported as completed and paid; later ones as open.`, '');
  if (warnings.length) out.push('## Warnings', '', ...warnings.map((w) => `- ${w}`), '');
  out.push('## Totals', '');
  out.push('| | |', '| --- | --- |');
  out.push(`| Orders imported | ${results.length} |`);
  out.push(`| Completed (paid) | ${completed.length} |`);
  out.push(`| Open | ${open.length} |`);
  out.push(`| Cancelled (not imported) | ${cancelled.length} |`);
  out.push(`| Held back as unclear (not imported) | ${held.length} |`);
  out.push(`| With an amount | ${withAmount.length} (total ${money(Math.round(withAmount.reduce((a, r) => a + r.amount.amount, 0) * 100) / 100) || '$0'}) |`);
  out.push(`| Advances recorded | ${advances} |`);
  out.push(`| Lines matched to the menu | ${matched} |`);
  out.push(`| Lines typed (not on the menu) | ${lines.length - matched} |`);
  out.push(`| Lines marked "check" | ${toCheck} |`);
  out.push(`| Flagged orders | ${flagged.length} |`, '');
  if (notes.length) out.push('## Notes', '', ...notes.map((n) => `- ${n}`), '');

  if (open.length) {
    out.push('## Open orders', '');
    for (const r of open) out.push(`- ${fmtDue(r.order.dueAt)} · ${nameOf(r.order.customerName)} · \`${r.id}\`${r.amount?.amount != null ? ` · ${money(r.amount.amount)}` : ''}`);
    out.push('');
  }

  out.push('## Flagged orders', '');
  if (!flagged.length) out.push('None.', '');
  for (const r of flagged) {
    const o = r.order;
    out.push(`### ${fmtDue(o.dueAt)} · ${nameOf(o.customerName)}`, '');
    out.push(`\`${r.id}\` · ${o.type}${o.people ? ` · ${o.people} people` : ''} · ${o.status}${r.amount?.amount != null ? ` · ${money(r.amount.amount)}` : ''}`, '');
    for (const f of r.flags) out.push(`- Flag: ${f}`);
    for (const f of r.added) out.push(`- Import: ${f}`);
    out.push('', 'Items:');
    for (const l of o.lines) out.push(`- ${l.check ? '**[check]** ' : ''}${l.text || l.name}${l.dishId ? '' : ' _(typed)_'}`);
    if (!o.lines.length) out.push('- (none)');
    out.push('');
  }

  out.push('## Cancelled (not imported)', '');
  if (!cancelled.length) out.push('None.');
  for (const c of [...cancelled].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))) {
    const why = (Array.isArray(c.changes) ? c.changes : []).map(str).filter(Boolean).join('; ');
    out.push(`- ${c.date ?? '?'} ${str(c.time)} · ${nameOf(str(c.customerName))} · \`${c.key}\`${why ? ` · ${why}` : ''}`);
  }
  out.push('');
  out.push('## Held back as unclear (not imported)', '');
  out.push('No date or no name, or maybe not an order. Add them by hand in the app if they were real orders.', '');
  if (!held.length) out.push('None.');
  for (const h of held) {
    const items = (Array.isArray(h.lines) ? h.lines : []).map((l) => str(l?.text) || str(l?.name)).filter(Boolean).join('; ');
    const why = (Array.isArray(h.flags) ? h.flags : []).map(str).filter(Boolean).join('; ');
    out.push(`- \`${str(h.key)}\` · ${str(h.date) || 'no date'} ${str(h.time)} · ${nameOf(str(h.customerName))} · ${noPrice(items)}${why ? `\n  - ${why}` : ''}`);
  }
  out.push('');
  return noPhones(out.join('\n'));
}

// ---------- command line ----------

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function main() {
  const inDir = arg('--in', '/tmp/claude-0/wa');
  const outDir = arg('--out', here);
  const parts = (arg('--parts', 'A,B,C,D')).split(',');
  const warnings = [];
  const files = [];
  for (const p of parts) {
    const path = join(inDir, `parsed-${p}.json`);
    if (!existsSync(path)) { warnings.push(`parsed-${p}.json is missing: skipped`); continue; }
    files.push({ name: `parsed-${p}.json`, orders: JSON.parse(readFileSync(path, 'utf8')) });
  }
  const held = [];
  for (const p of parts) {
    const path = join(inDir, `unclear-${p}.json`);
    if (existsSync(path)) held.push(...JSON.parse(readFileSync(path, 'utf8')));
  }
  for (const w of warnings) console.warn(`warning: ${w}`);
  const menuPath = join(here, 'menu.json');
  const menu = existsSync(menuPath) ? menuIndex(JSON.parse(readFileSync(menuPath, 'utf8'))) : null;
  if (!menu) console.warn('warning: menu.json missing: dish ids are not checked');
  const { list, report: md } = build(files, { menu, warnings, held });
  writeFileSync(join(outDir, 'orders.json'), JSON.stringify(list, null, 1) + '\n');
  writeFileSync(join(outDir, 'report.md'), md);
  const done = list.filter((x) => x.order.status === 'completed').length;
  console.log(`wrote ${list.length} orders (${done} completed, ${list.length - done} open) to ${join(outDir, 'orders.json')} and report.md`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { main(); } catch (e) { console.error(e.message); process.exit(1); }
}
