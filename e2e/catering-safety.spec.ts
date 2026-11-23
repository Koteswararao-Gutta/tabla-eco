// Catering safety: cancelled orders, soft delete, the add-only payment log, the price check and the duplicate warning.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { openScreen, readCollection } from './helpers';
import type { CateringEstimate, CateringOrder, OrderAmount } from '../src/shared/data/types';

const SHOTS = process.env.SHOT_DIR || 'test-results/catering-safety-shots';
const shot = (p: Page, name: string) => p.screenshot({ path: `${SHOTS}/${name}.png` });

test.setTimeout(90_000);

/** Staff hours closed every day, so the kitchen's full-screen alarm never covers the test (see catering-kitchen.spec). */
async function newContext(browser: Browser) {
  const context = await browser.newContext({ deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    if (localStorage.getItem('tabla:singletons')) return;
    const days = Array.from({ length: 7 }, () => ({ closed: true }));
    localStorage.setItem('tabla:singletons', JSON.stringify({ staffConfig: { id: 'staffConfig', settings: { days } } }));
  });
  return context;
}

async function typePin(kitchen: Page, pin: string) {
  for (const d of pin) await kitchen.getByRole('button', { name: d, exact: true }).click();
}

const dateInput = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function phone(page: Page) {
  const p = await openScreen(page.context(), '/manager/catering');
  await p.setViewportSize({ width: 390, height: 844 });
  return p;
}

test('cancel an order: off the kitchen and the totals, deposit and refund note stay in Payments, Reopen undoes it', async ({ browser }) => {
  const context = await newContext(browser);
  const kitchen = await openScreen(context, '/kitchen');
  await kitchen.setViewportSize({ width: 1280, height: 800 });
  const manager = await phone(kitchen);
  await typePin(kitchen, '1234');
  await expect(kitchen.getByRole('article', { name: 'Order for Priya Sharma' })).toBeVisible();

  // Amount $400, then a $100 deposit.
  const card = manager.getByTestId('order-card').filter({ hasText: 'Priya Sharma' });
  await card.click();
  const details = manager.getByRole('dialog', { name: 'Order details' });
  await details.getByRole('button', { name: 'Edit' }).click();
  const edit = manager.getByRole('dialog', { name: 'Edit order' });
  await edit.getByLabel('Amount $ (optional)').fill('400');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await card.click();
  await details.getByRole('button', { name: 'Mark paid', exact: true }).click();
  const pay = manager.getByRole('dialog', { name: 'Mark paid' });
  await pay.getByRole('button', { name: 'Deposit' }).click();
  await pay.getByTestId('deposit-input').fill('100');
  await pay.getByRole('button', { name: 'Zelle' }).click();
  await pay.getByLabel('Taken by').selectOption('Tarun');
  await pay.getByRole('button', { name: 'Save deposit' }).click();
  await expect(details.getByTestId('pay-history')).toContainText('Deposit $100 · Zelle · Tarun');
  await expect(details.getByTestId('pay-history')).toContainText('Amount set to $400');

  // Cancel, with a refund note.
  await details.getByTestId('cancel-order').click();
  const cancel = manager.getByRole('dialog', { name: 'Cancel this order?' });
  await expect(cancel).toContainText('$100 was already paid');
  await cancel.getByTestId('refund-note-input').fill('Refunded $100 by Zelle');
  await manager.waitForTimeout(300);
  await shot(manager, 'cancel-sheet');
  await cancel.getByTestId('confirm-cancel').click();
  await expect(details.getByTestId('cancelled-badge')).toBeVisible();
  await expect(details.getByTestId('refund-note')).toContainText('Refunded $100 by Zelle');
  await expect(details.getByTestId('pay-history')).toContainText('Order cancelled ($100 paid so far)');
  await expect(details.getByRole('button', { name: 'Mark paid', exact: true })).toHaveCount(0);
  await manager.waitForTimeout(300);
  await shot(manager, 'cancelled-details');
  await details.getByRole('button', { name: 'Close' }).click();

  // Gone from the open list and the kitchen; under History with a Cancelled badge.
  await expect(card).toHaveCount(0);
  await expect(kitchen.getByRole('article', { name: 'Order for Priya Sharma' })).toHaveCount(0);
  await kitchen.getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(kitchen.getByTestId('kitchen-calendar')).toBeVisible();
  await expect(kitchen.locator('body')).not.toContainText('Priya Sharma');
  await kitchen.getByRole('button', { name: 'Prep', exact: true }).click();
  await expect(kitchen.locator('body')).not.toContainText('Priya Sharma');
  await kitchen.getByRole('button', { name: 'List', exact: true }).click();
  await manager.getByRole('button', { name: /History/ }).click();
  const hist = manager.getByRole('region', { name: 'History' }).getByTestId('order-card').filter({ hasText: 'Priya Sharma' });
  await expect(hist.getByTestId('cancelled-badge')).toHaveText('Cancelled');
  await expect(hist).toContainText('$100 paid');
  await shot(manager, 'cancelled-in-history');
  await expect(manager.getByTestId('unpaid-filter')).toContainText('Unpaid1'); // only Rahul Verma, not the cancelled one

  // The log keeps every step, in order.
  const amt = (await readCollection<OrderAmount & { id: string }>(manager, 'orderAmounts'))[0];
  expect(amt.log!.map((e) => e.kind)).toEqual(['amount', 'deposit', 'cancelled', 'refund']);
  expect(amt).toMatchObject({ amount: 400, refundNote: 'Refunded $100 by Zelle', deposits: [{ amount: 100 }] });
  const order = (await readCollection<CateringOrder>(manager, 'orders')).find((o) => o.customerName === 'Priya Sharma')!;
  expect(order.status).toBe('cancelled');
  expect(typeof order.cancelledAt).toBe('number');

  // Analytics: listed as Cancelled with what was paid and the note, not in any total.
  await manager.goto('/#/manager/more/analytics?r=dates&from=' + dateInput(order.dueAt) + '&to=' + dateInput(order.dueAt));
  await expect(manager.getByTestId('an-sales')).toBeVisible();
  const row = manager.getByTestId('an-list').getByRole('link', { name: /Priya Sharma/ });
  await expect(row).toContainText('Cancelled');
  await expect(row).toContainText('$100 paid');
  await expect(row.getByTestId('refund-line')).toHaveText('Refunded $100 by Zelle');
  await expect(manager.getByText('Cancelled orders are not in any total.')).toBeVisible();
  await shot(manager, 'analytics-cancelled');

  // Reopen brings it back everywhere.
  await manager.goto('/#/manager/catering');
  await manager.getByRole('button', { name: /History/ }).click();
  await manager.getByRole('region', { name: 'History' }).getByTestId('order-card').filter({ hasText: 'Priya Sharma' }).click();
  await details.getByRole('button', { name: 'Reopen' }).click();
  await expect(manager.getByTestId('order-card').filter({ hasText: 'Priya Sharma' })).toBeVisible();
  await expect(kitchen.getByRole('article', { name: 'Order for Priya Sharma' })).toBeVisible();
  const reopened = (await readCollection<CateringOrder>(manager, 'orders')).find((o) => o.customerName === 'Priya Sharma')!;
  expect([reopened.status, reopened.cancelledAt]).toEqual(['open', null]);
  await context.close();
});

test('payment log is add-only: removing a deposit and "not paid" are recorded, never erased', async ({ browser }) => {
  const context = await newContext(browser);
  const manager = await openScreen(context, '/manager/catering');
  await manager.setViewportSize({ width: 390, height: 844 });
  await manager.getByTestId('unpaid-filter').click();
  const card = manager.getByRole('region', { name: 'Unpaid' }).getByRole('button', { name: /Rahul Verma/ });
  await card.click();
  const details = manager.getByRole('dialog', { name: 'Order details' });
  await details.getByRole('button', { name: 'Edit' }).click();
  await manager.getByRole('dialog', { name: 'Edit order' }).getByLabel('Amount $ (optional)').fill('300');
  await manager.getByRole('dialog', { name: 'Edit order' }).getByRole('button', { name: 'Save changes' }).click();
  await card.click();
  const pay = manager.getByRole('dialog', { name: 'Mark paid' });
  // A deposit, then remove it.
  await details.getByRole('button', { name: 'Mark paid', exact: true }).click();
  await pay.getByRole('button', { name: 'Deposit' }).click();
  await pay.getByTestId('deposit-input').fill('50');
  await pay.getByRole('button', { name: 'Cash' }).click();
  await pay.getByLabel('Taken by').selectOption('Siri');
  await pay.getByRole('button', { name: 'Save deposit' }).click();
  await details.getByTestId('payments').getByRole('button', { name: 'Remove' }).click();
  await details.getByTestId('payments').getByRole('button', { name: 'Tap to remove' }).click();
  await expect(details.getByTestId('pay-history')).toContainText('Deposit $50 removed · Cash · Siri');
  // Paid in full, then "not paid".
  await details.getByRole('button', { name: 'Mark paid', exact: true }).click();
  await pay.getByRole('button', { name: 'Card' }).click();
  await pay.getByLabel('Taken by').selectOption('Tarun');
  await pay.getByRole('button', { name: '✓ Mark paid' }).click();
  await details.getByTestId('paid-row').getByRole('button', { name: 'Undo' }).click();
  await details.getByTestId('paid-row').getByRole('button', { name: 'Tap to undo' }).click();
  await expect(details.getByTestId('pay-history')).toContainText('Marked not paid · Card · Tarun');
  await manager.waitForTimeout(300);
  await shot(manager, 'payment-history');
  const amt = (await readCollection<OrderAmount>(manager, 'orderAmounts')).find((a) => a.log?.length)!;
  expect(amt.log!.map((e) => e.kind)).toEqual(['amount', 'deposit', 'depositRemoved', 'paid', 'unpaid']);
  expect(amt.log![3]).toMatchObject({ kind: 'paid', amount: 300, method: 'card', takenBy: 'Tarun' });
  expect(amt).toMatchObject({ paid: false, deposits: [] });
  await context.close();
});

test('price check: changed items after the amount was set ask to check it; "Price is right" clears it', async ({ browser }) => {
  const context = await newContext(browser);
  const manager = await openScreen(context, '/manager/catering');
  await manager.setViewportSize({ width: 390, height: 844 });
  const card = manager.getByTestId('order-card').filter({ hasText: 'Desert Tech office' });
  const details = manager.getByRole('dialog', { name: 'Order details' });
  const edit = manager.getByRole('dialog', { name: 'Edit order' });
  // Old orders (amount without itemsAt) never warn.
  await expect(card.getByTestId('price-drift')).toHaveCount(0);
  await card.click();
  await details.getByRole('button', { name: 'Edit' }).click();
  await edit.getByLabel('Amount $ (optional)').fill('350');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(card.getByTestId('price-drift')).toHaveCount(0);
  const saved = (await readCollection<OrderAmount>(manager, 'orderAmounts')).find((a) => a.log?.length)!;
  const order = (await readCollection<CateringOrder>(manager, 'orders')).find((o) => o.customerName === 'Desert Tech office')!;
  expect(saved.itemsAt).toBe(order.items);

  // Change an item's quantity: the card and the details say so.
  await card.click();
  await details.getByRole('button', { name: 'Edit' }).click();
  await edit.getByLabel('Item 1 quantity').fill('3');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(card.getByTestId('price-drift')).toHaveText('Items changed since the price was set. Check the amount.');
  await shot(manager, 'price-drift-card');
  await card.click();
  await expect(details.getByTestId('price-drift')).toBeVisible();
  await manager.waitForTimeout(300);
  await shot(manager, 'price-drift-details');
  await details.getByRole('button', { name: 'Price is right' }).click();
  await expect(details.getByTestId('price-drift')).toHaveCount(0);
  await details.getByRole('button', { name: 'Close' }).click();
  await expect(card.getByTestId('price-drift')).toHaveCount(0);
  const after = (await readCollection<OrderAmount>(manager, 'orderAmounts')).find((a) => a.log?.length)!;
  expect(after.log!.map((e) => e.kind)).toEqual(['amount', 'amount']);
  await context.close();
});

test('duplicate warning: a new order for a phone that already has one that day asks first', async ({ browser }) => {
  const context = await newContext(browser);
  const manager = await openScreen(context, '/manager/catering');
  await manager.setViewportSize({ width: 390, height: 844 });
  await expect(manager.getByTestId('order-card').first()).toBeVisible();
  const priya = (await readCollection<CateringOrder>(manager, 'orders')).find((o) => o.customerName === 'Priya Sharma')!;
  await manager.getByRole('button', { name: '+ New order' }).click();
  const sheet = manager.getByRole('dialog', { name: 'New order' });
  await sheet.getByLabel('Customer name').fill('Priya S');
  await sheet.getByLabel('Phone').fill('(555) 123-4567');
  await sheet.getByLabel('Date').fill(dateInput(priya.dueAt));
  await sheet.getByLabel('Time').fill('19:00');
  await sheet.getByLabel('Item 1 dish').fill('Samosa');
  await sheet.getByLabel('Item 1 quantity').fill('20');
  await sheet.getByRole('button', { name: 'Save order' }).click();
  const warn = sheet.getByTestId('duplicate-warning');
  await expect(warn).toContainText("There's already an order for this phone on this day: Priya Sharma, 5:30 PM. Save anyway?");
  await manager.waitForTimeout(300);
  await shot(manager, 'duplicate-warning');
  // Go back: the form is still filled in, nothing saved.
  await warn.getByRole('button', { name: 'Go back' }).click();
  await expect(sheet.getByLabel('Customer name')).toHaveValue('Priya S');
  expect((await readCollection<CateringOrder>(manager, 'orders')).some((o) => o.customerName === 'Priya S')).toBe(false);
  // Save anyway saves it once.
  await sheet.getByRole('button', { name: 'Save order' }).click();
  await warn.getByRole('button', { name: 'Save anyway' }).click();
  await expect(manager.getByTestId('order-saved')).toBeVisible();
  expect((await readCollection<CateringOrder>(manager, 'orders')).filter((o) => o.customerName === 'Priya S')).toHaveLength(1);
  await context.close();
});

test('deleting an estimate hides it (still in the database), with Undo', async ({ browser }) => {
  const context = await newContext(browser);
  const manager = await openScreen(context, '/manager/catering');
  await manager.setViewportSize({ width: 390, height: 844 });
  await manager.getByTestId('estimates-filter').click();
  await manager.getByRole('button', { name: '+ Estimate' }).click();
  const sheet = manager.getByRole('dialog', { name: 'New estimate' });
  await sheet.getByLabel('Customer name').fill('Test Quote');
  await sheet.getByLabel('Item 1 dish').fill('Veg Dum Biryani');
  await sheet.getByLabel('Item 1 quantity').fill('1');
  await sheet.getByLabel('Item 1 unit').selectOption('Full tray');
  await sheet.getByRole('button', { name: 'Save estimate' }).click();
  const summary = manager.getByRole('dialog', { name: 'Estimate' });
  await summary.getByRole('button', { name: 'Delete' }).click();
  await expect(summary).toContainText('Delete this estimate? It goes off the list.');
  await summary.getByRole('button', { name: 'Delete', exact: true }).last().click();
  const toast = manager.getByRole('status').filter({ hasText: 'Estimate deleted: Test Quote' });
  await expect(toast).toBeVisible();
  await expect(manager.getByTestId('estimate-card').filter({ hasText: 'Test Quote' })).toHaveCount(0);
  const kept = (await readCollection<CateringEstimate>(manager, 'estimates')).find((e) => e.customerName === 'Test Quote');
  expect(typeof kept?.deletedAt).toBe('number');
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(manager.getByTestId('estimate-card').filter({ hasText: 'Test Quote' })).toBeVisible();
  await context.close();
});
