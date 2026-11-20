// node --test tools/whatsapp-import/build.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertClean, build, buildOrder, dueAtOf, lineText, noMoneyNotes, noPhones, noPrice, orderId, payMethod, sourceMs, NOW } from './build.mjs';

const menu = new Map([['dish-1', 'Vijayawada Boneless Chicken Biryani'], ['dish-2', 'Punjabi Samosa']]);

const base = (over = {}) => ({
  key: '2026-01-04-jyothi-1115',
  sources: ['‎[12/28/25, 9:08:09 PM] Jay C', '00000006-PHOTO-2025-12-28-21-18-16.jpg'],
  customerName: 'Jyothi',
  phone: '6026518597',
  date: '2026-01-04',
  time: '11:15',
  type: 'pickup',
  address: '',
  people: null,
  lines: [
    { dishId: 'dish-1', name: 'Vijayawada Boneless Chicken Biryani', qty: 1, unit: 'Full tray', note: '', text: 'Vij BL CB - 1 FT', check: false },
    { dishId: null, name: 'Live Dosa', qty: 60, unit: 'Servings', note: '', text: '', check: true },
  ],
  notes: 'Medium spicy',
  amount: 450,
  payments: [],
  cancelled: false,
  changes: [],
  flags: [],
  ...over,
});

test('times are Phoenix (UTC-7)', () => {
  assert.equal(dueAtOf('2026-01-04', '11:15').ms, Date.parse('2026-01-04T11:15:00-07:00'));
  assert.equal(dueAtOf('2026-07-04', '18:00').ms, Date.parse('2026-07-04T18:00:00-07:00')); // no DST
  assert.deepEqual(dueAtOf('2026-01-04', ''), { ms: Date.parse('2026-01-04T12:00:00-07:00'), defaulted: true });
  assert.equal(sourceMs('[12/28/25, 9:08:09 PM] Jay C'), Date.parse('2025-12-28T21:08:09-07:00'));
  assert.equal(sourceMs('[1/2/26, 12:05:00 AM] X'), Date.parse('2026-01-02T00:05:00-07:00'));
  assert.equal(sourceMs('00000006-PHOTO-2025-12-28-21-18-16.jpg'), Date.parse('2025-12-28T21:18:16-07:00'));
  assert.equal(sourceMs('nothing'), null);
});

test('bad dates fail', () => {
  assert.throws(() => dueAtOf('2026-02-30', '10:00'), /real date/);
  assert.throws(() => dueAtOf('2024-12-01', '10:00'), /outside/);
  assert.throws(() => dueAtOf('2026-1-4', '10:00'), /bad date/);
  assert.throws(() => dueAtOf('2026-01-04', '25:00'), /real date/);
  assert.throws(() => build([{ name: 'x', orders: [base({ date: '2026-13-01' })] }]), /cannot build/);
});

test('ids are sanitized and duplicates fail', () => {
  assert.equal(orderId('2026-01-04-Jyothi Rao_1115'), 'wa-2026-01-04-jyothi-rao-1115');
  assert.throws(() => build([{ name: 'a', orders: [base()] }, { name: 'b', orders: [base({ key: '2026-01-04-JYOTHI-1115' })] }]), /duplicate id wa-2026-01-04-jyothi-1115/);
});

test('a past order is completed and paid, shaped like the app', () => {
  const r = buildOrder(base({ payments: [{ amount: 100, kind: 'advance', method: 'Zelle', source: '[12/29/25, 10:00:00 AM] Jay C' }, { amount: 350, kind: 'paid', method: 'cash' }] }), { menu });
  const created = Date.parse('2025-12-28T21:08:09-07:00');
  const due = Date.parse('2026-01-04T11:15:00-07:00');
  assert.equal(r.id, 'wa-2026-01-04-jyothi-1115');
  assert.deepEqual(r.order, {
    customerName: 'Jyothi', phone: '6026518597', dueAt: due, type: 'pickup', people: null,
    items: 'Vij BL CB - 1 FT\nLive Dosa, 60 servings',
    lines: [
      { dishId: 'dish-1', name: 'Vijayawada Boneless Chicken Biryani', qty: 1, unit: 'Full tray', note: '', text: 'Vij BL CB - 1 FT' },
      { dishId: null, name: 'Live Dosa', qty: 60, unit: 'Servings', note: '', check: true },
    ],
    status: 'completed', completedAt: due, createdAt: created, updatedAt: created,
    history: [{ at: created, by: 'manager', changes: ['Imported from the WhatsApp catering group'] }],
    notes: 'Medium spicy',
  });
  assert.deepEqual(r.amount, {
    amount: 450, paid: true, paidAt: due, method: 'cash', takenBy: null, updatedAt: created,
    deposits: [{ amount: 100, method: 'zelle', takenBy: 'WhatsApp', at: Date.parse('2025-12-29T10:00:00-07:00') }],
  });
  assert.ok(!('address' in r.order));
  assertClean(r);
});

test('a future order is open; amount doc only when something was stated', () => {
  const later = { key: '2026-12-05-ravi-1800', date: '2026-12-05', time: '18:00', customerName: 'Ravi' };
  const none = buildOrder(base({ ...later, amount: null }), { menu });
  assert.equal(none.order.status, 'open');
  assert.equal(none.order.completedAt, null);
  assert.equal(none.amount, null);
  const adv = buildOrder(base({ ...later, amount: null, payments: [{ amount: 150, kind: 'advance', method: '' }] }), { menu });
  assert.deepEqual(adv.amount, {
    amount: null, paid: false, paidAt: null, method: null, takenBy: null, updatedAt: adv.order.createdAt,
    deposits: [{ amount: 150, method: 'cash', takenBy: 'WhatsApp', at: adv.order.createdAt }],
  });
  assert.match(adv.added.join(), /saved as cash/);
});

test('delivery keeps its address, unknown dish ids drop to typed, missing time is flagged', () => {
  const r = buildOrder(base({ type: 'delivery', address: '1 Main St', time: '', lines: [{ dishId: 'nope', name: 'Thing', qty: null, unit: '', note: '', text: '', check: false }] }), { menu });
  assert.equal(r.order.address, '1 Main St');
  assert.deepEqual(r.order.lines, [{ dishId: null, name: 'Thing', qty: null, unit: '', note: '', check: true }]);
  assert.equal(r.order.items, 'Thing');
  assert.match(r.added.join(), /12:00/);
  assert.match(r.added.join(), /not on the menu/);
});

test('cancelled orders are skipped and listed; Mamtha gets 520; report has no phones', () => {
  const mamtha = base({ key: '2026-11-07-mamtha-1730', customerName: 'Mamtha', date: '2026-11-07', time: '17:30', type: 'delivery', address: '1 Main St', amount: null });
  const gone = base({ key: '2026-02-01-sam-1200', customerName: 'Sam', date: '2026-02-01', cancelled: true, changes: ['Cancelled by customer'] });
  const flagged = base({ key: '2026-03-01-x-1000', date: '2026-03-01', time: '10:00', flags: ['phone 602 651 8597 unclear'] });
  const { list, report } = build([{ name: 'p', orders: [mamtha, gone, flagged] }], { menu });
  assert.equal(list.length, 2);
  const m = list.find((x) => x.id === 'wa-2026-11-07-mamtha-1730');
  assert.equal(m.amount.amount, 520);
  assert.equal(m.amount.paid, true);
  assert.match(report, /Cancelled \(not imported\) \| 1/);
  assert.match(report, /Sam · `2026-02-01-sam-1200` · Cancelled by customer/);
  assert.match(report, /\$520/);
  assert.doesNotMatch(report, /6026518597|602 651 8597/);
  assert.match(report, /\[phone\] unclear/);
  assert.equal(NOW, Date.parse('2026-11-21T06:59:59Z'));
});

test('helpers', () => {
  assert.equal(payMethod('Zelle'), 'zelle');
  assert.equal(payMethod('credit card'), 'card');
  assert.equal(payMethod(''), null);
  assert.equal(lineText({ name: 'Samosa', qty: 1.5, unit: 'full tray', note: 'mild' }), 'Samosa, 1.5 Full trays (mild)');
  assert.equal(lineText({ name: 'Rice', qty: null, unit: 'Half tray', note: '' }), 'Rice, Half tray');
  assert.equal(lineText({ name: 'Rice', qty: 1, unit: '3/4 tray', note: '' }), 'Rice, 1 3/4 tray');
  assert.equal(noPhones('total $1250 call 602-651-8597'), 'total $1250 call [phone]');
  assert.throws(() => assertClean({ a: [{ b: undefined }] }), /a\[0\]\.b/);
});

test('prices and payments never reach the order (the kitchen reads it)', () => {
  assert.equal(noPrice('Onion samosa -50 - $50'), 'Onion samosa -50');
  assert.equal(noPrice('paneer butter Masala (80$) -> 1/2 tray', { tray: true }), 'paneer butter Masala -> 1/2 tray');
  assert.equal(noPrice('Half Tray Chicken 65 wet(80)', { tray: true }), 'Half Tray Chicken 65 wet');
  assert.equal(noPrice('Butter naan- ( 25)'), 'Butter naan- ( 25)'); // a count, not a price
  assert.equal(noPrice('chicken chettinadu - (1) Tray', { tray: true }), 'chicken chettinadu - (1) Tray');
  assert.equal(noMoneyNotes('Total $765; $700 cash after friends and family discount.'), '');
  assert.equal(noMoneyNotes('Medium spice. #Paid'), 'Medium spice.');
  assert.equal(noMoneyNotes('Line 1\nLine 2'), 'Line 1\nLine 2');
  const r = buildOrder(base({
    notes: 'Mild. Total 290 + tax',
    lines: [{ dishId: 'dish-2', name: 'Punjabi Samosa', qty: 30, unit: 'Pieces', note: '', text: 'Samosa-30-$60', check: false }],
  }), { menu });
  assert.equal(r.order.items, 'Samosa-30');
  assert.equal(r.order.notes, 'Mild.');
  assert.doesNotMatch(JSON.stringify(r.order), /\$|290/);
  assert.equal(r.amount.amount, 450); // the amount itself stays, in orderAmounts
});

test('two lines with the same text fail the build (a split line would read as double)', () => {
  const t = '22 Naan garlic and chilli garlic half and half';
  const lines = [
    { dishId: null, name: 'Garlic Naan', qty: 11, unit: 'Pieces', note: '', text: t },
    { dishId: null, name: 'Chilli Garlic Naan', qty: 11, unit: 'Pieces', note: '', text: t },
  ];
  assert.throws(() => buildOrder(base({ lines })), /two lines read the same/);
});

test('unclear entries are listed in the report, not imported', () => {
  const { list, report } = build([{ name: 'p', orders: [base()] }], { menu, held: [{ key: 'nodate-x', customerName: '', date: '', lines: [{ text: 'Biryani - Full tray 160$' }], flags: ['no date'] }] });
  assert.equal(list.length, 1);
  assert.match(report, /Held back as unclear \(not imported\) \| 1/);
  assert.match(report, /`nodate-x` · no date/);
  assert.doesNotMatch(report, /160\$/);
});
