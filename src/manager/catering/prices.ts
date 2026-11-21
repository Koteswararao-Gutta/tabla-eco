// Catering prices: what each estimate line costs. Pure helpers: no React, no store.
//
// A dish has one full-tray price; a half tray is half of it (and 3/4 of a full tray is three quarters).
// A dish with no price of its own uses the full-tray price for its kind (veg; chicken and paneer;
// goat, lamb and fish). Pieces (samosa, kebab, tikki) are priced by hand on each estimate for now.
// The manager edits all of this under ☰ More > Catering prices; until then the starting prices below are used.
import type { CateringPrices, EstimateLine } from '@shared/data';
import { norm } from './lines';

// ---------- starting prices (from past catering orders, Nov 2026) ----------

export type Kind = keyof CateringPrices['defaults'];

export const KINDS: { value: Kind; label: string }[] = [
  { value: 'veg', label: 'Veg' },
  { value: 'chicken', label: 'Chicken and paneer' },
  { value: 'meat', label: 'Goat, lamb and fish' },
];

/** The owner's prices (Nov 21, 2026): veg $80 half / $160 full, chicken or paneer $85 / $170,
 *  goat, lamb or fish $90 / $180. */
export const STARTING_PRICES: CateringPrices = {
  trays: {},
  defaults: { veg: 160, chicken: 170, meat: 180 },
  taxPercent: 0,
  updatedAt: 0,
};

// ---------- reading the saved list ----------

const money = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null);

function priceMap(v: unknown): Record<string, number> {
  if (!v || typeof v !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [k, p] of Object.entries(v)) {
    const m = money(p);
    if (k && m !== null) out[k] = m;
  }
  return out;
}

/** The saved price list made safe to use; the starting prices when nothing is saved (null) yet. */
export function priceList(saved: Partial<CateringPrices> | null | undefined): CateringPrices {
  if (!saved) return STARTING_PRICES;
  const d = saved.defaults ?? STARTING_PRICES.defaults;
  return {
    trays: priceMap(saved.trays),
    defaults: {
      veg: money(d.veg) ?? STARTING_PRICES.defaults.veg,
      chicken: money(d.chicken) ?? STARTING_PRICES.defaults.chicken,
      meat: money(d.meat) ?? STARTING_PRICES.defaults.meat,
    },
    taxPercent: Math.min(50, money(saved.taxPercent) ?? 0),
    updatedAt: typeof saved.updatedAt === 'number' ? saved.updatedAt : 0,
  };
}

// ---------- pricing a dish ----------

/** The kind of dish, from its name: goat, lamb or fish (and other seafood); chicken, egg or paneer; else veg. */
export function kindOf(name: string): Kind {
  const n = name.toLowerCase();
  if (/goat|lamb|mutton|fish|shrimp|prawn|seafood|crab|apollo/.test(n)) return 'meat';
  if (/chicken|\bchk\b|\begg\b|\bwings?\b|paneer|panner|paner/.test(n)) return 'chicken';
  return 'veg';
}

/** A dish's full-tray price: its own, else its kind's. */
export function trayPrice(name: string, list: CateringPrices): number {
  return list.trays[norm(name)] ?? list.defaults[kindOf(name)];
}

const TRAY_SHARE: Record<string, number> = { 'full tray': 1, 'half tray': 0.5 };

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * What a line costs from the price list, or null when the list can't tell (no quantity, or not in trays:
 * pieces, servings, lbs): then staff type the price. An auto extra (raita, salan, chutney) is free: 0.
 */
export function listPrice(line: Pick<EstimateLine, 'name' | 'qty' | 'unit' | 'extra'>, list: CateringPrices): number | null {
  if (line.extra) return 0;
  const qty = line.qty;
  if (qty === null || !Number.isFinite(qty) || qty <= 0 || !line.name.trim()) return null;
  const unit = line.unit.trim().toLowerCase();
  const share = TRAY_SHARE[unit];
  if (share !== undefined) return cents(qty * share * trayPrice(line.name, list));
  return null;
}

// ---------- totals ----------

export interface Totals {
  subtotal: number;
  discount: number;
  deliveryFee: number;
  tax: number;
  total: number;
}

/** Subtotal of the line prices, less the discount, plus delivery, plus tax on the food after the discount. */
export function totals(prices: (number | null)[], discount: number | null, deliveryFee: number | null, taxPercent: number): Totals {
  const subtotal = cents(prices.reduce<number>((a, p) => a + (p ?? 0), 0));
  const off = Math.min(subtotal, Math.max(0, discount ?? 0));
  const fee = Math.max(0, deliveryFee ?? 0);
  const tax = cents(((subtotal - off) * Math.max(0, taxPercent)) / 100);
  return { subtotal, discount: off, deliveryFee: fee, tax, total: cents(subtotal - off + fee + tax) };
}
