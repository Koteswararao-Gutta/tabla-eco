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
});
