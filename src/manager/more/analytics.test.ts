import { describe, expect, it } from 'vitest';
import type { CateringOrder, OrderAmount, WithId } from '@shared/data';
import { analyze, bucketsFor, datesRange, filteredAmount, filterRows, periodOf, takesOf, weekStart } from './analytics';
import { payFrom } from '../catering/pay';

// November 2026: Mon 16 … Sun 22.
const at = (d: number, h: number, m = 0, mo = 10) => new Date(2026, mo, d, h, m).getTime();
const order = (id: string, dueAt: number, extra: Partial<CateringOrder> = {}) =>
  ({ id, customerName: id, phone: '', dueAt, type: 'pickup', items: '', status: 'completed', createdAt: 0, updatedAt: 0, ...extra }) as WithId<CateringOrder>;
const amt = (id: string, a: Partial<OrderAmount>) => ({ id, updatedAt: 0, ...a }) as WithId<OrderAmount>;
const dep = (amount: number, method: string, takenBy: string) => ({ amount, method, takenBy, at: 1 });
const week = periodOf('week', at(18, 12));

describe('ranges', () => {
  it('weeks run Monday 00:00 to the next Monday', () => {
    for (let d = 16; d <= 22; d++) expect(weekStart(at(d, 15))).toBe(at(16, 0));
    expect(weekStart(at(22, 23, 59))).toBe(at(16, 0));
    expect(weekStart(at(23, 0))).toBe(at(23, 0));
    expect(week).toEqual({ from: at(16, 0), to: at(23, 0) });
    expect(periodOf('week', at(18, 12), -1)).toEqual({ from: at(9, 0), to: at(16, 0) });
  });
  it('months and years, stepping across a year end', () => {
    expect(periodOf('month', at(18, 12))).toEqual({ from: at(1, 0), to: at(1, 0, 0, 11) });
    expect(periodOf('month', at(18, 12), 2)).toEqual({ from: new Date(2027, 0, 1).getTime(), to: new Date(2027, 1, 1).getTime() });
    expect(periodOf('year', at(18, 12), -1)).toEqual({ from: new Date(2025, 0, 1).getTime(), to: new Date(2026, 0, 1).getTime() });
  });
  it('picked dates include both days; a backwards range is refused', () => {
    expect(datesRange('2026-11-20', '2026-11-20')).toEqual({ from: at(20, 0), to: at(21, 0) });
    expect(datesRange('2026-11-21', '2026-11-20')).toBeNull();
    expect(datesRange('', '2026-11-20')).toBeNull();
  });
  it('bars: days for a week or month, weeks up to half a year, months beyond', () => {
    expect(bucketsFor(week).map((b) => b.label)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    expect(bucketsFor(periodOf('month', at(18, 12)))).toHaveLength(30);
    const q = bucketsFor({ from: at(1, 0, 0, 8), to: at(1, 0, 0, 11) }); // Sep 1 (Tue) – Nov 30
    expect(q[0]).toMatchObject({ from: at(1, 0, 0, 8), to: at(7, 0, 0, 8) }); // cut at the first Monday
    expect(q.at(-1)!.to).toBe(at(1, 0, 0, 11));
    const y = bucketsFor(periodOf('year', at(18, 12)));
    expect(y.map((b) => b.label).join('')).toBe('JFMAMJJASOND');
    // Every millisecond of the range is in exactly one bar.
    for (const bs of [q, y]) for (let i = 1; i < bs.length; i++) expect(bs[i].from).toBe(bs[i - 1].to);
  });
});

describe('analyze: the money', () => {
  const orders = [
    order('paid', at(16, 12)),
    order('part', at(17, 12), { status: 'open' }),
    order('unpaid', at(18, 12), { status: 'open', type: 'delivery' }),
    order('noAmount', at(19, 12)), // imported: paid, no amount
    order('depositsCover', at(20, 12)),
    order('cancelled', at(21, 12), { status: 'cancelled' }),
    order('deleted', at(21, 13), { deletedAt: 5 }),
    order('nextWeek', at(23, 0)),
    order('lastWeek', at(15, 23, 59)),
  ];
  const amounts = [
    amt('paid', { amount: 300, paid: true, method: 'card', takenBy: 'Siri', deposits: [dep(100, 'zelle', 'Tarun')] as never }),
    amt('part', { amount: 500, paid: false, deposits: [dep(200, 'cash', 'Ravi')] as never }),
    amt('unpaid', { amount: 250.5, paid: false }),
    amt('noAmount', { amount: null, paid: true }),
    amt('depositsCover', { amount: 150, deposits: [dep(100, 'cash', 'Ravi'), dep(50, 'card', 'Siri')] as never }),
    amt('cancelled', { amount: 400, deposits: [dep(100, 'zelle', 'Ravi')] as never, refundNote: 'Refunded by Zelle' }),
    amt('deleted', { amount: 999, paid: true }),
    amt('nextWeek', { amount: 999, paid: true }),
    amt('lastWeek', { amount: 999, paid: true }),
  ];
  const a = analyze(orders, amounts, week);

  it('lists the week, cancelled included, deleted and other weeks left out', () => {
    expect(a.rows.map((r) => [r.order.id, r.status])).toEqual([
      ['paid', 'paid'],
      ['part', 'part'],
      ['unpaid', 'unpaid'],
      ['noAmount', 'paid'],
      ['depositsCover', 'paid'],
      ['cancelled', 'cancelled'],
    ]);
  });
  it('sales = amounts; collected + owed = sales when every order has an amount', () => {
    expect(a).toMatchObject({ orders: 5, sales: 1200.5, collected: 650, owed: 550.5, withAmount: 4, noAmount: 1, unpaid: 2, pickup: 4, delivery: 1 });
    expect(a.average).toBeCloseTo(300.13, 2);
    expect(a.cancelled).toEqual({ orders: 1, paid: 100 });
  });
  it('splits the money by method and by who took it, adding up to what was collected', () => {
    expect(a.byMethod.map((s) => [s.label, s.amount, s.orders])).toEqual([
      ['Cash', 300, 2],
      ['Card', 250, 2],
      ['Zelle', 100, 1],
    ]);
    expect(a.byStaff.map((s) => [s.label, s.amount])).toEqual([
      ['Ravi', 300],
      ['Siri', 250],
      ['Tarun', 100],
    ]);
    const sum = (xs: { amount: number }[]) => xs.reduce((t, s) => t + s.amount, 0);
    expect(sum(a.byMethod)).toBe(a.collected);
    expect(sum(a.byStaff)).toBe(a.collected);
  });
  it('the chart bars add up to the totals', () => {
    expect(a.series.map((s) => s.orders)).toEqual([1, 1, 1, 1, 1, 0, 0]);
    expect(a.series.reduce((t, s) => t + s.sales, 0)).toBe(a.sales);
  });
  it('filters the list; a method filter shows just that money', () => {
    const ids = (f: string) => filterRows(a.rows, f).map((r) => r.order.id);
    expect(ids('unpaid')).toEqual(['part', 'unpaid']);
    expect(ids('noamount')).toEqual(['noAmount']);
    expect(ids('cancelled')).toEqual(['cancelled']);
    expect(ids('m:zelle')).toEqual(['paid']); // the cancelled order's Zelle deposit is not in the totals
    expect(ids('s:Ravi')).toEqual(['part', 'depositsCover']);
    expect(filteredAmount(a.rows[0], 'm:zelle')).toBe(100);
    expect(filteredAmount(a.rows[0], 'all')).toBeNull();
  });
  it('an empty week is all zeros', () => {
    expect(analyze([], [], week)).toMatchObject({ orders: 0, sales: 0, collected: 0, owed: 0, average: null, byMethod: [], dishes: [] });
  });
});

describe('older records', () => {
  it('a paid order with no method or name counts as "Not recorded", listed last', () => {
    const a = analyze([order('old', at(16, 12)), order('new', at(17, 12))], [amt('old', { amount: 520, paid: true }), amt('new', { amount: 80, paid: true, method: 'cash', takenBy: 'Ravi' })], week);
    expect(a.byMethod.map((s) => [s.key, s.label, s.amount])).toEqual([
      ['cash', 'Cash', 80],
      ['', 'Not recorded', 520],
    ]);
    expect(filterRows(a.rows, 'm:').map((r) => r.order.id)).toEqual(['old']);
  });
  it('takes: deposits as taken, then the rest by the "Paid in full" method', () => {
    const pay = payFrom({ amount: 300, paid: true, method: 'card', takenBy: ' Siri ', deposits: [dep(100, 'zelle', 'Tarun')] as never, updatedAt: 0 });
    expect(takesOf(pay)).toEqual([
      { amount: 100, method: 'zelle', takenBy: 'Tarun' },
      { amount: 200, method: 'card', takenBy: 'Siri' },
    ]);
    expect(takesOf(payFrom({ amount: 300, paid: false, updatedAt: 0 }))).toEqual([]);
  });
});

describe('top dishes', () => {
  it('counts orders per dish (by menu id, else by name), trays in full-tray terms, extras left out', () => {
    const line = (name: string, qty: number | null, unit: string, more: object = {}) => ({ dishId: null, name, qty, unit, note: '', ...more });
    const a = analyze(
      [
        order('a', at(16, 12), { lines: [line('Chicken Biryani', 1, 'Full tray', { dishId: 'cb' }), line('Raita', 1, 'Quarts', { extra: 'Raita' })] }),
        order('b', at(17, 12), { lines: [line('Chicken Dum Biryani', 1, 'Half tray', { dishId: 'cb' }), line('Samosa', 40, 'Pieces')] }),
        order('c', at(18, 12), { items: 'samosa, 20 pcs\nChicken Biryani 1 full tray' }),
        order('d', at(19, 12), { status: 'cancelled', items: 'Samosa 100' }),
      ],
      [],
      week,
    );
    expect(a.dishes.find((d) => /samosa/i.test(d.name))).toMatchObject({ orders: 2, trays: 0 });
    expect(a.dishes.some((d) => d.name === 'Raita')).toBe(false);
    const cb = a.dishes.filter((d) => /biryani/i.test(d.name));
    expect(cb.reduce((t, d) => t + d.orders, 0)).toBe(3);
    expect(cb.find((d) => d.orders === 2)).toMatchObject({ trays: 1.5 });
  });
});
