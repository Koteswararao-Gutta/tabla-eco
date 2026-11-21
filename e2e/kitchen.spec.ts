// Kitchen tablet: card address, one "soon" rule, the Calendar order sheet's buttons, and the offline strip.
import { expect, test } from '@playwright/test';

test('kitchen card: plain address, orange border only with the countdown; sheet buttons first; offline strip above the bar', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    if (localStorage.getItem('tabla:singletons')) return;
    // Closed every day, so the full-screen alarm stays off.
    const days = Array.from({ length: 7 }, () => ({ closed: true }));
    localStorage.setItem('tabla:singletons', JSON.stringify({ staffConfig: { id: 'staffConfig', settings: { days } } }));
  });
  const page = await context.newPage();
  await page.goto('/#/kitchen');
  await expect(page.getByText('Enter the 4-digit PIN')).toBeVisible();
  await page.evaluate(() => {
    const now = Date.now();
    const o = (id: string, name: string, inMin: number, extra = {}) => ({ id, customerName: name, phone: '555', type: 'pickup', items: 'Samosa, 20', status: 'open', createdAt: now, updatedAt: now, dueAt: now + inMin * 60_000, kitchenAckFor: now + inMin * 60_000, ...extra });
    const items = Array.from({ length: 14 }, (_, i) => `Dish ${i + 1}, ${i + 1} full trays`).join('\n');
    localStorage.setItem('tabla:orders', JSON.stringify({
      a: o('a', 'Soon Order', 30),
      b: o('b', 'Later Order', 90, { type: 'delivery', address: '1 Main St, Tempe', items }),
    }));
  });
  await page.reload();
  for (const d of '1234') await page.getByRole('button', { name: d, exact: true }).click();
  const soon = page.getByRole('article', { name: 'Order for Soon Order' });
  const later = page.getByRole('article', { name: 'Order for Later Order' });
  await expect(soon).toHaveClass(/\bsoon\b/);
  await expect(later).not.toHaveClass(/\bsoon\b/); // 1 h 30 min away: no countdown, no orange border

  // The address is plain text: no Copy button, and a tap on it opens the options like the rest of the card.
  await expect(later.getByRole('button')).toHaveCount(0);
  await later.getByText('1 Main St, Tempe').click();
  const options = page.getByRole('dialog', { name: 'Later Order' });
  await expect(options.getByRole('button', { name: /Mark completed/ })).toBeVisible();
  await page.keyboard.press('Escape');

  // Calendar: a long order's sheet keeps its buttons on screen, above the details (which keep Copy address).
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await page.getByTestId('kitchen-cal-row').filter({ hasText: 'Later Order' }).click();
  const full = page.getByRole('dialog', { name: 'Later Order' });
  const btn = (await full.getByRole('button', { name: /Mark completed/ }).boundingBox())!;
  const details = (await full.getByTestId('kitchen-order-details').boundingBox())!;
  expect(btn.y).toBeLessThan(details.y);
  expect(btn.y + btn.height).toBeLessThanOrEqual(800);
  await page.keyboard.press('Escape');

  // Offline: a readable strip above the top bar, not on top of it.
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  const notice = page.getByTestId('kitchen-notice');
  await expect(notice).toBeVisible();
  const n = (await notice.boundingBox())!;
  const bar = (await page.locator('.k-bar').boundingBox())!;
  expect(n.y + n.height).toBeLessThanOrEqual(bar.y + 1);
  await expect(notice).toHaveCSS('font-size', '17.6px'); // 1.1rem (was 0.85rem)
  await context.close();
});
