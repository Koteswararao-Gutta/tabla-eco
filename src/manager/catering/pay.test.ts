import { describe, expect, it } from 'vitest';
import { balance, depositError, depositTotal, isPaid, NO_PAY, paidSoFar, payFrom, payLabel, staffNames, unpaidDone, type Pay } from './pay';

const dep = (amount: number) => ({ amount, method: 'cash' as const, takenBy: 'Siri', at: 1 });
const pay = (p: Partial<Pay>): Pay => ({ ...NO_PAY, ...p });

describe('payFrom', () => {
  it('reads older docs (amount and paid only) and missing docs', () => {
    expect(payFrom(undefined)).toEqual(NO_PAY);
    expect(payFrom({ amount: 200, paid: true, updatedAt: 1 })).toEqual({ ...NO_PAY, amount: 200, paid: true });
  });
  it('drops bad deposits and unknown methods', () => {
    const p = payFrom({ amount: 300, deposits: [dep(100), { amount: 0 } as never, null as never], method: 'bitcoin' as never, takenBy: '  ', updatedAt: 1 });
    expect(p.deposits).toEqual([dep(100)]);
    expect(p.method).toBeNull();
    expect(p.takenBy).toBeNull();
  });
});

describe('balance', () => {
  it('is the amount minus deposits, 0 once paid, null without an amount', () => {
    expect(balance(pay({ amount: 300, deposits: [dep(100), dep(50.5)] }))).toBe(149.5);
    expect(depositTotal(pay({ deposits: [dep(0.1), dep(0.2)] }))).toBe(0.3);
    expect(balance(pay({ amount: 300, paid: true }))).toBe(0);
    expect(balance(pay({ amount: null, deposits: [dep(100)] }))).toBeNull();
    expect(balance(pay({ amount: 100, deposits: [dep(150)] }))).toBe(0);
  });
});

describe('payLabel', () => {
  it('labels the card', () => {
    expect(payLabel({ amount: 200, paid: true })).toBe('$200 · Paid');
    expect(payLabel({ amount: 200, paid: false })).toBe('$200 · Unpaid');
    expect(payLabel({ amount: null, paid: true })).toBe('Paid');
    expect(payLabel({ amount: null, paid: false })).toBe('');
    expect(payLabel(undefined)).toBe('');
    expect(payLabel(pay({ amount: 300, deposits: [dep(100)] }))).toBe('$300 · $200 owed');
    expect(payLabel(pay({ amount: null, deposits: [dep(100)] }))).toBe('$100 paid so far');
  });
});

describe('depositError', () => {
  const p = pay({ amount: 300, deposits: [dep(100)] });
  it('needs an amount below what is still owed', () => {
    expect(depositError('', p)).toMatch(/how much/);
    expect(depositError('0', p)).toMatch(/how much/);
    expect(depositError('abc', p)).toMatch(/like 100 or 100.50/);
    expect(depositError('250', p)).toMatch(/more than the \$200/);
    expect(depositError('200', p)).toMatch(/whole balance/);
    expect(depositError('$150.50', p)).toBe('');
    expect(depositError('5000', pay({}))).toBe(''); // no amount set: any deposit
  });
});

describe('staffNames', () => {
  it('lists active people from the Staff tab', () => {
    const config = { people: [{ id: 'a', name: 'Siri', active: true }, { id: 'b', name: 'Old', active: false }, { id: 'c', name: ' Tarun ' }], settings: {}, special: {} };
    expect(staffNames(config)).toEqual(['Siri', 'Tarun']);
  });
  it("uses the planner's starting staff before anything is saved", () => {
    expect(staffNames(null)).toContain('Siri');
    expect(staffNames(null).length).toBeGreaterThan(3);
  });
});

describe('unpaidDone', () => {
  const orders = [
    { id: '1', status: 'completed', dueAt: 30 },
    { id: '2', status: 'completed', dueAt: 10 },
    { id: '3', status: 'open', dueAt: 5 },
    { id: '4', status: 'completed', dueAt: 20 },
  ];
  it('lists finished orders not paid in full, soonest first', () => {
    const pays: Record<string, Pay> = { '4': pay({ paid: true }), '2': pay({ amount: 100, deposits: [dep(50)] }) };
    expect(unpaidDone(orders, (id) => pays[id] ?? NO_PAY)?.map((o) => o.id)).toEqual(['2', '1']);
  });
  it('waits while payments load', () => {
    expect(unpaidDone(orders, () => undefined)).toBeNull();
  });
  it('leaves out cancelled and deleted orders', () => {
    const more = [...orders, { id: '5', status: 'cancelled', dueAt: 1 }, { id: '6', status: 'completed', dueAt: 2, deletedAt: 9 }];
    expect(unpaidDone(more, () => NO_PAY)?.map((o) => o.id)).toEqual(['2', '4', '1']);
  });
});

describe('deposits that add up to the full amount', () => {
  const full = pay({ amount: 300, deposits: [dep(100), dep(200)] });
  it('count as paid', () => {
    expect(isPaid(full)).toBe(true);
    expect(isPaid(pay({ amount: 300, deposits: [dep(100)] }))).toBe(false);
    expect(isPaid(pay({ amount: null, deposits: [dep(100)] }))).toBe(false);
    expect(isPaid(pay({ amount: 0 }))).toBe(false);
    expect(payLabel(full)).toBe('$300 · Paid');
  });
  it('are not in the Unpaid list', () => {
    const orders = [{ id: 'a', status: 'completed', dueAt: 1 }];
    expect(unpaidDone(orders, () => full)).toEqual([]);
  });
});

describe('depositError wording', () => {
  it('asks for an amount like 100 without "leave it empty"', () => {
    expect(depositError('abc', pay({ amount: 300 }))).toBe('Please enter an amount like 100 or 100.50.');
  });
});

describe('paidSoFar', () => {
  it('is the whole amount once paid in full, else the deposits', () => {
    expect(paidSoFar(pay({ amount: 500, paid: true }))).toBe(500);
    expect(paidSoFar(pay({ amount: 500, paid: true, deposits: [dep(100)] }))).toBe(500);
    expect(paidSoFar(pay({ amount: 500, deposits: [dep(100)] }))).toBe(100);
    expect(paidSoFar(pay({ amount: null, paid: true, deposits: [dep(50)] }))).toBe(50);
    expect(paidSoFar(pay({ amount: 500 }))).toBe(0);
  });
});
