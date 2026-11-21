// Toast menu: the kitchen tablet's app opens Tabla's public Toast online ordering page once an hour
// (Toast blocks cloud servers) and sends the menu data built into it (window.__OO_STATE__) here.
// Kept free of Firebase so it can be tested on its own.
import { createHash } from 'node:crypto';

export const TOAST_PAGE =
  'https://order.toasttab.com/online/tabla-indian-restaurant-phoenix-az-2501-w-happy-valley-rd-suite-50-1240';

/** Where the alert sends the manager when they tap it. */
export const MENU_LINK = 'https://koteswararao-gutta.github.io/tabla-eco/#/manager/screens';

/** Tell the kitchen/manager phones after the menu has failed to update for this long. */
export const ALERT_AFTER_MS = 60 * 60_000; // two failed hourly runs in a row

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const money = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

/** Turns Toast's page data into our plain menu: groups of items with name, price and sold-out flag. */
export function menuFromState(state) {
  if (!state || typeof state !== 'object') return null;
  const menus = Object.keys(state)
    .filter((k) => k.startsWith('Menu:'))
    .map((k) => state[k])
    .filter((m) => Array.isArray(m?.groups));
  if (!menus.length) return null;

  const groups = [];
  for (const menu of menus) {
    for (const g of menu.groups) {
      const items = [];
      const addItems = (list) => {
        for (const i of Array.isArray(list) ? list : []) {
          const name = text(i?.name);
          if (!name) continue;
          const prices = (Array.isArray(i.prices) ? i.prices : []).map(money).filter((p) => p !== null);
          items.push({
            id: text(i.guid) || name,
            name,
            description: text(i.description),
            price: prices[0] ?? null,
            prices,
            soldOut: i.outOfStock === true,
            image: text(i.imageUrls?.large) || text(i.imageUrls?.medium) || null,
          });
        }
      };
      addItems(g?.items);
      for (const sub of Array.isArray(g?.subgroups) ? g.subgroups : []) addItems(sub?.items);
      if (items.length) groups.push({ id: text(g.guid) || text(g.name), name: text(g.name), items });
    }
  }
  if (!groups.length) return null;
  const all = groups.flatMap((g) => g.items);
  return {
    groups,
    itemCount: all.length,
    soldOutCount: all.filter((i) => i.soldOut).length,
    hash: createHash('sha256').update(JSON.stringify(groups)).digest('hex').slice(0, 16),
  };
}

/** Most menus one report may carry (Toast pages normally have one). */
export const MAX_MENUS = 10;

/**
 * The kitchen tablet's report: { menus: [Toast Menu objects from the page] } or { error: '...' }.
 * Returns { menu } (our plain menu), or { error } with a plain reason.
 */
export function readReport(data) {
  if (data && typeof data.error === 'string') return { error: data.error.slice(0, 300) || 'unknown error' };
  const menus = Array.isArray(data?.menus) ? data.menus.slice(0, MAX_MENUS) : null;
  if (!menus) return { error: 'the report had no menu in it' };
  const menu = menuFromState(Object.fromEntries(menus.map((m, i) => [`Menu:${i}`, m])));
  return menu ? { menu } : { error: 'the Toast page had no menu items' };
}

/**
 * After each run: what to save to the status doc and whether to alert.
 * `prev` is the last status (or null). Alerts once per outage, after ALERT_AFTER_MS, and once when it works again.
 */
export function nextStatus(prev, result, now) {
  if (result.ok) {
    return {
      status: { lastTryAt: now, lastOkAt: now, source: result.source, lastError: null, failingSince: null, alerted: false },
      alert: prev?.alerted ? { title: 'Toast menu is updating again', body: 'The TVs have the latest prices and sold-out items.' } : null,
    };
  }
  const failingSince = prev?.failingSince ?? now;
  const shouldAlert = !prev?.alerted && now - failingSince >= ALERT_AFTER_MS;
  return {
    status: {
      lastTryAt: now,
      lastOkAt: prev?.lastOkAt ?? null,
      source: prev?.source ?? null,
      lastError: String(result.error).slice(0, 500),
      failingSince,
      alerted: Boolean(prev?.alerted) || shouldAlert,
    },
    alert: shouldAlert
      ? { title: 'Toast menu stopped updating', body: 'The TVs keep showing the last good menu until it is fixed.' }
      : null,
  };
}
