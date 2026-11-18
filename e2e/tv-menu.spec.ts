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

test('no picture, a broken picture or an empty loop shows the idle look', async ({ context }) => {
  const { control, tvs } = await openTvs(context);
  await setLoop(control, { seconds: 30, firstSlotId: 'slot-menu-1' });
  const [tv1, tv2] = await tvs();
  // menu slot without a TV 2 picture never borrows: TV 2 is idle
  await setLoop(control, { patch: { 'slot-menu-1': { pictures: { tv1: (await slots(control))['slot-menu-1'].pictures.tv1 } } }, firstSlotId: 'slot-menu-1' });
  await expect(now(tv2)).toHaveAttribute('data-state', 'idle');
  await expect(tv2.getByText('Tabla').last()).toBeVisible();
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
