// Payments on catering orders: manager app only.
// Everything here lives in orderAmounts/{order id}, never on the order, so the kitchen tablet never loads it
// and it never reaches the WhatsApp message, the name tags or the order's change history.
import type { Deposit, OrderAmount, PayMethod, StaffConfig } from '@shared/data';
import { defaults, normalizeDB } from '../staff/model';
import { amountLabel, parseAmount } from './orders';

export const PAY_METHODS: { value: PayMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'zelle', label: 'Zelle' },
  { value: 'check', label: 'Check' },
];
export const methodLabel = (m: PayMethod | null | undefined): string => PAY_METHODS.find((x) => x.value === m)?.label ?? '';

/** An order's payment, as the manager app reads it. */
export interface Pay {
  amount: number | null;
  paid: boolean;
  paidAt: number | null;
  method: PayMethod | null;
  takenBy: string | null;
  deposits: Deposit[];
}
export const NO_PAY: Pay = { amount: null, paid: false, paidAt: null, method: null, takenBy: null, deposits: [] };

const isMethod = (m: unknown): m is PayMethod => PAY_METHODS.some((x) => x.value === m);

/** Reads a saved orderAmounts doc (or none) safely: older docs have only amount and paid. */
export function payFrom(doc: Partial<OrderAmount> | null | undefined): Pay {
  if (!doc) return NO_PAY;
  const deposits = (Array.isArray(doc.deposits) ? doc.deposits : []).filter(
    (d): d is Deposit => !!d && typeof d.amount === 'number' && Number.isFinite(d.amount) && d.amount > 0,
  );
  return {
    amount: typeof doc.amount === 'number' && Number.isFinite(doc.amount) ? doc.amount : null,
    paid: doc.paid === true,
    paidAt: typeof doc.paidAt === 'number' ? doc.paidAt : null,
    method: isMethod(doc.method) ? doc.method : null,
    takenBy: typeof doc.takenBy === 'string' && doc.takenBy.trim() ? doc.takenBy : null,
    deposits,
  };
}

/** What has been paid in deposits so far. */
export const depositTotal = (pay: Pick<Pay, 'deposits'>): number => Math.round(pay.deposits.reduce((a, d) => a + d.amount, 0) * 100) / 100;

/** What the customer still owes: amount minus deposits (0 once paid). null when the amount isn't set. */
export function balance(pay: Pick<Pay, 'amount' | 'paid' | 'deposits'>): number | null {
  if (pay.paid) return 0;
  if (pay.amount == null) return null;
  return Math.max(0, Math.round((pay.amount - depositTotal(pay)) * 100) / 100);
}

/** Paid: marked "Paid in full", or deposits that add up to the whole amount (nothing left owed). */
export function isPaid(pay: Pick<Pay, 'amount' | 'paid' | 'deposits'>): boolean {
  return pay.paid || (pay.amount != null && pay.deposits.length > 0 && balance(pay) === 0);
}

/** For a manager order card: "$200 · Paid", "$300 · $200 owed", "$200 · Unpaid", "$100 paid so far", "Paid";
 *  '' when nothing is set. */
export function payLabel(pay: Pick<Pay, 'amount' | 'paid'> & { deposits?: Deposit[] } | null | undefined): string {
  if (!pay) return '';
  const amount = amountLabel(pay.amount);
  const p = { ...pay, deposits: pay.deposits ?? [] };
  if (isPaid(p)) return amount ? `${amount} · Paid` : 'Paid';
  const paidSoFar = depositTotal(p);
  if (paidSoFar > 0) return amount ? `${amount} · ${amountLabel(balance(p))} owed` : `${amountLabel(paidSoFar)} paid so far`;
  return amount ? `${amount} · Unpaid` : '';
}

/** Error for the deposit box, or ''. A deposit is part of the balance: the whole balance is "Paid in full". */
export function depositError(text: string, pay: Pick<Pay, 'amount' | 'paid' | 'deposits'>): string {
  const n = parseAmount(text);
  if (n === null || n === 0) return 'Please enter how much they paid.';
  if (Number.isNaN(n)) return 'Please enter an amount like 100 or 100.50.';
  const owed = balance(pay);
  if (owed != null && n > owed) return `That's more than the ${amountLabel(owed)} still owed.`;
  if (owed != null && n === owed) return `That's the whole balance. Choose “Paid in full” instead.`;
  return '';
}

/** Names for the "Taken by" list: the people on the Staff tab (shift planner), removed people left out.
 *  Before the planner has saved anything it shows its starting staff, so the same names show here. */
export function staffNames(config: StaffConfig | null | undefined): string[] {
  const people = (config ? normalizeDB({ config, weeks: {} })?.config.people : null) ?? defaults().config.people;
  const names = people.filter((p) => p.active).map((p) => p.name.trim()).filter(Boolean);
  return [...new Set(names)];
}

/** Orders the kitchen has finished but the customer hasn't fully paid, soonest first. Waits (null) while payments load. */
export function unpaidDone<T extends { id: string; status: string; dueAt: number }>(orders: T[], payOf: (id: string) => Pay | undefined): T[] | null {
  const out: T[] = [];
  for (const o of orders) {
    if (o.status !== 'completed') continue;
    const p = payOf(o.id);
    if (!p) return null;
    if (!isPaid(p)) out.push(o);
  }
  return out.sort((a, b) => a.dueAt - b.dueAt);
}
