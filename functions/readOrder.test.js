import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRequest, checkRequest, DAILY_LIMIT, LIMIT_REACHED, menuNames, MODEL, readError, readOrderPhoto, ScannedOrder, takeDailyRead, usageDay, usageDoc } from './readOrder.js';

const ok = { image: 'A'.repeat(200), mediaType: 'image/jpeg', today: '2026-11-18', weekday: 'Wednesday' };

test('checkRequest accepts a normal photo and refuses bad input', () => {
  assert.equal(checkRequest(ok), null);
  assert.match(checkRequest(null), /No photo/);
  assert.match(checkRequest({ ...ok, image: 'x' }), /No photo/);
  assert.match(checkRequest({ ...ok, image: 'A'.repeat(4_000_001) }), /too large/);
  assert.match(checkRequest({ ...ok, mediaType: 'application/pdf' }), /not a photo/);
  assert.match(checkRequest({ ...ok, today: 'tomorrow' }), /date/);
});

const msg = { text: 'Hi, this is Ravi 480-555-0101. Need 2 trays chicken biryani Sat 6pm pickup', today: ok.today, weekday: ok.weekday };

test('checkRequest accepts a pasted message and refuses empty or huge ones', () => {
  assert.equal(checkRequest(msg), null);
  assert.match(checkRequest({ ...msg, text: '  ' }), /empty/);
  assert.match(checkRequest({ ...msg, text: 'x'.repeat(8001) }), /too long/);
  assert.match(checkRequest({ ...msg, image: ok.image, mediaType: ok.mediaType }), /not both/);
});

test('buildRequest sends a pasted message as text, with no image', () => {
  const r = buildRequest(msg);
  assert.equal(r.messages[0].content.length, 1);
  assert.match(r.messages[0].content[0].text, /Wednesday, 2026-11-18/);
  assert.match(r.messages[0].content[0].text, /<message>\nHi, this is Ravi/);
});

test('buildRequest sends the photo, today and the form schema to the cheap model', () => {
  const r = buildRequest(ok);
  assert.equal(r.model, MODEL);
  assert.equal(r.messages[0].content[0].source.data, ok.image);
  assert.match(r.messages[0].content[1].text, /Wednesday, 2026-11-18/);
  assert.ok(r.output_config.format);
  assert.equal(r.output_config.effort, 'low');
  assert.ok(r.max_tokens >= 8000); // room for thinking plus a long order
  assert.equal(r.temperature, undefined); // Haiku 5.5 refuses non-default sampling
});

test('buildRequest lists the menu dishes when there is a menu', () => {
  assert.match(buildRequest(msg, ['Chicken Dum Biryani', 'Raita']).messages[0].content[0].text, /<menu>\nChicken Dum Biryani\nRaita\n<\/menu>/);
  assert.match(buildRequest(ok, ['Raita']).messages[0].content[1].text, /<menu>\nRaita\n<\/menu>/);
  assert.doesNotMatch(buildRequest(msg).messages[0].content[0].text, /<menu>/);
});

test('menuNames lists each dish once, and copes with no menu', () => {
  const menu = { groups: [{ items: [{ name: 'Raita' }, { name: ' raita ' }, { name: '' }, null] }, { items: [{ name: 'Chicken 65' }] }, null] };
  assert.deepEqual(menuNames(menu), ['Raita', 'Chicken 65']);
  assert.deepEqual(menuNames(undefined), []);
  assert.deepEqual(menuNames({ groups: 'x' }), []);
});

test('the form schema asks for dish, quantity, unit and note per item', () => {
  const line = { dish: 'Raita', qty: '2', unit: 'Quarts', note: '', unsure: false };
  const out = { isOrder: true, customerName: '', phone: '', date: '', time: '', type: 'unknown', address: '', people: '', lines: [line], notes: '', unsure: [] };
  assert.deepEqual(ScannedOrder.parse(out).lines, [line]);
});

test('readOrderPhoto returns the parsed form, and fails when there is none', async () => {
  const parsed = { isOrder: true, customerName: 'Priya', items: ['Samosa, 20'] };
  const client = (out) => ({ messages: { parse: async () => ({ parsed_output: out, stop_reason: 'end_turn' }) } });
  assert.deepEqual(await readOrderPhoto(client(parsed), ok), parsed);
  await assert.rejects(readOrderPhoto(client(null), ok), /No order/);
  await readOrderPhoto(client(null), ok).catch((e) => assert.equal(readError(e), 'unreadable'));
});

test('readError tells a photo that cannot be read from a service that is down', () => {
  const bad = (message, inner) => Object.assign(new Error(message), { status: 400, error: inner ? { error: { message: inner } } : undefined });
  assert.equal(readError(bad('invalid image')), 'unreadable');
  assert.equal(readError(bad('400 {"type":"error"}', 'Could not process image')), 'unreadable');
  assert.equal(readError(bad('messages.0.content.0.image.source.base64: image exceeds 5 MB maximum')), 'unreadable');
  // Setup mistakes are not the photo's fault: report them as a passing problem and log them.
  assert.equal(readError(bad('model: claude-nope not found')), 'setup');
  assert.equal(readError(bad('output_config.effort: unknown field')), 'setup');
  assert.equal(readError(Object.assign(new Error('too big'), { status: 413 })), 'unreadable');
  assert.equal(readError(new Error('Failed to parse structured output as JSON: Unexpected end')), 'unreadable');
  assert.equal(readError(Object.assign(new Error('overloaded'), { status: 529 })), 'unavailable');
  assert.equal(readError(Object.assign(new Error('server'), { status: 500 })), 'unavailable');
  assert.equal(readError(Object.assign(new Error('rate'), { status: 429 })), 'unavailable');
  assert.equal(readError(new Error('Connection error.')), 'unavailable');
  assert.equal(readError(undefined), 'unavailable');
});

test('usageDay is the restaurant date (Phoenix), not UTC', () => {
  // 11 PM Phoenix on Nov 21 is already Nov 22 in UTC.
  assert.equal(usageDay(Date.UTC(2026, 10, 22, 6, 0)), '2026-11-21');
  assert.equal(usageDay(Date.UTC(2026, 10, 22, 7, 0)), '2026-11-22');
  assert.equal(usageDoc(Date.UTC(2026, 10, 22, 7, 0)), 'usage/readOrder-2026-11-22');
});

/** A tiny in-memory stand-in for the admin Firestore: doc() and runTransaction() only. */
function fakeDb() {
  const docs = new Map();
  return {
    docs,
    doc: (path) => ({ path }),
    runTransaction: async (fn) =>
      fn({
        get: async (ref) => ({ exists: docs.has(ref.path), get: (k) => docs.get(ref.path)?.[k] }),
        set: (ref, data) => docs.set(ref.path, data),
      }),
  };
}

test('takeDailyRead allows DAILY_LIMIT reads a day, then refuses; a new day starts again', async () => {
  const db = fakeDb();
  const day1 = Date.UTC(2026, 10, 21, 18, 0);
  for (let i = 0; i < DAILY_LIMIT; i++) assert.equal(await takeDailyRead(db, day1), true);
  assert.equal(await takeDailyRead(db, day1), false);
  assert.equal(db.docs.get(usageDoc(day1)).count, DAILY_LIMIT); // a refused read is not counted
  assert.equal(await takeDailyRead(db, day1 + 24 * 60 * 60_000), true);
  assert.match(LIMIT_REACHED, /Daily limit reached\. Please type the order in\./);
});
