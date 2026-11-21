import { describe, expect, it } from 'vitest';
import type { PayEvent } from '@shared/data';
import { appendLog, itemsChangedSincePrice, payEventText, payFrom } from './pay';

const ev = (kind: PayEvent['kind'], at: number, extra: Partial<PayEvent> = {}): PayEvent => ({ kind, amount: null, method: null, takenBy: null, at, ...extra });

describe('payment log (add-only)', () => {
  it('starts a log on a doc without one', () => {
    expect(appendLog(undefined, ev('amount', 1, { amount: 200 }))).toEqual([ev('amount', 1, { amount: 200 })]);
  });
  it('keeps every old entry exactly as it was and adds at the end', () => {
    const odd = { kind: 'something-old', at: 0 } as unknown as PayEvent;
    const old = [odd, ev('deposit', 2, { amount: 50, method: 'cash', takenBy: 'Ravi' })];
    const next = appendLog(old, ev('paid', 3, { amount: 150 }), ev('unpaid', 4));
    expect(next.slice(0, 2)).toEqual(old);
    expect(next[0]).toBe(odd);
    expect(next.map((e) => e.kind)).toEqual(['something-old', 'deposit', 'paid', 'unpaid']);
    expect(old).toHaveLength(2); // the old list is not changed
  });
  it('never saves undefined fields, and keeps a note only when there is one', () => {
    const [e] = appendLog([], { kind: 'unpaid', amount: undefined as unknown as null, method: null, takenBy: null, at: 5, note: undefined });
    expect(Object.values(e)).not.toContain(undefined);
    expect('note' in e).toBe(false);
    expect(appendLog([], ev('refund', 6, { note: '  Refunded $200 by Zelle ' }))[0].note).toBe('Refunded $200 by Zelle');
  });
  it('reads the log, itemsAt and refund note from a saved doc', () => {
    const p = payFrom({ amount: 100, updatedAt: 0, log: [ev('amount', 1, { amount: 100 }), null as unknown as PayEvent], itemsAt: '2 trays', refundNote: 'x' });
    expect(p.log).toHaveLength(1);
    expect(p.itemsAt).toBe('2 trays');
    expect(p.refundNote).toBe('x');
    expect(payFrom({ amount: 100, updatedAt: 0 })).toMatchObject({ log: [], itemsAt: null, refundNote: null });
  });
  it('says each entry in plain words', () => {
    expect(payEventText(ev('deposit', 1, { amount: 100, method: 'cash', takenBy: 'Ravi' }))).toBe('Deposit $100 · Cash · Ravi');
    expect(payEventText(ev('cancelled', 1, { amount: 50 }))).toBe('Order cancelled ($50 paid so far)');
    expect(payEventText(ev('refund', 1, { note: 'Refunded by Zelle' }))).toBe('Refund note · Refunded by Zelle');
  });
});

describe('items changed since the price was set', () => {
  it('warns when the items text differs from the one priced', () => {
    expect(itemsChangedSincePrice('3 Full tray Biryani', { amount: 200, itemsAt: '2 Full tray Biryani' })).toBe(true);
  });
  it('ignores spacing and blank lines', () => {
    expect(itemsChangedSincePrice('2 Full tray Biryani\n\n Samosa ', { amount: 200, itemsAt: '2 Full tray Biryani\nSamosa' })).toBe(false);
  });
  it('never warns without an amount or on older orders (no itemsAt)', () => {
    expect(itemsChangedSincePrice('x', { amount: null, itemsAt: 'y' })).toBe(false);
    expect(itemsChangedSincePrice('x', { amount: 100, itemsAt: null })).toBe(false);
    expect(itemsChangedSincePrice('x', undefined)).toBe(false);
  });
});
