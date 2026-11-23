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
  // Midday, so "in 90 minutes" is still today in the Calendar whatever time the test runs.
  await page.clock.install({ time: new Date('2026-11-18T12:00:00-07:00') });
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

test('kitchen: a double tap on Mark completed or Reopen acts once and never taps the next card', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    if (localStorage.getItem('tabla:singletons')) return;
    const days = Array.from({ length: 7 }, () => ({ closed: true }));
    localStorage.setItem('tabla:singletons', JSON.stringify({ staffConfig: { id: 'staffConfig', settings: { days } } }));
  });
  const page = await context.newPage();
  // Morning, so the orders later today show no countdown and sit in the Calendar's day list.
  await page.clock.install({ time: new Date('2026-11-18T08:00:00-07:00') });
  await page.goto('/#/kitchen');
  await expect(page.getByText('Enter the 4-digit PIN')).toBeVisible();
  await page.evaluate(() => {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    const at = (h: number) => day.getTime() + h * 3600_000;
    const o = (id: string, name: string, h: number) => ({ id, customerName: name, phone: '555', type: 'pickup', items: 'Samosa, 20', status: 'open', createdAt: 1, updatedAt: 1, dueAt: at(h) });
    // Many cards, so another card sits under the sheet's button.
    localStorage.setItem('tabla:orders', JSON.stringify(Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`k${i}`, o(`k${i}`, `Card ${i}`, 10 + i)]))));
  });
  await page.reload();
  for (const d of '1234') await page.getByRole('button', { name: d, exact: true }).click();
  const status = (id: string) => page.evaluate((id) => JSON.parse(localStorage.getItem('tabla:orders')!)[id].status, id);

  await page.getByRole('article', { name: 'Order for Card 1' }).click();
  await page.getByRole('dialog', { name: 'Card 1' }).getByRole('button', { name: /Mark completed/ }).dblclick();
  await expect(page.locator('.k-undo')).toContainText('Card 1');
  await page.waitForTimeout(600); // a stray tap would open a card's options after the double-tap wait
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await status('k1')).toBe('completed');

  // Calendar: Reopen turns into Mark completed in the same place; a double tap only reopens.
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await page.getByTestId('kitchen-cal-row').filter({ hasText: 'Card 1' }).click();
  await page.getByRole('dialog', { name: 'Card 1' }).getByRole('button', { name: /Reopen order/ }).dblclick();
  await expect(page.getByRole('dialog', { name: 'Card 1' }).getByRole('button', { name: /Mark completed/ })).toBeVisible();
  await page.waitForTimeout(300);
  expect(await status('k1')).toBe('open');
  await context.close();
});
