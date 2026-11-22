import { describe, expect, it } from 'vitest';
import { kindOf, listPrice, priceList, STARTING_PRICES, totals, trayPrice } from './prices';
import { norm } from './lines';

describe('catering prices', () => {
  it("uses the owner's tray prices by kind", () => {
    expect(trayPrice('Hyderabadi Veg Dum Biryani', STARTING_PRICES)).toBe(160);
    expect(trayPrice('Gobi 65', STARTING_PRICES)).toBe(160);
    expect(trayPrice('Vijayawada Boneless Chicken Biryani', STARTING_PRICES)).toBe(170);
    expect(trayPrice('Paneer Tikka Masala', STARTING_PRICES)).toBe(170);
    expect(trayPrice('Goat Fry Biryani', STARTING_PRICES)).toBe(180);
    expect(trayPrice('Apollo Fish', STARTING_PRICES)).toBe(180);
    expect(trayPrice('Lamb Tikka Masala', STARTING_PRICES)).toBe(180);
  });

  it('sorts dishes into kinds', () => {
    expect(kindOf('Egg Biryani')).toBe('chicken');
    expect(kindOf('Chilli Panner')).toBe('chicken');
  });
  it('knows Telugu and other meat names (the same words as the name tags)', () => {
    for (const n of ['Gongura Mamsam', 'Chepa Pulusu', 'Royyala Iguru', 'Keema Biryani', 'Haleem', 'Mutton Paya']) expect(kindOf(n)).toBe('meat');
    for (const n of ['Kodi Vepudu', 'Natu Kodi Pulusu', 'Kodiguddu Fry', 'Chicken Keema', 'Chicken Haleem', 'Boiled Eggs']) expect(kindOf(n)).toBe('chicken');
    for (const n of ['Gongura Pappu', 'Dal Tadka', 'Chapati', 'Bagara Rice']) expect(kindOf(n)).toBe('veg');
    expect(kindOf('Shrimp Biryani')).toBe('meat');
    expect(kindOf('Malai Kofta')).toBe('veg');
    expect(kindOf('Eggplant Curry')).toBe('veg');
  });

  it('prices trays in proportion: half tray is half, 3/4 is three quarters', () => {
    const l = (qty: number | null, unit: string, name = 'Chicken 65') => listPrice({ name, qty, unit }, STARTING_PRICES);
    expect(l(1, 'Full tray')).toBe(170);
    expect(l(1, 'Half tray')).toBe(85);
    expect(l(0.75, 'Full tray')).toBe(127.5);
    expect(l(1.5, 'Full tray', 'Veg Biryani')).toBe(240);
    expect(l(2, 'Half tray', 'Goat Curry')).toBe(180);
  });

  it('leaves pieces, other units and missing amounts to be typed', () => {
    expect(listPrice({ name: 'Onion Samosa', qty: 50, unit: 'Pieces' }, STARTING_PRICES)).toBeNull();
    expect(listPrice({ name: 'Chicken Biryani', qty: 40, unit: 'Servings' }, STARTING_PRICES)).toBeNull();
    expect(listPrice({ name: 'Chicken Biryani', qty: null, unit: 'Full tray' }, STARTING_PRICES)).toBeNull();
  });

  it('gives extras free', () => {
    expect(listPrice({ name: 'Raita', qty: 24, unit: 'Oz', extra: 'Raita' }, STARTING_PRICES)).toBe(0);
  });

  it("uses a dish's own price over its kind", () => {
    const list = priceList({ ...STARTING_PRICES, trays: { [norm('Chicken 65')]: 190 } });
    expect(listPrice({ name: 'Chicken 65', qty: 1, unit: 'Half tray' }, list)).toBe(95);
    expect(listPrice({ name: 'Chicken Fry', qty: 1, unit: 'Half tray' }, list)).toBe(85);
  });

  it('reads a broken saved list safely', () => {
    const list = priceList({ trays: { a: -5, b: 'x' as unknown as number, c: 100 }, defaults: { veg: NaN } as never, taxPercent: 900 });
    expect(list.trays).toEqual({ c: 100 });
    expect(list.defaults).toEqual(STARTING_PRICES.defaults);
    expect(list.taxPercent).toBe(50);
    expect(priceList(null)).toBe(STARTING_PRICES);
  });

  it('adds up: discount off the food, delivery on top, tax on food after discount', () => {
    expect(totals([170, 85, null], null, null, 0)).toEqual({ subtotal: 255, discount: 0, deliveryFee: 0, tax: 0, total: 255 });
    expect(totals([200], 20, 25, 10)).toEqual({ subtotal: 200, discount: 20, deliveryFee: 25, tax: 18, total: 223 });
    expect(totals([50], 80, null, 0).total).toBe(0);
  });
});
