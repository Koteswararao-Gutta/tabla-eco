import { describe, expect, it } from 'vitest';
import type { CateringOrder, OrderAmount, WithId } from '@shared/data';
import { mergeById, nearDay, needsPaidFlag, olderStep } from './data';

const order = (id: string, status: string, over: object = {}) =>
  ({ id, status, customerName: '', phone: '', dueAt: 0, type: 'pickup', items: '', createdAt: 0, updatedAt: 0, ...over }) as WithId<CateringOrder>;
const amount = (id: string, over: Partial<OrderAmount> = {}): WithId<OrderAmount> => ({ id, amount: 100, updatedAt: 0, ...over });

describe('needsPaidFlag', () => {
  it('creates a missing amount and marks one saved without paid, so "not paid" can be found later', () => {
    const orders = [order('none', 'open'), order('old', 'completed'), order('paid', 'completed'), order('flagged', 'completed'), order('paidAt', 'completed')];
    const amounts = [amount('old'), amount('paid', { paid: true }), amount('flagged', { paid: false }), amount('paidAt', { paidAt: 5 })];
    expect(needsPaidFlag(orders, amounts)).toEqual({ create: ['none'], mark: ['old'], unmark: [] });
  });
  it('leaves out cancelled and deleted orders', () => {
    expect(needsPaidFlag([order('c', 'cancelled'), order('d', 'open', { deletedAt: 5 })], [])).toEqual({ create: [], mark: [], unmark: [] });
  });
  it('takes cancelled, deleted and deposit-paid orders out of the "not paid" look-up, and puts them back when they owe again', () => {
    const dep = (amount: number) => ({ amount, method: 'cash' as const, takenBy: 'X', at: 1 });
    const orders = [
      order('c', 'cancelled'),
      order('d', 'completed', { deletedAt: 5 }),
      order('dep', 'completed'),
      order('full', 'cancelled'),
      order('back', 'open'),
      order('owes', 'completed'),
    ];
    const amounts = [
      amount('c', { paid: false }),
      amount('d', { paid: false }),
      amount('dep', { amount: 300, paid: false, deposits: [dep(100), dep(200)] }),
      amount('full', { amount: 300, paid: true }),
      amount('back', { paid: null }),
      amount('owes', { amount: 300, paid: null, deposits: [dep(100)] }),
    ];
    expect(needsPaidFlag(orders, amounts)).toEqual({ create: [], mark: ['back', 'owes'], unmark: ['c', 'd', 'dep'] });
  });
});

describe('mergeById', () => {
  it('keeps each order once, the later list winning', () => {
    const a = [order('1', 'open', { customerName: 'old' }), order('2', 'open')];
    const b = [order('1', 'completed', { customerName: 'new' })];
    const m = mergeById(a, null, b);
    expect(m.map((o) => [o.id, o.customerName])).toEqual([['1', 'new'], ['2', '']]);
  });
});

describe('nearDay', () => {
  it('asks for a day either side of the picked date', () => {
    expect(nearDay('2026-11-20')).toEqual({ dueFrom: new Date(2026, 10, 19).getTime(), dueTo: new Date(2026, 10, 22).getTime() });
    expect(nearDay('')).toEqual({ ids: [] });
  });
});

describe('olderStep', () => {
  it('goes back 6 months at a time', () => {
    expect(olderStep(new Date(2026, 8, 22, 15).getTime())).toBe(new Date(2026, 2, 22).getTime());
  });
});
