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
  await expect(biryani).toContainText('Priya Sharma: 2 Full trays');
  await expect(biryani).toContainText('Meera Party: 1 Half tray');
  await expect(kitchen.getByTestId('prep-other').filter({ hasText: 'Birthday cake' })).toContainText('Meera Party');
  await shot(kitchen, 'kitchen-prep-today');

  await kitchen.getByRole('button', { name: 'Next day' }).click();
  await expect(kitchen.locator('.kp-day-label')).toHaveText('Tomorrow');
  await expect(kitchen.getByText('1 open order')).toBeVisible();
  await expect(kitchen.getByTestId('prep-dish').filter({ hasText: 'Butter Chicken' })).toBeVisible();
  await shot(kitchen, 'kitchen-prep-tomorrow');

  await kitchen.getByRole('button', { name: 'Next day' }).click();
  await expect(kitchen.getByText(/No open orders for/)).toBeVisible();

  await kitchen.getByRole('button', { name: '← Back to open orders' }).click();
  await expect(kitchen.getByRole('heading', { name: 'Open orders' })).toBeVisible();
  await shot(kitchen, 'kitchen-open-orders-with-prep');

  // Portrait tablet, in a fresh page (the kitchen goes full screen once touched, so it can't be resized).
  const portrait = await context.newPage();
  await portrait.setViewportSize({ width: 800, height: 1280 });
  await portrait.goto('/#/kitchen');
  await portrait.getByRole('button', { name: 'Prep', exact: true }).click();
  await expect(portrait.locator('.kp-day-label')).toHaveText('Today');
  await shot(portrait, 'kitchen-prep-portrait');
  await context.close();
});
