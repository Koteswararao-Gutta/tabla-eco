// Payments list (pure): the catering orders on one day, with amount and Paid / Unpaid, and the day's totals.
import type { CateringOrder, OrderAmount, WithId } from '@shared/data';
import { dayStart } from '../catering/orders';
import { balance, depositTotal, payFrom } from '../catering/pay';

export interface PayRow {
  order: WithId<CateringOrder>;
  amount: number | null;
  paid: boolean;
  /** 'part' when deposits were taken but it isn't paid in full yet. */
  status: 'paid' | 'part' | 'unpaid';
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
      const pay = payFrom(byId.get(order.id));
      const status: PayRow['status'] = pay.paid ? 'paid' : depositTotal(pay) > 0 ? 'part' : 'unpaid';
      return { order, amount: pay.amount, paid: pay.paid, status, pay };
    });
  // Deposits count as paid, and only what is still owed as unpaid (the same as Statistics).
  let paidTotal = 0;
  let unpaidTotal = 0;
  for (const r of rows) {
    if (r.pay.paid) paidTotal += r.pay.amount ?? depositTotal(r.pay);
    else {
      paidTotal += depositTotal(r.pay);
      unpaidTotal += balance(r.pay) ?? 0;
    }
  }
  return { rows: rows.map(({ pay: _pay, ...r }) => r), paidTotal: round(paidTotal), unpaidTotal: round(unpaidTotal) };
}

const round = (n: number) => Math.round(n * 100) / 100;
