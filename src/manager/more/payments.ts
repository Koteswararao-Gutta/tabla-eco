// Payments list (pure): the catering orders on one day, with amount and Paid / Unpaid, and the day's totals.
import type { CateringOrder, OrderAmount, WithId } from '@shared/data';
import { dayStart } from '../catering/orders';

export interface PayRow {
  order: WithId<CateringOrder>;
  amount: number | null;
  paid: boolean;
}

export interface PayDay {
  rows: PayRow[];
  paidTotal: number;
  unpaidTotal: number;
}

/** Every order due on the day that contains `day` (open or completed), earliest first. */
export function paymentsOn(orders: WithId<CateringOrder>[], amounts: WithId<OrderAmount>[], day: number): PayDay {
  const from = dayStart(day);
  const to = dayStart(day, 1);
  const byId = new Map(amounts.map((a) => [a.id, a]));
  const rows = orders
    .filter((o) => o.dueAt >= from && o.dueAt < to)
    .sort((a, b) => a.dueAt - b.dueAt)
    .map((order) => {
      const a = byId.get(order.id);
      const amount = typeof a?.amount === 'number' && Number.isFinite(a.amount) ? a.amount : null;
      return { order, amount, paid: a?.paid === true };
    });
  let paidTotal = 0;
  let unpaidTotal = 0;
  for (const r of rows) {
    if (r.paid) paidTotal += r.amount ?? 0;
    else unpaidTotal += r.amount ?? 0;
  }
  return { rows, paidTotal: round(paidTotal), unpaidTotal: round(unpaidTotal) };
}

const round = (n: number) => Math.round(n * 100) / 100;
