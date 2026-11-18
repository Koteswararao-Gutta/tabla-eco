import { expect, test, type Page } from '@playwright/test';
import { openScreen, readCollection } from './helpers';
import type { CateringOrder } from '../src/shared/data/types';

// Screenshots for the eye check. Override with SHOT_DIR.
const SHOTS = process.env.SHOT_DIR || 'test-results/catering-kitchen-shots';
const shot = (p: Page, name: string) => p.screenshot({ path: `${SHOTS}/${name}.png` });

async function typePin(kitchen: Page, pin: string) {
  for (const d of pin) await kitchen.getByRole('button', { name: d, exact: true }).click();
}

test.setTimeout(60_000);

test('manager adds an order, kitchen sees it live, completes, undoes and reopens', async ({ browser }) => {
  const context = await browser.newContext({ deviceScaleFactor: 1 });
  const manager = await openScreen(context, '/manager/catering');
  await manager.setViewportSize({ width: 390, height: 844 });
  const kitchen = await openScreen(context, '/kitchen');
  await kitchen.setViewportSize({ width: 1280, height: 800 });

  // Manager list shows the sample orders.
  await expect(manager.getByRole('heading', { name: 'Catering' })).toBeVisible();
  await expect(manager.getByText('Priya Sharma')).toBeVisible();
  await expect(manager.getByText('Rahul Verma')).toHaveCount(0); // completed: only in History
  await shot(manager, 'manager-list');

  // Kitchen: PIN first. Wrong PIN is rejected, 1234 unlocks.
  await expect(kitchen.getByText('Enter the 4-digit PIN')).toBeVisible();
  await shot(kitchen, 'kitchen-pin');
  await typePin(kitchen, '9999');
  await expect(kitchen.getByText("That PIN didn't work")).toBeVisible();
  await expect(kitchen.getByRole('heading', { name: 'Open orders' })).toHaveCount(0);
  await typePin(kitchen, '1234');
  await expect(kitchen.getByRole('heading', { name: 'Open orders' })).toBeVisible();
  await expect(kitchen.getByTestId('kitchen-order')).toHaveCount(2);

  // New order: required fields, then delivery needs an address.
  await manager.getByRole('button', { name: '+ New order' }).click();
  const sheet = manager.getByRole('dialog', { name: 'New order' });
  await sheet.getByRole('button', { name: 'Save order' }).click();
  await expect(sheet.getByText("Please enter the customer's name.")).toBeVisible();
  await expect(sheet.getByText('Please add at least one item.')).toBeVisible();
  await shot(manager, 'manager-new-order-errors');
  const tomorrow = await manager.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  await sheet.getByLabel('Customer name').fill('Anika Wedding');
  await sheet.getByLabel('Phone').fill('555 222 3333');
  await sheet.getByLabel('Date').fill(tomorrow);
  await sheet.getByLabel('Time').fill('13:30');
  await sheet.getByRole('button', { name: 'Delivery' }).click();
  await sheet.getByLabel('Number of people (optional)').fill('120');
  await sheet.getByLabel('Order items (one per line)').fill('Chicken dum biryani, 4 large trays\nPaneer butter masala, 2 trays\nGarlic naan, 150');
  await sheet.getByLabel('Notes (optional)').fill('Set up by 1 PM');
  await sheet.getByRole('button', { name: 'Save order' }).click();
  await expect(sheet.getByText('Please enter the delivery address.')).toBeVisible();
  await shot(manager, 'manager-new-order-form');
  await sheet.getByLabel('Delivery address').fill('48 Lake View Rd, Hall B');
  await sheet.getByRole('button', { name: 'Save order' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(manager.getByRole('region', { name: 'Tomorrow' }).getByText('Anika Wedding')).toBeVisible();

  const saved = (await readCollection<CateringOrder>(manager, 'orders')).find((o) => o.customerName === 'Anika Wedding')!;
  expect(saved).toMatchObject({ status: 'open', type: 'delivery', address: '48 Lake View Rd, Hall B', people: 120, notes: 'Set up by 1 PM' });
  expect(saved.items.split('\n')).toHaveLength(3);

  // Kitchen picks it up by itself.
  const card = kitchen.getByRole('article', { name: 'Order for Anika Wedding' });
  await expect(card).toBeVisible();
  await expect(card.getByText('48 Lake View Rd, Hall B')).toBeVisible();
  await expect(card.getByText('Garlic naan, 150')).toBeVisible();
  await expect(card.getByText(/^in /)).toBeVisible();
  await shot(kitchen, 'kitchen-open-orders');

  // Mark completed: card goes, Undo brings it back.
  await card.getByRole('button', { name: 'Mark completed' }).click();
  await expect(card).toHaveCount(0);
  await kitchen.getByRole('button', { name: 'Undo' }).click();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Mark completed' }).click();
  await expect(card).toHaveCount(0);
  await expect(kitchen.getByRole('button', { name: 'Undo' })).toBeHidden({ timeout: 9000 });

  // Show all orders: ticked as completed, and it can be reopened.
  await kitchen.getByRole('button', { name: 'Show all orders' }).click();
  const row = kitchen.getByTestId('kitchen-row').filter({ hasText: 'Anika Wedding' });
  await expect(row).toContainText('✓ Completed');
  await expect(kitchen.getByTestId('kitchen-row').filter({ hasText: 'Rahul Verma' })).toContainText('✓ Completed');
  await shot(kitchen, 'kitchen-show-all');
  await row.getByRole('button', { name: 'Reopen' }).click();
  await expect(row).toContainText('Open');
  await kitchen.getByRole('button', { name: '← Back to open orders' }).click();
  await expect(card).toBeVisible();

  // The manager sees the kitchen's change and can complete / delete from the edit sheet.
  await manager.getByRole('button', { name: /Anika Wedding/ }).click();
  const edit = manager.getByRole('dialog', { name: 'Edit order' });
  await expect(edit.getByLabel('Delivery address')).toHaveValue('48 Lake View Rd, Hall B');
  await edit.getByRole('button', { name: 'Mark completed' }).click();
  await expect(card).toHaveCount(0);
  await manager.getByRole('button', { name: /History/ }).click();
  await manager.getByRole('region', { name: 'History' }).getByRole('button', { name: /Anika Wedding/ }).click();
  await manager.getByRole('dialog', { name: 'Edit order' }).getByRole('button', { name: 'Delete' }).click();
  await manager.getByRole('dialog', { name: 'Delete this order?' }).getByRole('button', { name: 'Delete order' }).click();
  await expect(manager.getByText('Anika Wedding')).toHaveCount(0);
  expect((await readCollection<CateringOrder>(manager, 'orders')).some((o) => o.customerName === 'Anika Wedding')).toBe(false);

  await context.close();
});

test('kitchen PIN stays in memory only: a reload locks it again', async ({ browser }) => {
  const context = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1024, height: 768 } });
  const kitchen = await openScreen(context, '/kitchen');
  await typePin(kitchen, '1234');
  await expect(kitchen.getByRole('heading', { name: 'Open orders' })).toBeVisible();
  await shot(kitchen, 'kitchen-1024');
  await kitchen.reload();
  await expect(kitchen.getByText('Enter the 4-digit PIN')).toBeVisible();
  await context.close();
});

test('saving an edit never undoes a completion made in the kitchen meanwhile', async ({ browser }) => {
  const context = await browser.newContext({ deviceScaleFactor: 1 });
  const manager = await openScreen(context, '/manager/catering');
  await manager.setViewportSize({ width: 390, height: 844 });
  const kitchen = await openScreen(context, '/kitchen');
  await kitchen.setViewportSize({ width: 1280, height: 800 });
  await typePin(kitchen, '1234');

  // Manager opens the edit sheet...
  await manager.getByRole('button', { name: /Desert Tech office/ }).click();
  const edit = manager.getByRole('dialog', { name: 'Edit order' });
  await expect(edit.getByRole('button', { name: 'Mark completed' })).toBeVisible();

  // ...the kitchen completes the order while it is open...
  await kitchen.getByRole('article', { name: 'Order for Desert Tech office' }).getByRole('button', { name: 'Mark completed' }).click();
  await expect(edit.getByRole('button', { name: 'Reopen' })).toBeVisible(); // the sheet shows the live status

  // ...and saving the edit keeps it completed.
  await edit.getByLabel('Notes (optional)').fill('Call when outside, gate code 42');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toHaveCount(0);
  const o = (await readCollection<CateringOrder>(manager, 'orders')).find((x) => x.customerName === 'Desert Tech office')!;
  expect(o.status).toBe('completed');
  expect(o.completedAt).toEqual(expect.any(Number));
  expect(o.notes).toBe('Call when outside, gate code 42');
  await expect(kitchen.getByRole('article', { name: 'Order for Desert Tech office' })).toHaveCount(0);
  await context.close();
});
