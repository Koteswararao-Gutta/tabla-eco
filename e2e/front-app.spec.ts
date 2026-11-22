import { expect, test } from '@playwright/test';
import { openScreen } from './helpers';

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });

const SHOTS = process.env.SHOT_DIR || 'test-results';

test('front app: Catering only, no tab bar; no Screens, no Staff, no ☰, no PIN', async ({ context }) => {
  const page = await openScreen(context, '/front');
  await expect(page).toHaveURL(/#\/front\/catering$/);
  // Catering only, so no tab bar at the bottom.
  await expect(page.getByRole('heading', { name: 'Catering' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Catering', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Staff', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'More' })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/front-catering.png` });

  // Front staff take payments: Mark paid works, and "Taken by" lists the staff from the Staff tab.
  await page.getByTestId('unpaid-filter').click();
  await page.getByRole('region', { name: 'Unpaid' }).getByRole('button', { name: /Rahul Verma/ }).click();
  const details = page.getByRole('dialog', { name: 'Order details' });
  await details.getByRole('button', { name: 'Mark paid', exact: true }).click();
  const pay = page.getByRole('dialog', { name: 'Mark paid' });
  await pay.getByLabel('Taken by').selectOption('Tarun');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Staff links typed by hand go back to Catering.
  await page.goto(page.url().replace(/#.*/, '#/front/staff'));
  await expect(page).toHaveURL(/#\/front\/catering$/);

  // No Screens: no tab, and a typed Screens link goes back to Catering too.
  await expect(page.getByRole('link', { name: 'Screens', exact: true })).toHaveCount(0);
  await page.goto(page.url().replace(/#.*/, '#/front/screens/tv1'));
  await expect(page).toHaveURL(/#\/front\/catering$/);
});

test('manager app: every tab opens with no PIN', async ({ context }) => {
  const page = await openScreen(context, '/manager/catering');
  await page.getByRole('link', { name: 'Screens', exact: true }).click();
  await expect(page.getByTestId('tile-tv1')).toBeVisible();
  await page.getByTestId('tile-tv1').click();
  await expect(page.getByTestId('view-only')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Add a picture between|Add a picture at the end|Picture 1: options/ }).first()).toBeVisible();

  await page.getByRole('link', { name: 'Staff', exact: true }).click();
  await expect(page.getByTestId('staff-planner')).toBeVisible();

  await page.getByRole('link', { name: 'More' }).click();
  await expect(page.getByTestId('statistics')).toBeVisible();
  await expect(page.getByText('Manager PIN')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/manager-more.png` });
});

test('↻ Refresh reloads the app in place: front, manager and kitchen', async ({ context }) => {
  for (const path of ['/front/catering', '/manager/catering']) {
    const page = await openScreen(context, path);
    await expect(page.getByRole('heading', { name: 'Catering' })).toBeVisible();
    const marker = await page.evaluate(() => ((window as unknown as { refreshMarker: number }).refreshMarker = 1));
    expect(marker).toBe(1);
    await page.getByRole('button', { name: 'Refresh' }).click();
    await page.waitForFunction(() => !(window as unknown as { refreshMarker?: number }).refreshMarker);
    await expect(page).toHaveURL(new RegExp('#' + path + '$'));
    await expect(page.getByRole('heading', { name: 'Catering' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/refresh-${path.split('/')[1]}.png` });
    await page.close();
  }

  const page = await openScreen(context, '/kitchen');
  for (const d of '1234') await page.getByRole('button', { name: d, exact: true }).click();
  await page.evaluate(() => ((window as unknown as { refreshMarker: number }).refreshMarker = 1));
  await page.getByRole('button', { name: 'Refresh' }).click();
  await page.waitForFunction(() => !(window as unknown as { refreshMarker?: number }).refreshMarker);
  // Still unlocked after the reload.
  await expect(page.getByRole('button', { name: 'Lock' })).toBeVisible();
});
