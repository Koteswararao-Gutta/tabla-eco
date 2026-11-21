// More > Export (pure): catering orders in a date range as a CSV file a spreadsheet opens.
import type { CateringOrder, OrderAmount, WithId } from '@shared/data';
import { dayStart, fromInputs, timeLabel, toDateInput } from '../catering/orders';
import { itemTexts } from '../catering/lines';
import { depositTotal, isPaid, methodLabel, payFrom } from '../catering/pay';

export type RangeKind = 'thisMonth' | 'lastMonth' | 'thisYear' | 'custom';

export const RANGE_KINDS: { value: RangeKind; label: string }[] = [
  { value: 'thisMonth', label: 'This month' },
  { value: 'lastMonth', label: 'Last month' },
  { value: 'thisYear', label: 'This year' },
  { value: 'custom', label: 'Pick dates' },
];

/** A range of days: from the start of `from` up to (not including) `to`, both local midnights. */
export interface Range {
  from: number;
  to: number;
}

/** The range for a choice. `custom` takes "yyyy-mm-dd" dates, both days included; null while they aren't
 *  dates or the end is before the start. */
export function rangeFor(kind: RangeKind, now: number, custom?: { from: string; to: string }): Range | null {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = d.getMonth();
  if (kind === 'thisMonth') return { from: new Date(y, m, 1).getTime(), to: new Date(y, m + 1, 1).getTime() };
  if (kind === 'lastMonth') return { from: new Date(y, m - 1, 1).getTime(), to: new Date(y, m, 1).getTime() };
  if (kind === 'thisYear') return { from: new Date(y, 0, 1).getTime(), to: new Date(y + 1, 0, 1).getTime() };
  const from = fromInputs(custom?.from ?? '', '12:00');
  const to = fromInputs(custom?.to ?? '', '12:00');
  if (from === null || to === null || to < from) return null;
  return { from: dayStart(from), to: dayStart(to, 1) };
}

/** The last day in the range (its start). */
export const lastDay = (r: Range) => dayStart(r.to, -1);

/** "tabla-catering-2026-11-01-to-2026-11-30.csv" */
export const csvFileName = (r: Range) => `tabla-catering-${toDateInput(r.from)}-to-${toDateInput(lastDay(r))}.csv`;

export const CSV_HEADER = ['Date', 'Time', 'Customer', 'Phone', 'Pickup or delivery', 'People', 'Items', 'Status', 'Amount', 'Deposits', 'Paid', 'Payment method', 'Taken by', 'Refund note'];

type Cell = string | number | null;

/** One cell, quoted when it has to be. Text that a spreadsheet would run as a formula (=, +, -, @ at the
 *  start, e.g. a phone "+1 480…") gets a ' in front, so it shows as typed. Numbers stay numbers. */
export function csvCell(v: Cell): string {
  if (v === null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '';
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const unique = (xs: (string | null | undefined)[]) => [...new Set(xs.map((x) => (x ?? '').trim()).filter(Boolean))];

const STATUS: Record<string, string> = { open: 'Open', completed: 'Done', cancelled: 'Cancelled' };

/** The rows of the file (header first): every order due in the range, earliest first, deleted ones left out. */
export function csvRows(orders: WithId<CateringOrder>[], amounts: WithId<OrderAmount>[], range: Range): Cell[][] {
  const byId = new Map(amounts.map((a) => [a.id, a]));
  const rows = orders
    .filter((o) => typeof o.dueAt === 'number' && o.dueAt >= range.from && o.dueAt < range.to)
    .filter((o) => typeof (o as { deletedAt?: unknown }).deletedAt !== 'number')
    .sort((a, b) => a.dueAt - b.dueAt)
    .map((o): Cell[] => {
      const doc = byId.get(o.id);
      const pay = payFrom(doc);
      const deposits = depositTotal(pay);
      // How it was paid: the final payment, else the deposits' (several kinds joined).
      const method = pay.method ? methodLabel(pay.method) : unique(pay.deposits.map((x) => methodLabel(x.method))).join(', ');
      const takenBy = pay.takenBy ?? unique(pay.deposits.map((x) => x.takenBy)).join(', ');
      const refund = (doc as { refundNote?: unknown } | undefined)?.refundNote;
      return [
        toDateInput(o.dueAt),
        timeLabel(o.dueAt),
        o.customerName ?? '',
        o.phone ?? '',
        o.type === 'delivery' ? 'Delivery' : 'Pickup',
        typeof o.people === 'number' && o.people > 0 ? o.people : null,
        itemTexts(o).join('; '),
        STATUS[o.status as string] ?? 'Open',
        pay.amount,
        deposits > 0 ? deposits : null,
        isPaid(pay) ? 'yes' : 'no',
        method,
        takenBy,
        typeof refund === 'string' ? refund : '',
      ];
    });
  return [CSV_HEADER, ...rows];
}

/** The whole file: a byte-order mark (so Excel reads names and "½" right), lines ending in CRLF. */
export function toCsv(rows: Cell[][]): string {
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
