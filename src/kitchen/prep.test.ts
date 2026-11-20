import { describe, expect, it } from 'vitest';
import type { CateringOrder, OrderLine } from '@shared/data';
import { linesText } from '../manager/catering/lines';
import { prepFor } from './prep';

const day = new Date(2026, 10, 20).getTime();
const at = (h: number, addDays = 0) => new Date(2026, 10, 20 + addDays, h).getTime();
const line = (dishId: string | null, name: string, qty: number | null, unit: string, note = ''): OrderLine => ({ dishId, name, qty, unit, note });
const order = (customerName: string, dueAt: number, lines: OrderLine[], status: CateringOrder['status'] = 'open'): CateringOrder => ({
  id: customerName, customerName, phone: '', dueAt, type: 'pickup', items: linesText(lines), lines, status, createdAt: 0, updatedAt: 0,
});

describe('prepFor', () => {
  it('adds up menu dishes by unit, only for open orders on that day', () => {
    const p = prepFor(
      [
        order('Patel', at(12), [line('b', 'Chicken Biryani', 2, 'Full tray', 'extra spicy'), line('s', 'Samosa', 40, 'Pieces')]),
        order('Smith', at(18), [line('b', 'Chicken Biryani', 2, 'Full tray'), line('b', 'Chicken Biryani', 1, 'Half tray')]),
        order('Done', at(13), [line('b', 'Chicken Biryani', 9, 'Full tray')], 'completed'),
        order('Tomorrow', at(12, 1), [line('b', 'Chicken Biryani', 5, 'Full tray')]),
      ],
      day,
    );
    expect(p.orders).toBe(2);
    expect(p.dishes).toEqual([
      { name: 'Chicken Biryani', totals: ['4 Full trays', '1 Half tray'], from: ['Patel: 2 Full trays (extra spicy)', 'Smith: 2 Full trays', 'Smith: 1 Half tray'] },
      { name: 'Samosa', totals: ['40 pieces'], from: ['Patel: 40 pieces'] },
    ]);
    expect(p.others).toEqual([]);
  });

  it('lists typed-in dishes and lines with no quantity as written', () => {
    const p = prepFor([order('Rao', at(11), [line(null, 'Mango cake', 1, 'Pieces'), line('r', 'Raita', null, '')])], day);
    expect(p.dishes).toEqual([]);
    expect(p.others).toEqual([
      { text: 'Mango cake, 1 piece', customer: 'Rao' },
      { text: 'Raita', customer: 'Rao' },
    ]);
  });

  it('reads old orders saved as plain text', () => {
    const o = { ...order('Old', at(10), []), items: '2 trays veg biryani', lines: undefined };
    const p = prepFor([o], day);
    expect(p.orders).toBe(1);
    expect(p.others.map((x) => x.customer)).toEqual(['Old']);
  });
});

describe('prepFor with the menu', () => {
  it('matches dishes in orders saved as plain text', () => {
    const o = { ...order('Old', at(10), []), items: 'Chicken dum biryani, 2 large trays\nMango cake', lines: undefined };
    const p = prepFor([o, order('New', at(12), [line('cb', 'Chicken Dum Biryani', 1, 'Full tray')])], day, [{ id: 'cb', name: 'Chicken Dum Biryani', group: 'Biryani', description: '' }]);
    expect(p.dishes).toEqual([{ name: 'Chicken Dum Biryani', totals: ['3 Full trays'], from: ['Old: 2 Full trays', 'New: 1 Full tray'] }]);
    expect(p.others).toEqual([{ text: 'Mango cake', customer: 'Old' }]);
  });
});
