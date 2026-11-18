import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alertFor, deadTokens, MAX_AHEAD_MS, onRing, planReminder, REMIND_MS } from './reminders.js';

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
  const r = [{ success: true }, { success: false, error: { code: 'messaging/registration-token-not-registered' } }, { success: false, error: { code: 'messaging/internal-error' } }];
  assert.deepEqual(deadTokens(['a', 'b', 'c'], r), ['b']);
});
