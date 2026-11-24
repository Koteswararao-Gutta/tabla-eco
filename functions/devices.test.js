import assert from 'node:assert/strict';
import { test } from 'node:test';
import { afterWrong, appName, cleanName, CODE_RE, codeMatches, DEVICE_TRIES, deviceModel, hashCode, triesLeft, waitMinutes } from './devices.js';

test('the code is 6 to 10 digits', () => {
  assert.ok(CODE_RE.test('123456'));
  assert.ok(CODE_RE.test('1234567890'));
  assert.ok(!CODE_RE.test('12345'));
  assert.ok(!CODE_RE.test('12345678901'));
  assert.ok(!CODE_RE.test('12a456'));
});

test('a saved code matches only itself, and the hash never holds the code', () => {
  const saved = hashCode('482913');
  assert.ok(codeMatches('482913', saved));
  assert.ok(!codeMatches('482914', saved));
  assert.ok(!codeMatches(undefined, saved));
  assert.ok(!codeMatches('482913', null));
  assert.ok(!JSON.stringify(saved).includes('482913'));
  assert.notEqual(hashCode('482913').hash, saved.hash); // new salt each time
});

test('wrong codes: 5 per device in 15 minutes, then a wait', () => {
  const now = 1_000_000_000;
  let rec = null;
  for (let i = 0; i < DEVICE_TRIES.max; i++) {
    assert.ok(triesLeft(rec, DEVICE_TRIES, now) > 0);
    rec = afterWrong(rec, DEVICE_TRIES, now + i);
  }
  assert.equal(triesLeft(rec, DEVICE_TRIES, now + 10), 0);
  assert.equal(waitMinutes(rec, DEVICE_TRIES, now + 60_000), 14);
  // The window passes: tries again, and the count starts over.
  const later = now + DEVICE_TRIES.windowMs;
  assert.equal(triesLeft(rec, DEVICE_TRIES, later), DEVICE_TRIES.max);
  assert.deepEqual(afterWrong(rec, DEVICE_TRIES, later), { count: 1, since: later });
});

test('device model and app names are plain and safe', () => {
  assert.equal(deviceModel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'iPhone');
  assert.equal(deviceModel('Mozilla/5.0 (Linux; Android 9; AFTMM) AppleWebKit'), 'Fire TV');
  assert.equal(deviceModel('Mozilla/5.0 (Linux; Android 12; SM-X200) AppleWebKit Safari'), 'Android tablet');
  assert.equal(deviceModel('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari'), 'Android phone');
  assert.equal(deviceModel(42), 'Unknown device');
  assert.equal(appName('kitchen'), 'kitchen');
  assert.equal(appName('../../x'), 'other');
  assert.equal(cleanName('  Ravi’s   phone '), 'Ravi’s phone');
  assert.equal(cleanName('   '), null);
  assert.equal(cleanName('x'.repeat(80)).length, 40);
});

test('manager phones: everyone may manage until one is marked; then only active manager phones may', async () => {
  const { mayManage, activeManagers, STALE_MS } = await import('./devices.js');
  const now = 100 * STALE_MS;
  const fresh = now - 1000;
  assert.ok(mayManage('a', [], now)); // nobody marked yet
  assert.ok(mayManage('a', [{ id: 'b', manager: false, lastSeen: fresh }], now));
  const boss = { id: 'boss', manager: true, lastSeen: fresh };
  assert.ok(mayManage('boss', [boss], now));
  assert.ok(!mayManage('staff', [boss], now));
  // A manager phone not seen for 30 days no longer counts (a lost phone never locks everyone out for good).
  const gone = { id: 'boss', manager: true, lastSeen: now - STALE_MS };
  assert.deepEqual(activeManagers([gone], now), []);
  assert.ok(mayManage('staff', [gone], now));
  assert.ok(!mayManage('staff', [gone, { id: 'boss2', manager: true, lastSeen: fresh }], now));
});

test('stale devices: not seen for 30 days, oldest first', async () => {
  const { staleDevices, STALE_MS } = await import('./devices.js');
  const now = 100 * STALE_MS;
  const list = [
    { id: 'new', lastSeen: now - 1000 },
    { id: 'old', lastSeen: now - 2 * STALE_MS },
    { id: 'older', lastSeen: now - 3 * STALE_MS },
    { id: 'edge', lastSeen: now - STALE_MS },
  ];
  assert.deepEqual(staleDevices(list, now).map((d) => d.id), ['older', 'old', 'edge']);
});
