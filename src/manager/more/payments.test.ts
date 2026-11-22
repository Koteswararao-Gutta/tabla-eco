import { describe, expect, it } from 'vitest';
import type { CateringOrder, OrderAmount, WithId } from '@shared/data';
import { paymentsOn } from './payments';

const at = (d: number, h: number) => new Date(2026, 10, d, h, 0).getTime();
const order = (id: string, dueAt: number, status: 'open' | 'completed' = 'open') =>
  ({ id, customerName: id, phone: '', dueAt, type: 'pickup', items: '', status, createdAt: 0, updatedAt: 0 }) as WithId<CateringOrder>;
const amt = (id: string, amount: number | null, paid?: boolean) => ({ id, amount, paid, updatedAt: 0 }) as WithId<OrderAmount>;

describe('paymentsOn', () => {
  const orders = [order('late', at(20, 18)), order('early', at(20, 11), 'completed'), order('nextDay', at(21, 0)), order('prevDay', at(19, 23)), order('noAmount', at(20, 13))];
  const amounts = [amt('late', 250.5, true), amt('early', 100), amt('nextDay', 999, true), amt('prevDay', 50)];

  it('lists only that day, earliest first, open and completed', () => {
    const day = paymentsOn(orders, amounts, at(20, 9));
    expect(day.rows.map((r) => r.order.id)).toEqual(['early', 'noAmount', 'late']);
    expect(day.rows.map((r) => [r.amount, r.paid])).toEqual([[100, false], [null, false], [250.5, true]]);
  });

  it('adds up paid and unpaid', () => {
    expect(paymentsOn(orders, amounts, at(20, 9))).toMatchObject({ paidTotal: 250.5, unpaidTotal: 100 });
    expect(paymentsOn(orders, [], at(20, 9))).toMatchObject({ paidTotal: 0, unpaidTotal: 0 });
    expect(paymentsOn([], amounts, at(20, 9)).rows).toEqual([]);
  });

  it('counts deposits as paid and only what is still owed as unpaid', () => {
    const dep = { id: 'early', amount: 500, paid: false, updatedAt: 0, deposits: [{ amount: 200, method: 'zelle', takenBy: 'Siri', at: 0 }] } as unknown as WithId<OrderAmount>;
    const day = paymentsOn(orders, [dep], at(20, 9));
    expect(day.rows.find((r) => r.order.id === 'early')!.status).toBe('part');
    expect(day).toMatchObject({ paidTotal: 200, unpaidTotal: 300 });
  });
});

describe('paymentsOn with deposits', () => {
  it('counts deposits that add up to the amount as paid, not part paid', () => {
    const o = [order('a', at(20, 12))];
    const a = [{ id: 'a', amount: 300, deposits: [{ amount: 100, method: 'cash', takenBy: 'X', at: 1 }, { amount: 200, method: 'card', takenBy: 'X', at: 2 }], updatedAt: 0 } as WithId<OrderAmount>];
    const day = paymentsOn(o, a, at(20, 9));
    expect(day.rows[0].status).toBe('paid');
    expect(day.rows[0].paid).toBe(true);
    expect([day.paidTotal, day.unpaidTotal]).toEqual([300, 0]);
  });
});

describe('paymentsOn with cancelled and deleted orders', () => {
  it('lists a cancelled order with what was paid, outside the totals; leaves deleted ones out', () => {
    const o = [
      { ...order('off', at(20, 12)), status: 'cancelled' } as WithId<CateringOrder>,
      { ...order('gone', at(20, 13)), deletedAt: 5 } as WithId<CateringOrder>,
      order('ok', at(20, 14)),
    ];
    const a = [
      { id: 'off', amount: 300, deposits: [{ amount: 100, method: 'cash', takenBy: 'X', at: 1 }], refundNote: 'Refunded by Zelle', updatedAt: 0 } as WithId<OrderAmount>,
      amt('gone', 500),
      amt('ok', 80),
    ];
    const day = paymentsOn(o, a, at(20, 9));
    expect(day.rows.map((r) => [r.order.id, r.status])).toEqual([['off', 'cancelled'], ['ok', 'unpaid']]);
    expect(day.rows[0]).toMatchObject({ paidSoFar: 100, refundNote: 'Refunded by Zelle' });
    expect([day.paidTotal, day.unpaidTotal]).toEqual([0, 80]);
  });
});

describe('paymentsOn: a cancelled order that was paid in full', () => {
  it('shows the whole amount as paid, so the refund is not missed', () => {
    const o = [{ ...order('full', at(20, 12)), status: 'cancelled' } as WithId<CateringOrder>];
    const a = [{ id: 'full', amount: 500, paid: true, paidAt: 1, method: 'zelle', takenBy: 'X', updatedAt: 0 } as WithId<OrderAmount>];
    const day = paymentsOn(o, a, at(20, 9));
    expect(day.rows[0]).toMatchObject({ status: 'cancelled', paidSoFar: 500 });
    expect([day.paidTotal, day.unpaidTotal]).toEqual([0, 0]);
  });
});
