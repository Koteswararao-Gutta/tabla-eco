import { expect, test, type Page } from '@playwright/test';
import { openScreen } from './helpers';

// Kitchen "Prep": one day's open catering orders, added up by dish and unit.
const SHOTS = process.env.SHOT_DIR || 'test-results/kitchen-prep-shots';
const shot = (p: Page, name: string) => p.screenshot({ path: `${SHOTS}/${name}.png` });

test('kitchen Prep adds up the day’s open orders by dish and unit', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  // Staff hours "closed", so a sample order due within the hour can't cover the screen with the alarm.
  await context.addInitScript(() => {
    if (localStorage.getItem('tabla:singletons')) return;
    const days = Array.from({ length: 7 }, () => ({ closed: true }));
    localStorage.setItem('tabla:singletons', JSON.stringify({ staffConfig: { id: 'staffConfig', settings: { days } } }));
  });
  const kitchen = await openScreen(context, '/kitchen');
  for (const d of '1234') await kitchen.getByRole('button', { name: d, exact: true }).click();
  await expect(kitchen.getByRole('heading', { name: 'Open orders' })).toBeVisible();

  // One more order today, saved the new way (dish picked from the menu), plus a typed-in item.
  await kitchen.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('tabla:orders') || '{}');
    const at = new Date();
    at.setHours(20, 0, 0, 0);
    const lines = [
      // biryani-2 is Chicken Dum Biryani on the sample menu.
      { dishId: 'biryani-2', name: 'Chicken Dum Biryani', qty: 1, unit: 'Half tray', note: '' },
      { dishId: null, name: 'Birthday cake', qty: 1, unit: '', note: '' },
    ];
    t.prepTest = {
      id: 'prepTest', customerName: 'Meera Party', phone: '555 000 1111', dueAt: at.getTime(), type: 'pickup',
      items: 'Chicken Dum Biryani, 1 Half tray\nBirthday cake, 1', lines, status: 'open', createdAt: 0, updatedAt: 0,
    };
    localStorage.setItem('tabla:orders', JSON.stringify(t));
  });
  await kitchen.reload();
  await expect(kitchen.getByRole('heading', { name: 'Open orders' })).toBeVisible();

  await kitchen.getByRole('button', { name: 'Prep', exact: true }).click();
  await expect(kitchen.getByRole('heading', { name: 'Prep' })).toBeVisible();
  await expect(kitchen.locator('.kp-day-label')).toHaveText('Today');
  await expect(kitchen.getByRole('button', { name: 'Day before' })).toBeDisabled();
  await expect(kitchen.getByText('2 open orders')).toBeVisible();
  // The sample order (plain text "2 large trays") and the new one (1 Half tray) add up under one dish.
  const biryani = kitchen.getByTestId('prep-dish').filter({ hasText: 'Chicken Dum Biryani' });
  await expect(biryani.locator('.kp-dish-total')).toHaveText('2 Full trays, 1 Half tray');
  await expect(biryani).toContainText('5:30 PM Priya Sharma: 2 Full trays');
  await expect(biryani).toContainText('8:00 PM Meera Party: 1 Half tray');
  // The order's own note shows at the top, so it isn't lost when dishes are added together.
  await expect(kitchen.getByTestId('prep-note')).toContainText('Priya Sharma: Less spicy');
  await expect(kitchen.getByTestId('prep-other').filter({ hasText: 'Birthday cake' })).toContainText('Meera Party');
  await shot(kitchen, 'kitchen-prep-today');

  await kitchen.getByRole('button', { name: 'Next day' }).click();
  await expect(kitchen.locator('.kp-day-label')).toHaveText('Tomorrow');
  await expect(kitchen.getByText('1 open order')).toBeVisible();
  await expect(kitchen.getByTestId('prep-dish').filter({ hasText: 'Butter Chicken' })).toBeVisible();
  await shot(kitchen, 'kitchen-prep-tomorrow');

  await kitchen.getByRole('button', { name: 'Next day' }).click();
  await expect(kitchen.getByText(/No open orders for/)).toBeVisible();

  // Scrolled down, the day picker stays on screen under the top bar.
  await kitchen.getByRole('button', { name: 'Day before' }).click();
  await kitchen.getByRole('button', { name: 'Day before' }).click();
  await kitchen.locator('.k-root').evaluate((el) => el.scrollTo(0, 400));
  await expect(kitchen.getByRole('button', { name: 'Next day' })).toBeInViewport();

  await kitchen.getByRole('button', { name: 'List', exact: true }).click();
  await expect(kitchen.getByRole('heading', { name: 'Open orders' })).toBeVisible();
  await shot(kitchen, 'kitchen-open-orders-with-prep');

  // Portrait tablet, in a fresh page (the kitchen goes full screen once touched, so it can't be resized).
  const portrait = await context.newPage();
  await portrait.setViewportSize({ width: 800, height: 1280 });
  await portrait.goto('/#/kitchen');
  await portrait.getByRole('button', { name: 'Prep', exact: true }).click();
  await expect(portrait.getByRole('heading', { name: 'Prep' })).toBeVisible();
  await expect(portrait.locator('.kp-day-label')).toHaveText('Today');
  await shot(portrait, 'kitchen-prep-portrait');
  await context.close();
});

test('kitchen Prep goes back to the open orders list after 3 minutes with no touch', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    if (localStorage.getItem('tabla:singletons')) return;
    const days = Array.from({ length: 7 }, () => ({ closed: true }));
    localStorage.setItem('tabla:singletons', JSON.stringify({ staffConfig: { id: 'staffConfig', settings: { days } } }));
  });
  const page = await context.newPage();
  await page.clock.install();
  await page.goto('/#/kitchen');
  for (const d of '1234') await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: 'Prep', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Prep' })).toBeVisible();
  await page.clock.runFor(181_000);
  await expect(page.getByRole('heading', { name: 'Open orders' })).toBeVisible();
  await context.close();
});

test('kitchen Prep keeps the picked day at midnight, and its arrows fit a narrow screen', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    if (localStorage.getItem('tabla:singletons')) return;
    const days = Array.from({ length: 7 }, () => ({ closed: true }));
    localStorage.setItem('tabla:singletons', JSON.stringify({ staffConfig: { id: 'staffConfig', settings: { days } } }));
  });
  const page = await context.newPage();
  const late = new Date();
  late.setHours(23, 59, 0, 0);
  await page.clock.install({ time: late });
  await page.goto('/#/kitchen');
  for (const d of '1234') await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: 'Prep', exact: true }).click();
  const next = page.getByRole('button', { name: 'Next day' });
  expect((await next.boundingBox())!.width).toBeGreaterThanOrEqual(48);
  await next.click();
  await expect(page.locator('.kp-day-label')).toHaveText('Tomorrow');
  const date = await page.locator('.kp-day-date').textContent();
  await page.clock.runFor(2 * 60_000); // under the 3-minute idle return
  // Past midnight the same day is now "Today", not the day after.
  await expect(page.locator('.kp-day-label')).toHaveText('Today');
  await expect(page.locator('.kp-day-date')).toHaveText(date!);
  await shot(page, 'kitchen-prep-phone');
  await context.close();
});
