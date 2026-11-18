// Toast menu: reads the menu (items, prices, sold out) from Tabla's public Toast online ordering page.
// The page has the whole menu built in as data (window.__OO_STATE__), so no Toast API plan is needed.
// Kept free of Firebase so it can be tested on its own.
import { createHash } from 'node:crypto';

export const TOAST_PAGE =
  'https://order.toasttab.com/online/tabla-indian-restaurant-phoenix-az-2501-w-happy-valley-rd-suite-50-1240';

/** Where the alert sends the manager when they tap it. */
export const MENU_LINK = 'https://koteswararao-gutta.github.io/tabla-eco/#/manager/screens';

/** Tell the kitchen/manager phones after the menu has failed to update for this long. */
export const ALERT_AFTER_MS = 30 * 60_000;

const BROWSERS = [
  // Desktop Chrome first, then a phone (Toast serves the same data to both).
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
];

/** Pulls the JSON assigned to `window.<name> = {...}` out of the page's HTML, or null if it isn't there. */
export function readPageState(html, name = '__OO_STATE__') {
  const at = html.indexOf(`window.${name}`);
  if (at < 0) return null;
  const start = html.indexOf('{', at);
  if (start < 0) return null;
  // Walk to the matching closing brace, skipping braces inside strings.
  let depth = 0;
  let inString = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

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

/** Way 1: load the page like a browser and read the menu built into it. */
export async function readFromPage(fetchFn = fetch, url = TOAST_PAGE) {
  let lastError = 'no menu found';
  for (const ua of BROWSERS) {
    try {
      const res = await fetchFn(url, {
        headers: { 'User-Agent': ua, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        lastError = `page answered ${res.status}`;
        continue;
      }
      const menu = menuFromState(readPageState(await res.text()));
      if (menu) return menu;
      lastError = 'page loaded but had no menu in it';
    } catch (e) {
      lastError = `could not load the page (${e?.message ?? e})`;
    }
  }
  throw new Error(lastError);
}

/** Way 2 (backup): open the page in a hidden Chrome, the same as a normal visitor, and read the menu from it. */
export async function readWithChrome(url = TOAST_PAGE) {
  const [{ default: chromium }, { default: puppeteer }] = await Promise.all([
    import('@sparticuz/chromium'),
    import('puppeteer-core'),
  ]);
  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(BROWSERS[0]);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 });
    const state = await page.evaluate(() => window.__OO_STATE__ ?? null);
    const menu = menuFromState(state) ?? menuFromState(readPageState(await page.content()));
    if (!menu) throw new Error('Chrome opened the page but found no menu');
    return menu;
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Tries each way in turn. Returns { menu, source } or throws with every way's reason. */
export async function readToastMenu(ways) {
  const reasons = [];
  for (const [source, read] of ways) {
    try {
      return { menu: await read(), source };
    } catch (e) {
      reasons.push(`${source}: ${e?.message ?? e}`);
    }
  }
  throw new Error(reasons.join('; '));
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
