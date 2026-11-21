// Auto extras: the sides that always go with some dishes (raita and salan with every biryani, chutneys
// with samosas, ...), added to the order as their own rows, marked "extra". Pure helpers: no React, no store.
//
// To change what goes with what, or how much, change EXTRA_RULES (and the sizes below). Nothing else.
import type { LineDraft } from './orders';
import { parseQty } from './orders';

// ---------- the rules (edit here) ----------

export interface ExtraRule {
  /** Words in a dish name that bring this rule ("biryani" matches "Chicken Dum Biryani"). */
  dishes: string[];
  /** Dishes whose name has any of these words are left out ("Samosa Chaat" has its own chutneys). */
  except?: string[];
  /** The extras, as they are called in the kitchen. The same name in two rules adds up into one row. */
  extras: string[];
  /** Ounces of each extra per piece of the dish. */
  ozPerPiece?: number;
  /** Ounces of each extra per full tray of the dish. */
  ozPerTray?: number;
  /** Ounces of each extra for up to a full tray of the dish: [trays, oz], smallest first. More than a full
   *  tray gets the full-tray amount for each tray. */
  trayTable?: [number, number][];
}

/** First matching rule wins, so "Chicken 65 Biryani" gets the biryani extras, not the dry-item dip. */
export const EXTRA_RULES: ExtraRule[] = [
  // Half tray: 24 oz each. Full tray: 1/4 tray each.
  { dishes: ['biryani', 'biriyani', 'biriani'], extras: ['Raita', 'Salan'], ozPerTray: 48 },
  // 2 oz of each for every 2 samosas.
  { dishes: ['samosa'], except: ['chaat'], extras: ['Mint Chutney', 'Tamarind Chutney'], ozPerPiece: 1 },
  // 2 oz for every 4 tikkis.
  { dishes: ['beetroot tikki', 'beet tikki', 'croquet'], extras: ['Chilli Dip'], ozPerPiece: 0.5 },
  // Dry items. 1/4 tray: 16 oz. 1/2 tray: 24 oz. Full tray: 38 oz.
  { dishes: ['65', 'kebab', 'kabab', 'kabob', 'kebob'], extras: ['Mint Chutney'], trayTable: [[0.25, 16], [0.5, 24], [1, 38]] },
];

/** Roughly how many pieces (samosas, tikkis, kebabs) fill a full tray, to go between pieces and trays. */
export const PIECES_PER_TRAY = 50;

/** The containers an extra goes in, smallest first, with how many ounces each holds. An amount is rounded
 *  up to the first one that fits; above a full tray it is rounded up to quarter trays. */
export const CONTAINERS: { oz: number; qty: number; unit: string }[] = [
  { oz: 8, qty: 8, unit: 'Oz' },
  { oz: 16, qty: 16, unit: 'Oz' },
  { oz: 24, qty: 24, unit: 'Oz' },
  { oz: 38, qty: 38, unit: 'Oz' },
  { oz: 48, qty: 0.25, unit: 'Full tray' },
  { oz: 96, qty: 0.5, unit: 'Full tray' },
  { oz: 144, qty: 0.75, unit: 'Full tray' },
  { oz: 192, qty: 1, unit: 'Full tray' },
];

// ---------- working it out ----------

const QUARTER_TRAY_OZ = 48;

/** The rule for a dish name, or null. */
export function ruleFor(name: string): ExtraRule | null {
  const n = ` ${name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
  // A number must be the whole word ("65", not "650"); a word may go on ("croquet" finds "Croquettes").
  const has = (w: string) => n.includes(/^\d+$/.test(w) ? ` ${w} ` : ` ${w}`);
  return EXTRA_RULES.find((r) => r.dishes.some(has) && !(r.except ?? []).some(has)) ?? null;
}

/** Ounces of each extra for one dish line; null when the amount can't be worked out (no quantity, or a
 *  unit like Servings that doesn't say how much). */
export function extraOz(rule: ExtraRule, qty: number | null, unit: string): number | null {
  if (qty === null || !Number.isFinite(qty) || qty <= 0) return null;
  const u = unit.trim().toLowerCase();
  const trays = u === 'full tray' ? qty : u === 'half tray' ? qty / 2 : u === 'pieces' ? qty / PIECES_PER_TRAY : null;
  if (trays === null) return null;
  if (rule.ozPerPiece !== undefined) return trays * PIECES_PER_TRAY * rule.ozPerPiece;
  if (rule.ozPerTray !== undefined) return trays * rule.ozPerTray;
  const t = rule.trayTable ?? [];
  if (!t.length) return null;
  if (trays > 1) return trays * t[t.length - 1][1];
  return (t.find(([upTo]) => trays <= upTo + 1e-9) ?? t[t.length - 1])[1];
}

/** An amount in ounces as the container it goes in: 20 → 24 Oz, 60 → 1/2 Full tray, 250 → 1-1/2 Full trays. */
export function container(oz: number): { qty: number; unit: string } {
  const c = CONTAINERS.find((x) => oz <= x.oz + 1e-9);
  if (c) return { qty: c.qty, unit: c.unit };
  return { qty: Math.ceil(oz / QUARTER_TRAY_OZ - 1e-9) / 4, unit: 'Full tray' };
}

export interface Extra {
  /** The extra's name: also how its row is found again ("Raita"). */
  key: string;
  /** null when no dish line says how much: the row is added with an empty amount to fill in. */
  qty: number | null;
  unit: string;
}

/** The extras for the order's dish lines, in rule order, each added up over all its dishes. */
export function extrasFor(lines: { name: string; qty: number | null; unit: string }[]): Extra[] {
  const total = new Map<string, number | null>();
  for (const l of lines) {
    const rule = l.name.trim() ? ruleFor(l.name) : null;
    if (!rule) continue;
    const oz = extraOz(rule, l.qty, l.unit);
    for (const e of rule.extras) {
      const had = total.get(e);
      total.set(e, oz === null ? had ?? null : (had ?? 0) + oz);
    }
  }
  const order = EXTRA_RULES.flatMap((r) => r.extras);
  return [...total.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([key, oz]) => (oz === null ? { key, qty: null, unit: '' } : { key, ...container(oz) }));
}

const qtyBox = (q: number | null) => (q === null ? '' : String(Math.round(q * 100) / 100));
const parsed = (text: string) => {
  const q = parseQty(text);
  return q === null || Number.isNaN(q) ? null : q;
};

/** The extras a row list should have but doesn't: what counts as "taken off" when an order is opened. */
export function missingExtras(drafts: LineDraft[]): string[] {
  const have = new Set(drafts.filter((d) => d.extra).map((d) => d.extra));
  return extrasFor(drafts.filter((d) => !d.extra).map((d) => ({ name: d.name, qty: parsed(d.qty), unit: d.unit })))
    .map((e) => e.key)
    .filter((k) => !have.has(k));
}

/**
 * The form's rows with their extras up to date: dish rows first, then the extras. An extra nobody has
 * changed follows its dishes (new amount, or gone when its dishes are gone). An extra someone changed
 * stays as they left it. An extra in `off` (taken off by hand) isn't added back.
 */
export function withExtras(drafts: LineDraft[], off: ReadonlySet<string>): LineDraft[] {
  const mains = drafts.filter((d) => !d.extra);
  const want = extrasFor(mains.map((d) => ({ name: d.name, qty: parsed(d.qty), unit: d.unit })));
  const rows: LineDraft[] = [];
  for (const w of want) {
    const had = drafts.find((d) => d.extra === w.key);
    if (had?.extraEdited) rows.push(had);
    else if (had) rows.push({ ...had, name: had.name || w.key, qty: qtyBox(w.qty), unit: w.unit });
    else if (!off.has(w.key)) rows.push({ dishId: null, name: w.key, qty: qtyBox(w.qty), unit: w.unit, note: '', extra: w.key });
  }
  // Extras someone changed stay even when their dishes are gone: they meant them.
  for (const d of drafts) if (d.extra && d.extraEdited && !want.some((w) => w.key === d.extra)) rows.push(d);
  return [...mains, ...rows];
}
