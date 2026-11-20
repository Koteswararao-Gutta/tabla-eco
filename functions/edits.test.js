import assert from 'node:assert/strict';
import { test } from 'node:test';
import { editAlertFor, kitchenEdit } from './edits.js';

const order = { customerName: 'Sharma', history: [] };
const k = { at: 2000, by: 'kitchen', changes: ['Items: 20 samosas → 25 samosas'] };
const m = { at: 2000, by: 'manager', changes: ['Time: 5:00 PM → 6:00 PM'] };

test('a new kitchen entry is found', () => {
  assert.deepEqual(kitchenEdit(order, { ...order, history: [k] }), k);
});

test('manager edits, other saves and new or deleted orders send nothing', () => {
  assert.equal(kitchenEdit(order, { ...order, history: [m] }), null);
  assert.equal(kitchenEdit({ ...order, history: [k] }, { ...order, history: [k], status: 'completed' }), null);
  assert.equal(kitchenEdit(order, { ...order }), null);
  assert.equal(kitchenEdit(null, { ...order, history: [k] }), null);
  assert.equal(kitchenEdit({ ...order, history: [k] }, null), null);
  assert.equal(kitchenEdit({ customerName: 'x' }, { customerName: 'x', history: 'junk' }), null);
});

test('a second kitchen edit after the history is full still counts', () => {
  const full = Array.from({ length: 50 }, (_, i) => ({ at: i, by: 'kitchen', changes: ['x'] }));
  const next = [...full.slice(1), { at: 99, by: 'kitchen', changes: ['y'] }];
  assert.equal(kitchenEdit({ history: full }, { history: next })?.at, 99);
});

test('alert words', () => {
  const a = editAlertFor(order, k);
  assert.equal(a.title, 'Kitchen changed Sharma order');
  assert.equal(a.body, 'Items: 20 samosas → 25 samosas');
  assert.match(a.link, /#\/manager\/catering$/);
  const long = editAlertFor({ customerName: 'A' }, { changes: Array(30).fill('Notes: something long here') });
  assert.ok(long.body.length <= 200);
});
