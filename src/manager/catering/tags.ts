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

// What a tag leaves out of a dish name: portion counts and sizes ("(6 pcs)", "(Serves 2)", "(16 oz)") and
// menu markers ("(V)", "(GF)", "(Spicy)"). A marker still tells veg or non-veg.
const PORTION = /^(?:\d+(?:[.-]\d+(?:\/\d+)?)?\s*(?:pcs?|pieces?|nos|ct|count|oz|ounces?|lbs?|ml|l|qts?|quarts?|gal|gallons?|inch|in|"|ft|ht|full\s+trays?|half\s+trays?|trays?|plates?|servings?)?\.?|serves?\s*\d+(?:\s*-\s*\d+)?|(?:small|medium|large|regular|family(?:\s+pack)?|half|full)(?:\s+(?:size|tray|pack))?)$/i;
const MARKER = /^(?:v|vg|veg|vegan|vegetarian|nv|non[\s-]?veg(?:etarian)?|gf|df|jain|spicy|mild|hot|new|chef'?s\s+special|special|signature|popular)$/i;
const VEG_MARK = /^(?:v|vg|veg|vegan|vegetarian|jain)$/i;
const NONVEG_MARK = /^(?:nv|non[\s-]?veg(?:etarian)?)$/i;
// A note in brackets on a typed line ("extra spicy", "cut in 4", "on the side") is for the kitchen, not the tag.
const KITCHEN_NOTE = /\b(?:spicy|spice|mild|medium|hot|less|more|extra|no|without|add|side|separate|separately|cut|sliced|pack|packed|sauce|gravy|oil|salt|sweet|onion|garlic|cilantro|chutney|hold|please|pls|deliver|pickup|warm|cold)\b/i;
// A note from reading a paper order ("Veg crossed out, written as Baby Corn above it", "Not on menu as written")
// is for the staff checking the scan, not the guest.
const SCAN_NOTE = /\b(?:menu|written|writing|wrote|crossed|cross|scratched|unclear|illegible|unreadable|readable|maybe|probably|likely|guess|check|confirm|verify|ask|above|below|margin|paper|handwriting|scan|scanned|typo|spelled|spelling|not|unsure|unknown)\b|\?/i;
/** A tag's small line holds only a short describing word or two ("Dry", "Bone-in", "Boneless"), never a sentence or a note. */
const tagNote = (t: string) =>
  !!t && t.split(/\s+/).length <= 3 && t.length <= 24 && !PORTION.test(t) && !MARKER.test(t) && !KITCHEN_NOTE.test(t) && !SCAN_NOTE.test(t);

/** A dish name for a tag, and its small line: "Onion Samosa (6 pcs) (V)" → "Onion Samosa"; "Andhra Chicken Curry (Bone-in)" →
 *  "Andhra Chicken Curry" with "Bone-in" under it. `mark` is the veg or non-veg a menu marker gave, if any. */
export function tagName(raw: string): { name: string; sub: string; mark: Diet | null } {
  const subs: string[] = [];
  let mark: Diet | null = null;
  const name = raw
    .replace(/\s*[([]([^)\]]*)[)\]]/g, (_, inner: string) => {
      const t = inner.trim();
      if (VEG_MARK.test(t)) mark = 'veg';
      else if (NONVEG_MARK.test(t)) mark = 'nonveg';
      if (tagNote(t)) subs.push(t);
      return ' ';
    })
    // "Spring Rolls - 6 pc", "Gulab Jamun 4pc" at the end of a menu name
    .replace(/\s*[-–—,]?\s*\d+\s*(?:pcs?|pieces?)\.?\s*$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/^[-–—:,\s]+|[-–—:,\s]+$/g, '')
    .trim();
  return { name: tidyCase(name), sub: tidyCase(subs.join(', ')), mark };
}

/** Veg or non-veg: from the Toast menu group ("Non-Veg Starters"), else from the words in the dish. Veg when nothing says meat. */
export function guessDiet(name: string, toast: ToastItem | null): Diet {
  const group = toast?.group.toLowerCase() ?? '';
  if (/non[\s-]?veg/.test(group) || NON_VEG_RE.test(group)) return 'nonveg';
  if (NON_VEG_RE.test(name) || (toast && NON_VEG_RE.test(toast.name))) return 'nonveg';
  return 'veg';
}

/** One tag per dish of the order, in order, without repeats ("Samosa" and "Samosas" are one): just the dish,
 *  never the quantity or unit. The line's note goes under the name ("Bone-in"), unless it is for the kitchen
 *  ("extra spicy") or from reading the paper order ("not on menu as written"). The menu dish, when the line has one, gives the name and veg or non-veg. */
export function tagsForOrder(order: Partial<Pick<CateringOrder, 'items' | 'lines'>>, menu?: ToastMenu | null): NameTag[] {
  const dishes = menuDishes(menu);
  const seen = new Set<string>();
  const tags: NameTag[] = [];
  for (const line of orderLines(order, dishes)) {
    const menuDish = dishById(line.dishId, dishes);
    // The menu's name when the line is a menu dish; else the line's own name (an old order's line was read
    // from its text once, without its amount). The text is never read again here.
    const raw = menuDish?.name ?? line.name;
    const note = line.extra ? '' : line.note.trim();
    const { name, sub: nameSub, mark } = tagName(raw);
    const sub = nameSub || (tagNote(note) ? tidyCase(note) : '');
    const key = name.toLowerCase().split(/[^a-z0-9]+/).map((w) => (w.length > 3 ? w.replace(/s$/, '') : w)).join('');
    if (!name || seen.has(key)) continue;
    seen.add(key);
    const dish = menuDish ?? findDish(raw, dishes) ?? findDish(name, dishes);
    tags.push({ name, sub, diet: mark ?? guessDiet(name, dish) });
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

/** About the most a tag's two lines hold at the smallest size (capitals are wider); a longer name is cut
 *  short when printed. Checked by eye on the printed sheet: 56 plain letters fit, 60 often don't. */
export const TAG_NAME_FITS = 58;
export const tooLong = (name: string) => {
  const t = name.trim();
  return t.length + 0.3 * (t.match(/[A-Z]/g) ?? []).length > TAG_NAME_FITS;
};

export const DIET_LABEL: Record<Diet, string> = { veg: 'Vegetarian', nonveg: 'Non-vegetarian' };
