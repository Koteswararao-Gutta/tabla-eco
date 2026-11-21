import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openScreen } from './helpers';

// Manager > More: Export, and what phones load (open and recent orders; older ones only when asked for).
const SHOTS = process.env.SHOT_DIR || 'test-results/more-shots';
const shot = (p: Page, name: string) => p.screenshot({ path: `${SHOTS}/${name}.png` });

const DAY = 24 * 3600_000;
const ymd = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test.setTimeout(60_000);

/** Adds orders and amounts straight to the local store (test-only), then reloads so the page reads them. */
async function addData(page: Page, orders: Record<string, object>, amounts: Record<string, object>) {
  await page.evaluate(
    ([o, a]) => {
      for (const [col, docs] of [['orders', o], ['orderAmounts', a]] as const) {
        const t = JSON.parse(localStorage.getItem('tabla:' + col) || '{}');
        for (const [id, d] of Object.entries(docs)) t[id] = { ...d, id };
        localStorage.setItem('tabla:' + col, JSON.stringify(t));
      }
    },
    [orders, amounts] as const,
  );
  await page.reload();
}

test('older orders load only when asked for; old unpaid ones still show under Unpaid; Export downloads a CSV', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, acceptDownloads: true });
  // Staff hours "closed", so no alarm gets in the way.
  await context.addInitScript(() => {
    if (localStorage.getItem('tabla:singletons')) return;
    const days = Array.from({ length: 7 }, () => ({ closed: true }));
    localStorage.setItem('tabla:singletons', JSON.stringify({ staffConfig: { id: 'staffConfig', settings: { days } } }));
  });
  const page = await openScreen(context, '/manager/catering');
  await expect(page.getByTestId('order-card').first()).toBeVisible();

  const now = Date.now();
  const old = new Date(now - 200 * DAY).setHours(13, 0, 0, 0);
  const first = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1, 12).getTime();
  const base = { phone: '', type: 'pickup', people: null, createdAt: 0, updatedAt: 0 };
  await addData(
    page,
    {
      oldUnpaid: { ...base, customerName: 'Old Unpaid Party', dueAt: old, items: 'Samosa, 40', status: 'completed' },
      oldPaid: { ...base, customerName: 'Old Paid Party', dueAt: old + 3600_000, items: 'Raita, 2 quarts', status: 'completed' },
      monthOrder: {
        ...base,
        customerName: 'Export, "Test"',
        phone: '+1 480 555 0000',
        type: 'delivery',
        address: '1 Main St',
        people: 30,
        dueAt: first,
        items: 'old text',
        lines: [{ dishId: null, name: 'Veg Biryani', qty: 1.5, unit: 'Full tray', note: 'mild' }],
        status: 'completed',
      },
      gone: { ...base, customerName: 'Deleted Order', dueAt: first + 3600_000, items: 'Tea', status: 'open', deletedAt: now },
    },
    {
      oldUnpaid: { amount: 400, paid: false, updatedAt: 0 },
      oldPaid: { amount: 250, paid: true, paidAt: old, method: 'cash', takenBy: 'Ravi', updatedAt: 0 },
      monthOrder: { amount: 300, paid: true, paidAt: first, method: 'card', takenBy: 'Siri', deposits: [{ amount: 100, method: 'zelle', takenBy: 'Tarun', at: first }], updatedAt: 0 },
    },
  );

  // An unpaid order from 200 days ago is still under Unpaid.
  await page.getByTestId('unpaid-filter').click();
  await expect(page.getByTestId('unpaid-list')).toContainText('Old Unpaid Party');
  await expect(page.getByTestId('unpaid-list')).not.toContainText('Old Paid Party');

  // History shows the recent ones; older ones come when asked for.
  await page.getByRole('button', { name: 'Orders', exact: true }).click();
  await page.getByRole('button', { name: /^History/ }).click();
  const history = page.getByRole('region', { name: 'History' });
  await expect(history).toContainText('Export, "Test"');
  await expect(history).not.toContainText('Old Paid Party');
  await page.getByTestId('show-older').click();
  await expect(history).toContainText('Old Paid Party');
  await expect(page.getByTestId('show-older')).toContainText('Show orders before');
  await page.mouse.wheel(0, 5000);
  await page.waitForTimeout(300);
  await shot(page, 'catering-history-older');
  // An old order opens with its amount.
  await history.getByRole('button', { name: /Old Paid Party/ }).click();
  await expect(page.getByTestId('order-amount')).toContainText('$250');
  await page.getByRole('button', { name: 'Close' }).click();

  // Payments for that old day loads that day.
  await page.goto(`/#/manager/more/payments?day=${ymd(old)}`);
  await expect(page.getByTestId('payments')).toContainText('Old Paid Party');
  await expect(page.getByTestId('payments')).toContainText('Old Unpaid Party');
  await expect(page.getByTestId('payment-totals')).toContainText('$250');
  // Opening an old order from Payments shows it, though it isn't in the recent list.
  await page.getByTestId('payments').getByRole('link', { name: /Old Paid Party/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Old Paid Party');
  await expect(page.getByTestId('order-amount')).toContainText('$250');

  // Export: More > Export, this month by default.
  await page.goto('/#/manager/more');
  await shot(page, 'more-home');
  await page.getByTestId('export').click();
  await expect(page.getByRole('heading', { name: 'Export' })).toBeVisible();
  const summary = page.getByTestId('export-summary');
  await expect(summary).not.toContainText('Loading');
  await shot(page, 'export-this-month');
  const count = Number(await summary.locator('b').textContent());
  expect(count).toBeGreaterThan(0);

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-download').click()]);
  const monthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime();
  const monthEnd = new Date(new Date(now).getFullYear(), new Date(now).getMonth() + 1, 0).getTime();
  expect(download.suggestedFilename()).toBe(`tabla-catering-${ymd(monthStart)}-to-${ymd(monthEnd)}.csv`);
  const csv = await readFile((await download.path())!, 'utf8');
  const lines = csv.replace(/^﻿/, '').trimEnd().split('\r\n');
  expect(lines[0]).toBe('Date,Time,Customer,Phone,Pickup or delivery,People,Items,Status,Amount,Deposits,Paid,Payment method,Taken by,Refund note');
  expect(lines).toHaveLength(count + 1);
  expect(csv).toContain(`${ymd(first)},12:00 PM,"Export, ""Test""",'+1 480 555 0000,Delivery,30,"Veg Biryani, 1-1/2 Full trays (mild)",Done,300,100,yes,Card,Siri,`);
  expect(csv).not.toContain('Deleted Order');
  expect(csv).not.toContain('Old Paid Party');

  // Last month, this year, and picked dates.
  await page.getByRole('button', { name: 'This year' }).click();
  await expect(summary).toContainText(`Jan 1, ${new Date(now).getFullYear()}`);
  await page.getByRole('button', { name: 'Pick dates' }).click();
  await page.getByTestId('export-from').fill(ymd(old));
  await page.getByTestId('export-to').fill(ymd(old));
  await expect(summary.locator('b')).toHaveText('2');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-download').click()]);
  expect(dl2.suggestedFilename()).toBe(`tabla-catering-${ymd(old)}-to-${ymd(old)}.csv`);
  const csv2 = await readFile((await dl2.path())!, 'utf8');
  expect(csv2).toContain('Old Unpaid Party,,Pickup,,"Samosa, 40",Done,400,,no,,,');
  await shot(page, 'export-picked-dates');
  await page.getByTestId('export-to').fill(ymd(old - 2 * DAY));
  await expect(page.getByRole('alert')).toContainText('Please pick a start date');
  await expect(page.getByTestId('export-download')).toHaveCount(0);
  await shot(page, 'export-bad-dates');

  await context.close();
});

test('the front app has no Export (no ☰ at all)', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await openScreen(context, '/front/catering');
  await expect(page.getByRole('heading', { name: 'Catering' })).toBeVisible();
  await expect(page.getByText('Export')).toHaveCount(0);
  await page.goto('/#/front/more/export');
  await expect(page.getByRole('heading', { name: 'Export' })).toHaveCount(0);
  await context.close();
});
