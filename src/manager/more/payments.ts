// Payments list (pure): the catering orders on one day, with amount and Paid / Unpaid, and the day's totals.
import type { CateringOrder, OrderAmount, WithId } from '@shared/data';
import { dayStart } from '../catering/orders';
import { balance, depositTotal, isPaid, payFrom } from '../catering/pay';
import { isCancelled, isDeleted } from '../catering/safety';

export interface PayRow {
  order: WithId<CateringOrder>;
  amount: number | null;
  paid: boolean;
  /** 'part' when deposits were taken but it isn't paid in full yet. 'cancelled': the order was cancelled
   *  (left out of the totals; what was paid shows so a refund can be handled). */
  status: 'paid' | 'part' | 'unpaid' | 'cancelled';
  /** Deposits taken so far (on a cancelled order: what may need refunding). */
  paidSoFar: number;
  refundNote: string | null;
}

export interface PayDay {
  rows: PayRow[];
  paidTotal: number;
  unpaidTotal: number;
}

/** Every order due on the day that contains `day` (open, completed or cancelled; never deleted), earliest first.
 *  Cancelled orders are listed but not added to the totals. */
export function paymentsOn(orders: WithId<CateringOrder>[], amounts: WithId<OrderAmount>[], day: number): PayDay {
  const from = dayStart(day);
  const to = dayStart(day, 1);
  const byId = new Map(amounts.map((a) => [a.id, a]));
  const rows = orders
    .filter((o) => o.dueAt >= from && o.dueAt < to && !isDeleted(o))
    .sort((a, b) => a.dueAt - b.dueAt)
    .map((order) => {
      const pay = payFrom(byId.get(order.id));
      const status: PayRow['status'] = isCancelled(order) ? 'cancelled' : isPaid(pay) ? 'paid' : depositTotal(pay) > 0 ? 'part' : 'unpaid';
      return { order, amount: pay.amount, paid: isPaid(pay), status, paidSoFar: depositTotal(pay), refundNote: pay.refundNote, pay };
    });
  // Deposits count as paid, and only what is still owed as unpaid (the same as Statistics).
  let paidTotal = 0;
  let unpaidTotal = 0;
  for (const r of rows) {
    if (r.status === 'cancelled') continue;
    if (r.pay.paid) paidTotal += r.pay.amount ?? depositTotal(r.pay);
    else {
      paidTotal += depositTotal(r.pay);
      unpaidTotal += balance(r.pay) ?? 0;
    }
  }
  return { rows: rows.map(({ pay: _pay, ...r }) => r), paidTotal: round(paidTotal), unpaidTotal: round(unpaidTotal) };
}

const round = (n: number) => Math.round(n * 100) / 100;
