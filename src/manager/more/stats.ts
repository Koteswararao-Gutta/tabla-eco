// Statistics (pure): the catering orders in one week, Monday to Sunday, with amounts and the week's totals.
import type { CateringOrder, OrderAmount, WithId } from '@shared/data';
import { dayStart } from '../catering/orders';
import { balance, depositTotal, isPaid, payFrom } from '../catering/pay';
import { isCancelled, isDeleted } from '../catering/safety';

/** Midnight on the Monday of the week that contains `ms`, moved by `addWeeks`. */
export function weekStart(ms: number, addWeeks = 0): number {
  const d = new Date(dayStart(ms));
  const back = (d.getDay() + 6) % 7; // Sunday 0 → 6 days back, Monday 1 → 0
  return dayStart(d.getTime(), addWeeks * 7 - back);
}

export interface WeekRow {
  order: WithId<CateringOrder>;
  amount: number | null;
  status: 'paid' | 'part' | 'unpaid';
}

export interface Week {
  rows: WeekRow[];
  /** Every order's amount added up. */
  total: number;
  /** Paid in full, plus deposits on orders not yet paid in full. */
  paid: number;
  /** What is still owed. */
  unpaid: number;
  /** Orders with no amount set (not in any total). */
  noAmount: number;
}

/** Every order due Monday 00:00 to Sunday 23:59 of the week that contains `ms` (open or completed), earliest first.
 *  Cancelled and deleted orders are left out. */
export function weekStats(orders: WithId<CateringOrder>[], amounts: WithId<OrderAmount>[], ms: number): Week {
  const from = weekStart(ms);
  const to = weekStart(ms, 1);
  const byId = new Map(amounts.map((a) => [a.id, a]));
  let total = 0;
  let paid = 0;
  let unpaid = 0;
  let noAmount = 0;
  const rows = orders
    .filter((o) => o.dueAt >= from && o.dueAt < to && !isCancelled(o) && !isDeleted(o))
    .sort((a, b) => a.dueAt - b.dueAt)
    .map((order): WeekRow => {
      const pay = payFrom(byId.get(order.id));
      const deposits = depositTotal(pay);
      if (pay.amount == null) noAmount++;
      else total += pay.amount;
      if (pay.paid) paid += pay.amount ?? deposits;
      else {
        paid += deposits;
        unpaid += balance(pay) ?? 0;
      }
      const status = isPaid(pay) ? 'paid' : deposits > 0 ? 'part' : 'unpaid';
      return { order, amount: pay.amount, status };
    });
  return { rows, total: round(total), paid: round(paid), unpaid: round(unpaid), noAmount };
}

const round = (n: number) => Math.round(n * 100) / 100;
