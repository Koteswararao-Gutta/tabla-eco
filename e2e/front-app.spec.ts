import { expect, test } from '@playwright/test';
import { openScreen } from './helpers';

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });

const SHOTS = process.env.SHOT_DIR || 'test-results';

test('front app: Catering and Screens (look only); no Staff, no ☰, no PIN', async ({ context }) => {
  const page = await openScreen(context, '/front');
  await expect(page).toHaveURL(/#\/front\/catering$/);
  await expect(page.getByRole('link', { name: 'Catering', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Staff', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'More' })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/front-catering.png` });

  // Front staff take payments: Mark paid works, and "Taken by" lists the staff from the Staff tab.
  await page.getByRole('region', { name: 'Done, not paid' }).getByRole('button', { name: /Rahul Verma/ }).click();
  const details = page.getByRole('dialog', { name: 'Order details' });
  await details.getByRole('button', { name: '💵 Mark paid' }).click();
  const pay = page.getByRole('dialog', { name: 'Mark paid' });
  await pay.getByLabel('Taken by').selectOption('Tarun');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Staff and More links typed by hand go back to Catering.
  await page.goto(page.url().replace(/#.*/, '#/front/staff'));
  await expect(page).toHaveURL(/#\/front\/catering$/);

  await page.getByRole('link', { name: 'Screens', exact: true }).click();
  await expect(page.getByText('Only the manager app can change them.')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/front-screens.png` });

  await page.getByTestId('tile-tv1').click();
  await expect(page).toHaveURL(/#\/front\/screens\/tv1$/);
  await expect(page.getByTestId('view-only')).toBeVisible();
  await expect(page.getByTestId('slot').first()).toBeVisible();
  // Nothing to change: no add buttons, no picture options, no timing buttons.
  await expect(page.getByRole('button')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/front-tv1.png`, fullPage: true });

  // A mirror TV says what it mirrors, with no switch.
  await page.getByRole('link', { name: '‹ Screens' }).click();
  await page.getByTestId('tile-tv3').click();
  await expect(page.getByTestId('mirror-note')).toHaveText(/same pictures as TV 1/);
  await expect(page.getByRole('switch')).toHaveCount(0);

  // The kitchen tile can't change the kitchen PIN here.
  await page.getByRole('link', { name: '‹ Screens' }).click();
  await page.getByTestId('tile-kitchen').click();
  await expect(page.getByTestId('view-only')).toBeVisible();
  await expect(page.getByTestId('current-pin')).toHaveCount(0);
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
