import { describe, expect, it } from 'vitest';
import type { CateringOrder, OrderLine } from '@shared/data';
import { linesText, type Dish } from '../manager/catering/lines';
import { prepFor } from './prep';

const day = new Date(2026, 10, 20).getTime();
const at = (h: number, addDays = 0) => new Date(2026, 10, 20 + addDays, h).getTime();
const line = (dishId: string | null, name: string, qty: number | null, unit: string, note = '', check = false): OrderLine => ({ dishId, name, qty, unit, note, ...(check ? { check } : {}) });
const order = (customerName: string, dueAt: number, lines: OrderLine[], status: CateringOrder['status'] = 'open', notes = ''): CateringOrder => ({
  id: customerName, customerName, phone: '', dueAt, type: 'pickup', items: linesText(lines), lines, status, createdAt: 0, updatedAt: 0, ...(notes ? { notes } : {}),
});
const dish = (id: string, name: string): Dish => ({ id, name, group: '', description: '' });
const MENU = [dish('s', 'Samosa'), dish('cb', 'Chicken Dum Biryani'), dish('c65', 'Chicken 65'), dish('r', 'Raita')];

describe('prepFor', () => {
  it('adds up menu dishes by unit (Full tray first), one entry per order, only open orders that day', () => {
    const p = prepFor(
      [
        order('Patel', at(12), [line('cb', 'Chicken Dum Biryani', 1, 'Half tray'), line('cb', 'Chicken Dum Biryani', 2, 'Full tray', 'extra spicy'), line('s', 'Samosa', 40, 'Pieces')]),
        order('Smith', at(18), [line('cb', 'Chicken Dum Biryani', 2, 'Full tray')]),
        order('Done', at(13), [line('cb', 'Chicken Dum Biryani', 9, 'Full tray')], 'completed'),
        order('Tomorrow', at(12, 1), [line('cb', 'Chicken Dum Biryani', 5, 'Full tray')]),
      ],
      day,
      MENU,
    );
    expect(p.orders).toBe(2);
    // Menu order: Samosa comes before Chicken Dum Biryani on this menu.
    expect(p.dishes.map((d) => [d.name, d.totals])).toEqual([
      ['Samosa', ['40 pieces']],
      ['Chicken Dum Biryani', ['4 Full trays', '1 Half tray']],
    ]);
    expect(p.dishes[1].from.map((f) => f.text)).toEqual(['12:00 PM Patel: 1 Half tray, 2 Full trays (extra spicy)', '6:00 PM Smith: 2 Full trays']);
    expect(p.others).toEqual([]);
  });

  it('lists typed-in dishes and lines with no quantity as written', () => {
    const p = prepFor([order('Rao', at(11), [line(null, 'Mango cake', 1, 'Pieces'), line('r', 'Raita', null, '')])], day);
    expect(p.dishes).toEqual([]);
    expect(p.others).toEqual([
      { text: 'Mango cake, 1 piece', customer: '11:00 AM Rao' },
      { text: 'Raita', customer: '11:00 AM Rao' },
    ]);
  });

  it('shows the order notes, and a missing name', () => {
    const p = prepFor([order('', at(9), [line('s', 'Samosa', 10, 'Pieces')], 'open', 'Less spicy')], day, MENU);
    expect(p.notes).toEqual([{ customer: '9:00 AM No name', text: 'Less spicy' }]);
    expect(p.dishes[0].from[0].text).toBe('9:00 AM No name: 10 pieces');
  });

  it('uses the menu name and merges unit spellings, so renamed lines still add up', () => {
    const p = prepFor(
      [order('A', at(10), [line('cb', 'Chkn biryani (spicy)', 1, 'full trays')]), order('B', at(11), [line('cb', 'Chicken Dum Biryani', 2, 'FT')])],
      day,
      MENU,
    );
    expect(p.dishes.map((d) => [d.name, d.totals])).toEqual([['Chicken Dum Biryani', ['3 Full trays']]]);
  });

  it('adds up guessed lines but marks them to check', () => {
    const p = prepFor([order('A', at(10), [line('cb', 'Chicken Dum Biryani', 2, 'Full tray', '', true)])], day, MENU);
    expect(p.dishes[0].check).toBe(true);
    expect(p.dishes[0].from[0].check).toBe(true);
  });
});

describe('prepFor with orders saved as plain text', () => {
  const text = (items: string) => ({ ...order('Old', at(10), []), items, lines: undefined });

  it('matches dishes on the menu', () => {
    const p = prepFor([text('Chicken dum biryani, 2 large trays\nMango cake'), order('New', at(12), [line('cb', 'Chicken Dum Biryani', 1, 'Full tray')])], day, MENU);
    expect(p.dishes.map((d) => [d.name, d.totals, d.check])).toEqual([['Chicken Dum Biryani', ['3 Full trays'], false]]);
    expect(p.others).toEqual([{ text: 'Mango cake', customer: '10:00 AM Old' }]);
  });

  it('marks a dish matched only by the start of its name, or a line with two amounts, to check', () => {
    const p = prepFor([text('Chicken 65 Biryani - 2 FT\nSamosa 10 pcs + 20 pcs')], day, MENU);
    expect(p.dishes.map((d) => [d.name, d.check])).toEqual([
      ['Samosa', true],
      ['Chicken 65', true],
    ]);
  });

  it('without the menu, lists everything as written', () => {
    const p = prepFor([text('2 trays veg biryani')], day);
    expect(p.orders).toBe(1);
    expect(p.others.map((x) => x.customer)).toEqual(['10:00 AM Old']);
  });
});

describe('prepFor with 1½ trays', () => {
  it('shows mixed amounts with a dash, never "11/2"', () => {
    const p = prepFor(
      [
        order('Patel', at(12), [line('cb', 'Chicken Dum Biryani', 1.5, 'Full tray')]),
        order('Smith', at(18), [line('cb', 'Chicken Dum Biryani', 1, 'Full tray')]),
        { ...order('Old', at(13), []), lines: undefined, items: 'Chicken dum biryani 11/2 FT' },
      ],
      day,
      MENU,
    );
    expect(p.dishes[0].totals).toEqual(['4 Full trays']);
    expect(p.dishes[0].from.map((f) => f.text)).toEqual(['12:00 PM Patel: 1-1/2 Full trays', '1:00 PM Old: 1-1/2 Full trays', '6:00 PM Smith: 1 Full tray']);
  });
});
