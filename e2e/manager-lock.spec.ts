import { expect, test } from '@playwright/test';
import { openScreen, readCollection } from './helpers';

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });

const SHOTS = process.env.SHOT_DIR || 'test-results';

test('catering is open; Screens, Staff and More ask for the manager PIN', async ({ context }) => {
  const page = await openScreen(context, '/manager/catering');
  await expect(page.getByRole('link', { name: 'More' })).toBeVisible();
  await expect(page.getByTestId('manager-lock')).toHaveCount(0);

  await page.getByRole('link', { name: 'Screens', exact: true }).click();
  await expect(page.getByTestId('manager-lock')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/manager-lock.png` });

  // Wrong PIN: says so and stays locked. The kitchen PIN is not the manager PIN.
  await page.keyboard.type('1234');
  await expect(page.getByRole('status')).toHaveText(/didn't work/);
  await expect(page.getByTestId('manager-lock')).toBeVisible();

  for (const d of '5678') await page.getByRole('button', { name: d, exact: true }).click();
  await expect(page.getByTestId('manager-lock')).toHaveCount(0);
  await expect(page.getByTestId('tile-tv1')).toBeVisible();

  // One PIN opens Staff and More too, also in a new window.
  await page.getByRole('link', { name: 'Staff', exact: true }).click();
  await expect(page.getByTestId('staff-planner')).toBeVisible();
  const other = await openScreen(context, '/manager/more');
  await expect(other.getByTestId('statistics')).toContainText('Coming soon');
  await other.screenshot({ path: `${SHOTS}/manager-more.png` });

  // Lock now locks every manager tab again.
  await other.getByRole('button', { name: 'Lock now' }).click();
  await expect(other.getByTestId('manager-lock')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('manager-lock')).toBeVisible();
});

test('locks again after 10 minutes without a touch', async ({ context }) => {
  const page = await openScreen(context, '/manager/staff');
  await page.clock.install();
  await page.reload();
  await page.getByTestId('manager-lock').waitFor();
  await page.keyboard.type('5678');
  await expect(page.getByTestId('staff-planner')).toBeVisible();
  await page.clock.fastForward('09:00');
  await expect(page.getByTestId('manager-lock')).toHaveCount(0);
  await page.clock.fastForward('01:30');
  await expect(page.getByTestId('manager-lock')).toBeVisible();
});

test('the manager PIN can be changed, and must differ from the kitchen PIN', async ({ context }) => {
  const page = await openScreen(context, '/manager/more');
  await page.getByTestId('manager-lock').waitFor();
  await page.keyboard.type('5678');
  await expect(page.getByTestId('manager-pin')).toHaveText('5678');
  const input = page.getByLabel('New PIN (4 digits)');
  await input.fill('1234');
  await page.getByRole('button', { name: 'Change PIN' }).click();
  await expect(page.getByRole('alert')).toHaveText(/kitchen PIN/);
  await input.fill('2468');
  await page.getByRole('button', { name: 'Change PIN' }).click();
  await expect(page.getByTestId('manager-pin')).toHaveText('2468');
  const settings = (await readCollection<{ id: string; managerPin?: string; kitchenPin?: string }>(page, 'singletons')).find((s) => s.id === 'settings');
  expect(settings?.managerPin).toBe('2468');
  expect(settings?.kitchenPin).toBe('1234');

  // This phone stays open. Another phone (fresh unlock) needs the new PIN; the old one no longer works.
  await page.reload();
  await expect(page.getByTestId('statistics')).toBeVisible();
  await page.getByRole('button', { name: 'Lock now' }).click();
  await expect(page.getByTestId('manager-lock')).toBeVisible();
  await page.keyboard.type('5678');
  await expect(page.getByTestId('manager-lock')).toBeVisible();
  await page.keyboard.type('2468');
  await expect(page.getByTestId('statistics')).toBeVisible();
});
