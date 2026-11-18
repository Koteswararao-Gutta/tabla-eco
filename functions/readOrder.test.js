import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRequest, checkRequest, MODEL, readOrderPhoto } from './readOrder.js';

const ok = { image: 'A'.repeat(200), mediaType: 'image/jpeg', today: '2026-11-18', weekday: 'Wednesday' };

test('checkRequest accepts a normal photo and refuses bad input', () => {
  assert.equal(checkRequest(ok), null);
  assert.match(checkRequest(null), /No photo/);
  assert.match(checkRequest({ ...ok, image: 'x' }), /No photo/);
  assert.match(checkRequest({ ...ok, image: 'A'.repeat(4_000_001) }), /too large/);
  assert.match(checkRequest({ ...ok, mediaType: 'application/pdf' }), /not a photo/);
  assert.match(checkRequest({ ...ok, today: 'tomorrow' }), /date/);
});

test('buildRequest sends the photo, today and the form schema to the cheap model', () => {
  const r = buildRequest(ok);
  assert.equal(r.model, MODEL);
  assert.equal(r.messages[0].content[0].source.data, ok.image);
  assert.match(r.messages[0].content[1].text, /Wednesday, 2026-11-18/);
  assert.ok(r.output_config.format);
  assert.equal(r.temperature, undefined); // Haiku 5.5 refuses non-default sampling
});

test('readOrderPhoto returns the parsed form, and fails when there is none', async () => {
  const parsed = { isOrder: true, customerName: 'Priya', items: ['Samosa, 20'] };
  const client = (out) => ({ messages: { parse: async () => ({ parsed_output: out, stop_reason: 'end_turn' }) } });
  assert.deepEqual(await readOrderPhoto(client(parsed), ok), parsed);
  await assert.rejects(readOrderPhoto(client(null), ok), /No order/);
});
