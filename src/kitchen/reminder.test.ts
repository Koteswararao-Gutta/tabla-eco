import { describe, expect, it } from 'vitest';
import type { CateringOrder, WithId } from '@shared/data';
import { ackKey, dueReminders } from './reminder';

const H = 3_600_000;
const order = (id: string, dueAt: number, status: CateringOrder['status'] = 'open') =>
  ({ id, dueAt, status, customerName: id, phone: '', type: 'pickup', items: '', createdAt: 0, updatedAt: 0 }) as WithId<CateringOrder>;

describe('dueReminders', () => {
  const now = 100 * H;
  it('reminds open orders due within the hour, soonest first', () => {
    const list = [order('later', now + 2 * H), order('b', now + 50 * 60_000), order('a', now + 10 * 60_000)];
    expect(dueReminders(list, now, new Set()).map((o) => o.id)).toEqual(['a', 'b']);
  });
  it('skips completed and acknowledged orders', () => {
    const done = order('done', now + 1000, 'completed');
    const seen = order('seen', now + 1000);
    expect(dueReminders([done, seen], now, new Set([ackKey(seen)]))).toEqual([]);
  });
  it('reminds again when the order time changes', () => {
    const o = order('x', now + 1000);
    const moved = { ...o, dueAt: now + 2000 };
    expect(dueReminders([moved], now, new Set([ackKey(o)]))).toHaveLength(1);
  });
});
