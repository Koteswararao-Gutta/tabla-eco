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
  await expect(page.getByTestId('add-hint')).toContainText('TV 2 shows the restaurant name in this spot');
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

test('move to top and move to bottom in one tap, restarting the loop once', async ({ context }) => {
  const page = await openScreen(context, '/manager/screens/tv1');
  const order = () => page.getByTestId('slot').evaluateAll((els) => els.map((e) => e.getAttribute('data-slot-id')));
  await page.getByRole('button', { name: 'Picture 4: options' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('button', { name: 'Move to bottom' })).toBeDisabled();
  if (SHOTS) await page.waitForTimeout(400); // let the sheet finish rising
  await shot(page, 'options-move');
  await sheet.getByRole('button', { name: 'Move to top' }).click();
  await expect.poll(order).toEqual(['slot-catering', 'slot-menu-1', 'slot-menu-2', 'slot-special']);
  expect((await singleton(page, 'loop')).firstSlotId).toBe('slot-catering');
  await expect(sheet.getByRole('button', { name: 'Move to top' })).toBeDisabled();
  await expect(sheet).toContainText('Picture 1 of 4');
  await sheet.getByRole('button', { name: 'Move to bottom' }).click();
  await expect.poll(order).toEqual(['slot-menu-1', 'slot-menu-2', 'slot-special', 'slot-catering']);
  const orders = (await readCollection<Slot>(page, 'slots')).sort((a, b) => a.order - b.order).map((s) => s.order);
  expect(orders).toEqual([1, 2, 3, 4]);
});

test('changing seconds and transition saves on the slot', async ({ context }) => {
  const page = await openScreen(context, '/manager/screens/tv1');
  await page.getByTestId('slot-line').first().click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toContainText('all front TVs');
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

test('picture options: preview, seconds, transition and end date in one place', async ({ context }) => {
  const page = await openScreen(context, '/manager/screens/tv1');
  await page.getByRole('button', { name: 'Picture 3: options' }).click(); // the special
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByTestId('options-preview').locator('img')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Clear end date' })).toHaveCount(0);
  await sheet.getByTestId('options-seconds').fill('12');
  await sheet.getByRole('button', { name: 'Fade' }).click();
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
  expect([s.seconds, s.transition, s.endsAt]).toEqual([12, 'fade', new Date(2030, 0, 5, 21, 0).getTime()]);
  expect((await singleton(page, 'loop')).firstSlotId).toBe('slot-special');
});

test('picture buttons work from the keyboard', async ({ context }) => {
  const page = await openScreen(context, '/manager/screens/tv1');
  await page.getByRole('button', { name: 'Add a picture between 1 and 2' }).click();
  const choose = page.getByRole('dialog').getByRole('button', { name: 'Choose a picture' });
  await choose.focus();
  await expect(choose).toBeFocused();
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
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
  await expect(page.getByRole('button', { name: 'Add a picture for TV 3' }).first()).toBeVisible();
  const tv3 = (await readCollection<{ id: string; mirrorOf: string | null }>(page, 'screens')).find((s) => s.id === 'tv3')!;
  expect(tv3.mirrorOf).toBeNull();
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
