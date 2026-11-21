import { describe, expect, it } from 'vitest';
import type { CateringOrder, ScannedOrder } from '@shared/data';
import { describeChanges, HISTORY_MAX, lastEdit, withEdit } from './orders';
import { countdown, dayLabel, duration, emptyForm, formFromOrder, formFromScan, fromInputs, groupByDay, groupByDayUpcomingFirst, groupOpen, history, isSoon, monthGrid, orderFields, ordersByDay, sameDayOrders, shareText, showsCountdown, telHref, validate, whatsappHref, NAME_MAX } from './orders';

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
  const row = (name: string, qty = '', unit = '', note = '') => ({ dishId: null, name, qty, unit, note });
  const good = { ...emptyForm(NOW), customerName: ' Priya ', phone: '555 123 4567', time: '17:30', lines: [row('Biryani'), row(''), row('  Raita  ')], people: '40' };

  it('turns date and time inputs into local ms', () => {
    expect(fromInputs('2026-11-18', '17:30')).toBe(at(18, 17, 30));
    expect(fromInputs('', '17:30')).toBeNull();
  });
  it('accepts a good form and builds clean fields', () => {
    expect(validate(good)).toEqual({});
    const f = orderFields(good);
    expect(f).toEqual({
      customerName: 'Priya', phone: '555 123 4567', dueAt: at(18, 17, 30), type: 'pickup', items: 'Biryani\nRaita', people: 40,
      lines: [{ dishId: null, name: 'Biryani', qty: null, unit: '', note: '' }, { dishId: null, name: 'Raita', qty: null, unit: '', note: '' }],
    });
    expect(Object.values(f)).not.toContain(undefined);
    expect('address' in f).toBe(false);
  });
  it('requires the main fields', () => {
    const e = validate(emptyForm(NOW));
    expect(Object.keys(e).sort()).toEqual(['customerName', 'lines', 'phone', 'time']);
  });
  it('saves dish, quantity, unit and note, and the items as text', () => {
    const f = orderFields({ ...good, lines: [{ ...row('Chicken Dum Biryani', '2', 'Full tray', 'extra spicy'), dishId: 'g1' }, row('Gulab Jamun', '40', 'Pieces'), row('Raita', '1', 'Quarts')] });
    expect(f.lines[0]).toEqual({ dishId: 'g1', name: 'Chicken Dum Biryani', qty: 2, unit: 'Full tray', note: 'extra spicy' });
    expect(f.items).toBe('Chicken Dum Biryani, 2 Full trays (extra spicy)\nGulab Jamun, 40 pieces\nRaita, 1 quart');
  });
  it('checks quantities and rows with no dish', () => {
    expect(validate({ ...good, lines: [row('Rice', 'two')] }).lines).toMatch(/quantity of item 1/);
    expect(validate({ ...good, lines: [row('Rice', '0')] }).lines).toMatch(/quantity/);
    expect(validate({ ...good, lines: [row('Rice', '1.5')] }).lines).toBeUndefined();
    expect(validate({ ...good, lines: [row('Rice'), row('', '3')] }).lines).toMatch(/Item 2 has no dish/);
  });
  it('keeps an untouched old line exactly as typed, so saving changes nothing', () => {
    const o = order(at(19, 12, 0), { items: 'Chicken dum biryani, 2 large trays\nGarlic naan, 30' });
    const form = formFromOrder(o);
    expect(form.lines[0]).toMatchObject({ name: 'Chicken Dum Biryani', qty: '2', unit: 'Full tray', text: 'Chicken dum biryani, 2 large trays' });
    const f = orderFields(form);
    expect(f.items).toBe(o.items);
    expect(describeChanges(o, { ...o, ...f })).toEqual([]);
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
    expect(orderFields(formFromOrder(o))).toEqual({ customerName: 'A', phone: o.phone, dueAt: o.dueAt, type: 'delivery', address: 'X', people: 25, items: 'Rice', notes: 'N', lines: [{ dishId: null, name: 'Rice', qty: null, unit: '', note: '', text: 'Rice' }] });
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
    expect(form).toMatchObject({ customerName: 'Meera Iyer', date: '2026-11-19', time: '18:30', type: 'delivery', address: '12 Palm St', people: '40', notes: '' });
    expect(form.lines.map((l) => [l.name, l.qty, l.unit])).toEqual([['Veg Biryani', '2', 'Full tray'], ['Naan', '30', '']]);
    expect(unsure).toEqual(['phone']);
    expect(validate(form)).toEqual({});
  });

  it('keeps the form values and asks to check when something is missing or malformed', () => {
    const { form, unsure } = formFromScan({ ...scan, date: '19/11', time: '6pm', type: 'unknown', address: '', people: '0', items: [] }, base);
    expect(form.date).toBe(base.date);
    expect(form.time).toBe('');
    expect(form.type).toBe('pickup');
    expect(form.people).toBe('');
    expect(form.lines).toEqual(base.lines);
    expect(unsure).toEqual(['phone', 'date', 'type']);
  });
});

describe('formFromScan with structured lines', () => {
  const dishes = [{ id: 'g1', name: 'Chicken Dum Biryani', group: 'Biryani', description: '' }, { id: 'g2', name: 'Gulab Jamun', group: 'Desserts', description: '' }];
  const scan: ScannedOrder = {
    isOrder: true, customerName: 'Meera', phone: '555 404 1212', date: '2026-11-19', time: '18:30', type: 'pickup', address: '', people: '', notes: '', unsure: [],
    lines: [
      { dish: 'Chicken Dum Biryani', qty: '2', unit: 'FT', note: 'mild', unsure: false },
      { dish: 'gulab jamun', qty: '40', unit: 'pcs', note: '', unsure: true },
      { dish: 'Kaju Katli', qty: '', unit: '', note: '', unsure: false },
    ],
  };
  it('matches menu dishes, makes units standard and marks rows to check', () => {
    const { form } = formFromScan(scan, emptyForm(NOW), dishes);
    expect(form.lines).toEqual([
      { dishId: 'g1', name: 'Chicken Dum Biryani', qty: '2', unit: 'Full tray', note: 'mild' },
      { dishId: 'g2', name: 'Gulab Jamun', qty: '40', unit: 'Pieces', note: '', check: true },
      { dishId: null, name: 'Kaju Katli', qty: '', unit: '', note: '', check: true },
    ]);
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

  it('says 1 person, and leaves out marks WhatsApp would format', () => {
    const text = shareText({ ...base, customerName: 'Priya *VIP* _Sharma_', type: 'pickup', people: 1, notes: 'Line 1 ~strike~' });
    expect(text).toBe('*Catering order*\nPriya VIP Sharma\nFri, Nov 20, 5:30 PM\nPickup\n1 person\n\n*Items*\n• Chicken biryani, 4 trays\n• Garlic naan, 150\n\n*Notes:* Line 1 strike');
  });

  it('makes a wa.me link with the message encoded', () => {
    expect(whatsappHref('a & b\n*c*')).toBe('https://wa.me/?text=a%20%26%20b%0A*c*');
  });
});

describe('edit history', () => {
  const base = order(at(20, 17), { customerName: 'Sharma', items: '20 samosas\nChicken biryani, 2 trays', notes: '', people: 30 });
  it('says what changed in plain words', () => {
    const after = { ...base, dueAt: at(21, 18, 30), items: '25 samosas\nChicken biryani, 2 trays\nRaita', people: 40, notes: 'Extra spicy' };
    expect(describeChanges(base, after)).toEqual([
      'Date: Fri, Nov 20 → Sat, Nov 21',
      'Time: 5:00 PM → 6:30 PM',
      'People: 30 → 40',
      'Items: 20 samosas → 25 samosas',
      'Item added: Raita',
      'Notes: (none) → Extra spicy',
    ]);
  });
  it('is empty when nothing changed, and ignores spacing', () => {
    expect(describeChanges(base, { ...base, items: ' 20 samosas \n\nChicken biryani, 2 trays', notes: '  ' })).toEqual([]);
  });
  it('covers pickup/delivery, address, name, phone and removed items', () => {
    const after = { ...base, customerName: 'R Sharma', phone: '555 000 1111', type: 'delivery' as const, address: '1 Main St', items: '20 samosas' };
    expect(describeChanges(base, after)).toEqual([
      'Name: Sharma → R Sharma',
      'Phone: 555 123 4567 → 555 000 1111',
      'Pickup → Delivery',
      'Address: (none) → 1 Main St',
      'Item removed: Chicken biryani, 2 trays',
    ]);
  });
  it('keeps the latest edits only', () => {
    let h = withEdit(undefined, { at: 0, by: 'manager', changes: ['a'] });
    for (let i = 1; i <= HISTORY_MAX + 5; i++) h = withEdit(h, { at: i, by: 'kitchen', changes: ['b'] });
    expect(h).toHaveLength(HISTORY_MAX);
    expect(lastEdit({ history: h })?.at).toBe(HISTORY_MAX + 5);
    expect(lastEdit({})).toBeNull();
  });
});

import { amountError, amountInput, amountLabel, parseAmount } from './orders';

describe('order amount (manager only)', () => {
  it('reads what was typed', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('  ')).toBeNull();
    expect(parseAmount('200')).toBe(200);
    expect(parseAmount('$200')).toBe(200);
    expect(parseAmount('1,250.50')).toBe(1250.5);
    expect(parseAmount('$ 99.9')).toBe(99.9);
    expect(parseAmount('.5')).toBe(0.5);
    expect(parseAmount('0')).toBe(0);
  });
  it('rejects text that is not an amount', () => {
    for (const bad of ['abc', '20 dollars', '-5', '1.234', '2e3', '1.2.3', '2000000']) expect(Number.isNaN(parseAmount(bad))).toBe(true);
    expect(amountError('abc')).toMatch(/amount like 200/);
    expect(amountError('')).toBe('');
    expect(amountError('200')).toBe('');
  });
  it('shows it as dollars', () => {
    expect(amountLabel(200)).toBe('$200');
    expect(amountLabel(1250.5)).toBe('$1,250.50');
    expect(amountLabel(null)).toBe('');
    expect(amountLabel(undefined)).toBe('');
    expect(amountInput(200)).toBe('200');
    expect(amountInput(200.5)).toBe('200.50');
    expect(amountInput(null)).toBe('');
  });
  it('never reaches the kitchen, the WhatsApp message or the change history', () => {
    // The amount isn't an order field: an order with an amount stored elsewhere shares and diffs the same.
    const o = order(NOW, { items: 'Rice' });
    const withExtra = { ...o, amount: 200 } as CateringOrder;
    expect(shareText(withExtra)).not.toMatch(/\$|200/);
    expect(describeChanges(o, withExtra)).toEqual([]);
    expect(Object.keys(orderFields(formFromOrder(withExtra)))).not.toContain('amount');
  });
});

describe('1½ trays in the share text and a scan', () => {
  it('shares old typed "11/2" lines as "1-1/2"', () => {
    const o = order(at(20, 12), { items: 'Chicken biryani 11/2 trays\nNaan, 1-1/2 Full trays' });
    expect(shareText(o)).toContain('• Chicken biryani 1-1/2 trays\n• Naan, 1-1/2 Full trays');
  });

  it('reads a scanned "1 1/2" as 1.5, not 112', () => {
    const scan = { lines: [{ dish: 'Chicken biryani', qty: '1 1/2', unit: 'full tray', note: '', unsure: false }] } as unknown as ScannedOrder;
    expect(formFromScan(scan, emptyForm(at(20, 12))).form.lines[0].qty).toBe('1.5');
  });
});

describe('showsCountdown', () => {
  it('shows only in the last hour and after the time', () => {
    const NOW = new Date(2026, 10, 20, 12, 0).getTime();
    expect(showsCountdown(NOW + 61 * 60_000, NOW)).toBe(false);
    expect(showsCountdown(NOW + 3 * 86_400_000, NOW)).toBe(false);
    expect(showsCountdown(NOW + 60 * 60_000, NOW)).toBe(true);
    expect(showsCountdown(NOW + 5 * 60_000, NOW)).toBe(true);
    expect(showsCountdown(NOW - 25 * 60_000, NOW)).toBe(true);
  });
});
