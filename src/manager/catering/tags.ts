// Catering name tags: one card per dish for the buffet table or the tray lid, printed on plain letter paper
// (10 per sheet, cut along the marks). Pure helpers: no React, no store.
import type { CateringOrder, ToastMenu } from '@shared/data';
import { itemLines } from './orders';

export type Diet = 'veg' | 'nonveg';

export interface NameTag {
  /** "Andhra Chicken Curry" */
  name: string;
  /** Small line under the name, from brackets on the order line: "Bone-in". Empty when none. */
  sub: string;
  diet: Diet | null;
}

export const TAGS_PER_SHEET = 10;
export const TAG_SITE = 'tablausa.com/phoenix';

const SIZE = '(?:(?:extra\\s+)?(?:large|small|medium|big|full|half|lg|sm|med)\\s+)?';
const UNITS =
  SIZE +
  '(?:full\\s+trays?|half\\s+trays?|ft|ht|fts|hts|trays?|pans?|tubs?|gallons?|gal|lbs?|pounds?|pcs|pieces?|nos|qty|dozen|doz|plates?|boxes?|quarts?|qt|liters?|litres?|ltrs?|servings?|people|ppl|pax)';
const QTY = `\\d+(?:[.,/]\\d+)?`;
// "6 FT", "15 gallons", "x2", "×3", "2 x"
const LEAD_QTY = new RegExp(`^(?:${QTY}\\s*(?:x|×|\\*)\\s*|${QTY}\\s*(?:${UNITS})\\b\\.?\\s*(?:of\\s+)?|${QTY}\\s+(?=[a-z]))`, 'i');
const TAIL_QTY = new RegExp(
  `(?:\\s*[-–—:,=]\\s*${QTY}\\s*(?:${UNITS})?\\.?|\\s*(?:x|×|\\*)\\s*${QTY}|\\s+${QTY}\\s*(?:${UNITS})\\.?)\\s*$`,
  'i',
);
const QTY_ONLY = new RegExp(`^\\s*(?:x|×)?\\s*${QTY}\\s*(?:${UNITS})?\\.?\\s*$`, 'i');

const NON_VEG = [
  'chicken', 'kodi', 'mutton', 'goat', 'lamb', 'keema', 'kheema', 'fish', 'chepa', 'chapa', 'apollo', 'shrimp', 'shrimps',
  'prawn', 'prawns', 'royyala', 'royya', 'egg', 'eggs', 'guddu', 'kodiguddu', 'beef', 'pork', 'meat', 'seafood', 'crab', 'haleem',
  'nihari', 'seekh', 'boti', 'paya', 'mamsam', 'natu', 'pomfret', 'tilapia', 'salmon', 'tuna',
];
const NON_VEG_RE = new RegExp(`\\b(?:${NON_VEG.join('|')})\\b`, 'i');

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

const SMALL_WORDS = new Set(['and', 'with', 'the', 'for', 'of', 'in', 'on', 'or', 'no']);

/** Capitalises words like a menu: "chicken dum biryani with raita" → "Chicken Dum Biryani with Raita". */
function tidyCase(s: string): string {
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

type ToastItem = { name: string; description: string; group: string };

/** Toast menu items by their squashed name, for looking up a dish's group and description. */
export function toastIndex(menu: ToastMenu | null | undefined): Map<string, ToastItem> {
  const map = new Map<string, ToastItem>();
  for (const g of Array.isArray(menu?.groups) ? menu!.groups : []) {
    for (const i of Array.isArray(g?.items) ? g.items : []) {
      if (typeof i?.name !== 'string' || !i.name.trim()) continue;
      const key = norm(i.name);
      if (key && !map.has(key)) map.set(key, { name: i.name.trim(), description: i.description ?? '', group: g.name ?? '' });
    }
  }
  return map;
}

function findToast(name: string, index: Map<string, ToastItem>): ToastItem | null {
  const key = norm(name);
  if (!key) return null;
  const exact = index.get(key);
  if (exact) return exact;
  // "Chicken Dum Biryani" on the order vs "Chicken Dum Biryani (Serves 2)" on Toast, or the other way round.
  let best: ToastItem | null = null;
  for (const [k, v] of index) {
    if (k.length < 5 || key.length < 5) continue;
    if ((k.startsWith(key) || key.startsWith(k)) && (!best || Math.abs(norm(best.name).length - key.length) > Math.abs(k.length - key.length))) best = v;
  }
  return best;
}

/** Veg or non-veg: from the Toast menu group ("Non-Veg Starters"), else from the words in the dish. Veg when nothing says meat. */
export function guessDiet(name: string, toast: ToastItem | null): Diet {
  const group = toast?.group.toLowerCase() ?? '';
  if (/non[\s-]?veg/.test(group) || NON_VEG_RE.test(group)) return 'nonveg';
  if (NON_VEG_RE.test(name) || (toast && NON_VEG_RE.test(toast.name))) return 'nonveg';
  return 'veg';
}

/** One tag per dish line of the order, in order, without repeats. */
export function tagsForOrder(order: Pick<CateringOrder, 'items'>, menu?: ToastMenu | null): NameTag[] {
  const index = toastIndex(menu);
  const seen = new Set<string>();
  const tags: NameTag[] = [];
  for (const line of itemLines(order.items ?? '')) {
    const { name, sub } = dishFromLine(line);
    const key = norm(name + sub);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    const toast = findToast(name, index);
    tags.push({ name, sub, diet: guessDiet(name, toast) });
  }
  return tags;
}

/** Splits tags into printed sheets of 10. */
export function sheets<T>(tags: T[], perSheet = TAGS_PER_SHEET): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < tags.length; i += perSheet) out.push(tags.slice(i, i + perSheet));
  return out;
}

/** Name-length class so long dish names still fit two lines: '' | 'long' | 'xlong'. */
export function nameSize(name: string): '' | 'long' | 'xlong' {
  const longestWord = Math.max(0, ...name.split(/\s+/).map((w) => w.length));
  if (name.length > 34 || longestWord > 16) return 'xlong';
  if (name.length > 22 || longestWord > 12) return 'long';
  return '';
}

export const DIET_LABEL: Record<Diet, string> = { veg: 'Vegetarian', nonveg: 'Non-vegetarian' };
