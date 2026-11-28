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

test('an ad video plays in its spot, from the same point on every TV, and falls back to its picture', async ({ context }) => {
  const video = (await import('node:fs')).readFileSync(new URL('./fixtures/ad-test.webm', import.meta.url));
  await context.route('**/ads/e2e-ad-1.webm', (r) => r.fulfill({ status: 200, contentType: 'video/webm', body: video }));
  await context.route('**/ads/missing-1.webm', (r) => r.fulfill({ status: 404, body: '' }));
  const { control, tvs } = await openTvs(context);
  const all = await slots(control);
  const { tv1: left, tv2: right } = all['slot-menu-1'].pictures;
  await control.evaluate(({ left, right }) => {
    const pics = JSON.parse(localStorage.getItem('tabla:pictures') || '{}');
    pics[left] = { ...pics[left], video: { src: 'ads/e2e-ad-1.webm', sound: true } };
    pics[right] = { ...pics[right], video: { src: 'ads/missing-1.webm', sound: false } };
    localStorage.setItem('tabla:pictures', JSON.stringify(pics));
  }, { left, right });
  await setLoop(control, { seconds: 30, firstSlotId: 'slot-menu-1' });
  const [tv1, tv2, tv3] = await tvs();
  // TV 1 and its mirror TV 3 play the video (sound is allowed to fall back to muted in a headless browser)
  for (const tv of [tv1, tv3]) {
    await expect(now(tv)).toHaveAttribute('data-video', 'playing');
    await expect.poll(() => tv.getByTestId('menu-tv-video').evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 5_000 }).toBeGreaterThan(0.2);
  }
  // no default play icon: a see-through poster, and the video stays hidden until it really plays
  await expect(tv1.getByTestId('menu-tv-video')).toHaveAttribute('poster', /^data:image\/gif/);
  await expect(tv1.getByTestId('menu-tv-video')).toBeVisible();
  const times = await Promise.all([tv1, tv3].map((p) => p.getByTestId('menu-tv-video').evaluate((v: HTMLVideoElement) => v.currentTime)));
  expect(Math.abs(times[0] - times[1])).toBeLessThan(0.6);
  // TV 2's video can't load: it shows the picture instead
  await expect(now(tv2)).toHaveAttribute('data-picture-id', right);
  await expect(now(tv2)).toHaveAttribute('data-video', '');
  await expect(tv2.getByTestId('menu-tv-video')).toHaveCount(0);
  // a TV that reloads mid-spot joins the video at the same point, not from the start
  await tv1.waitForTimeout(1_500);
  await tv1.reload();
  await expect(now(tv1)).toHaveAttribute('data-video', 'playing');
  await expect.poll(() => tv1.getByTestId('menu-tv-video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(1.5);
});

test('an ad after every 2 rounds: all four TVs play the same order, each its own side, the video goes after', async ({ context }) => {
  const video = (await import('node:fs')).readFileSync(new URL('./fixtures/ad-test.webm', import.meta.url));
  await context.route('**/ads/e2e-ad-1.webm', (r) => r.fulfill({ status: 200, contentType: 'video/webm', body: video }));
  const { control, tvs } = await openTvs(context);
  const all = await slots(control);
  const m1 = all['slot-menu-1'].pictures;
  const m2 = all['slot-menu-2'].pictures;
  const special = all['slot-special'].pictures.tv1;
  await control.evaluate((ids) => {
    const pics = JSON.parse(localStorage.getItem('tabla:pictures') || '{}');
    pics[ids.special] = { ...pics[ids.special], video: { src: 'ads/e2e-ad-1.webm', sound: false } };
    localStorage.setItem('tabla:pictures', JSON.stringify(pics));
  }, { special });
  await setLoop(control, {
    replace: true,
    patch: {
      a: { order: 1, seconds: 2, transition: 'none', kind: 'menu', pictures: m1 },
      b: { order: 2, seconds: 2, transition: 'none', kind: 'menu', pictures: { tv1: m2.tv1, tv2: m1.tv2 } },
      ad: { order: 3, seconds: 2, transition: 'none', kind: 'catering', every: { by: 'rounds', n: 2 }, pictures: { tv1: special, tv2: m1.tv1 } },
    },
  });
  const pages = await tvs();
  for (const p of pages) await expect(now(p)).not.toHaveAttribute('data-state', 'loading');
  for (const p of pages) await record(p);
  // TV 1 plays the ad's video; TV 2 shows its own side (a still here)
  await expect(now(pages[0])).toHaveAttribute('data-slot-id', 'ad', { timeout: 12_000 });
  await expect(now(pages[0])).toHaveAttribute('data-video', 'playing');
  await expect(now(pages[1])).toHaveAttribute('data-picture-id', m1.tv1);
  await expect(now(pages[2])).toHaveAttribute('data-video', 'playing');
  // the video element is gone once the ad is over (its decoder given back)
  await expect(now(pages[0])).toHaveAttribute('data-slot-id', 'a', { timeout: 4_000 });
  await expect(pages[0].getByTestId('menu-tv-video')).toHaveCount(0);
  await control.waitForTimeout(6_500);
  const logs = await Promise.all(pages.map(logOf));
  const seqs = logs.map((l) => l.map(([, id]) => id).filter((id, i, a) => id && id !== a[i - 1]));
  for (const s of seqs) expect(s.slice(0, 8)).toEqual(seqs[0].slice(0, 8));
  // the pattern: two rounds of a, b, then the ad
  const text = seqs[0].join(',');
  expect(text).toMatch(/a,b,a,b,ad,a,b/);
  expect(text).not.toMatch(/ad,a,b,ad/);
});

test('an ad video uploaded from the phone (kept in the database) plays on the TV', async ({ context }) => {
  const video = (await import('node:fs')).readFileSync(new URL('./fixtures/ad-test.webm', import.meta.url));
  const { control, tvs } = await openTvs(context);
  const all = await slots(control);
  const left = all['slot-menu-1'].pictures.tv1;
  await control.evaluate(async ({ bytes, left }) => {
    const db: IDBDatabase = await new Promise((ok) => {
      const r = indexedDB.open('tabla-pictures', 1);
      r.onsuccess = () => ok(r.result);
    });
    await new Promise<void>((ok) => {
      const tx = db.transaction('blobs', 'readwrite');
      tx.objectStore('blobs').put(new Blob([new Uint8Array(bytes)], { type: 'video/mp4' }), 'video:v1');
      tx.oncomplete = () => ok();
    });
    const pics = JSON.parse(localStorage.getItem('tabla:pictures') || '{}');
    pics[left] = { ...pics[left], video: { src: 'stored:v1', sound: false, seconds: 3 } };
    localStorage.setItem('tabla:pictures', JSON.stringify(pics));
  }, { bytes: [...video], left });
  await setLoop(control, { seconds: 30, firstSlotId: 'slot-menu-1' });
  const [tv1] = await tvs();
  await expect(now(tv1)).toHaveAttribute('data-video', 'playing');
  await expect(tv1.getByTestId('menu-tv-video')).toHaveAttribute('src', /^blob:/);
});

test('a paused ad\'s video is never downloaded; a live one is', async ({ context }) => {
  const video = (await import('node:fs')).readFileSync(new URL('./fixtures/ad-test.webm', import.meta.url));
  const asked: string[] = [];
  await context.route('**/ads/e2e-*.webm', (r) => {
    asked.push(new URL(r.request().url()).pathname.split('/').pop()!);
    return r.fulfill({ status: 200, contentType: 'video/webm', body: video });
  });
  const { control, tvs } = await openTvs(context);
  const all = await slots(control);
  const m1 = all['slot-menu-1'].pictures;
  const special = all['slot-special'].pictures.tv1;
  await control.evaluate((ids) => {
    const pics = JSON.parse(localStorage.getItem('tabla:pictures') || '{}');
    pics[ids.m1] = { ...pics[ids.m1], video: { src: 'ads/e2e-paused.webm', sound: false } };
    pics[ids.special] = { ...pics[ids.special], video: { src: 'ads/e2e-live.webm', sound: false } };
    localStorage.setItem('tabla:pictures', JSON.stringify(pics));
  }, { m1: m1.tv1, special });
  await setLoop(control, {
    replace: true,
    patch: {
      a: { order: 1, seconds: 2, transition: 'none', kind: 'menu', pictures: { tv1: all['slot-menu-2'].pictures.tv1 } },
      paused: { order: 2, seconds: 2, transition: 'none', kind: 'catering', endsAt: Date.now() - 1_000, every: { by: 'rounds', n: 1 }, pictures: { tv1: m1.tv1 } },
      live: { order: 3, seconds: 2, transition: 'none', kind: 'catering', every: { by: 'rounds', n: 1 }, pictures: { tv1: special } },
    },
  });
  const [tv1] = await tvs();
  await expect(now(tv1)).toHaveAttribute('data-slot-id', 'live', { timeout: 8_000 });
  await expect(now(tv1)).toHaveAttribute('data-video', 'playing');
  await tv1.waitForTimeout(2_500);
  expect(asked).toContain('e2e-live.webm');
  expect(asked).not.toContain('e2e-paused.webm');
});

test('an ad video that drifts away from the other TVs comes back in sync by itself', async ({ context }) => {
  const video = (await import('node:fs')).readFileSync(new URL('./fixtures/ad-test-long.webm', import.meta.url));
  await context.route('**/ads/e2e-ad-long.webm', (r) => r.fulfill({ status: 200, contentType: 'video/webm', body: video }));
  const { control, tvs } = await openTvs(context);
  const { tv1: left } = (await slots(control))['slot-menu-1'].pictures;
  await control.evaluate((left) => {
    const pics = JSON.parse(localStorage.getItem('tabla:pictures') || '{}');
    pics[left] = { ...pics[left], video: { src: 'ads/e2e-ad-long.webm', sound: false } };
    localStorage.setItem('tabla:pictures', JSON.stringify(pics));
  }, left);
  await setLoop(control, { seconds: 30, firstSlotId: 'slot-menu-1' });
  const [tv1, , tv3] = await tvs();
  const vid = (p: Page) => p.getByTestId('menu-tv-video');
  // Where each video is, taken back to one moment (both windows share this computer's clock).
  const pos = (p: Page) => vid(p).evaluate((v: HTMLVideoElement) => v.currentTime - Date.now() / 1000);
  const gap = async () => Math.abs((await pos(tv1)) - (await pos(tv3)));
  for (const tv of [tv1, tv3]) {
    await expect(now(tv)).toHaveAttribute('data-video', 'playing');
    await expect.poll(() => vid(tv).evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 5_000 }).toBeGreaterThan(0.5);
  }
  await expect.poll(gap, { timeout: 4_000 }).toBeLessThan(0.05);

  // A small slip (TV 3 falls 0.15 s behind): it plays a little faster until it is back.
  await vid(tv3).evaluate((v: HTMLVideoElement) => (v.currentTime -= 0.15));
  await expect.poll(() => vid(tv3).evaluate((v: HTMLVideoElement) => v.playbackRate), { timeout: 2_000 }).toBeGreaterThan(1);
  await expect.poll(gap, { timeout: 6_000 }).toBeLessThan(0.05);

  // A big slip (TV 1 jumps 2 s ahead): it jumps straight back.
  await vid(tv1).evaluate((v: HTMLVideoElement) => (v.currentTime += 2));
  await expect.poll(gap, { timeout: 3_000 }).toBeLessThan(0.1);
  await expect.poll(gap, { timeout: 4_000 }).toBeLessThan(0.05);
});

test('a missing ad video is asked for again only at the next change, not over and over', async ({ context }) => {
  let asked = 0;
  await context.route('**/ads/missing-1.webm', (r) => {
    asked++;
    return r.fulfill({ status: 404, body: '' });
  });
  const { control, tvs } = await openTvs(context);
  const right = (await slots(control))['slot-menu-1'].pictures.tv2;
  await control.evaluate((right) => {
    const pics = JSON.parse(localStorage.getItem('tabla:pictures') || '{}');
    pics[right] = { ...pics[right], video: { src: 'ads/missing-1.webm', sound: false } };
    localStorage.setItem('tabla:pictures', JSON.stringify(pics));
  }, right);
  await setLoop(control, { seconds: 60, firstSlotId: 'slot-menu-1' });
  const [, tv2] = await tvs();
  // it falls back to the still picture
  await expect(now(tv2)).toHaveAttribute('data-picture-id', right);
  await tv2.waitForTimeout(5_000);
  expect(asked).toBeGreaterThan(0);
  expect(asked).toBeLessThanOrEqual(8);
});
