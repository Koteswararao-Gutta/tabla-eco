import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { openScreen } from './helpers';

// Double taps in the manager's Catering: a second tap must never act twice or land on the next screen.

test.setTimeout(60_000);

async function phone(browser: import('@playwright/test').Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await context.addInitScript(() => {
    if (localStorage.getItem('tabla:singletons')) return;
    // Closed every day, so no alarm gets in the way.
    const days = Array.from({ length: 7 }, () => ({ closed: true }));
    localStorage.setItem('tabla:singletons', JSON.stringify({ staffConfig: { id: 'staffConfig', settings: { days } } }));
  });
  const page = await openScreen(context, '/manager/catering');
  await expect(page.getByTestId('order-card').first()).toBeVisible();
  return { context, page };
}

test('a double tap on Paste message reads the copied message once', async ({ browser }) => {
  const { context, page } = await phone(browser);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  // Count clipboard reads: each one starts a read of the message (on the live app, a paid call).
  await page.evaluate(() => {
    const w = window as unknown as { reads: number };
    w.reads = 0;
    const readText = navigator.clipboard.readText.bind(navigator.clipboard);
    navigator.clipboard.readText = () => (w.reads++, readText());
    const read = navigator.clipboard.read.bind(navigator.clipboard);
    navigator.clipboard.read = () => (w.reads++, read());
  });
  await page.evaluate(() => navigator.clipboard.writeText('2 full tray chicken biryani, 50 pcs samosa, Saturday 6 pm. Ramesh 480-555-0199'));
  await page.getByRole('button', { name: '+ New order' }).click();
  const sheet = page.getByRole('dialog', { name: 'New order' });
  await sheet.getByRole('button', { name: 'Paste message' }).dblclick();
  await expect(sheet.getByText('Filled in from the message.')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { reads: number }).reads)).toBe(1);
  await context.close();
});

/** Adds one open order for today (5 PM) with an amount, and reloads. */
async function addOrder(page: Page, id: string, name: string, deposit = false) {
  await page.evaluate(
    ([id, name, deposit]) => {
      const due = new Date();
      due.setHours(17, 0, 0, 0);
      const orders = JSON.parse(localStorage.getItem('tabla:orders') || '{}');
      orders[id] = { id, customerName: name, phone: '480 555 0101', dueAt: due.getTime(), type: 'pickup', items: 'Samosa, 40', status: 'open', createdAt: 1, updatedAt: 1 };
      localStorage.setItem('tabla:orders', JSON.stringify(orders));
      const amounts = JSON.parse(localStorage.getItem('tabla:orderAmounts') || '{}');
      amounts[id] = { id, amount: 300, paid: false, itemsAt: 'Samosa, 40', updatedAt: 1, ...(deposit ? { deposits: [{ amount: 50, method: 'cash', takenBy: 'Tarun', at: 1 }] } : {}) };
      localStorage.setItem('tabla:orderAmounts', JSON.stringify(amounts));
    },
    [id, name, deposit] as const,
  );
  await page.reload();
  await expect(page.getByTestId('order-card').filter({ hasText: name })).toBeVisible();
}

test('a double tap on Mark completed, Mark paid or Remove acts once and never taps what shows next', async ({ browser }) => {
  const { context, page } = await phone(browser);
  await addOrder(page, 'tapA', 'Double Tap One');
  await addOrder(page, 'tapB', 'Double Tap Two', true);
  const card = (name: string) => page.getByTestId('order-card').filter({ hasText: name });
  const amountOf = (id: string) => page.evaluate((id) => JSON.parse(localStorage.getItem('tabla:orderAmounts')!)[id], id);

  // Mark completed: the sheet closes and the second tap doesn't open the order card now under the finger.
  await card('Double Tap One').click();
  await page.getByRole('dialog').getByRole('button', { name: '✓ Mark completed' }).dblclick();
  await expect(page.locator('.c-toast')).toContainText('Marked completed');
  await page.waitForTimeout(500);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('.c-toast').getByRole('button', { name: 'Undo' }).click();

  // Mark paid: back on the order, the second tap doesn't follow "Share to WhatsApp" or "Cancel order".
  await card('Double Tap One').click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'Mark paid' }).click();
  await sheet.getByRole('button', { name: 'Cash' }).click();
  await sheet.locator('select').selectOption({ index: 1 });
  const popups: Page[] = [];
  context.on('page', (p) => popups.push(p));
  await sheet.getByRole('button', { name: '✓ Mark paid' }).dblclick();
  await expect(sheet.getByTestId('paid-row')).toBeVisible();
  await page.waitForTimeout(300);
  expect(popups).toHaveLength(0);
  await expect(sheet.getByTestId('order-summary')).toBeVisible();
  expect(((await amountOf('tapA')).log as { kind: string }[]).filter((e) => e.kind === 'paid')).toHaveLength(1);
  // "Undo" on the payment asks for a second tap; a double tap is not that second tap.
  await page.waitForTimeout(500);
  await sheet.getByTestId('paid-row').getByRole('button', { name: 'Undo' }).dblclick();
  await expect(sheet.getByTestId('paid-row').getByRole('button')).toHaveText('Tap to undo');
  await page.waitForTimeout(500);
  await sheet.getByTestId('paid-row').getByRole('button').click();
  await expect(sheet.getByTestId('paid-row')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500); // taps right after a save are ignored

  // Remove deposit: a double tap only arms it.
  await card('Double Tap Two').click();
  await sheet.getByTestId('payments').getByRole('button', { name: 'Remove' }).dblclick();
  await expect(sheet.getByTestId('payments').getByRole('button')).toHaveText('Tap to remove');
  expect((await amountOf('tapB')).deposits).toHaveLength(1);
  await context.close();
});
