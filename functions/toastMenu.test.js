import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALERT_AFTER_MS, menuFromState, nextStatus, readReport, settleKilled, wasKilled } from './toastMenu.js';

// Shaped like the menu data on Tabla's real ordering page (checked 2026-11-18, window.__OO_STATE__).
const state = {
  ROOT_QUERY: { __typename: 'Query' },
  'Menu:bc69': {
    __typename: 'Menu',
    name: 'Tabla Indian Restaurant - Phoenix AZ',
    groups: [
      {
        __typename: 'MenuGroup',
        guid: 'g1',
        name: 'Veg Appetizers',
        items: [
          { guid: 'i1', name: '5. Gobi 65', description: 'Spicy cauliflower {florets} "golden" fried.', prices: [13.99], outOfStock: false,
            imageUrls: { large: 'https://img/large.jpg', small: 'https://img/small.jpg' } },
          { guid: 'i2', name: 'Cut Mirchi', description: '', prices: [10.99], outOfStock: true, imageUrls: null },
        ],
      },
      { __typename: 'MenuGroup', guid: 'g2', name: 'Sides and Extras',
        items: [{ guid: 'i3', name: 'Tamarind', prices: [3.99, 4.99, 5.99], outOfStock: false }] },
      { __typename: 'MenuGroup', guid: 'g3', name: 'Empty', items: [] },
    ],
  },
};

test('menuFromState gives groups with name, price, sold out and picture', () => {
  const menu = menuFromState(state);
  assert.equal(menu.groups.length, 2); // empty group left out
  assert.equal(menu.itemCount, 3);
  assert.equal(menu.soldOutCount, 1);
  assert.deepEqual(menu.groups[0].items[0], {
    id: 'i1', name: '5. Gobi 65', description: 'Spicy cauliflower {florets} "golden" fried.',
    price: 13.99, prices: [13.99], soldOut: false, image: 'https://img/large.jpg',
  });
  assert.equal(menu.groups[0].items[1].soldOut, true);
  assert.equal(menu.groups[0].items[1].image, null);
  assert.deepEqual(menu.groups[1].items[0].prices, [3.99, 4.99, 5.99]);
  assert.equal(menuFromState({ ROOT_QUERY: {} }), null);
  assert.equal(menuFromState(null), null);
});

test('the hash changes when a price or sold-out mark changes, and only then', () => {
  const a = menuFromState(state).hash;
  assert.equal(menuFromState(structuredClone(state)).hash, a);
  const priced = structuredClone(state);
  priced['Menu:bc69'].groups[0].items[0].prices = [14.99];
  assert.notEqual(menuFromState(priced).hash, a);
  const soldOut = structuredClone(state);
  soldOut['Menu:bc69'].groups[0].items[0].outOfStock = true;
  assert.notEqual(menuFromState(soldOut).hash, a);
});

test('nextStatus alerts once after failing for an hour, and once when it works again', () => {
  const t0 = Date.UTC(2026, 10, 18, 22, 0);
  let s = nextStatus(null, { ok: true, source: 'page' }, t0);
  assert.equal(s.alert, null);
  s = nextStatus(s.status, { ok: false, error: 'blocked' }, t0 + 5 * 60_000);
  assert.equal(s.alert, null);
  assert.equal(s.status.lastOkAt, t0);
  const since = s.status.failingSince;
  s = nextStatus(s.status, { ok: false, error: 'blocked' }, since + ALERT_AFTER_MS);
  assert.match(s.alert.title, /stopped/);
  s = nextStatus(s.status, { ok: false, error: 'blocked' }, since + 2 * ALERT_AFTER_MS);
  assert.equal(s.alert, null); // only once
  s = nextStatus(s.status, { ok: true, source: 'chrome' }, since + 3 * ALERT_AFTER_MS);
  assert.match(s.alert.title, /again/);
  assert.equal(s.status.failingSince, null);
  assert.equal(nextStatus(s.status, { ok: true, source: 'page' }, since + 4 * ALERT_AFTER_MS).alert, null);
});

test('a run killed before it saved counts as a failed try, so repeated kills still alert', () => {
  const H = 60 * 60_000;
  const t0 = Date.UTC(2026, 10, 18, 22, 0);
  const ok = nextStatus(null, { ok: true, source: 'page' }, t0).status;
  assert.equal(wasKilled(ok), false);
  // Run 1 (t0 + 1h) writes startedAt and is killed; run 2 finds it.
  let saved = { ...ok, startedAt: t0 + H };
  assert.equal(wasKilled(saved), true);
  let s = settleKilled(saved);
  assert.equal(s.status.failingSince, t0 + H);
  assert.equal(s.status.lastTryAt, t0 + H);
  assert.match(s.status.lastError, /stopped/);
  assert.equal(s.alert, null);
  assert.equal(wasKilled(s.status), false);
  // Run 2 (t0 + 2h) is killed too; run 3 finds it: failing for an hour, so one alert.
  saved = { ...s.status, startedAt: t0 + 2 * H };
  s = settleKilled(saved);
  assert.match(s.alert.title, /stopped/);
  assert.equal(s.status.alerted, true);
  // nextStatus does the same when it is handed a killed status.
  const n = nextStatus({ ...ok, startedAt: t0 + H }, { ok: false, error: 'blocked' }, t0 + 2 * H);
  assert.equal(n.status.failingSince, t0 + H);
  assert.match(n.alert.title, /stopped/);
  // A finished run's status (startedAt equal to lastTryAt) is not a kill.
  assert.equal(wasKilled({ ...ok, startedAt: ok.lastTryAt }), false);
  assert.deepEqual(settleKilled(null), { status: null, alert: null });
});


test('readReport turns the tablet report into a menu, or a plain reason', () => {
  const ok = readReport({ menus: [state['Menu:bc69']] });
  assert.equal(ok.menu.itemCount, 3);
  assert.equal(ok.menu.hash, menuFromState(state).hash);
  assert.deepEqual(readReport({ error: 'page answered 403' }), { error: 'page answered 403' });
  assert.match(readReport({ menus: [{ groups: [] }] }).error, /no menu items/);
  assert.match(readReport({}).error, /no menu/);
  assert.match(readReport(null).error, /no menu/);
});
