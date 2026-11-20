// Catering order items, structured: each line is a dish (picked from the Toast menu, or typed in), a
// quantity, a unit and an optional note. Pure helpers: no React, no store.
//
// The order also keeps its items as plain text (`items`, made from the lines with lineText), so the
// kitchen, the phone alerts and older app versions keep working, and going back to plain text is easy.
import type { CateringOrder, OrderLine, ToastMenu } from '@shared/data';

// ---------- units ----------

export interface Unit {
  /** What the unit picker shows and the order saves: "Full tray". */
  label: string;
  /** How a quantity reads: "1 Full tray", "2 Full trays". */
  one: string;
  many: string;
}

/** The units the order form offers, in this order. To change the list, change it here (and the same list
 *  in functions/readOrder.js, so a scan or paste uses it too). Old orders keep whatever unit they were saved with. */
export const UNITS: Unit[] = [
  { label: 'Full tray', one: 'Full tray', many: 'Full trays' },
  { label: 'Half tray', one: 'Half tray', many: 'Half trays' },
  { label: 'Pieces', one: 'piece', many: 'pieces' },
  { label: 'Servings', one: 'serving', many: 'servings' },
  { label: 'Lbs', one: 'lb', many: 'lbs' },
  { label: 'Quarts', one: 'quart', many: 'quarts' },
  { label: 'Gallons', one: 'gallon', many: 'gallons' },
  { label: 'Plates', one: 'plate', many: 'plates' },
];

const unitByLabel = (label: string) => UNITS.find((u) => u.label.toLowerCase() === label.trim().toLowerCase()) ?? null;

/** Words people write for each unit. [pattern, unit label, sure]: "tray" alone could be full or half, so it is not sure. */
const UNIT_WORDS: [RegExp, string, boolean][] = [
  [/^(?:(?:full|large|big|lg|lrg)\s*trays?|f\.?t\.?s?|full)$/i, 'Full tray', true],
  [/^(?:(?:half|small|medium|med|sm)\s*trays?|h\.?t\.?s?|half)$/i, 'Half tray', true],
  [/^(?:trays?|pans?)$/i, 'Full tray', false],
  [/^(?:pcs?|pieces?|nos|each|ea|count|ct)$/i, 'Pieces', true],
  [/^(?:servings?|people|persons?|ppl|pax|guests?)$/i, 'Servings', true],
  [/^(?:lbs?|pounds?)$/i, 'Lbs', true],
  [/^(?:quarts?|qts?)$/i, 'Quarts', true],
  [/^(?:gallons?|gal|gals)$/i, 'Gallons', true],
  [/^plates?$/i, 'Plates', true],
  [/^(?:dozen|doz)$/i, 'Pieces', true],
];

/** A unit as written ("FT", "large trays", "pcs") as one of UNITS, else the word as written. */
export function normalizeUnit(word: string): { unit: string; sure: boolean } {
  const w = word.trim().replace(/\.$/, '');
  if (!w) return { unit: '', sure: true };
  const known = unitByLabel(w);
  if (known) return { unit: known.label, sure: true };
  for (const [re, unit, sure] of UNIT_WORDS) if (re.test(w)) return { unit, sure };
  return { unit: tidyCase(w), sure: true };
}

/** "2 Full trays", "40 pieces", "1 lb", "3 Tubs", "40"; '' when there is no quantity and no unit. */
export function qtyText(l: Pick<OrderLine, 'qty' | 'unit'>): string {
  const u = unitByLabel(l.unit);
  const qty = typeof l.qty === 'number' && Number.isFinite(l.qty) ? l.qty : null;
  const unit = (u ? (qty === 1 ? u.one : u.many) : l.unit.trim()) || '';
  if (qty === null) return u ? u.label : unit;
  return unit ? `${qtyNumber(qty)} ${unit}` : qtyNumber(qty);
}
const qtyNumber = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

/** The line as text: "Chicken Dum Biryani, 2 Full trays (extra spicy)". A line kept from an old order reads as typed. */
export function lineText(l: OrderLine): string {
  if (typeof l.text === 'string' && l.text.trim()) return l.text.trim();
  const q = qtyText(l);
  const note = l.note.trim();
  return `${l.name.trim()}${q ? `, ${q}` : ''}${note ? ` (${note})` : ''}`;
}

/** All lines as the order's `items` text, one per line. */
export const linesText = (lines: OrderLine[]) => lines.map(lineText).filter(Boolean).join('\n');

export const itemLines = (items: string) =>
  (typeof items === 'string' ? items : '').split('\n').map((l) => l.trim()).filter(Boolean);

// ---------- the Toast menu ----------

export interface Dish {
  id: string;
  name: string;
  group: string;
  description: string;
}

const cache = new WeakMap<object, Dish[]>();

/** Every dish on the Toast menu, once each (by name), in menu order. Empty when there is no menu yet. */
export function menuDishes(menu: ToastMenu | null | undefined): Dish[] {
  if (!menu || typeof menu !== 'object') return [];
  const hit = cache.get(menu);
  if (hit) return hit;
  const seen = new Set<string>();
  const out: Dish[] = [];
  for (const g of Array.isArray(menu.groups) ? menu.groups : []) {
    for (const i of Array.isArray(g?.items) ? g.items : []) {
      const name = typeof i?.name === 'string' ? i.name.trim() : '';
      const key = norm(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ id: typeof i.id === 'string' && i.id ? i.id : name, name, group: typeof g.name === 'string' ? g.name : '', description: typeof i.description === 'string' ? i.description : '' });
    }
  }
  cache.set(menu, out);
  return out;
}

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

export const dishById = (id: string | null | undefined, dishes: Dish[]) => (id ? dishes.find((d) => d.id === id) ?? null : null);

/** The menu dish a typed name means: same letters, or one name starting with the other
 *  ("Chicken Dum Biryani" vs "Chicken Dum Biryani (Serves 2)"). null when none. */
export function findDish(name: string, dishes: Dish[]): Dish | null {
  const key = norm(name);
  if (!key) return null;
  const exact = dishes.find((d) => norm(d.name) === key);
  if (exact) return exact;
  let best: Dish | null = null;
  for (const d of dishes) {
    const k = norm(d.name);
    if (k.length < 5 || key.length < 5) continue;
    if ((k.startsWith(key) || key.startsWith(k)) && (!best || Math.abs(norm(best.name).length - key.length) > Math.abs(k.length - key.length))) best = d;
  }
  return best;
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Menu dishes for what is typed so far, best first: "chick bir" finds "Chicken Dum Biryani". Every typed
 *  word must start a word of the dish (or, from 3 letters, appear inside it). */
export function searchDishes(query: string, dishes: Dish[], max = 6): Dish[] {
  const q = words(query);
  if (!q.length) return [];
  const whole = norm(query);
  const scored: { d: Dish; score: number }[] = [];
  for (const d of dishes) {
    const w = words(d.name);
    const joined = norm(d.name);
    let score = 0;
    let ok = true;
    for (const t of q) {
      if (w.some((x) => x.startsWith(t))) continue;
      if (t.length >= 3 && joined.includes(t)) {
        score += 2;
        continue;
      }
      ok = false;
      break;
    }
    if (!ok) continue;
    if (joined === whole) score -= 10;
    else if (joined.startsWith(whole)) score -= 5;
    else if (w[0]?.startsWith(q[0])) score -= 2;
    scored.push({ d, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.d.name.length - b.d.name.length || a.d.name.localeCompare(b.d.name))
    .slice(0, max)
    .map((s) => s.d);
}

// ---------- reading a typed line ----------

const SIZE = '(?:(?:extra\\s+)?(?:large|small|medium|big|full|half|lg|lrg|sm|med)\\s+)?';
const UNIT_SRC =
  SIZE +
  '(?:full\\s+trays?|half\\s+trays?|ft|ht|fts|hts|trays?|pans?|tubs?|gallons?|gals?|lbs?|pounds?|pcs?|pieces?|nos|qty|dozen|doz|plates?|boxes?|quarts?|qts?|liters?|litres?|ltrs?|servings?|people|persons?|ppl|pax|guests?)';
const UNITS_RE = UNIT_SRC;
const QTY = `\\d+(?:[.,/]\\d+)?`;
// "6 FT", "15 gallons", "x2", "×3", "2 x"
const LEAD_QTY = new RegExp(`^(?:${QTY}\\s*(?:x|×|\\*)\\s*|${QTY}\\s*(?:${UNITS_RE})\\b\\.?\\s*(?:of\\s+)?|${QTY}\\s+(?=[a-z]))`, 'i');
const TAIL_QTY = new RegExp(
  `(?:\\s*[-–—:,=]\\s*${QTY}\\s*(?:${UNITS_RE})?\\.?|\\s*(?:x|×|\\*)\\s*${QTY}|\\s+${QTY}\\s*(?:${UNITS_RE})\\.?)\\s*$`,
  'i',
);
const QTY_ONLY = new RegExp(`^\\s*(?:x|×)?\\s*${QTY}\\s*(?:${UNITS_RE})?\\.?\\s*$`, 'i');
const QTY_PARTS = new RegExp(`(${QTY})\\s*(${UNITS_RE})?\\b`, 'i');

const SMALL_WORDS = new Set(['and', 'with', 'the', 'for', 'of', 'in', 'on', 'or', 'no']);

/** Capitalises words like a menu: "chicken dum biryani with raita" → "Chicken Dum Biryani with Raita". */
export function tidyCase(s: string): string {
  let first = true;
  return s.replace(/[A-Za-z][A-Za-z']*/g, (w) => {
    const keep = !first && SMALL_WORDS.has(w.toLowerCase());
    first = false;
    if (keep || w[0] !== w[0].toLowerCase()) return w;
    return w[0].toUpperCase() + w.slice(1);
  });
}

/** The dish name (and small line) from one order line: quantities and tray counts dropped. */
export function dishFromLine(line: string): { name: string; sub: string } {
  let s = line.trim().replace(/^(?:[-*•·]+|\d+[.)])\s+/, '');
  // Bracketed bits: quantities are dropped, anything else ("Bone-in", "no onion") becomes the small line.
  const subs: string[] = [];
  s = s.replace(/\s*[([]([^)\]]*)[)\]]/g, (_, inner: string) => {
    const t = inner.trim();
    if (t && !QTY_ONLY.test(t)) subs.push(t);
    return ' ';
  });
  s = s.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s.replace(TAIL_QTY, '').trim();
    s = s.replace(LEAD_QTY, '').trim();
    if (s === before) break;
  }
  s = s.replace(/^[-–—:,\s]+|[-–—:,\s]+$/g, '');
  return { name: tidyCase(s), sub: tidyCase(subs.join(', ')) };
}

/** The quantity and unit written on a line ("Chicken biryani, 2 large trays" → 2, Full tray). */
function qtyFromLine(line: string): { qty: number | null; unit: string; sure: boolean } {
  const s = line.trim().replace(/^(?:[-*•·]+|\d+[.)])\s+/, '');
  const name = dishFromLine(line).name;
  // Look in what is left once the dish name is taken out, so "Chicken 65, 2 trays" reads 2, not 65.
  const nameAt = name ? s.toLowerCase().indexOf(name.toLowerCase()) : -1;
  const rest = nameAt >= 0 ? s.slice(0, nameAt) + ' ' + s.slice(nameAt + name.length) : s;
  const m = QTY_PARTS.exec(rest);
  if (!m) return { qty: null, unit: '', sure: false };
  const raw = m[1].replace(',', '.');
  let qty: number;
  if (raw.includes('/')) {
    const [a, b] = raw.split('/').map(Number);
    qty = b ? a / b : NaN;
  } else qty = parseFloat(raw);
  if (!Number.isFinite(qty) || qty <= 0) return { qty: null, unit: '', sure: false };
  const word = (m[2] ?? '').trim();
  const { unit, sure } = normalizeUnit(word);
  if (/^(?:dozen|doz)$/i.test(word)) qty *= 12;
  return { qty: Math.round(qty * 100) / 100, unit, sure };
}

/** One typed line as a structured line. `sure` is false when the dish isn't on the menu or the quantity
 *  or unit was a guess. `text` keeps the line as typed. */
export function parseLine(line: string, dishes: Dish[] = []): { line: OrderLine; sure: boolean } {
  const text = line.trim();
  const { name: typed, sub } = dishFromLine(text);
  const dish = findDish(typed, dishes);
  const q = qtyFromLine(text);
  const name = dish?.name ?? typed;
  const sure = !!dish && q.qty !== null && q.sure;
  return { line: { dishId: dish?.id ?? null, name, qty: q.qty, unit: q.unit, note: sub ? sub.charAt(0).toLowerCase() + sub.slice(1) : '', text, ...(sure ? {} : { check: true }) }, sure };
}

const validLine = (l: unknown): l is OrderLine =>
  !!l && typeof l === 'object' && typeof (l as OrderLine).name === 'string' && typeof (l as OrderLine).unit === 'string' && typeof (l as OrderLine).note === 'string';

/** The order's items as structured lines. Uses the saved lines when they still match the items text;
 *  otherwise (an old order, or one edited by an older app version) reads them from the text. */
export function orderLines(o: Partial<Pick<CateringOrder, 'items' | 'lines'>>, dishes: Dish[] = []): OrderLine[] {
  const text = itemLines(o.items ?? '');
  const saved = o.lines;
  if (Array.isArray(saved) && saved.length === text.length && saved.every((l, i) => validLine(l) && lineText(l) === text[i])) return saved;
  return text.map((t) => parseLine(t, dishes).line);
}

/** Lines saved without anything undefined (Firestore refuses undefined). */
export function cleanLine(l: OrderLine): OrderLine {
  const out: OrderLine = { dishId: l.dishId ?? null, name: l.name.trim(), qty: typeof l.qty === 'number' && Number.isFinite(l.qty) ? l.qty : null, unit: l.unit.trim(), note: l.note.trim() };
  if (typeof l.text === 'string' && l.text.trim()) out.text = l.text.trim();
  if (l.check) out.check = true;
  return out;
}
