import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_BODY } from './reminders.js';
import { restaurantDay, summaryFor, todaysOrders } from './summary.js';

const H = 60 * 60_000;
const nineAm = Date.UTC(2026, 10, 21, 16, 0); // 9:00 AM in Phoenix, Nov 21
const at = (h, m = 0) => Date.UTC(2026, 10, 21, 7 + h, m); // h:mm in Phoenix on Nov 21
const o = (id, dueAt, extra = {}) => ({ id, customerName: `Guest ${id}`, status: 'open', dueAt, type: 'pickup', ...extra });

test('restaurantDay uses Phoenix time', () => {
  assert.equal(restaurantDay(nineAm), '2026-11-21');
  assert.equal(restaurantDay(Date.UTC(2026, 10, 22, 6, 59)), '2026-11-21'); // 11:59 PM in Phoenix
  assert.equal(restaurantDay(Date.UTC(2026, 10, 22, 7, 0)), '2026-11-22');
});

test("todaysOrders picks today's open orders, earliest first", () => {
  const orders = [
    o('late', at(18)),
    o('early', at(11, 30)),
    o('done', at(12), { status: 'completed' }),
    o('cancelled', at(13), { status: 'cancelled', cancelledAt: nineAm - H }),
    o('deleted', at(14), { deletedAt: nineAm - H }),
    o('undeleted', at(15), { deletedAt: null }),
    o('tomorrow', at(24, 30)),
    o('yesterday', at(-1)),
    o('earlier today', at(7)), // already past but still today: listed
    { id: 'no time', customerName: 'x', status: 'open' },
  ];
  assert.deepEqual(todaysOrders(orders, nineAm).map((x) => x.id), ['earlier today', 'early', 'undeleted', 'late']);
  assert.deepEqual(todaysOrders([], nineAm), []);
});

test('summaryFor: no orders, no alert', () => {
  assert.equal(summaryFor([]), null);
});

test('summaryFor says how many, with times and names', () => {
  const a = summaryFor([o('1', at(11, 30), { customerName: 'Priya Sharma' }), o('2', at(18), { customerName: 'Raj', type: 'delivery' })]);
  assert.equal(a.title, "Today's catering: 2 orders");
  assert.equal(a.body, '11:30 AM Priya Sharma; 6:00 PM Raj (delivery)');
  assert.match(a.link, /#\/manager\/catering$/);
  assert.equal(summaryFor([o('1', at(12))]).title, "Today's catering: 1 order");
});

test('summaryFor keeps a busy day short', () => {
  const many = Array.from({ length: 30 }, (_, i) => o(String(i), at(10) + i * 10 * 60_000, { customerName: 'A very long customer name indeed' }));
  const a = summaryFor(many);
  assert.equal(a.title, "Today's catering: 30 orders");
  assert.ok(a.body.length <= MAX_BODY);
  assert.match(a.body, /^10:00 AM A very long customer na…; 10:10 AM /);
});
