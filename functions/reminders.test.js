import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alertFor, chunks, deadTokens, MAX_AHEAD_MS, MAX_BODY, onRing, planReminder, REMIND_MS, sendShouldRetry, shouldSchedule } from './reminders.js';

const H = 60 * 60_000;
const now = Date.UTC(2026, 10, 18, 20, 0); // 1:00 PM in Phoenix
const order = { customerName: 'Priya Sharma', status: 'open', dueAt: now + 5 * H, type: 'pickup' };

test('planReminder rings an hour before, right away when closer, never for closed or past orders', () => {
  assert.equal(planReminder('a', order, now).at, order.dueAt - REMIND_MS);
  assert.equal(planReminder('a', { ...order, dueAt: now + 30 * 60_000 }, now).at, now);
  assert.equal(planReminder('a', { ...order, status: 'completed' }, now), null);
  assert.equal(planReminder('a', { ...order, dueAt: now - 1 }, now), null);
  assert.equal(planReminder('a', null, now), null);
  assert.equal(planReminder('a', { ...order, dueAt: now + 60 * 24 * H }, now).at, now + MAX_AHEAD_MS);
});

test('planReminder gives the same id for the same order and time, a new one when the time moves', () => {
  assert.equal(planReminder('a', order, now).id, planReminder('a', { ...order, notes: 'x' }, now + 60_000).id);
  assert.notEqual(planReminder('a', order, now).id, planReminder('a', { ...order, dueAt: order.dueAt + H }, now).id);
  assert.match(planReminder('a b/c', order, now).id, /^[A-Za-z0-9_-]+$/);
});

test('onRing sends only for an open order still at the same time', () => {
  const task = { dueAt: order.dueAt };
  const ring = order.dueAt - H;
  assert.equal(onRing(order, task, ring), 'send');
  assert.equal(onRing({ ...order, status: 'completed' }, task, ring), 'skip');
  assert.equal(onRing({ ...order, dueAt: order.dueAt + H }, task, ring), 'skip');
  assert.equal(onRing(null, task, ring), 'skip');
  assert.equal(onRing(order, task, order.dueAt + 1), 'skip');
  assert.equal(onRing(order, task, now), 'later');
});

test('alertFor says who, what and when in restaurant time', () => {
  assert.deepEqual(alertFor(order, order.dueAt - H), {
    title: 'Catering in 1 hour',
    body: 'Priya Sharma, pickup at 6:00 PM',
    link: 'https://koteswararao-gutta.github.io/tabla-eco/#/manager/catering',
  });
  assert.equal(alertFor({ ...order, type: 'delivery' }, order.dueAt - 20 * 60_000).title, 'Catering in 20 min');
});

test('deadTokens picks only tokens that are gone for good', () => {
  const fail = (code) => ({ success: false, error: { code } });
  const r = [
    { success: true },
    fail('messaging/registration-token-not-registered'),
    fail('messaging/internal-error'),
    fail('messaging/invalid-registration-token'),
    fail('messaging/invalid-argument'), // also sent for a bad message: must not wipe every phone
  ];
  assert.deepEqual(deadTokens(['a', 'b', 'c', 'd', 'e'], r), ['b', 'd']);
});

test('onRing does not send twice for the same time (retry, or moved away and back)', () => {
  const task = { dueAt: order.dueAt };
  const ring = order.dueAt - H;
  assert.equal(onRing({ ...order, remindedFor: order.dueAt }, task, ring), 'skip');
  assert.equal(onRing({ ...order, remindedFor: order.dueAt - 2 * H }, task, ring), 'send');
  assert.equal(onRing({ ...order, remindedFor: null }, task, ring), 'send');
});

test('shouldSchedule sets an alarm only when an open order is new, reopened or moved', () => {
  assert.equal(shouldSchedule(null, order), true);
  assert.equal(shouldSchedule(order, { ...order, dueAt: order.dueAt + H }), true);
  assert.equal(shouldSchedule({ ...order, status: 'completed' }, order), true);
  assert.equal(shouldSchedule(order, { ...order, notes: 'no onions' }), false);
  assert.equal(shouldSchedule(order, { ...order, remindedFor: order.dueAt }), false);
  assert.equal(shouldSchedule(order, { ...order, kitchenAckFor: order.dueAt }), false);
  assert.equal(shouldSchedule(order, { ...order, status: 'completed' }), false);
  assert.equal(shouldSchedule(order, null), false);
  assert.equal(shouldSchedule(null, null), false);
});

test('alertFor keeps a very long name short', () => {
  const a = alertFor({ ...order, customerName: 'X'.repeat(5000) }, order.dueAt - H);
  assert.ok(a.body.length <= MAX_BODY);
  assert.match(a.body, /…, pickup at 6:00 PM$/);
  assert.equal(alertFor({ ...order, customerName: '   ' }, order.dueAt - H).body, 'Order, pickup at 6:00 PM');
});

test('chunks splits tokens into batches of 500', () => {
  const list = Array.from({ length: 1201 }, (_, i) => i);
  assert.deepEqual(chunks(list).map((c) => c.length), [500, 500, 201]);
  assert.deepEqual(chunks([]), []);
});

test('sendShouldRetry: only when nobody got the reminder and a failure may pass', () => {
  assert.equal(sendShouldRetry({ sent: 0, failed: 2, removed: 0 }), true); // FCM hiccup
  assert.equal(sendShouldRetry({ sent: 0, failed: 2, removed: 1 }), true);
  assert.equal(sendShouldRetry({ sent: 0, failed: 2, removed: 2 }), false); // every phone is gone
  assert.equal(sendShouldRetry({ sent: 0, failed: 0, removed: 0 }), false); // no phones have alerts on
  assert.equal(sendShouldRetry({ sent: 1, failed: 3, removed: 0 }), false); // someone got it
});

test('a cancelled or deleted order never rings, and undo sets the alarm again', () => {
  const task = { dueAt: order.dueAt };
  const ring = order.dueAt - H;
  const cancelled = { ...order, status: 'cancelled', cancelledAt: now };
  const deleted = { ...order, deletedAt: now };
  assert.equal(onRing(cancelled, task, ring), 'skip');
  assert.equal(onRing(deleted, task, ring), 'skip');
  assert.equal(onRing({ ...order, deletedAt: null }, task, ring), 'send');
  assert.equal(planReminder('a', cancelled, now), null);
  assert.equal(planReminder('a', deleted, now), null);
  assert.equal(shouldSchedule(order, cancelled), false);
  assert.equal(shouldSchedule(order, deleted), false);
  assert.equal(shouldSchedule(cancelled, { ...order, cancelledAt: null }), true); // undo cancel
  assert.equal(shouldSchedule(deleted, { ...order, deletedAt: null }), true); // undo delete
});
