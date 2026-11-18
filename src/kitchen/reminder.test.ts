import { describe, expect, it } from 'vitest';
import type { CateringOrder } from '@shared/data';
import { ackPatch, dueReminders, ringAt, type KitchenOrder } from './reminder';

const H = 3_600_000;
const MIN = 60_000;
const order = (id: string, dueAt: number, status: CateringOrder['status'] = 'open', kitchenAckFor?: number) =>
  ({ id, dueAt, status, customerName: id, phone: '', type: 'pickup', items: '', createdAt: 0, updatedAt: 0, kitchenAckFor }) as KitchenOrder;

describe('dueReminders', () => {
  const now = 100 * H;
  it('reminds open orders due within the hour, soonest first', () => {
    const list = [order('later', now + 2 * H), order('b', now + 50 * MIN), order('a', now + 10 * MIN)];
    expect(dueReminders(list, now).map((o) => o.id)).toEqual(['a', 'b']);
  });
  it('skips completed and acknowledged orders', () => {
    const done = order('done', now + 1000, 'completed');
    const seen = order('seen', now + 1000, 'open', now + 1000);
    expect(dueReminders([done, seen], now)).toEqual([]);
  });
  it('the acknowledgement is stored as the due time it was for', () => {
    expect(ackPatch(order('x', now + 1000))).toEqual({ kitchenAckFor: now + 1000 });
  });
  it('reminds again when the order time changes', () => {
    const moved = order('x', now + 2000, 'open', now + 1000); // acked for the old time
    expect(dueReminders([moved], now)).toHaveLength(1);
  });
  it('keeps a late order for an hour, then leaves it to its card', () => {
    expect(dueReminders([order('late', now - 59 * MIN)], now)).toHaveLength(1);
    expect(dueReminders([order('old', now - 61 * MIN)], now)).toEqual([]);
    expect(dueReminders([order('days', now - 72 * H)], now)).toEqual([]);
  });
});

describe('ringAt: only while the kitchen is staffed', () => {
  // Weekdays: prep from 10:00, open 11:00 to 21:00, break 14:00 to 17:00. Sunday closed on a special date.
  const wd = { open: 660, close: 1260, brk: [840, 1020] };
  const staff = { settings: { prepStart: 600, days: [wd, wd, wd, wd, wd, wd, wd] }, special: { '2026-11-22': { closed: true } } };
  const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime(); // Wed Nov 18 2026 is d=18

  it('rings 1 hour before when people are there', () => {
    expect(ringAt(at(18, 13), staff)).toBe(at(18, 12));
    expect(ringAt(at(18, 19), staff)).toBe(at(18, 18));
  });
  it('during the break, waits until people are back', () => {
    expect(ringAt(at(18, 17, 30), staff)).toBe(at(18, 17)); // 5:30 order: rings at 5:00, not 4:30
  });
  it('if people are back only after it is due, rings just before the break', () => {
    expect(ringAt(at(18, 16), staff)).toBe(at(18, 13, 45)); // 4:00 order, during the break
  });
  it('early morning orders ring when prep starts', () => {
    expect(ringAt(at(18, 10, 30), staff)).toBe(at(18, 10));
  });
  it('without staff hours, rings exactly 1 hour before', () => {
    expect(ringAt(at(18, 17, 30))).toBe(at(18, 16, 30));
    expect(ringAt(at(18, 17, 30), { nothing: true })).toBe(at(18, 16, 30));
  });
  it('dueReminders holds the 5:30 order during the break, then shows it at 5:00', () => {
    const o = order('x', at(18, 17, 30));
    expect(dueReminders([o], at(18, 16, 30), staff)).toEqual([]);
    expect(dueReminders([o], at(18, 17), staff)).toEqual([o]);
  });
  it('a 4:00 order rung before the break stays until an hour after it is due', () => {
    const o = order('x', at(18, 16));
    expect(dueReminders([o], at(18, 13, 45), staff)).toEqual([o]);
    expect(dueReminders([o], at(18, 17, 1), staff)).toEqual([]);
  });
});
