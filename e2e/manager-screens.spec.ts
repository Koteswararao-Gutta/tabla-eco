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
  await page.getByRole('button', { name: 'Add a picture after picture 1' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await page.getByTestId('add-file').setInputFiles({ name: 'dish.png', mimeType: 'image/png', buffer: PNG });
  await expect(sheet.locator('img')).toBeVisible();
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
  await page.getByRole('button', { name: 'Move up' }).click();
  await expect(page.getByTestId('slot').first()).toHaveAttribute('data-slot-id', 'slot-menu-2');
  await page.getByRole('button', { name: 'Done' }).click();

  // The catering spot only has TV 1's picture: removing it removes the spot.
  await page.getByRole('button', { name: 'Picture 4: options' }).click();
  await page.getByRole('button', { name: 'Remove from TV 1' }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByTestId('slot')).toHaveCount(3);
  expect((await readCollection<Slot>(page, 'slots')).map((s) => s.id).sort()).toEqual(['slot-menu-1', 'slot-menu-2', 'slot-special']);
});

test('TV 3 mirroring can be turned off', async ({ context }) => {
  const page = await openScreen(context, '/manager/screens/tv3');
  const sw = page.getByRole('switch', { name: /Mirror TV 1/ });
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('mirror-note')).toBeVisible();
  await expect(page.getByRole('button', { name: /Add a picture after/ })).toHaveCount(0);
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('mirror-note')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Add a picture for TV 3' }).first()).toBeVisible();
  const tv3 = (await readCollection<{ id: string; mirrorOf: string | null }>(page, 'screens')).find((s) => s.id === 'tv3')!;
  expect(tv3.mirrorOf).toBeNull();
  await page.getByRole('link', { name: '‹ Screens' }).click();
  await expect(page.getByTestId('tile-tv3')).toContainText('Own pictures');
});

test('TV 5 music settings save', async ({ context }) => {
  const page = await openScreen(context, '/manager/screens/tv5');
  await page.getByLabel('YouTube playlist link').fill('https://www.youtube.com/playlist?list=PL123');
  await page.getByRole('button', { name: 'Every N seconds' }).click();
  await page.getByLabel('Every (seconds)').fill('90');
  await expect(page.getByTestId('clip-picture')).toHaveCount(1);
  await page.getByTestId('clip-file').setInputFiles({ name: 'tray.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByTestId('clip-picture')).toHaveCount(2);
  await page.getByRole('button', { name: 'Remove clip picture 1' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();
  const m = await singleton(page, 'music');
  expect([m.playlist, m.clipMode, m.everySeconds, m.clipPictures.length]).toEqual(['https://www.youtube.com/playlist?list=PL123', 'everySeconds', 90, 1]);
  await shot(page, 'tv5');
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
