import { describe, expect, it } from 'vitest';
import type { CateringOrder, WithId } from '@shared/data';
import { duplicateOf, isDeleted, kitchenOrders, notDeleted, phoenixDay, phoneDigits } from './safety';

// Phoenix is UTC-7 all year.
const phx = (d: number, h: number, m = 0) => Date.UTC(2026, 10, d, h + 7, m);
const order = (id: string, phone: string, dueAt: number, extra: Partial<CateringOrder> = {}) =>
  ({ id, customerName: id, phone, dueAt, type: 'pickup', items: '', status: 'open', createdAt: 0, updatedAt: 0, ...extra }) as WithId<CateringOrder>;

describe('soft delete and cancelled filters', () => {
  const list = [order('a', '', 1), order('b', '', 1, { deletedAt: 5 }), order('c', '', 1, { status: 'cancelled', cancelledAt: 3 }), order('d', '', 1, { deletedAt: null })];
  it('leaves deleted out (null is not deleted)', () => {
    expect(notDeleted(list).map((o) => o.id)).toEqual(['a', 'c', 'd']);
    expect(isDeleted({ deletedAt: null })).toBe(false);
    expect(isDeleted({})).toBe(false);
  });
  it('keeps the same list when nothing is deleted', () => {
    const clean = [list[0], list[3]];
    expect(notDeleted(clean)).toBe(clean);
  });
  it('the kitchen sees neither deleted nor cancelled orders', () => {
    expect(kitchenOrders(list).map((o) => o.id)).toEqual(['a', 'd']);
  });
});

describe('duplicate order check', () => {
  it('reads phone digits whatever the formatting', () => {
    expect(phoneDigits('(602) 555-0101')).toBe('6025550101');
    expect(phoneDigits('+1 602.555.0101')).toBe('6025550101');
    expect(phoneDigits('')).toBe('');
    expect(phoneDigits(undefined)).toBe('');
  });
  it('uses the Phoenix calendar day', () => {
    expect(phoenixDay(phx(20, 0, 1))).toBe(phoenixDay(phx(20, 23, 59)));
    expect(phoenixDay(phx(20, 23, 59))).not.toBe(phoenixDay(phx(21, 0, 0)));
  });
  const orders = [
    order('same', '602-555-0101', phx(20, 12)),
    order('otherDay', '6025550101', phx(21, 12)),
    order('otherPhone', '6025550199', phx(20, 12)),
    order('gone', '6025550102', phx(20, 12), { deletedAt: 9 }),
    order('off', '6025550103', phx(20, 12), { status: 'cancelled' }),
    order('done', '6025550104', phx(20, 9), { status: 'completed' }),
  ];
  it('finds another order for the same phone on the same day', () => {
    expect(duplicateOf(orders, '(602) 555 0101', phx(20, 18))?.id).toBe('same');
    expect(duplicateOf(orders, '6025550104', phx(20, 18))?.id).toBe('done');
  });
  it('ignores other days, other phones, deleted and cancelled orders, and an empty phone', () => {
    expect(duplicateOf(orders, '6025550101', phx(22, 12))).toBeNull();
    expect(duplicateOf(orders, '6025550102', phx(20, 12))).toBeNull();
    expect(duplicateOf(orders, '6025550103', phx(20, 12))).toBeNull();
    expect(duplicateOf(orders, '', phx(20, 12))).toBeNull();
    expect(duplicateOf([order('x', '', phx(20, 12))], '', phx(20, 12))).toBeNull();
    expect(duplicateOf(orders, '6025550101', phx(20, 12), 'same')).toBeNull();
  });
});
