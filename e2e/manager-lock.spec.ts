import { expect, test } from '@playwright/test';
import { openScreen, readCollection } from './helpers';

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });

const SHOTS = process.env.SHOT_DIR || 'test-results';

test('catering is open; Screens, Staff and More ask for the manager PIN', async ({ context }) => {
  const page = await openScreen(context, '/manager/catering');
  await expect(page.getByRole('link', { name: 'More' })).toBeVisible();
  await expect(page.getByTestId('manager-lock')).toHaveCount(0);

  await page.getByRole('link', { name: 'Screens', exact: true }).click();
  await expect(page.getByTestId('manager-lock')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/manager-lock.png` });

  // Wrong PIN: says so and stays locked. The kitchen PIN is not the manager PIN.
  await page.keyboard.type('1234');
  await expect(page.getByRole('status')).toHaveText(/didn't work/);
  await expect(page.getByTestId('manager-lock')).toBeVisible();

  for (const d of '5678') await page.getByRole('button', { name: d, exact: true }).click();
  await expect(page.getByTestId('manager-lock')).toHaveCount(0);
  await expect(page.getByTestId('tile-tv1')).toBeVisible();

  // One PIN opens Staff and More too, also in a new window.
  await page.getByRole('link', { name: 'Staff', exact: true }).click();
  await expect(page.getByTestId('staff-planner')).toBeVisible();
  const other = await openScreen(context, '/manager/more');
  await expect(other.getByTestId('statistics')).toBeVisible();
  await other.screenshot({ path: `${SHOTS}/manager-more.png` });

  // Lock now locks every manager tab again.
  await other.getByRole('button', { name: 'Lock now' }).click();
  await expect(other.getByTestId('manager-lock')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('manager-lock')).toBeVisible();
});

test('locks again after 10 minutes without a touch', async ({ context }) => {
  const page = await openScreen(context, '/manager/staff');
  await page.clock.install();
  await page.reload();
  await page.getByTestId('manager-lock').waitFor();
  await page.keyboard.type('5678');
  await expect(page.getByTestId('staff-planner')).toBeVisible();
  await page.clock.fastForward('09:00');
  await expect(page.getByTestId('manager-lock')).toHaveCount(0);
  await page.clock.fastForward('01:30');
  await expect(page.getByTestId('manager-lock')).toBeVisible();
});

test('the manager PIN can be changed, and must differ from the kitchen PIN', async ({ context }) => {
  const page = await openScreen(context, '/manager/more');
  await page.getByTestId('manager-lock').waitFor();
  await page.keyboard.type('5678');
  await expect(page.getByTestId('manager-pin')).toHaveText('5678');
  const input = page.getByLabel('New PIN (4 digits)');
  await input.fill('1234');
  await page.getByRole('button', { name: 'Change PIN' }).click();
  await expect(page.getByRole('alert')).toHaveText(/kitchen PIN/);
  await input.fill('2468');
  await page.getByRole('button', { name: 'Change PIN' }).click();
  await expect(page.getByTestId('manager-pin')).toHaveText('2468');
  const settings = (await readCollection<{ id: string; managerPin?: string; kitchenPin?: string }>(page, 'singletons')).find((s) => s.id === 'settings');
  expect(settings?.managerPin).toBe('2468');
  expect(settings?.kitchenPin).toBe('1234');

  // This phone stays open. Another phone (fresh unlock) needs the new PIN; the old one no longer works.
  await page.reload();
  await expect(page.getByTestId('statistics')).toBeVisible();
  await page.getByRole('button', { name: 'Lock now' }).click();
  await expect(page.getByTestId('manager-lock')).toBeVisible();
  await page.keyboard.type('5678');
  await expect(page.getByTestId('manager-lock')).toBeVisible();
  await page.keyboard.type('2468');
  await expect(page.getByTestId('statistics')).toBeVisible();
});

test('More > Payments: one day of orders with Paid / Unpaid and totals; a row opens the order', async ({ context }) => {
  const page = await openScreen(context, '/manager/more');
  await page.getByTestId('manager-lock').waitFor();
  await page.keyboard.type('5678');
  // Two orders today (one paid), one tomorrow.
  await page.evaluate(() => {
    const at = (days: number, h: number) => {
      const d = new Date();
      d.setDate(d.getDate() + days);
      d.setHours(h, 0, 0, 0);
      return d.getTime();
    };
    const o = (id: string, name: string, dueAt: number) => ({ id, customerName: name, phone: '', dueAt, type: 'pickup', items: 'Biryani', status: 'open', createdAt: 0, updatedAt: 0 });
    localStorage.setItem('tabla:orders', JSON.stringify({ p1: o('p1', 'Asha', at(0, 18)), p2: o('p2', 'Ravi', at(0, 11)), p3: o('p3', 'Meena', at(1, 12)) }));
    localStorage.setItem('tabla:orderAmounts', JSON.stringify({ p1: { id: 'p1', amount: 250.5, paid: true, updatedAt: 0 }, p2: { id: 'p2', amount: 120, paid: false, updatedAt: 0 }, p3: { id: 'p3', amount: 80, paid: true, updatedAt: 0 } }));
  });
  await page.reload();
  await page.getByRole('link', { name: /Payments/ }).click();
  const rows = page.getByTestId('payments').getByRole('listitem');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Ravi');
  await expect(rows.nth(0)).toContainText('$120');
  await expect(rows.nth(0)).toContainText('Unpaid');
  await expect(rows.nth(1)).toContainText('$250.50');
  await expect(rows.nth(1)).toContainText('Paid');
  await expect(page.getByTestId('payment-totals')).toContainText('Paid$250.50');
  await expect(page.getByTestId('payment-totals')).toContainText('Unpaid$120');
  await page.screenshot({ path: `${SHOTS}/manager-payments.png` });

  await page.getByRole('button', { name: 'Day after' }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Meena');
  await page.getByRole('button', { name: 'Day before' }).click();
  await page.getByRole('button', { name: 'Day before' }).click();
  await expect(page.getByText('No catering orders on this day.')).toBeVisible();
  await page.getByRole('button', { name: 'Day after' }).click();

  await rows.first().getByRole('link').click();
  await expect(page.getByTestId('order-summary')).toContainText('Ravi');
});

test('More > Statistics: this week Monday to Sunday, with the week total and paid / unpaid', async ({ context }) => {
  const page = await openScreen(context, '/manager/more');
  await page.getByTestId('manager-lock').waitFor();
  await page.keyboard.type('5678');
  // This week: Monday (paid), Sunday (part paid), Wednesday (no amount). Last week: one order. Next Monday: one order.
  await page.evaluate(() => {
    const monday = new Date();
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const at = (days: number, h: number) => {
      const d = new Date(monday);
      d.setDate(d.getDate() + days);
      d.setHours(h, 0, 0, 0);
      return d.getTime();
    };
    const o = (id: string, name: string, dueAt: number) => ({ id, customerName: name, phone: '', dueAt, type: 'pickup', items: 'Biryani', status: 'completed', createdAt: 0, updatedAt: 0 });
    localStorage.setItem('tabla:orders', JSON.stringify({ s1: o('s1', 'Asha', at(0, 12)), s2: o('s2', 'Ravi', at(6, 19)), s3: o('s3', 'Meena', at(2, 13)), s4: o('s4', 'Old', at(-1, 18)), s5: o('s5', 'Next', at(7, 11)) }));
    localStorage.setItem('tabla:orderAmounts', JSON.stringify({
      s1: { id: 's1', amount: 250.5, paid: true, updatedAt: 0 },
      s2: { id: 's2', amount: 400, paid: false, deposits: [{ amount: 100, method: 'cash', takenBy: 'Ravi', at: 0 }], updatedAt: 0 },
      s4: { id: 's4', amount: 75, paid: true, updatedAt: 0 },
      s5: { id: 's5', amount: 999, paid: false, updatedAt: 0 },
    }));
  });
  await page.reload();
  await page.getByTestId('statistics').click();
  await expect(page.getByTestId('week-label')).toHaveText('This week');
  const rows = page.getByTestId('week-orders').getByRole('listitem');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Asha');
  await expect(rows.nth(0)).toContainText('Paid');
  await expect(rows.nth(1)).toContainText('Meena');
  await expect(rows.nth(1)).toContainText('No amount');
  await expect(rows.nth(2)).toContainText('$400');
  await expect(rows.nth(2)).toContainText('Part paid');
  await expect(page.getByTestId('week-total')).toContainText('$650.50');
  await expect(page.getByTestId('week-total')).toContainText('3 orders');
  await expect(page.getByTestId('week-paid-unpaid')).toContainText('Paid$350.50');
  await expect(page.getByTestId('week-paid-unpaid')).toContainText('Unpaid$300');
  await expect(page.getByText('1 order has no amount yet')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/manager-statistics.png`, fullPage: true });

  await page.getByRole('button', { name: 'Week before' }).click();
  await expect(page.getByTestId('week-label')).toHaveText('Last week');
  await expect(rows).toHaveCount(1);
  await expect(page.getByTestId('week-total')).toContainText('$75');
  await page.getByRole('button', { name: 'Week after' }).click();
  await page.getByRole('button', { name: 'Week after' }).click();
  await expect(page.getByTestId('week-label')).toHaveText('Next week');
  await expect(rows.first()).toContainText('Next');
  await page.getByRole('button', { name: 'Week before' }).click();

  await rows.first().getByRole('link').click();
  await expect(page.getByTestId('order-summary')).toContainText('Asha');
});
