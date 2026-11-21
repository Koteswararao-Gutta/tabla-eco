import { describe, expect, it } from 'vitest';
import type { CateringOrder, OrderAmount, WithId } from '@shared/data';
import { csvCell, csvFileName, CSV_HEADER, csvRows, rangeFor, toCsv } from './export';

const at = (m: number, d: number, h = 12, min = 0) => new Date(2026, m, d, h, min).getTime();
const NOW = at(10, 21); // Sat Nov 21 2026

const order = (id: string, over: Partial<CateringOrder> = {}): WithId<CateringOrder> => ({
  id,
  customerName: 'Anika',
  phone: '480-555-1234',
  dueAt: at(10, 20, 17, 30),
  type: 'pickup',
  people: 40,
  items: 'Samosa, 40 pieces',
  status: 'open',
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe('rangeFor', () => {
  it('this month, last month and this year, end not included', () => {
    expect(rangeFor('thisMonth', NOW)).toEqual({ from: at(10, 1, 0), to: at(11, 1, 0) });
    expect(rangeFor('lastMonth', NOW)).toEqual({ from: at(9, 1, 0), to: at(10, 1, 0) });
    expect(rangeFor('thisYear', NOW)).toEqual({ from: new Date(2026, 0, 1).getTime(), to: new Date(2027, 0, 1).getTime() });
    // January: last month is December of the year before.
    expect(rangeFor('lastMonth', new Date(2027, 0, 5).getTime())).toEqual({ from: new Date(2026, 11, 1).getTime(), to: new Date(2027, 0, 1).getTime() });
  });
  it('custom dates include both days; nothing while they are missing or reversed', () => {
    expect(rangeFor('custom', NOW, { from: '2026-11-03', to: '2026-11-05' })).toEqual({ from: at(10, 3, 0), to: at(10, 6, 0) });
    expect(rangeFor('custom', NOW, { from: '2026-11-05', to: '2026-11-05' })).toEqual({ from: at(10, 5, 0), to: at(10, 6, 0) });
    expect(rangeFor('custom', NOW, { from: '2026-11-06', to: '2026-11-05' })).toBeNull();
    expect(rangeFor('custom', NOW, { from: '', to: '2026-11-05' })).toBeNull();
    expect(rangeFor('custom', NOW)).toBeNull();
  });
});

describe('csvFileName', () => {
  it('names the first and last day', () => {
    expect(csvFileName(rangeFor('thisMonth', NOW)!)).toBe('tabla-catering-2026-11-01-to-2026-11-30.csv');
    expect(csvFileName(rangeFor('custom', NOW, { from: '2026-02-03', to: '2026-02-03' })!)).toBe('tabla-catering-2026-02-03-to-2026-02-03.csv');
  });
});

describe('csvCell', () => {
  it('quotes commas, quotes and line breaks, and doubles quotes', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(' padded')).toBe('" padded"');
    expect(csvCell('')).toBe('');
    expect(csvCell(null)).toBe('');
  });
  it('keeps numbers as numbers, rounded to cents', () => {
    expect(csvCell(1250.5)).toBe('1250.5');
    expect(csvCell(0.1 + 0.2)).toBe('0.3');
    expect(csvCell(40)).toBe('40');
  });
  it('stops text running as a spreadsheet formula', () => {
    expect(csvCell('+1 480 555 1234')).toBe("'+1 480 555 1234");
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('@me')).toBe("'@me");
    expect(csvCell('-5')).toBe("'-5");
  });
});

describe('csvRows', () => {
  const range = rangeFor('thisMonth', NOW)!;
  const amounts: WithId<OrderAmount>[] = [
    { id: 'paid', amount: 500, paid: true, paidAt: 1, method: 'zelle', takenBy: 'Ravi', deposits: [{ amount: 100, method: 'cash', takenBy: 'Sita', at: 1 }], updatedAt: 1 },
    { id: 'part', amount: 300, paid: false, deposits: [{ amount: 100, method: 'cash', takenBy: 'Sita', at: 1 }, { amount: 50, method: 'card', takenBy: 'Sita', at: 2 }], updatedAt: 1 },
    { id: 'gone', amount: 80, paid: false, updatedAt: 1, refundNote: 'Refunded $80 by Zelle' } as WithId<OrderAmount>,
  ];
  const orders = [
    order('part', { dueAt: at(10, 25, 18), customerName: 'Lee, Pat', type: 'delivery', status: 'open' }),
    order('paid', { dueAt: at(10, 2, 11, 15), status: 'completed', lines: [{ dishId: 'b', name: 'Chicken Dum Biryani', qty: 2, unit: 'Full tray', note: 'mild' }, { dishId: null, name: 'Raita', qty: 24, unit: 'Oz', note: '', extra: 'Raita' }] }),
    order('gone', { dueAt: at(10, 10), status: 'cancelled' as CateringOrder['status'] }),
    order('deleted', { dueAt: at(10, 11), deletedAt: 5 } as Partial<CateringOrder>),
    order('noamount', { dueAt: at(10, 12), people: null, phone: '' }),
    order('october', { dueAt: at(9, 31, 23) }),
    order('december', { dueAt: at(11, 1, 0) }),
  ];
  const rows = csvRows(orders, amounts, range);

  it('has the header, then the range orders earliest first, deleted ones left out', () => {
    expect(rows[0]).toEqual(CSV_HEADER);
    expect(rows.slice(1).map((r) => r[0])).toEqual(['2026-11-02', '2026-11-10', '2026-11-12', '2026-11-25']);
  });
  it('writes a paid order: items from its lines in one cell, deposits total, the final method and who took it', () => {
    expect(rows[1]).toEqual(['2026-11-02', '11:15 AM', 'Anika', '480-555-1234', 'Pickup', 40, 'Chicken Dum Biryani, 2 Full trays (mild); Raita, 24 oz (extra)', 'Done', 500, 100, 'yes', 'Zelle', 'Ravi', '']);
  });
  it('writes a cancelled order with its refund note, and an order without an amount', () => {
    expect(rows[2].slice(7)).toEqual(['Cancelled', 80, null, 'no', '', '', 'Refunded $80 by Zelle']);
    expect(rows[3].slice(3, 12)).toEqual(['', 'Pickup', null, 'Samosa, 40 pieces', 'Open', null, null, 'no', '']);
  });
  it('a part-paid order lists the deposit methods and takers', () => {
    expect(rows[4].slice(2, 13)).toEqual(['Lee, Pat', '480-555-1234', 'Delivery', 40, 'Samosa, 40 pieces', 'Open', 300, 150, 'no', 'Cash, Card', 'Sita']);
  });
  it('makes a file a spreadsheet opens: BOM, CRLF, quoted cells', () => {
    const csv = toCsv(rows);
    expect(csv.startsWith('﻿Date,Time,Customer,')).toBe(true);
    expect(csv.split('\r\n')).toHaveLength(rows.length + 1);
    expect(csv).toContain('"Lee, Pat"');
    expect(csv).toContain('"Chicken Dum Biryani, 2 Full trays (mild); Raita, 24 oz (extra)"');
  });
});
