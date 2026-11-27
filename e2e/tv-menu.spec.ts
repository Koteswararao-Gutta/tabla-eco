import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { openScreen } from './helpers';

// Test-only: write straight into the local store, the way another window (the manager) would.
type SlotPatch = Record<string, Record<string, unknown>>;
async function setLoop(page: Page, opts: { seconds?: number; patch?: SlotPatch; firstSlotId?: string | null; replace?: boolean }) {
  await page.evaluate(({ seconds, patch, firstSlotId, replace }) => {
    const slots = replace ? {} : JSON.parse(localStorage.getItem('tabla:slots') || '{}');
    for (const id of Object.keys(slots)) if (seconds) slots[id].seconds = seconds;
    for (const [id, p] of Object.entries(patch || {})) slots[id] = { ...(slots[id] || {}), ...p, id };
    localStorage.setItem('tabla:slots', JSON.stringify(slots));
    const single = JSON.parse(localStorage.getItem('tabla:singletons') || '{}');
    single.loop = { id: 'loop', anchor: Date.now(), firstSlotId: firstSlotId ?? null };
    localStorage.setItem('tabla:singletons', JSON.stringify(single));
  }, { seconds: opts.seconds ?? 0, patch: opts.patch ?? {}, firstSlotId: opts.firstSlotId ?? null, replace: !!opts.replace });
}

const now = (p: Page) => p.getByTestId('menu-tv-now');
const slotOf = (p: Page) => now(p).getAttribute('data-slot-id');
const slots = (p: Page) => p.evaluate(() => JSON.parse(localStorage.getItem('tabla:slots') || '{}'));

/** A control window (seeds the data) plus TV 1 to TV 4. */
async function openTvs(context: BrowserContext) {
  const control = await openScreen(context, '/');
  await expect(control.getByRole('heading', { name: 'Tabla' })).toBeVisible();
  return { control, tvs: async () => Promise.all([1, 2, 3, 4].map((n) => openScreen(context, `/tv/${n}`))) };
}

/** Records every change of the shown slot with its time. */
async function record(page: Page) {
  await page.evaluate(() => {
    const log: [number, string][] = [];
    (window as unknown as { __log: typeof log }).__log = log;
    const el = document.querySelector('[data-testid="menu-tv-now"]')!;
    log.push([Date.now(), el.getAttribute('data-slot-id') || '']);
    new MutationObserver(() => log.push([Date.now(), el.getAttribute('data-slot-id') || ''])).observe(el, {
      attributes: true,
      attributeFilter: ['data-slot-id'],
    });
  });
}
const logOf = (p: Page) => p.evaluate(() => (window as unknown as { __log: [number, string][] }).__log);

test('all four TVs switch slot together', async ({ context }) => {
  const { control, tvs } = await openTvs(context);
  await setLoop(control, { seconds: 2 });
  const pages = await tvs();
  for (const p of pages) await expect(now(p)).not.toHaveAttribute('data-state', 'loading');
  for (const p of pages) await record(p);
  await control.waitForTimeout(4_600); // at least two switches
  const logs = await Promise.all(pages.map(logOf));
  const switches = logs.map((l) => l.slice(1));
  expect(switches[0].length).toBeGreaterThanOrEqual(2);
  for (const s of switches) expect(s.map(([, id]) => id)).toEqual(switches[0].map(([, id]) => id));
  for (let i = 0; i < switches[0].length; i++) {
    const times = switches.map((s) => s[i][0]);
    console.log('switch', i, switches[0][i][1], 'spread ms', Math.max(...times) - Math.min(...times));
    expect(Math.max(...times) - Math.min(...times)).toBeLessThan(250);
  }
});

test('TV 3 mirrors TV 1 and TV 4 mirrors TV 2', async ({ context }) => {
  const { control, tvs } = await openTvs(context);
  await setLoop(control, { seconds: 30, firstSlotId: 'slot-menu-1' });
  const [tv1, tv2, tv3, tv4] = await tvs();
  const all = await slots(control);
  const { tv1: left, tv2: right } = all['slot-menu-1'].pictures;
  await expect(now(tv1)).toHaveAttribute('data-picture-id', left);
  await expect(now(tv2)).toHaveAttribute('data-picture-id', right);
  await expect(now(tv3)).toHaveAttribute('data-picture-id', left);
  await expect(now(tv4)).toHaveAttribute('data-picture-id', right);
  expect(left).not.toBe(right);
});

test('a picture on TV 3 alone never blanks TV 1 / TV 2; TV 3 falls back to TV 1\'s pictures', async ({ context }) => {
  const { control, tvs } = await openTvs(context);
  await control.evaluate(() => {
    const screens = JSON.parse(localStorage.getItem('tabla:screens') || '{}');
    screens.tv3 = { ...screens.tv3, mirrorOf: null };
    localStorage.setItem('tabla:screens', JSON.stringify(screens));
  });
  const all = await slots(control);
  const own = all['slot-menu-1'].pictures.tv1;
  // the only spot is TV 3's own: TV 1 / TV 2 play nothing new, TV 3 shows it
  await setLoop(control, { replace: true, patch: { a: { order: 1, seconds: 30, transition: 'fade', kind: 'menu', pictures: { tv1: own } }, b: { order: 2, seconds: 30, transition: 'fade', kind: 'menu', pictures: { tv3: own } } }, firstSlotId: 'b' });
  const [tv1, , tv3] = await tvs();
  await expect(now(tv1)).toHaveAttribute('data-slot-id', 'a');
  await expect(now(tv1)).toHaveAttribute('data-picture-id', own);
  await expect(now(tv3)).toHaveAttribute('data-slot-id', 'b');
  await expect(now(tv3)).toHaveAttribute('data-picture-id', own);
  // in TV 1's spot, TV 3 (no own picture) shows TV 1's
  await setLoop(control, { firstSlotId: 'a' });
  await expect(now(tv3)).toHaveAttribute('data-slot-id', 'a', { timeout: 2_000 });
  await expect(now(tv3)).toHaveAttribute('data-picture-id', own);
});

test('a reloaded TV lands on the right slot at once', async ({ context }) => {
  const { control, tvs } = await openTvs(context);
  await setLoop(control, { seconds: 3 });
  const [tv1, tv2] = await tvs();
  await expect(now(tv1)).toHaveAttribute('data-slot-id', 'slot-menu-2', { timeout: 6_000 });
  await tv2.reload();
  await expect(now(tv2)).toHaveAttribute('data-state', /picture|idle/, { timeout: 1_500 });
  expect(await slotOf(tv2)).toBe(await slotOf(tv1));
  // and keeps switching with the others afterwards
  await expect(now(tv1)).toHaveAttribute('data-slot-id', 'slot-special', { timeout: 4_000 });
  await expect(now(tv2)).toHaveAttribute('data-slot-id', 'slot-special', { timeout: 300 });
});

test('a slot change written in another window shows on the TVs', async ({ context }) => {
  const { control, tvs } = await openTvs(context);
  await setLoop(control, { seconds: 30, firstSlotId: 'slot-menu-1' });
  const [tv1, , tv3] = await tvs();
  const all = await slots(control);
  const special = all['slot-special'].pictures.tv1;
  await expect(now(tv1)).toHaveAttribute('data-picture-id', all['slot-menu-1'].pictures.tv1);
  await setLoop(control, { patch: { 'slot-menu-1': { pictures: { tv1: special, tv2: all['slot-menu-1'].pictures.tv2 } } }, firstSlotId: 'slot-menu-1' });
  await expect(now(tv1)).toHaveAttribute('data-picture-id', special, { timeout: 2_000 });
  await expect(now(tv3)).toHaveAttribute('data-picture-id', special, { timeout: 2_000 });
  // restart from another slot: every TV jumps there
  await setLoop(control, { firstSlotId: 'slot-catering' });
  await expect(now(tv1)).toHaveAttribute('data-slot-id', 'slot-catering', { timeout: 2_000 });
});

test('a missing TV picture, a broken picture or an empty loop', async ({ context }) => {
  const { control, tvs } = await openTvs(context);
  await setLoop(control, { seconds: 30, firstSlotId: 'slot-menu-1' });
  const [tv1, tv2] = await tvs();
  // menu slot without a TV 2 picture never borrows TV 1's: TV 2 shows its own next picture again
  const before = await slots(control);
  await setLoop(control, { patch: { 'slot-menu-1': { pictures: { tv1: before['slot-menu-1'].pictures.tv1 } } }, firstSlotId: 'slot-menu-1' });
  await expect(now(tv2)).toHaveAttribute('data-slot-id', 'slot-menu-1');
  await expect(now(tv2)).toHaveAttribute('data-picture-id', before['slot-menu-2'].pictures.tv2);
  // broken picture
  await setLoop(control, { patch: { 'slot-menu-1': { pictures: { tv1: 'no-such-picture' } } }, firstSlotId: 'slot-menu-1' });
  await expect(now(tv1)).toHaveAttribute('data-state', 'idle');
  // nothing playing at all
  await setLoop(control, { replace: true });
  await expect(now(tv1)).toHaveAttribute('data-state', 'idle');
  await expect(now(tv1)).toHaveAttribute('data-slot-id', '');
  await expect(tv1.getByText('Tabla').last()).toBeVisible();
  await expect(now(tv1)).toHaveCSS('cursor', 'none');
});

// Test-only: take a picture's bytes out of (or back into) the local picture storage.
async function pictureBytes(page: Page, id: string, action: 'remove' | 'restore') {
  await page.evaluate(
    ({ id, action }) =>
      new Promise<void>((resolve, reject) => {
        const w = window as unknown as { __saved?: Blob };
        const open = indexedDB.open('tabla-pictures', 1);
        open.onsuccess = () => {
          const s = open.result.transaction('blobs', 'readwrite').objectStore('blobs');
          if (action === 'restore') {
            s.put(w.__saved, id).onsuccess = () => resolve();
          } else {
            const get = s.get(id);
            get.onsuccess = () => {
              w.__saved = get.result;
              s.delete(id).onsuccess = () => resolve();
            };
          }
        };
        open.onerror = () => reject(open.error);
      }),
    { id, action },
  );
}

test('a picture that is missing at first shows once it is back', async ({ context }) => {
  const { control, tvs } = await openTvs(context);
  const all = await slots(control);
  const pic = all['slot-menu-1'].pictures.tv1;
  await pictureBytes(control, pic, 'remove');
  await setLoop(control, { replace: true, patch: { 'slot-menu-1': { ...all['slot-menu-1'], seconds: 1.5 }, 'slot-menu-2': { ...all['slot-menu-2'], seconds: 1.5 } }, firstSlotId: 'slot-menu-1' });
  const [tv1] = await tvs();
  await expect(now(tv1)).toHaveAttribute('data-slot-id', 'slot-menu-1');
  await expect(now(tv1)).toHaveAttribute('data-state', 'idle');
  await pictureBytes(control, pic, 'restore');
  // next time round the loop the picture is asked for again and shows
  await expect(now(tv1)).toHaveAttribute('data-picture-id', pic, { timeout: 5_000 });
  await expect(now(tv1)).toHaveAttribute('data-slot-id', 'slot-menu-1');
});

test('screenshots at 1920x1080', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const { control, tvs } = await openTvs(context);
  await setLoop(control, { seconds: 60, firstSlotId: 'slot-menu-1' });
  const [tv1, tv2] = await tvs();
  for (const p of [tv1, tv2]) await expect(now(p)).toHaveAttribute('data-state', 'picture');
  await tv1.screenshot({ path: 'test-results/screens/tv1.png' });
  await tv2.screenshot({ path: 'test-results/screens/tv2.png' });
  await setLoop(control, { firstSlotId: 'slot-special' });
  await expect(now(tv2)).toHaveAttribute('data-slot-id', 'slot-special');
  await tv2.waitForTimeout(1_000); // let the slide finish
  await tv2.screenshot({ path: 'test-results/screens/tv2-special.png' });
  await context.close();
});

test('a TV opened once still starts with no internet (its own code is kept for offline)', async ({ context }) => {
  const tv = await openScreen(context, '/tv/1');
  await expect(now(tv)).toBeVisible();
  // The service worker keeps every screen's code, also the parts loaded only when a screen opens.
  await tv.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() => tv.evaluate(async () => (await (await caches.open('tabla-shell-v2')).keys()).map((r) => r.url).filter((u) => /assets\/tv-menu-.*\.js$/.test(u)).length), { timeout: 10_000 })
    .toBe(1);
  await context.setOffline(true);
  await tv.reload();
  await expect(now(tv)).toBeVisible();
  await expect(tv.locator('.tvm-layer img').first()).toBeVisible();
  await context.setOffline(false);
});
