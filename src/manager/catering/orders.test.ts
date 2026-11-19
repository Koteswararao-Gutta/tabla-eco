import { describe, expect, it } from 'vitest';
import type { CateringOrder, ScannedOrder } from '@shared/data';
import { countdown, dayLabel, duration, emptyForm, formFromOrder, formFromScan, fromInputs, groupByDay, groupByDayUpcomingFirst, groupOpen, history, isSoon, monthGrid, orderFields, ordersByDay, sameDayOrders, shareText, telHref, validate, whatsappHref, NAME_MAX } from './orders';

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime(); // Nov 2026, local time
const NOW = at(18, 12, 0); // Wed Nov 18, 12:00

let n = 0;
const order = (dueAt: number, extra: Partial<CateringOrder> = {}): CateringOrder => ({
  id: 'o' + ++n, customerName: 'A', phone: '555 123 4567', dueAt, type: 'pickup', items: 'Rice', status: 'open', createdAt: 0, updatedAt: 0, ...extra,
});

describe('countdown', () => {
  it('counts down to a future order', () => {
    expect(countdown(NOW + (2 * 60 + 15) * 60_000, NOW)).toEqual({ text: 'in 2 h 15 min', late: false });
    expect(countdown(NOW + 45 * 60_000, NOW)).toEqual({ text: 'in 45 min', late: false });
    expect(countdown(NOW + 3 * 3_600_000, NOW).text).toBe('in 3 h');
  });
  it('says late for overdue orders', () => {
    expect(countdown(NOW - 45 * 60_000, NOW)).toEqual({ text: '45 min late', late: true });
    expect(countdown(NOW - 3 * 86_400_000, NOW)).toEqual({ text: '3 days late', late: true });
  });
  it('says due now within a minute', () => {
    expect(countdown(NOW + 20_000, NOW).text).toBe('due now');
    expect(countdown(NOW - 20_000, NOW).late).toBe(false);
  });
  it('formats durations', () => {
    expect(duration(30 * 3_600_000)).toBe('30 h');
    expect(duration(50 * 3_600_000)).toBe('2 days');
  });
});

describe('grouping', () => {
  const a = order(at(18, 17, 30));
  const b = order(at(18, 13, 0));
  const c = order(at(19, 12, 0), { type: 'delivery' });
  const d = order(at(22, 18, 0));
  const old = order(at(16, 18, 0));
  const done = order(at(17, 19, 0), { status: 'completed', completedAt: at(17, 18, 50) });
  const all = [a, b, c, d, old, done];

  it('groups open orders by day, soonest first', () => {
    const g = groupOpen(all, NOW);
    expect(g.today.map((o) => o.id)).toEqual([b.id, a.id]);
    expect(g.tomorrow).toEqual([c]);
    expect(g.later).toEqual([d]);
    expect(g.overdue).toEqual([old]);
  });
  it('history is completed orders, newest first', () => {
    const done2 = order(at(10, 9), { status: 'completed' });
    expect(history([done2, ...all])).toEqual([done, done2]);
  });
  it('groups every order by day, newest first', () => {
    const g = groupByDay(all, NOW);
    expect(g.map((x) => x.label)).toEqual(['Sun, Nov 22', 'Tomorrow', 'Today', 'Yesterday', 'Mon, Nov 16']);
    expect(g[2].orders).toEqual([a, b]);
  });
  it('for the kitchen: today and the days ahead first, then past days, each day by time', () => {
    const g = groupByDayUpcomingFirst(all, NOW);
    expect(g.map((x) => x.label)).toEqual(['Today', 'Tomorrow', 'Sun, Nov 22', 'Yesterday', 'Mon, Nov 16']);
    expect(g[0].orders).toEqual([b, a]);
    expect(groupByDayUpcomingFirst([], NOW)).toEqual([]);
  });
  it('labels days', () => {
    expect(dayLabel(at(18, 23, 59), NOW)).toBe('Today');
    expect(dayLabel(at(19, 0, 0), NOW)).toBe('Tomorrow');
  });
  it('flags orders due within two hours', () => {
    expect(isSoon(order(NOW + 90 * 60_000), NOW)).toBe(true);
    expect(isSoon(order(NOW + 150 * 60_000), NOW)).toBe(false);
    expect(isSoon(order(NOW - 10 * 60_000), NOW)).toBe(true);
    expect(isSoon(order(NOW + 10 * 60_000, { status: 'completed' }), NOW)).toBe(false);
  });
});

describe('form', () => {
  const good = { ...emptyForm(NOW), customerName: ' Priya ', phone: '555 123 4567', time: '17:30', items: 'Biryani\n\n  Raita  \n', people: '40' };

  it('turns date and time inputs into local ms', () => {
    expect(fromInputs('2026-11-18', '17:30')).toBe(at(18, 17, 30));
    expect(fromInputs('', '17:30')).toBeNull();
  });
  it('accepts a good form and builds clean fields', () => {
    expect(validate(good)).toEqual({});
    const f = orderFields(good);
    expect(f).toEqual({ customerName: 'Priya', phone: '555 123 4567', dueAt: at(18, 17, 30), type: 'pickup', items: 'Biryani\nRaita', people: 40 });
    expect(Object.values(f)).not.toContain(undefined);
    expect('address' in f).toBe(false);
  });
  it('requires the main fields', () => {
    const e = validate(emptyForm(NOW));
    expect(Object.keys(e).sort()).toEqual(['customerName', 'items', 'phone', 'time']);
  });
  it('requires an address for delivery only', () => {
    expect(validate({ ...good, type: 'delivery' }).address).toMatch(/address/);
    const f = orderFields({ ...good, type: 'delivery', address: ' 1 Main St ', notes: 'Call' });
    expect(f.address).toBe('1 Main St');
    expect(f.notes).toBe('Call');
    expect(orderFields({ ...good, address: 'left over' }).address).toBeUndefined();
  });
  it('checks people and phone', () => {
    expect(validate({ ...good, people: 'ten' }).people).toBeTruthy();
    expect(validate({ ...good, people: '0' }).people).toBeTruthy();
    expect(orderFields({ ...good, people: '' }).people).toBeNull();
    expect(validate({ ...good, phone: '12' }).phone).toMatch(/short/);
  });
  it('round-trips an order through the form', () => {
    const o = order(at(19, 12, 0), { type: 'delivery', address: 'X', people: 25, notes: 'N' });
    expect(orderFields(formFromOrder(o))).toEqual({ customerName: 'A', phone: o.phone, dueAt: o.dueAt, type: 'delivery', address: 'X', people: 25, items: 'Rice', notes: 'N' });
  });
});

describe('formFromScan', () => {
  const scan: ScannedOrder = {
    isOrder: true, customerName: ' Meera Iyer ', phone: '555 404 1212', date: '2026-11-19', time: '18:30', type: 'delivery',
    address: '12 Palm St', people: 'about 40', items: ['Veg biryani, 2 trays', ' ', 'Naan, 30'], notes: '', unsure: ['phone', 'bogus'],
  };
  const base = emptyForm(new Date(2026, 10, 18, 10).getTime());

  it('fills every field it can and keeps the AI flags', () => {
    const { form, unsure } = formFromScan(scan, base);
    expect(form).toMatchObject({ customerName: 'Meera Iyer', date: '2026-11-19', time: '18:30', type: 'delivery', address: '12 Palm St', people: '40', items: 'Veg biryani, 2 trays\nNaan, 30', notes: '' });
    expect(unsure).toEqual(['phone']);
    expect(validate(form)).toEqual({});
  });

  it('keeps the form values and asks to check when something is missing or malformed', () => {
    const { form, unsure } = formFromScan({ ...scan, date: '19/11', time: '6pm', type: 'unknown', address: '', people: '0', items: [] }, base);
    expect(form.date).toBe(base.date);
    expect(form.time).toBe('');
    expect(form.type).toBe('pickup');
    expect(form.people).toBe('');
    expect(form.items).toBe('');
    expect(unsure).toEqual(['phone', 'date', 'type']);
  });
});

describe('month calendar', () => {
  it('lays out November 2026 Sunday first', () => {
    const weeks = monthGrid(2026, 10);
    expect(weeks).toHaveLength(5);
    expect(weeks[0].slice(0, 1)).toEqual([new Date(2026, 10, 1).getTime()]); // Nov 1, 2026 is a Sunday
    expect(weeks[4].filter(Boolean)).toHaveLength(2); // Nov 29, 30
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
  });
  it('pads the first week of a month that starts mid-week', () => {
    const weeks = monthGrid(2026, 11); // Dec 1, 2026 is a Tuesday
    expect(weeks[0].slice(0, 2)).toEqual([null, null]);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });
  it('groups orders by day, earliest first', () => {
    const late = order(at(20, 18));
    const early = order(at(20, 11));
    const days = ordersByDay([late, order(at(21, 12)), early]);
    expect(days.get(new Date(2026, 10, 20).getTime())).toEqual([early, late]);
    expect(days.size).toBe(2);
  });
  it('lists the other open orders that day and marks the ones within an hour', () => {
    const a = order(at(20, 17, 30));
    const b = order(at(20, 12));
    const done = order(at(20, 18), { status: 'completed' });
    const other = order(at(21, 18));
    const got = sameDayOrders([a, b, done, other], at(20, 18));
    expect(got.map((g) => [g.order, g.close])).toEqual([[b, false], [a, true]]);
    expect(sameDayOrders([a, b], at(20, 17, 30), a.id).map((g) => g.order)).toEqual([b]); // editing a: skip itself
    expect(sameDayOrders([a], at(20, 18, 30))[0].close).toBe(false); // exactly 1 hour apart is fine
  });
});

describe('telHref', () => {
  it('keeps only digits and a leading plus', () => {
    expect(telHref('555 123-4567')).toBe('tel:5551234567');
    expect(telHref('+1 (480) 555-0101')).toBe('tel:+14805550101');
    expect(telHref('(480) 555-0101 ext 2')).toBe('tel:4805550101');
    expect(telHref('480.555.0101 x23')).toBe('tel:4805550101');
    expect(telHref('480-555-0101 #4')).toBe('tel:4805550101');
    expect(telHref('480 555 0101 Ext. 12')).toBe('tel:4805550101');
    expect(telHref('480 555 0101 extension 7')).toBe('tel:4805550101');
    expect(telHref('+44 20 7946 0958')).toBe('tel:+442079460958');
    expect(telHref('1+480-555-0101')).toBe('tel:14805550101'); // only a leading + is kept
  });
});

describe('validate: name length', () => {
  it('rejects a name longer than the box allows, with a plain message', () => {
    const f = { ...emptyForm(at(18, 12), undefined), customerName: 'A'.repeat(NAME_MAX + 1) };
    expect(validate(f).customerName).toBe(`Please shorten the name to ${NAME_MAX} letters or fewer.`);
    expect(validate({ ...f, customerName: 'A'.repeat(NAME_MAX) }).customerName).toBeUndefined();
  });
});

describe('shareText / whatsappHref', () => {
  const due = new Date(2026, 10, 20, 17, 30).getTime(); // Fri, Nov 20, 5:30 PM
  const base = { customerName: 'Anika Wedding', dueAt: due, items: 'Chicken biryani, 4 trays\n\n  Garlic naan, 150 ', people: 120 };

  it('writes a delivery order with every part', () => {
    const text = shareText({ ...base, type: 'delivery', address: '48 Lake View Rd', notes: 'Set up by 1 PM' }, 'New catering order');
    expect(text).toBe(
      '*New catering order*\nAnika Wedding\nFri, Nov 20, 5:30 PM\nDelivery: 48 Lake View Rd\n120 people\n\n*Items*\n• Chicken biryani, 4 trays\n• Garlic naan, 150\n\n*Notes:* Set up by 1 PM',
    );
  });

  it('leaves out what is empty', () => {
    const text = shareText({ ...base, type: 'pickup', people: null, notes: '  ' });
    expect(text).toBe('*Catering order*\nAnika Wedding\nFri, Nov 20, 5:30 PM\nPickup\n\n*Items*\n• Chicken biryani, 4 trays\n• Garlic naan, 150');
  });

  it('makes a wa.me link with the message encoded', () => {
    expect(whatsappHref('a & b\n*c*')).toBe('https://wa.me/?text=a%20%26%20b%0A*c*');
  });
});
