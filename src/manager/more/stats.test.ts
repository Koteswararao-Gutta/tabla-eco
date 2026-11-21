import { describe, expect, it } from 'vitest';
import type { CateringOrder, OrderAmount, WithId } from '@shared/data';
import { weekStart, weekStats } from './stats';

// November 2026: Mon 16 … Sun 22.
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();
const order = (id: string, dueAt: number, status: 'open' | 'completed' = 'open') =>
  ({ id, customerName: id, phone: '', dueAt, type: 'pickup', items: '', status, createdAt: 0, updatedAt: 0 }) as WithId<CateringOrder>;
const amt = (id: string, a: Partial<OrderAmount>) => ({ id, updatedAt: 0, ...a }) as WithId<OrderAmount>;

describe('weekStart', () => {
  it('is Monday midnight for every day of the week', () => {
    for (let d = 16; d <= 22; d++) expect(weekStart(at(d, 15))).toBe(at(16, 0));
    expect(weekStart(at(22, 23, 59))).toBe(at(16, 0));
    expect(weekStart(at(23, 0))).toBe(at(23, 0));
  });
  it('moves by whole weeks', () => {
    expect(weekStart(at(20, 9), -1)).toBe(at(9, 0));
    expect(weekStart(at(20, 9), 2)).toBe(at(30, 0));
  });
});

describe('weekStats', () => {
  const orders = [
    order('sun', at(22, 20)),
    order('mon', at(16, 0), 'completed'),
    order('wed', at(18, 12)),
    order('part', at(19, 12)),
    order('none', at(20, 12)),
    order('prevSun', at(15, 23, 59)),
    order('nextMon', at(23, 0)),
  ];
  const amounts = [
    amt('sun', { amount: 250.5, paid: true }),
    amt('mon', { amount: 100 }),
    amt('wed', { amount: 300, paid: false }),
    amt('part', { amount: 400, deposits: [{ amount: 150, method: 'cash', takenBy: 'Ravi', at: 0 }] }),
    amt('prevSun', { amount: 999, paid: true }),
    amt('nextMon', { amount: 999 }),
  ];

  it('lists Monday to Sunday only, earliest first, open and completed', () => {
    const w = weekStats(orders, amounts, at(20, 9));
    expect(w.rows.map((r) => r.order.id)).toEqual(['mon', 'wed', 'part', 'none', 'sun']);
    expect(w.rows.map((r) => [r.amount, r.status])).toEqual([[100, 'unpaid'], [300, 'unpaid'], [400, 'part'], [null, 'unpaid'], [250.5, 'paid']]);
  });

  it('adds up the week: total, paid (with deposits) and still owed', () => {
    expect(weekStats(orders, amounts, at(20, 9))).toMatchObject({ total: 1050.5, paid: 400.5, unpaid: 650, noAmount: 1 });
  });

  it('is empty for a week with no orders', () => {
    expect(weekStats(orders, amounts, at(2, 9))).toEqual({ rows: [], total: 0, paid: 0, unpaid: 0, noAmount: 0 });
  });
});

describe('weekStats with deposits', () => {
  it('shows an order paid by deposits in full as Paid', () => {
    const w = weekStats([order('a', at(18, 12))], [amt('a', { amount: 200, deposits: [{ amount: 200, method: 'cash', takenBy: 'X', at: 1 }] })], at(18, 9));
    expect(w.rows[0].status).toBe('paid');
    expect([w.paid, w.unpaid]).toEqual([200, 0]);
  });
});

describe('weekStats leaves out cancelled and deleted orders', () => {
  it('counts neither in the rows nor the totals', () => {
    const o = [order('a', at(18, 12)), { ...order('off', at(18, 13)), status: 'cancelled' } as WithId<CateringOrder>, { ...order('gone', at(18, 14)), deletedAt: 1 } as WithId<CateringOrder>];
    const w = weekStats(o, [amt('a', { amount: 100 }), amt('off', { amount: 200, deposits: [{ amount: 50, method: 'cash', takenBy: 'X', at: 0 }] }), amt('gone', { amount: 300 })], at(18, 9));
    expect(w.rows.map((r) => r.order.id)).toEqual(['a']);
    expect([w.total, w.paid, w.unpaid]).toEqual([100, 0, 100]);
  });
});
