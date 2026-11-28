import { expect, test, type Page } from '@playwright/test';
import { openScreen, readCollection } from './helpers';

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });

// Set SHOTS_DIR to save phone screenshots for a look by eye.
const SHOTS = process.env.SHOTS_DIR;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

// A tiny real PNG (2x2, orange).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGO8cYOBgYGBiYGBgYGBAQAZ7gGBUmzvbgAAAABJRU5ErkJggg==',
  'base64',
);

type Slot = { id: string; order: number; seconds: number; transition: string; pictures: Record<string, string> };
const singleton = (page: Page, id: string) =>
  page.evaluate((k) => JSON.parse(localStorage.getItem('tabla:singletons') || '{}')[k], id);

test('home shows six tiles and TV 1 lists the seeded pictures in order', async ({ context }) => {
  const page = await openScreen(context, '/manager/screens');
  for (const id of ['tv1', 'tv2', 'tv3', 'tv4', 'tv5', 'kitchen']) await expect(page.getByTestId('tile-' + id)).toBeVisible();
  await expect(page.locator('.t-tile')).toHaveCount(6);
  await expect(page.getByTestId('tile-tv3')).toContainText('Mirrors TV 1');
  await expect(page.getByTestId('tile-tv5')).toContainText('Music');
  await shot(page, 'home');

  await page.getByTestId('tile-tv1').click();
  await expect(page).toHaveURL(/#\/manager\/screens\/tv1$/);
  const slots = page.getByTestId('slot');
  await expect(slots).toHaveCount(4);
  expect(await slots.evaluateAll((els) => els.map((e) => e.getAttribute('data-slot-id')))).toEqual(['slot-menu-1', 'slot-menu-2', 'slot-special', 'slot-catering']);
  await expect(page.locator('.sc-pic img')).toHaveCount(4);
  await expect(slots.nth(0).getByTestId('slot-line')).toHaveText(/Fade · 10 s/);
  await shot(page, 'tv1');

  // TV 2 borrows TV 1's special picture and says so.
  await page.goto('/#/manager/screens/tv2');
  await expect(page.getByTestId('slot').nth(2)).toContainText('Shared with TV 1');
});

test('adding a picture creates a slot after that spot and restarts the loop on it', async ({ context }) => {
  const page = await openScreen(context, '/manager/screens/tv1');
  await expect(page.getByTestId('slot')).toHaveCount(4);
  await page.getByRole('button', { name: 'Add a picture between 1 and 2' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId('add-hint')).toContainText('TV 2 shows its own next picture again in this spot');
  await page.getByTestId('add-file').setInputFiles({ name: 'dish.png', mimeType: 'image/png', buffer: PNG });
  await expect(sheet.locator('img')).toBeVisible();
  // a 2x2 picture: tall-ish (square) and tiny, so both plain warnings show
  await expect(sheet.getByTestId('picture-warning')).toHaveText([/black bars at the sides/, /small and may look blurry/]);
  await sheet.getByRole('button', { name: 'Special' }).click();
  await shot(page, 'add-sheet');
  await sheet.getByRole('button', { name: 'Add picture' }).click();
  await expect(sheet).toBeHidden();

  const all = await readCollection<Slot>(page, 'slots');
  expect(all).toHaveLength(5);
  const added = all.find((s) => !s.id.startsWith('slot-'))!;
  expect(added.order).toBe(1.5);
  expect(added.seconds).toBe(10);
  expect(added.transition).toBe('fade');
  expect(Object.keys(added.pictures)).toEqual(['tv1']);
  expect((await singleton(page, 'loop')).firstSlotId).toBe(added.id);
  await expect(page.getByTestId('slot').nth(1)).toHaveAttribute('data-slot-id', added.id);
  await expect(page.getByTestId('slot').nth(1).locator('img')).toBeVisible();
});

test('a file that is not a picture: plain message, no broken image, Add stays off until a real picture', async ({ context }) => {
  const page = await openScreen(context, '/manager/screens/tv1');
  await expect(page.getByTestId('slot')).toHaveCount(4);
  await page.getByRole('button', { name: 'Add a picture', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await page.getByTestId('add-file').setInputFiles({ name: 'menu.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 not a picture') });
  await expect(sheet.getByTestId('picture-broken')).toBeVisible();
  await expect(sheet.locator('img')).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Add picture' })).toBeDisabled();
  await shot(page, 'add-not-a-picture');
  // A real picture afterwards clears it.
  await page.getByTestId('add-file').setInputFiles({ name: 'dish.png', mimeType: 'image/png', buffer: PNG });
  await expect(sheet.locator('img')).toBeVisible();
  await expect(sheet.getByTestId('picture-broken')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Add picture' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId('slot')).toHaveCount(5);
});

test('one clear add button at the end, quiet + buttons in between with their own names', async ({ context }) => {
  const page = await openScreen(context, '/manager/screens/tv1');
  await expect(page.getByTestId('slot')).toHaveCount(4);
  const between = page.getByRole('button', { name: /^Add a picture between/ });
  await expect(between).toHaveCount(3);
  expect(await between.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual([
    'Add a picture between 1 and 2',
    'Add a picture between 2 and 3',
    'Add a picture between 3 and 4',
  ]);
  const end = page.getByRole('button', { name: 'Add a picture', exact: true });
  await end.scrollIntoViewIfNeeded();
  await shot(page, 'tv1-end');
  expect((await end.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await end.click();
  const sheet = page.getByRole('dialog');
  await page.getByTestId('add-file').setInputFiles({ name: 'dish.png', mimeType: 'image/png', buffer: PNG });
  await sheet.getByRole('button', { name: 'Add picture' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId('slot')).toHaveCount(5);
  const added = (await readCollection<Slot>(page, 'slots')).find((s) => !s.id.startsWith('slot-'))!;
  expect(added.order).toBe(5);
  await expect(page.getByTestId('slot').last()).toHaveAttribute('data-slot-id', added.id);
});

test('move up and move down, restarting the loop once', async ({ context }) => {
  const page = await openScreen(context, '/manager/screens/tv1');
  const order = () => page.getByTestId('slot').evaluateAll((els) => els.map((e) => e.getAttribute('data-slot-id')));
  await page.getByRole('button', { name: 'Picture 4: options' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('button', { name: 'Move down' })).toBeDisabled();
  await expect(sheet.getByRole('button', { name: 'Move to top' })).toHaveCount(0);
  await expect(sheet.getByTestId('options-seconds')).toHaveCount(0); // seconds live on the "Fade · 10 s ›" line
  await expect(sheet).toContainText('Order, seconds and change are shared by TV 1 to TV 4.');
  if (SHOTS) await page.waitForTimeout(400); // let the sheet finish rising
  await shot(page, 'options-move');
  await sheet.getByRole('button', { name: 'Move up' }).click();
  await expect.poll(order).toEqual(['slot-menu-1', 'slot-menu-2', 'slot-catering', 'slot-special']);
  expect((await singleton(page, 'loop')).firstSlotId).toBe('slot-catering');
  await expect(sheet).toContainText('Picture 3 of 4');
  await sheet.getByRole('button', { name: 'Move down' }).click();
  await expect.poll(order).toEqual(['slot-menu-1', 'slot-menu-2', 'slot-special', 'slot-catering']);
  const orders = (await readCollection<Slot>(page, 'slots')).sort((a, b) => a.order - b.order).map((s) => s.order);
  expect(orders).toEqual([1, 2, 3, 4]);
});

test('changing seconds and transition saves on the slot', async ({ context }) => {
  const page = await openScreen(context, '/manager/screens/tv1');
  await page.getByTestId('slot-line').first().click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toContainText('shared by TV 1 to TV 4');
  await page.getByTestId('timing-seconds').fill('15');
  await sheet.getByRole('button', { name: 'Slide' }).click();
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId('slot-line').first()).toHaveText(/Slide · 15 s/);
  const s = (await readCollection<Slot>(page, 'slots')).find((x) => x.id === 'slot-menu-1')!;
  expect([s.seconds, s.transition]).toEqual([15, 'slide']);
  expect((await singleton(page, 'loop')).firstSlotId).toBe('slot-menu-1');
});

test('moving and removing pictures', async ({ context }) => {
  const page = await openScreen(context, '/manager/screens/tv1');
  await page.getByRole('button', { name: 'Picture 2: options' }).click();
  await expect(page.getByTestId('options-preview').locator('img')).toBeVisible();
  await page.getByRole('button', { name: 'Move up' }).click();
  await expect(page.getByTestId('slot').first()).toHaveAttribute('data-slot-id', 'slot-menu-2');
  // a menu picture never offers an end date
  await expect(page.getByTestId('ends-input')).toHaveCount(0);
  await page.getByRole('button', { name: 'Done' }).click();

  const pictureIds = async () => (await readCollection<{ id: string }>(page, 'pictures')).map((p) => p.id);
  const slotPicture = async (id: string) => (await readCollection<Slot>(page, 'slots')).find((s) => s.id === id)!.pictures.tv1;
  const cateringPic = await slotPicture('slot-catering');
  const specialPic = await slotPicture('slot-special');

  // The catering spot only has TV 1's picture: removing it removes the spot.
  await page.getByRole('button', { name: 'Picture 4: options' }).click();
  await page.getByRole('button', { name: 'Remove from TV 1' }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm.getByRole('heading')).toHaveText('Remove this picture from TV 1?');
  await shot(page, 'remove-confirm');
  await confirm.getByRole('button', { name: 'Remove picture' }).click();
  await expect(page.getByTestId('slot')).toHaveCount(3);
  expect((await readCollection<Slot>(page, 'slots')).map((s) => s.id).sort()).toEqual(['slot-menu-1', 'slot-menu-2', 'slot-special']);
  // the TV 5 clip still uses that picture, so it is kept
  expect(await pictureIds()).toContain(cateringPic);

  // The special picture is used nowhere else: removing it deletes the stored picture too.
  await page.getByRole('button', { name: 'Picture 3: options' }).click();
  await page.getByRole('button', { name: 'Remove from TV 1' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove picture' }).click();
  await expect(page.getByTestId('slot')).toHaveCount(2);
  await expect.poll(pictureIds).not.toContain(specialPic);
});

test('picture options: preview and end date', async ({ context }) => {
  const page = await openScreen(context, '/manager/screens/tv1');
  await page.getByRole('button', { name: 'Picture 3: options' }).click(); // the special
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByTestId('options-preview').locator('img')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Clear end date' })).toHaveCount(0);
  await sheet.getByTestId('ends-input').fill('2030-01-05T21:00');
  await expect(sheet.getByRole('button', { name: 'Clear end date' })).toBeVisible();
  // the date field stays inside the sheet on a narrow phone
  const box = await sheet.getByTestId('ends-input').boundingBox();
  const sheetBox = await sheet.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(sheetBox!.x + sheetBox!.width);
  await shot(page, 'options-sheet');
  await sheet.getByRole('button', { name: 'Save changes' }).click();
  await expect(sheet).toBeHidden();
  const s = (await readCollection<Slot & { endsAt: number | null }>(page, 'slots')).find((x) => x.id === 'slot-special')!;
  expect(s.endsAt).toEqual(new Date(2030, 0, 5, 21, 0).getTime());
  expect((await singleton(page, 'loop')).firstSlotId).toBe('slot-special');
});

test('picture buttons work from the keyboard', async ({ context }) => {
  const page = await openScreen(context, '/manager/screens/tv1');
  await page.getByRole('button', { name: 'Add a picture between 1 and 2' }).click();
  const choose = page.getByRole('dialog').getByRole('button', { name: 'Choose a picture' });
  await choose.focus();
  await expect(choose).toBeFocused();
  const chooser = page.waitForEvent('filechooser');
  await choose.press('Enter'); // focuses and presses in one step, so nothing can take the focus in between
  await (await chooser).setFiles({ name: 'dish.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('dialog').locator('img')).toBeVisible();
});

test('TV 3 mirroring can be turned off', async ({ context }) => {
  const page = await openScreen(context, '/manager/screens/tv3');
  const sw = page.getByRole('switch', { name: /Mirror TV 1/ });
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('mirror-note')).toBeVisible();
  await expect(page.getByRole('button', { name: /Add a picture between/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add a picture', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('mirror-note').getByRole('link', { name: /TV 1/ })).toHaveAttribute('href', '#/manager/screens/tv1');
  const before = await sw.boundingBox();
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  expect((await sw.boundingBox())!.y).toBe(before!.y); // the switch never moves under the finger
  await expect(page.getByTestId('mirror-note')).toBeHidden();
  // TV 3 keeps showing TV 1's pictures (never goes blank) until it gets its own
  await expect(sw).toContainText("Shows TV 1's pictures until you add its own");
  await expect(page.getByTestId('slot')).toHaveCount(4);
  await expect(page.getByText('Same as TV 1').first()).toBeVisible();
  const tv3 = (await readCollection<{ id: string; mirrorOf: string | null }>(page, 'screens')).find((s) => s.id === 'tv3')!;
  expect(tv3.mirrorOf).toBeNull();

  // A picture added on TV 3 alone is a spot for TV 3 / TV 4 only: TV 1 does not list it (and never blanks for it)
  await page.getByRole('button', { name: 'Add a picture', exact: true }).click();
  await page.getByTestId('add-file').setInputFiles({ name: 'tv3.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByTestId('add-hint')).toContainText("TV 1 and TV 2 don't change.");
  await page.getByRole('dialog').getByRole('button', { name: 'Add picture' }).click();
  await expect(page.getByTestId('slot')).toHaveCount(5);
  await page.goto(page.url().replace('/tv3', '/tv1'));
  await expect(page.getByTestId('slot')).toHaveCount(4);
  await page.goto(page.url().replace('/tv1', '/tv3'));
  await page.getByRole('link', { name: '‹ Screens' }).click();
  await expect(page.getByTestId('tile-tv3')).toContainText('Own pictures');
});

test('TV 5 music settings save as you change them', async ({ context }) => {
  const page = await openScreen(context, '/manager/screens/tv5');
  await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
  await page.getByLabel('YouTube playlist link').fill('https://www.youtube.com/playlist?list=PL123');
  await page.getByRole('button', { name: 'On a timer' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await page.getByLabel('Show the clip every … seconds').fill('90');
  await expect(page.getByTestId('clip-picture')).toHaveCount(1);
  await page.getByTestId('clip-file').setInputFiles({ name: 'tray.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByTestId('clip-picture')).toHaveCount(2);
  await page.getByRole('button', { name: 'Remove clip picture 1' }).click();
  await expect(page.getByTestId('clip-picture')).toHaveCount(1);
  await expect(page.getByTestId('undo-toast')).toContainText('Picture removed');
  await expect
    .poll(async () => {
      const m = await singleton(page, 'music');
      return [m.playlist, m.clipMode, m.everySeconds, m.clipPictures.length];
    })
    .toEqual(['https://www.youtube.com/playlist?list=PL123', 'everySeconds', 90, 1]);
  await shot(page, 'tv5');

  // Leaving right after typing still keeps the change.
  await page.getByLabel('Title', { exact: true }).fill('Biryani trays for your party');
  await page.getByRole('link', { name: '‹ Screens' }).click();
  await expect.poll(async () => (await singleton(page, 'music')).clipTitle).toBe('Biryani trays for your party');
});

test('kitchen PIN must be 4 digits and saves', async ({ context }) => {
  const page = await openScreen(context, '/manager/screens/kitchen');
  await expect(page.getByTestId('current-pin')).toHaveText('1234');
  const input = page.getByLabel('New PIN (4 digits)');
  await input.fill('12');
  await page.getByRole('button', { name: 'Change PIN' }).click();
  await expect(page.getByRole('alert')).toHaveText('The PIN must be exactly 4 digits.');
  await input.fill('4321');
  await page.getByRole('button', { name: 'Change PIN' }).click();
  await expect(page.getByText('PIN changed.')).toBeVisible();
  expect((await singleton(page, 'settings')).kitchenPin).toBe('4321');
  await expect(page.getByTestId('current-pin')).toHaveText('4321');
  await expect(page.getByRole('link', { name: 'Open the kitchen screen' })).toHaveAttribute('href', '#/kitchen');
  await shot(page, 'kitchen');
});

test('TV 5 clip picture: × offers Undo, and the file is deleted only after the Undo is gone', async ({ context }) => {
  const page = await openScreen(context, '/manager/screens/tv5');
  await expect(page.getByTestId('clip-picture')).toHaveCount(1);
  await page.getByTestId('clip-file').setInputFiles({ name: 'tray.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByTestId('clip-picture')).toHaveCount(2);
  const clip = async () => (await singleton(page, 'music')).clipPictures as string[];
  await expect.poll(async () => (await clip()).length).toBe(2);
  const [seeded, added] = await clip();
  const pictureIds = async () => (await readCollection<{ id: string }>(page, 'pictures')).map((p) => p.id);

  // the visible × is 32 px
  const x = page.getByRole('button', { name: 'Remove clip picture 2' });
  expect(await x.evaluate((el) => getComputedStyle(el, '::after').width)).toBe('32px');
  await shot(page, 'tv5-clip');

  // Remove, then Undo: back in the same place, file kept.
  await page.getByRole('button', { name: 'Remove clip picture 1' }).click();
  await expect(page.getByTestId('clip-picture')).toHaveCount(1);
  await expect.poll(clip).toEqual([added]);
  const toast = page.getByTestId('undo-toast');
  await expect(toast).toBeVisible();
  // The toast scrolls itself into view smoothly, so the page is still moving here. Every
  // position check reads all the boxes in one go (same frame); reading them one after the
  // other let the page scroll in between and made this test fail now and then.
  const boxes = () =>
    page.evaluate(() => {
      const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
      const t = box('[data-testid="undo-toast"]');
      return { toastTop: t.top, toastBottom: t.bottom, gridBottom: box('.sc-clip-grid').bottom, tabBarTop: box('.t-tabbar').top };
    });
  // the toast never covers the pictures or the Add picture tile
  const b = await boxes();
  expect(b.toastTop).toBeGreaterThanOrEqual(b.gridBottom);
  // ...and it scrolls clear of the tab bar so Undo can be tapped
  await expect.poll(async () => { const s = await boxes(); return s.toastBottom <= s.tabBarTop; }).toBe(true);
  await shot(page, 'tv5-undo');
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(toast).toBeHidden();
  await expect.poll(clip).toEqual([seeded, added]);
  expect(await pictureIds()).toContain(seeded);

  // Remove without Undo: the file stays while Undo is offered, and goes after.
  await x.click();
  await expect.poll(clip).toEqual([seeded]);
  await page.waitForTimeout(1000);
  expect(await pictureIds()).toContain(added);
  await expect(toast).toBeHidden({ timeout: 8000 });
  await expect.poll(pictureIds).not.toContain(added);
});

// ---------- ads ----------

/** Turns two copies of the seeded pictures into a live-like ad: left with sound on TV 1, right without on TV 2. */
async function seedAd(page: Page, extra: Record<string, unknown> = {}) {
  await page.evaluate(async (extra) => {
    const slots = JSON.parse(localStorage.getItem('tabla:slots') || '{}');
    const pics = JSON.parse(localStorage.getItem('tabla:pictures') || '{}');
    const { tv1, tv2 } = slots['slot-menu-1'].pictures;
    const db: IDBDatabase = await new Promise((ok) => {
      const r = indexedDB.open('tabla-pictures', 1);
      r.onsuccess = () => ok(r.result);
    });
    const copy = (from: string, to: string) =>
      new Promise<void>((ok) => {
        const tx = db.transaction('blobs', 'readwrite');
        const st = tx.objectStore('blobs');
        const g = st.get(from);
        g.onsuccess = () => st.put(g.result, to);
        tx.oncomplete = () => ok();
      });
    await copy(tv1, 'adL');
    await copy(tv2, 'adR');
    pics.adL = { ...pics[tv1], id: 'adL', name: 'Ad left', video: { src: 'ads/e2e-ad-1.webm', sound: true } };
    pics.adR = { ...pics[tv2], id: 'adR', name: 'Ad right', video: { src: 'ads/e2e-ad-1.webm', sound: false } };
    localStorage.setItem('tabla:pictures', JSON.stringify(pics));
    slots['ad-1'] = { id: 'ad-1', order: 5, seconds: 15, transition: 'fade', kind: 'catering', pictures: { tv1: 'adL', tv2: 'adR' }, endsAt: null, ...extra };
    localStorage.setItem('tabla:slots', JSON.stringify(slots));
  }, extra);
}

const setBeats = (page: Page, beats: Record<string, { lastSeen: number; version?: number }>) =>
  page.evaluate((b) => {
    const all: Record<string, unknown> = {};
    for (const [id, v] of Object.entries(b)) all[id] = { id, ...v };
    localStorage.setItem('tabla:heartbeats', JSON.stringify(all));
  }, beats);

async function adPage(context: import('@playwright/test').BrowserContext, extra: Record<string, unknown> = {}, beats?: Record<string, { lastSeen: number; version?: number }>) {
  const control = await openScreen(context, '/');
  await expect(control.getByRole('heading', { name: 'Tabla' })).toBeVisible();
  await seedAd(control, extra);
  if (beats) await setBeats(control, beats);
  const page = await openScreen(context, '/manager/screens/tv1');
  await expect(page.getByTestId('slot')).toHaveCount(5);
  return page;
}

test('the Add sheet offers Menu, Special and Ad; Ad asks for two videos, sound and how often', async ({ context }) => {
  const page = await openScreen(context, '/manager/screens/tv1');
  await page.getByRole('button', { name: 'Add a picture', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('group', { name: 'Type' }).getByRole('button')).toHaveText(['Menu', 'Special', 'Ad']);
  await sheet.getByRole('button', { name: 'Ad', exact: true }).click();
  await expect(sheet.getByRole('heading', { name: 'Add an ad' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: "Video for TV 1 (left) – ends with 'Scan the code'" })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Video for TV 2 (right) – shows the QR code' })).toBeVisible();
  await expect(sheet.getByRole('switch', { name: /Play with sound/ })).toHaveAttribute('aria-checked', 'false');
  await expect(sheet.getByRole('group', { name: 'How often' }).getByRole('button')).toHaveText(['After rounds', 'By minutes']);
  await expect(sheet.getByTestId('ad-save')).toBeDisabled();
  await shot(page, 'ad-add-sheet');
  // a file that is not an MP4: a plain message
  await sheet.getByTestId('ad-file-left').setInputFiles({ name: 'clip.webm', mimeType: 'video/webm', buffer: Buffer.from('\x1aE\xdf\xa3 not an mp4 file at all') });
  await expect(sheet.getByTestId('ad-video-problem')).toHaveText('Choose the MP4 file (from Files).');
  await expect(sheet.getByTestId('ad-save')).toBeDisabled();
  // a video was picked: closing asks first, and Keep editing keeps the sheet
  await page.keyboard.press('Escape');
  await expect(page.getByText('Discard the videos you picked?')).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(sheet.getByRole('heading', { name: 'Add an ad' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(sheet).toBeHidden();
});

test('how often by minutes: at least 2, and not shorter than the ad plus a minute', async ({ context }) => {
  const page = await adPage(context);
  await page.locator('[data-slot-id="ad-1"]').getByTestId('slot-line').click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'By minutes' }).click();
  await sheet.getByTestId('ad-every-n').fill('1');
  await expect(sheet.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await sheet.getByTestId('ad-every-n').fill('2');
  await expect(sheet.getByTestId('ad-every-problem')).toHaveCount(0);
  await expect(sheet.getByTestId('ad-every-hint')).toContainText('% of the time');
  await expect(sheet.getByRole('button', { name: 'Save changes' })).toBeEnabled();
});

test('uploading an ad from the phone: two videos, then one ad spot on TV 1 and TV 2, shown first', async ({ context }) => {
  const mp4 = (await import('node:fs')).readFileSync(new URL('../public/ads/catering-right-1.mp4', import.meta.url));
  const page = await openScreen(context, '/manager/screens/tv1');
  await expect(page.getByTestId('slot')).toHaveCount(4);
  await page.getByRole('button', { name: 'Add a picture', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'Ad', exact: true }).click();
  await sheet.getByTestId('ad-file-left').setInputFiles({ name: 'left.mp4', mimeType: 'video/mp4', buffer: mp4 });
  await sheet.getByTestId('ad-file-right').setInputFiles({ name: 'right.mp4', mimeType: 'video/mp4', buffer: mp4 });
  await expect(sheet.getByTestId('ad-summary-left')).toHaveText(/^TV 1: 15 s · /, { timeout: 15_000 });
  await expect(sheet.getByTestId('ad-summary-right')).toHaveText(/^TV 2: 15 s · /, { timeout: 15_000 });
  await expect(sheet.getByTestId('ad-side-left').locator('img')).toBeVisible();
  await sheet.getByRole('switch', { name: /Play with sound/ }).click();
  await sheet.getByRole('button', { name: 'By minutes' }).click();
  await sheet.getByTestId('ad-every-n').fill('2');
  await expect(sheet.getByTestId('ad-every-hint')).toContainText('% of the time');
  await shot(page, 'ad-add-filled');
  await sheet.getByTestId('ad-save').click();
  await expect(sheet).toBeHidden({ timeout: 15_000 });
  await expect(page.getByTestId('ad-notice')).toHaveText('Done. The ad is on the TVs now.');

  const all = await readCollection<Slot & { kind?: string; every?: unknown }>(page, 'slots');
  const ad = all.find((s) => s.kind === 'catering' && s.id !== 'slot-catering')!;
  expect(ad.seconds).toBe(15);
  expect(ad.every).toEqual({ by: 'minutes', n: 2 });
  const pics = await readCollection<{ id: string; video?: { src: string; sound: boolean; seconds: number } }>(page, 'pictures');
  const l = pics.find((p) => p.id === ad.pictures.tv1)!;
  const r = pics.find((p) => p.id === ad.pictures.tv2)!;
  expect(l.video).toMatchObject({ src: expect.stringMatching(/^stored:/), sound: true });
  expect(r.video).toMatchObject({ src: expect.stringMatching(/^stored:/), sound: true });
  expect(l.video!.src).not.toBe(r.video!.src);
  expect((await singleton(page, 'loop')).firstSlotId).toBe(ad.id);
  // the list shows it as an ad with sound
  const item = page.locator(`[data-slot-id="${ad.id}"]`);
  await expect(item).toContainText('Ad');
  await expect(item.getByTestId('video-badge')).toHaveText('Sound on');
  await expect(item.getByTestId('slot-line')).toContainText('15 s · every 2 min');
});

test('an ad with videos opens the ad sheet: no Replace picture, no picture Remove; pause, sound and how often', async ({ context }) => {
  const page = await adPage(context);
  const item = page.locator('[data-slot-id="ad-1"]');
  await expect(item.getByTestId('video-badge')).toHaveText('Sound on');
  await expect(item.locator('.t-badge.accent')).toHaveText('Ad');
  await item.getByRole('button', { name: /Ad 5: options/ }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Ad' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: /Replace picture/ })).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: /Remove from/ })).toHaveCount(0);
  await expect(sheet.getByTestId('ad-pair').locator('img')).toHaveCount(2);
  await expect(sheet.getByTestId('ad-badges')).toContainText('Sound on TV 1 and TV 3');
  await shot(page, 'ad-sheet');

  // Sound on for both sides (all 4 TVs)
  await sheet.getByRole('switch', { name: /Play with sound/ }).click();
  await expect.poll(async () => (await readCollection<{ id: string; video?: { sound: boolean } }>(page, 'pictures')).filter((p) => p.id === 'adL' || p.id === 'adR').map((p) => p.video?.sound)).toEqual([true, true]);
  await sheet.getByRole('switch', { name: /Play with sound/ }).click();
  await expect.poll(async () => (await readCollection<{ id: string; video?: { sound: boolean } }>(page, 'pictures')).filter((p) => p.id === 'adL' || p.id === 'adR').map((p) => p.video?.sound)).toEqual([false, false]);

  // How often: after every 3 rounds, saved on the slot; the loop starts again at the first menu picture
  await sheet.getByTestId('ad-every-n').fill('3');
  await sheet.getByRole('button', { name: 'Save changes' }).click();
  await expect(sheet).toBeHidden();
  let ad = (await readCollection<Slot & { every?: unknown; endsAt?: number | null }>(page, 'slots')).find((s) => s.id === 'ad-1')!;
  expect(ad.every).toEqual({ by: 'rounds', n: 3 });
  expect((await singleton(page, 'loop')).firstSlotId).toBeNull();
  await expect(item.getByTestId('slot-line')).toContainText('after every 3 rounds');

  // Pause (ends at the end of what plays now, no restart), then play again (restarts at the first menu picture)
  await item.getByTestId('slot-line').click();
  const anchorBefore = (await singleton(page, 'loop')).anchor;
  await sheet.getByRole('switch', { name: /Show this ad/ }).click();
  await expect.poll(async () => (await readCollection<Slot & { endsAt?: number | null }>(page, 'slots')).find((s) => s.id === 'ad-1')!.endsAt).not.toBeNull();
  expect((await singleton(page, 'loop')).anchor).toBe(anchorBefore);
  await expect(sheet.getByRole('switch', { name: /Show this ad/ })).toHaveAttribute('aria-checked', 'false');
  await expect(item.getByTestId('slot-line')).toContainText('Paused');
  await sheet.getByRole('switch', { name: /Show this ad/ }).click();
  await expect.poll(async () => (await readCollection<Slot & { endsAt?: number | null }>(page, 'slots')).find((s) => s.id === 'ad-1')!.endsAt).toBeNull();
  expect((await singleton(page, 'loop')).firstSlotId).toBeNull();
  ad = (await readCollection<Slot & { every?: unknown }>(page, 'slots')).find((s) => s.id === 'ad-1')!;
  expect(ad.pictures).toEqual({ tv1: 'adL', tv2: 'adR' });
  // the ad's pictures are still there
  const ids = (await readCollection<{ id: string }>(page, 'pictures')).map((p) => p.id);
  expect(ids).toEqual(expect.arrayContaining(['adL', 'adR']));
});

test('Remove ad takes only the ad spot off the TVs; its pictures and videos stay', async ({ context }) => {
  const page = await adPage(context);
  await page.locator('[data-slot-id="ad-1"]').getByTestId('slot-line').click();
  const sheet = page.getByRole('dialog');
  await sheet.getByTestId('ad-remove').click();
  await expect(sheet.getByText('Removes the ad from all 4 TVs. The videos stay saved.')).toBeVisible();
  await sheet.getByTestId('ad-remove-confirm').click();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId('ad-notice')).toHaveText('Ad removed from the TVs.');
  await expect(page.getByTestId('slot')).toHaveCount(4);
  expect((await readCollection<{ id: string }>(page, 'slots')).map((s) => s.id)).not.toContain('ad-1');
  expect((await readCollection<{ id: string }>(page, 'pictures')).map((p) => p.id)).toEqual(expect.arrayContaining(['adL', 'adR']));
  expect((await singleton(page, 'loop')).firstSlotId).toBeNull();
});

test('the ad sheet asks before throwing away unsaved changes', async ({ context }) => {
  const page = await adPage(context);
  await page.locator('[data-slot-id="ad-1"]').getByTestId('slot-line').click();
  const sheet = page.getByRole('dialog');
  await sheet.getByTestId('ad-every-n').fill('4');
  await page.keyboard.press('Escape');
  await expect(page.getByText('Discard your changes?')).toBeVisible();
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(sheet).toBeHidden();
  expect((await readCollection<Slot & { every?: unknown }>(page, 'slots')).find((s) => s.id === 'ad-1')!.every ?? null).not.toEqual({ by: 'rounds', n: 4 });
});

test('how often waits until every menu TV runs the new version', async ({ context }) => {
  const fresh = Date.now() - 60_000;
  const page = await adPage(context, {}, { tv1: { lastSeen: fresh, version: 2 }, tv2: { lastSeen: fresh, version: 2 }, tv3: { lastSeen: fresh }, tv4: { lastSeen: fresh, version: 2 } });
  await page.locator('[data-slot-id="ad-1"]').getByTestId('slot-line').click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByTestId('ad-every-waiting')).toContainText('Still on the old version: TV 3.');
  await expect(sheet.getByTestId('ad-every-n')).toHaveCount(0);
  await shot(page, 'ad-sheet-waiting');
});

test('a picture-only ad (no video) keeps the normal picture sheet', async ({ context }) => {
  const page = await adPage(context);
  // the picture-only catering slot (no video) keeps the normal picture sheet with Remove
  const cat = page.locator('[data-slot-id="slot-catering"]');
  await expect(cat.locator('.t-badge.accent')).toHaveText('Ad');
  await cat.getByRole('button', { name: /Picture 4: options/ }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Remove from TV 1' })).toBeVisible();
});
