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
    const read = navigator.clipboard.readText.bind(navigator.clipboard);
    navigator.clipboard.readText = () => (w.reads++, read());
  });
  await page.evaluate(() => navigator.clipboard.writeText('2 full tray chicken biryani, 50 pcs samosa, Saturday 6 pm. Ramesh 480-555-0199'));
  await page.getByRole('button', { name: '+ New order' }).click();
  const sheet = page.getByRole('dialog', { name: 'New order' });
  await sheet.getByRole('button', { name: 'Paste message' }).dblclick();
  await expect(sheet.getByText('Filled in from the message.')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { reads: number }).reads)).toBe(1);
  await context.close();
});
