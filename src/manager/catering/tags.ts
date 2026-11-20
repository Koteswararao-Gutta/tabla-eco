// Catering name tags: one card per dish for the buffet table or the tray lid, printed on plain letter paper
// (10 per sheet, cut along the marks). Pure helpers: no React, no store.
import type { CateringOrder, ToastMenu } from '@shared/data';
import { dishById, dishFromLine, findDish, menuDishes, orderLines, tidyCase, type Dish } from './lines';

export { dishFromLine };

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

const NON_VEG = [
  'chicken', 'kodi', 'mutton', 'goat', 'lamb', 'keema', 'kheema', 'fish', 'chepa', 'chapa', 'apollo', 'shrimp', 'shrimps',
  'prawn', 'prawns', 'royyala', 'royya', 'egg', 'eggs', 'guddu', 'kodiguddu', 'beef', 'pork', 'meat', 'seafood', 'crab', 'haleem',
  'nihari', 'seekh', 'boti', 'paya', 'mamsam', 'natu', 'pomfret', 'tilapia', 'salmon', 'tuna',
];
const NON_VEG_RE = new RegExp(`\\b(?:${NON_VEG.join('|')})\\b`, 'i');

type ToastItem = Pick<Dish, 'name' | 'description' | 'group'>;

/** Veg or non-veg: from the Toast menu group ("Non-Veg Starters"), else from the words in the dish. Veg when nothing says meat. */
export function guessDiet(name: string, toast: ToastItem | null): Diet {
  const group = toast?.group.toLowerCase() ?? '';
  if (/non[\s-]?veg/.test(group) || NON_VEG_RE.test(group)) return 'nonveg';
  if (NON_VEG_RE.test(name) || (toast && NON_VEG_RE.test(toast.name))) return 'nonveg';
  return 'veg';
}

/** One tag per dish of the order, in order, without repeats. The menu dish (when the line was picked
 *  from the menu) gives the name and veg or non-veg; the note gives the small line. */
export function tagsForOrder(order: Partial<Pick<CateringOrder, 'items' | 'lines'>>, menu?: ToastMenu | null): NameTag[] {
  const dishes = menuDishes(menu);
  const seen = new Set<string>();
  const tags: NameTag[] = [];
  for (const line of orderLines(order, dishes)) {
    // A line kept as typed (an old order) reads its name and small line from the text, as before.
    const { name, sub } = line.text ? dishFromLine(line.text) : { name: line.dishId ? line.name.trim() : tidyCase(line.name.trim()), sub: tidyCase(line.note.trim()) };
    const key = (name + sub).toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (!name || seen.has(key)) continue;
    seen.add(key);
    const dish = dishById(line.dishId, dishes) ?? findDish(name, dishes);
    tags.push({ name, sub, diet: guessDiet(name, dish) });
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
