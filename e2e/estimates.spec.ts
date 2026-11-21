import { expect, test, type Page } from '@playwright/test';
import { openScreen, readCollection } from './helpers';

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });

const SHOTS = process.env.SHOT_DIR || 'test-results';

async function addItem(page: Page, n: number, dish: string, qty: string, unit: string) {
  const sheet = page.getByRole('dialog');
  if (n > 1) await sheet.getByRole('button', { name: '+ Add item' }).click();
  await sheet.getByLabel(`Item ${n} dish`).fill(dish);
  await sheet.getByLabel(`Item ${n} quantity`).fill(qty);
  await sheet.getByLabel(`Item ${n} unit`).selectOption(unit);
}

test('estimate: priced from the list, sent on WhatsApp, then made into an order', async ({ context }) => {
  const page = await openScreen(context, '/manager/catering');
  await page.getByTestId('estimates-filter').click();
  await expect(page.getByTestId('estimates-list')).toContainText('No estimates.');
  await page.getByRole('button', { name: '+ New estimate' }).click();

  const sheet = page.getByRole('dialog', { name: 'New estimate' });
  await sheet.getByLabel('Customer name').fill('Priya Shah');
  await sheet.getByLabel('Phone (to send the estimate)').fill('602 555 1234');
  await sheet.getByLabel('Number of people (optional)').fill('40');
  await addItem(page, 1, 'Chicken Dum Biryani', '1', 'Full tray');
  await addItem(page, 2, 'Veg Dum Biryani', '1', 'Half tray');
  await addItem(page, 3, 'Samosa (2)', '50', 'Pieces');

  // Chicken $170 full, veg $80 half; samosa pieces have no list price yet.
  const prices = sheet.getByTestId('estimate-prices');
  await expect(prices.getByLabel('Price of Chicken Dum Biryani')).toHaveAttribute('placeholder', '170');
  await expect(prices.getByLabel('Price of Veg Dum Biryani')).toHaveAttribute('placeholder', '80');
  // Biryani raita and salan come with it, free.
  await expect(prices.getByText('Included').first()).toBeVisible();
  await sheet.getByRole('button', { name: 'Save estimate' }).click();
  await expect(sheet.getByText('Please enter a price for Samosa (2).')).toBeVisible();
  await prices.getByLabel('Price of Samosa (2)').fill('50');
  await sheet.getByLabel('Discount $ (optional)').fill('20');
  await expect(sheet.getByTestId('estimate-total')).toContainText('$280');
  await page.screenshot({ path: `${SHOTS}/estimate-form.png`, fullPage: true });
  await sheet.getByRole('button', { name: 'Save estimate' }).click();

  const summary = page.getByRole('dialog', { name: 'Estimate' });
  await expect(summary.getByTestId('estimate-total')).toContainText('$280');
  const href = await summary.getByTestId('send-estimate').getAttribute('href');
  expect(href).toMatch(/^https:\/\/wa\.me\/16025551234\?text=/);
  const text = decodeURIComponent(href!.split('text=')[1]);
  expect(text).toContain('• Chicken Dum Biryani, 1 Full tray: $170');
  expect(text).toContain('*Total: $280*');
  expect(text).not.toContain('undefined');
  await page.waitForTimeout(500); // the sheet finishes sliding in
  await page.screenshot({ path: `${SHOTS}/estimate-summary.png`, fullPage: true });

  // Edit: change the chicken to a half tray; the price follows the list.
  await summary.getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit estimate' });
  await edit.getByLabel('Item 1 unit').selectOption('Half tray');
  await expect(edit.getByTestId('estimate-total')).toContainText('$195');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('dialog', { name: 'Estimate' }).getByTestId('estimate-total')).toContainText('$195');

  // The customer confirmed: the new-order form opens filled in, with the total as the amount.
  await page.getByTestId('make-order').click();
  const order = page.getByRole('dialog', { name: 'New order' });
  await expect(order.getByTestId('from-estimate')).toBeVisible();
  await expect(order.getByLabel('Customer name')).toHaveValue('Priya Shah');
  await expect(order.getByTestId('amount-input')).toHaveValue('195');
  await order.getByLabel('Date').fill('2026-12-05');
  await order.getByLabel('Time').fill('18:00');
  await order.getByRole('button', { name: 'Save order' }).click();
  await expect(page.getByTestId('order-saved')).toBeVisible();

  const saved = await readCollection<{ customerName: string; items: string }>(page, 'orders');
  const made = saved.find((o) => o.customerName === 'Priya Shah')!;
  expect(made.items).toContain('Chicken Dum Biryani, 1 Half tray');
  expect(made.items).not.toContain('$');
  const est = await readCollection<{ status: string; orderId: string }>(page, 'estimates');
  expect(est[0].status).toBe('ordered');
  expect(est[0].orderId).toBeTruthy();
  const amounts = await readCollection<{ amount: number }>(page, 'orderAmounts');
  expect(amounts.some((a) => a.amount === 195)).toBe(true);

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('estimates-list')).toContainText('No estimates.');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/estimates-list.png` });
  await expect(page.getByRole('button', { name: /Confirmed, made into orders \(1\)/ })).toBeVisible();
});

test('price list: the manager changes a price and new estimates use it; the front app has estimates too', async ({ context }) => {
  const page = await openScreen(context, '/manager/more');
  await page.getByTestId('prices').click();
  await expect(page.getByTestId('default-chicken')).toHaveValue('170');
  await page.getByTestId('default-chicken').fill('176');
  await page.getByLabel('Full tray price of Veg Dum Biryani').fill('150');
  await page.getByTestId('save-prices').click();
  await expect(page.getByTestId('save-prices')).toHaveText('✓ Saved');
  await page.screenshot({ path: `${SHOTS}/catering-prices.png` });

  const front = await openScreen(context, '/front/catering');
  await front.getByTestId('estimates-filter').click();
  await front.getByRole('button', { name: '+ New estimate' }).click();
  await addItem(front, 1, 'Chicken 65', '1', 'Half tray');
  await addItem(front, 2, 'Veg Dum Biryani', '1', 'Full tray');
  const prices = front.getByTestId('estimate-prices');
  await expect(prices.getByLabel('Price of Chicken 65')).toHaveAttribute('placeholder', '88');
  await expect(prices.getByLabel('Price of Veg Dum Biryani')).toHaveAttribute('placeholder', '150');
  // Front staff can change a price on the estimate, but not the list.
  await expect(front.getByRole('link', { name: 'Change the price list' })).toHaveCount(0);
});
