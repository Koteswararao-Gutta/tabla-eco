import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALERT_AFTER_MS, menuFromState, nextStatus, readFromPage, readPageState, readToastMenu } from './toastMenu.js';

// Shaped like Tabla's real ordering page (checked 2026-11-18): the menu sits in window.__OO_STATE__.
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
const page = (s) =>
  `<html><script>window.__APOLLO_STATE__ = {"a":{"b":"}"}};\n    window.__OO_STATE__ = ${JSON.stringify(s)};\n    window.__FLAGS_STATE__ = {};</script></html>`;

test('readPageState finds the menu data even with braces and quotes inside text', () => {
  assert.deepEqual(readPageState(page(state)), state);
  assert.equal(readPageState('<html>no data</html>'), null);
  assert.equal(readPageState('window.__OO_STATE__ = {"cut off'), null);
});

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

test('readFromPage tries a phone browser when the first try is refused', async () => {
  const seen = [];
  const fakeFetch = async (_url, { headers }) => {
    seen.push(headers['User-Agent']);
    return seen.length === 1 ? { ok: false, status: 403 } : { ok: true, text: async () => page(state) };
  };
  const menu = await readFromPage(fakeFetch, 'https://example.test');
  assert.equal(menu.itemCount, 3);
  assert.equal(seen.length, 2);
  assert.match(seen[1], /iPhone/);
  await assert.rejects(readFromPage(async () => ({ ok: true, text: async () => '<html></html>' }), 'x'), /no menu/);
});

test('readToastMenu falls back to the next way and reports every reason', async () => {
  const menu = menuFromState(state);
  const ok = await readToastMenu([['page', async () => { throw new Error('page answered 403'); }], ['chrome', async () => menu]]);
  assert.equal(ok.source, 'chrome');
  await assert.rejects(
    readToastMenu([['page', async () => { throw new Error('a'); }], ['chrome', async () => { throw new Error('b'); }]]),
    /page: a; chrome: b/,
  );
});

test('nextStatus alerts once after 30 minutes of failing, and once when it works again', () => {
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
