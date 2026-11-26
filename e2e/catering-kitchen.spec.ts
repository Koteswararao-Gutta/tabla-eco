import { expect, test, type Browser, type BrowserContextOptions, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openScreen, readCollection } from './helpers';
import type { CateringOrder } from '../src/shared/data/types';

// Screenshots for the eye check. Override with SHOT_DIR.
const SHOTS = process.env.SHOT_DIR || 'test-results/catering-kitchen-shots';
const shot = (p: Page, name: string) => p.screenshot({ path: `${SHOTS}/${name}.png` });

async function typePin(kitchen: Page, pin: string) {
  for (const d of pin) await kitchen.getByRole('button', { name: d, exact: true }).click();
}

/** Kitchen: one tap on an order card opens its options; pick one. */
async function kitchenOption(kitchen: Page, customer: string, option: 'Mark completed' | 'Edit order' | 'Print name tags') {
  await kitchen.getByRole('article', { name: `Order for ${customer}` }).click({ position: { x: 20, y: 20 } });
  await kitchen.getByRole('dialog', { name: customer }).getByRole('button', { name: new RegExp(option) }).click();
}

/** One item row of the order form. `pick` taps that dish in the menu suggestions after typing `dish`. */
type Row = { dish: string; pick?: string; qty?: string; unit?: string; note?: string };

/** Fills the order form's item rows, adding or removing rows to match. */
async function fillItems(sheet: Locator, rows: Row[]) {
  for (let i = 0; i < rows.length; i++) {
    const n = i + 1;
    if ((await sheet.getByTestId('item-row').count()) < n) await sheet.getByRole('button', { name: '+ Add item' }).click();
    const r = rows[i];
    await sheet.getByLabel(`Item ${n} dish`).fill(r.dish);
    if (r.pick) await sheet.getByRole('listbox', { name: 'Dishes on the menu' }).getByRole('option', { name: new RegExp('^' + r.pick) }).click();
    await sheet.getByLabel(`Item ${n} quantity`).fill(r.qty ?? '');
    await sheet.getByLabel(`Item ${n} unit`).selectOption(r.unit ?? '');
    await sheet.getByLabel(`Item ${n} note`).fill(r.note ?? '');
  }
  while ((await sheet.getByTestId('item-row').count()) > rows.length) {
    await sheet.getByRole('button', { name: `Remove item ${await sheet.getByTestId('item-row').count()}` }).click();
  }
}

test.setTimeout(60_000);

/** The kitchen's 1-hour alarm covers the whole screen, and a sample order can be due within the hour at
 *  any time of day. So unless a test sets its own staff hours, the staff schedule starts as "closed every
 *  day": heads-ups still show as a banner, but the alarm stays off. */
async function newContext(browser: Browser, opts: BrowserContextOptions = {}) {
  const context = await browser.newContext(opts);
  await context.addInitScript(() => {
    if (localStorage.getItem('tabla:singletons')) return;
    const days = Array.from({ length: 7 }, () => ({ closed: true }));
    localStorage.setItem('tabla:singletons', JSON.stringify({ staffConfig: { id: 'staffConfig', settings: { days } } }));
  });
  return context;
}

/** Staff hours for the test (test-only): 'open' = staffed all day, every day; 'closed' = never. */
// Midday on the restaurant's clock. Tests that add an order "in 30 minutes" and expect "pickup at …"
// (not "tomorrow at …") start here, so they pass at any hour GitHub happens to run them.
const MIDDAY = new Date('2026-11-18T12:00:00-07:00');

async function setHours(page: Page, hours: 'open' | 'closed') {
  await page.evaluate((h) => {
    const t = JSON.parse(localStorage.getItem('tabla:singletons') || '{}');
    const day = h === 'open' ? { open: 0, close: 1440, brk: null } : { closed: true };
    t.staffConfig = { id: 'staffConfig', settings: { days: Array.from({ length: 7 }, () => day) } };
    localStorage.setItem('tabla:singletons', JSON.stringify(t));
  }, hours);
}

test('manager adds an order, kitchen sees it live, completes, undoes and reopens', async ({ browser }) => {
  test.setTimeout(90_000); // a long walk through the whole flow
  const context = await newContext(browser, { deviceScaleFactor: 1 });
  const manager = await openScreen(context, '/manager/catering');
  await manager.setViewportSize({ width: 390, height: 844 });
  const kitchen = await openScreen(context, '/kitchen');
  await kitchen.setViewportSize({ width: 1280, height: 800 });

  // Manager list shows the sample orders.
  await expect(manager.getByRole('heading', { name: 'Catering' })).toBeVisible();
  await expect(manager.getByText('Priya Sharma')).toBeVisible();
  // Completed but not paid: not in the Orders list (only under History), but under Unpaid.
  await expect(manager.getByText('Rahul Verma')).toHaveCount(0);
  await shot(manager, 'manager-list');
  await manager.getByTestId('unpaid-filter').click();
  await expect(manager.getByRole('region', { name: 'Unpaid' }).getByText('Rahul Verma')).toBeVisible();
  await manager.getByRole('button', { name: 'Orders', exact: true }).click();

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
  await expect(sheet.getByLabel('Customer name')).toBeFocused(); // the first field to fix
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
  await fillItems(sheet, [
    { dish: 'chick bir', pick: 'Chicken Dum Biryani', qty: '4', unit: 'Full tray', note: 'medium spicy' },
    { dish: 'Paneer butter masala', qty: '2', unit: 'Half tray' },
    { dish: 'garlic', pick: 'Garlic Naan', qty: '150', unit: 'Pieces' },
  ]);
  await sheet.getByLabel('Notes (optional)').fill('Set up by 1 PM');
  await sheet.getByRole('button', { name: 'Save order' }).click();
  await expect(sheet.getByText('Please enter the delivery address.')).toBeVisible();
  await expect(sheet.getByLabel('Delivery address')).toBeFocused();
  await shot(manager, 'manager-new-order-form');
  await sheet.getByLabel('Delivery address').fill('48 Lake View Rd, Hall B');
  await sheet.getByRole('button', { name: 'Save order' }).click();
  await expect(sheet).toHaveCount(0);
  // Saved: offer to share it with the front staff WhatsApp group.
  const savedSheet = manager.getByRole('dialog', { name: 'Order saved' });
  const message = savedSheet.getByLabel('Message');
  await expect(message).toContainText('*New catering order*\nAnika Wedding');
  await expect(message).toContainText('Delivery: 48 Lake View Rd, Hall B\n120 people\n\n*Items*\n• Chicken Dum Biryani, 4 Full trays (medium spicy)\n• Paneer Butter Masala, 2 Half trays\n• Garlic Naan, 150 pieces\n• Raita, 1 Full tray (extra)\n• Salan, 1 Full tray (extra)');
  await expect(message).not.toContainText('555'); // no customer phone for the staff group
  const share = savedSheet.getByRole('link', { name: 'Share to WhatsApp' });
  const href = (await share.getAttribute('href'))!;
  expect(href.startsWith('https://wa.me/?text=')).toBe(true);
  expect(decodeURIComponent(href.slice('https://wa.me/?text='.length))).toBe(await message.textContent());
  await expect(share).toHaveAttribute('target', '_blank');
  await manager.waitForTimeout(400);
  await shot(manager, 'manager-order-saved-share');
  await savedSheet.getByRole('button', { name: 'Done' }).click();
  await expect(savedSheet).toHaveCount(0);
  await expect(manager.getByRole('region', { name: 'Tomorrow' }).getByText('Anika Wedding')).toBeVisible();

  const saved = (await readCollection<CateringOrder>(manager, 'orders')).find((o) => o.customerName === 'Anika Wedding')!;
  expect(saved).toMatchObject({ status: 'open', type: 'delivery', address: '48 Lake View Rd, Hall B', people: 120, notes: 'Set up by 1 PM' });
  expect(saved.items.split('\n')).toHaveLength(5);
  // Saved structured too: the menu dish, quantity, unit and note; the biryani brought raita and salan.
  expect(saved.lines).toEqual([
    { dishId: 'biryani-2', name: 'Chicken Dum Biryani', qty: 4, unit: 'Full tray', note: 'medium spicy' },
    { dishId: 'veg-curries-1', name: 'Paneer Butter Masala', qty: 2, unit: 'Half tray', note: '' },
    { dishId: 'rice-breads-4', name: 'Garlic Naan', qty: 150, unit: 'Pieces', note: '' },
    { dishId: null, name: 'Raita', qty: 1, unit: 'Full tray', note: '', extra: 'Raita' },
    { dishId: null, name: 'Salan', qty: 1, unit: 'Full tray', note: '', extra: 'Salan' },
  ]);

  // Kitchen picks it up by itself.
  const card = kitchen.getByRole('article', { name: 'Order for Anika Wedding' });
  await expect(card).toBeVisible();
  await expect(card.getByText('48 Lake View Rd, Hall B')).toBeVisible();
  await expect(card.getByText('150 pieces')).toBeVisible();
  await expect(card.getByText('Garlic Naan')).toBeVisible();
  await expect(card.getByText(/^in /)).toHaveCount(0); // tomorrow: no countdown until the last hour
  // Kept short: no phone number and no day under the time (the "Tomorrow" heading says it), and the
  // tap hint is said once above the list, not on every card.
  await expect(card).not.toContainText('555 222 3333');
  await expect(card.locator('.k-day')).toHaveCount(0);
  await expect(kitchen.getByText('Tap an order for options. Double-tap to mark it completed.')).toHaveCount(1);
  await expect(kitchen.getByTestId('kitchen-group').first().getByRole('heading')).toHaveText('Today');
  await shot(kitchen, 'kitchen-open-orders');

  // One tap shows the options; Mark completed: card goes, Undo brings it back.
  await card.click({ position: { x: 20, y: 20 } });
  const options = kitchen.getByRole('dialog', { name: 'Anika Wedding' });
  await expect(options.getByRole('button', { name: /Edit order/ })).toBeVisible();
  await expect(options.getByRole('button', { name: /Print name tags/ })).toBeVisible();
  await shot(kitchen, 'kitchen-order-options');
  await options.getByRole('button', { name: /Mark completed/ }).click();
  await expect(card).toHaveCount(0);
  await kitchen.getByRole('button', { name: 'Undo' }).click();
  await expect(card).toBeVisible();
  // A double tap completes it at once, without the options.
  await card.dblclick({ position: { x: 20, y: 20 } });
  await expect(card).toHaveCount(0);
  await expect(options).toBeHidden();
  await expect(kitchen.getByRole('button', { name: 'Undo' })).toBeHidden({ timeout: 9000 });

  // No "Show all orders" button: the Calendar shows completed orders, and reopens them.
  await expect(kitchen.getByRole('button', { name: /Show all orders/ })).toHaveCount(0);
  await kitchen.getByRole('button', { name: 'Calendar', exact: true }).click();
  const [y, m, d] = tomorrow.split('-').map(Number);
  const tmr = new Date(y, m - 1, d);
  if (tmr.getMonth() !== new Date().getMonth()) await kitchen.getByRole('button', { name: 'Next month' }).click();
  await kitchen.getByRole('button', { name: new RegExp('^' + tmr.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) + ':') }).click();
  const row = kitchen.getByTestId('kitchen-cal-row').filter({ hasText: 'Anika Wedding' });
  await expect(row).toContainText('Completed');
  await row.click();
  const full = kitchen.getByRole('dialog', { name: 'Anika Wedding' });
  await expect(full.getByTestId('kitchen-order-details')).toContainText('555 222 3333'); // the phone is in the full order
  await full.getByRole('button', { name: /Reopen order/ }).click();
  await expect(row).toContainText('Open');
  await kitchen.keyboard.press('Escape');
  await kitchen.getByRole('button', { name: 'List', exact: true }).click();
  await expect(card).toBeVisible();

  // The manager sees the kitchen's change and can complete / delete from the order summary.
  await manager.getByRole('button', { name: /Anika Wedding/ }).click();
  const summary = manager.getByRole('dialog', { name: 'Order details' });
  await expect(summary.getByText('Tomorrow, 1:30 PM')).toBeVisible();
  await expect(summary.getByText('48 Lake View Rd, Hall B')).toBeVisible();
  await expect(summary.getByRole('listitem')).toHaveText(['4 Full trays Chicken Dum Biryani · medium spicy', '2 Half trays Paneer Butter Masala', '150 pieces Garlic Naan', '1 Full tray Raita Extra', '1 Full tray Salan Extra']);
  await shot(manager, 'manager-order-summary');
  // An open order can be shared again from its summary.
  const again = decodeURIComponent((await summary.getByRole('link', { name: 'Share to WhatsApp' }).getAttribute('href'))!);
  expect(again).toContain('*Catering order*\nAnika Wedding');
  await summary.getByRole('button', { name: 'Mark completed' }).click();
  await expect(card).toHaveCount(0);
  // Quick feedback with Undo.
  const toast = manager.getByRole('status').filter({ hasText: 'Marked completed: Anika Wedding' });
  await expect(toast).toBeVisible();
  await shot(manager, 'manager-marked-completed');
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(card).toBeVisible();
  await manager.getByRole('button', { name: /Anika Wedding/ }).click();
  await summary.getByRole('button', { name: 'Mark completed' }).click();
  await expect(card).toHaveCount(0);
  await manager.getByRole('button', { name: /History/ }).click();
  await manager.getByRole('region', { name: 'History' }).getByRole('button', { name: /Anika Wedding/ }).click();
  // Delete, then "Keep it" goes back to the order.
  await expect(summary.getByRole('button', { name: 'Reopen' })).toBeVisible();
  await summary.getByRole('button', { name: 'Delete' }).click();
  await manager.getByRole('dialog', { name: 'Delete this order?' }).getByRole('button', { name: 'Keep it' }).click();
  await expect(summary.getByText('Anika Wedding')).toBeVisible();
  await summary.getByRole('button', { name: 'Delete' }).click();
  await manager.getByRole('dialog', { name: 'Delete this order?' }).getByRole('button', { name: 'Delete order' }).click();
  // A soft delete: gone from every screen, with Undo for a few seconds, but still in the database.
  const deleted = manager.getByRole('status').filter({ hasText: 'Deleted: Anika Wedding' });
  await expect(deleted).toBeVisible();
  await expect(manager.getByTestId('order-card').filter({ hasText: 'Anika Wedding' })).toHaveCount(0);
  const kept = (await readCollection<CateringOrder>(manager, 'orders')).find((o) => o.customerName === 'Anika Wedding');
  expect(typeof kept?.deletedAt).toBe('number');
  await deleted.getByRole('button', { name: 'Undo' }).click();
  await expect(manager.getByTestId('order-card').filter({ hasText: 'Anika Wedding' })).toBeVisible();
  await manager.getByRole('button', { name: /Anika Wedding/ }).click();
  await summary.getByRole('button', { name: 'Delete' }).click();
  await manager.getByRole('dialog', { name: 'Delete this order?' }).getByRole('button', { name: 'Delete order' }).click();
  await expect(manager.getByTestId('order-card').filter({ hasText: 'Anika Wedding' })).toHaveCount(0);
  await expect(kitchen.getByText('Anika Wedding')).toHaveCount(0);
  expect((await readCollection<CateringOrder>(manager, 'orders')).some((o) => o.customerName === 'Anika Wedding' && typeof o.deletedAt === 'number')).toBe(true);

  await context.close();
});

test('kitchen stays unlocked on this tablet through a reload, until Lock or a new PIN', async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 1, viewport: { width: 1024, height: 768 } });
  const kitchen = await openScreen(context, '/kitchen');
  await typePin(kitchen, '1234');
  await expect(kitchen.getByRole('heading', { name: 'Open orders' })).toBeVisible();
  await shot(kitchen, 'kitchen-1024');
  // The nightly reload (or a crash) keeps it unlocked.
  await kitchen.reload();
  await expect(kitchen.getByRole('heading', { name: 'Open orders' })).toBeVisible();
  await expect(kitchen.getByText('Enter the 4-digit PIN')).toHaveCount(0);
  // Remembered on this device only, and never the PIN itself.
  const kept = await kitchen.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('tabla-device:')));
  expect(kept).toHaveLength(1);
  expect(kept[0][1]).not.toContain('1234');
  // Lock locks it, also after a reload.
  await kitchen.getByRole('button', { name: 'Lock' }).click();
  await expect(kitchen.getByText('Enter the 4-digit PIN')).toBeVisible();
  await kitchen.reload();
  await expect(kitchen.getByText('Enter the 4-digit PIN')).toBeVisible();
  await typePin(kitchen, '1234');
  await expect(kitchen.getByRole('heading', { name: 'Open orders' })).toBeVisible();
  // The manager changes the PIN: the tablet locks at once, and only the new PIN opens it.
  const manager = await openScreen(context, '/manager/catering');
  await manager.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('tabla:singletons') || '{}');
    t.settings = { ...(t.settings || { restaurantName: 'Tabla' }), kitchenPin: '4321' };
    localStorage.setItem('tabla:singletons', JSON.stringify(t));
  });
  await kitchen.reload(); // a reload, or the live update, both show the PIN screen
  await expect(kitchen.getByText('Enter the 4-digit PIN')).toBeVisible();
  await typePin(kitchen, '1234');
  await expect(kitchen.getByText("That PIN didn't work")).toBeVisible();
  await typePin(kitchen, '4321');
  await expect(kitchen.getByRole('heading', { name: 'Open orders' })).toBeVisible();
  await context.close();
});

test('kitchen 1-hour alarm: full screen, flashing, rings until touched (at least twice), only in staffed hours', async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 1, viewport: { width: 1024, height: 768 } });
  // Count beeps through a stand-in for the browser's sound output, and record the app's volume switch.
  await context.addInitScript(() => {
    const w = window as unknown as { beeps: number; loud: boolean[]; AudioContext: unknown; TablaAlarm: unknown };
    w.beeps = 0;
    w.loud = [];
    w.TablaAlarm = { loud: (on: boolean) => w.loud.push(on) };
    const Real = window.AudioContext;
    w.AudioContext = class extends Real {
      createOscillator() {
        w.beeps++;
        return super.createOscillator();
      }
    };
  });
  const page = await context.newPage();
  await page.clock.install({ time: MIDDAY }); // an order 30 minutes away stays on the same day;
  await page.goto('/#/kitchen');
  await expect(page.getByText('Enter the 4-digit PIN')).toBeVisible();
  const addOrder = (id: string, name: string, inMin: number) =>
    page.evaluate(({ id, name, inMin }: { id: string; name: string; inMin: number }) => {
      const t = JSON.parse(localStorage.getItem('tabla:orders') || '{}');
      for (const o of Object.values(t) as { status: string }[]) o.status = 'completed'; // only this order is open
      const now = Date.now();
      t[id] = { id, customerName: name, phone: '555', type: 'pickup', items: 'Samosa, 20', status: 'open', createdAt: now, updatedAt: now, dueAt: now + inMin * 60_000 };
      localStorage.setItem('tabla:orders', JSON.stringify(t));
    }, { id, name, inMin });
  const beeps = () => page.evaluate(() => (window as unknown as { beeps: number }).beeps);
  const loud = () => page.evaluate(() => (window as unknown as { loud: boolean[] }).loud);
  const BEEPS = 8; // per ring
  const CYCLE = 8 * 360 + 1200; // one ring plus the pause
  const alarm = page.getByTestId('kitchen-alarm');
  const banner = page.getByTestId('kitchen-reminder');

  // Out of hours (break, closed): only the quiet banner, no alarm, no sound.
  await setHours(page, 'closed');
  await addOrder('soon', 'Anita Rao', 30);
  await page.reload();
  await expect(banner).toContainText('Anita Rao pickup at');
  await page.clock.runFor(20_000);
  await expect(alarm).toHaveCount(0);
  expect(await beeps()).toBe(0);

  // Staffed: the alarm covers the whole screen, over the PIN screen, and flashes.
  await setHours(page, 'open');
  await page.reload();
  await expect(alarm).toBeVisible();
  await expect(alarm).toContainText('Catering order soon');
  await expect(alarm).toContainText('Anita Rao');
  await expect(alarm).toContainText('Pickup at');
  await expect(alarm).toContainText('Touch anywhere to stop');
  expect(await alarm.boundingBox()).toEqual({ x: 0, y: 0, width: 1024, height: 768 });
  await expect(alarm).toHaveCSS('animation-name', 'k-alarm-flash');
  await expect(alarm).toHaveCSS('animation-iteration-count', 'infinite');
  await shot(page, 'kitchen-alarm');
  expect(await page.evaluate(() => { const top = document.elementFromPoint(512, 700); return !!top?.closest('.k-alarm'); })).toBe(true); // keypad covered
  expect(await beeps()).toBe(BEEPS); // first ring
  expect(await loud()).toEqual([true]); // the app turns the volume up
  // Nobody touches it: it keeps ringing.
  await page.clock.runFor(5 * CYCLE);
  expect(await beeps()).toBe(6 * BEEPS);

  // A touch anywhere stops it at once and acknowledges the order (no PIN needed).
  await page.mouse.click(100, 100);
  await expect(alarm).toHaveCount(0);
  await expect(banner).toHaveCount(0);
  expect(await loud()).toEqual([true, false]); // volume back
  await page.clock.runFor(30_000);
  expect(await beeps()).toBe(6 * BEEPS);
  await expect(page.getByText('Enter the 4-digit PIN')).toBeVisible(); // the touch didn't press a key
  await page.reload();
  await expect(page.getByText('Enter the 4-digit PIN')).toBeVisible();
  await expect(alarm).toHaveCount(0); // saved on the order

  // Touched during the first ring: it still finishes 2 full rings.
  await addOrder('next', 'Bharat Iyer', 50);
  await page.reload();
  await expect(alarm).toContainText('Bharat Iyer');
  expect(await beeps()).toBe(BEEPS); // first ring playing
  await alarm.click();
  await expect(alarm).toHaveCount(0);
  await page.clock.runFor(3 * CYCLE);
  expect(await beeps()).toBe(2 * BEEPS); // the second ring still played, then quiet
  await context.close();
});

test('kitchen: with 5 heads-ups and the time zone strip, the PIN keypad stays on screen', async ({ browser }) => {
  // A New York tablet shows the time zone warning strip, which pushes the page down.
  const context = await newContext(browser, { deviceScaleFactor: 1, viewport: { width: 1024, height: 768 }, timezoneId: 'America/New_York' });
  const page = await openScreen(context, '/kitchen');
  await expect(page.getByText('Enter the 4-digit PIN')).toBeVisible();
  await page.evaluate(() => {
    // Only these 5 orders: a sample order due within the hour (the test runs at any time of day) would make 6.
    const t: Record<string, unknown> = {};
    const now = Date.now();
    for (const [i, name] of ['Anita Rao', 'Bharat Iyer', 'Chitra Nair', 'Deepak Shah', 'Esha Gupta'].entries())
      t['r' + i] = { id: 'r' + i, customerName: name, phone: '555', type: 'pickup', items: 'Samosa, 20', status: 'open', createdAt: now, updatedAt: now, dueAt: now + (10 + i * 10) * 60_000 };
    localStorage.setItem('tabla:orders', JSON.stringify(t));
  });
  await page.reload();
  // The PIN screen shows 3 rows and "+2 more" (no hidden scroll area); all 5 show once unlocked.
  await expect(page.getByTestId('kitchen-reminder').getByRole('button', { name: 'Got it' })).toHaveCount(3);
  await expect(page.getByTestId('kitchen-reminder')).toContainText('+2 more');
  const onScreen = async () => {
    const vh = page.viewportSize()!.height;
    for (const k of ['1', '0', 'Clear', 'Delete last digit']) {
      const b = (await page.getByRole('button', { name: k, exact: true }).boundingBox())!;
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y + b.height).toBeLessThanOrEqual(vh);
    }
    // Nothing sits on top of the keypad or the PIN dots.
    expect(await page.evaluate(() => {
      const hit = (el: Element) => { const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!top && (el === top || el.contains(top)); };
      // ...nor on the heads-up: it sits below the time zone strip.
      return document.documentElement.classList.contains('t-tz-on') && [...document.querySelectorAll('.k-key, .k-dots, .k-remind-btn')].every(hit);
    })).toBe(true);
  };
  await onScreen();
  await shot(page, 'kitchen-pin-5-reminders-1024');
  await page.setViewportSize({ width: 800, height: 1280 });
  await onScreen();
  await shot(page, 'kitchen-pin-5-reminders-portrait');
  // The keypad still works, and so does Got it.
  await typePin(page, '1234');
  await expect(page.getByRole('heading', { name: 'Open orders' })).toBeVisible();
  await expect(page.getByTestId('kitchen-reminder').getByRole('button', { name: 'Got it' })).toHaveCount(5);
  await context.close();
});

test('kitchen: shows "Tap anywhere to turn on sound" while the browser keeps sound off', async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 1, viewport: { width: 1024, height: 768 } });
  // A stand-in sound output that stays off until a tap, like Chrome after a restart.
  await context.addInitScript(() => {
    class FakeAudio extends EventTarget {
      state = 'suspended';
      currentTime = 0;
      destination = {};
      resume() {
        const during = window.event?.type; // only a real tap or key press turns it on
        if ((during === 'pointerdown' || during === 'keydown') && this.state !== 'running') {
          this.state = 'running';
          this.dispatchEvent(new Event('statechange'));
        }
        return Promise.resolve();
      }
      createOscillator() { return { frequency: {}, connect: (g: unknown) => g, start() {}, stop() {} }; }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (d: unknown) => d }; }
    }
    (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudio;
  });
  const page = await openScreen(context, '/kitchen');
  const note = page.getByText('Tap anywhere to turn on sound');
  await expect(note).toBeVisible();
  await shot(page, 'kitchen-sound-off-pin');
  await typePin(page, '1234'); // the first tap turns sound on
  await expect(page.getByRole('heading', { name: 'Open orders' })).toBeVisible();
  await expect(note).toHaveCount(0);
  // After a restart it is unlocked, and the note shows on the board until a tap.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Open orders' })).toBeVisible();
  await expect(note).toBeVisible();
  await shot(page, 'kitchen-sound-off-board');
  await page.mouse.click(500, 700);
  await expect(note).toHaveCount(0);
  await context.close();
});

test('saving an edit never undoes a completion made in the kitchen meanwhile', async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 1 });
  const manager = await openScreen(context, '/manager/catering');
  await manager.setViewportSize({ width: 390, height: 844 });
  const kitchen = await openScreen(context, '/kitchen');
  await kitchen.setViewportSize({ width: 1280, height: 800 });
  await typePin(kitchen, '1234');

  // Manager opens the edit sheet...
  await manager.getByRole('button', { name: /Desert Tech office/ }).click();
  await manager.getByRole('dialog', { name: 'Order details' }).getByRole('button', { name: 'Edit' }).click();
  const edit = manager.getByRole('dialog', { name: 'Edit order' });
  await expect(edit.getByLabel('Notes (optional)')).toBeVisible();

  // ...the kitchen completes the order while it is open...
  await kitchenOption(kitchen, 'Desert Tech office', 'Mark completed');
  await expect(kitchen.getByRole('article', { name: 'Order for Desert Tech office' })).toHaveCount(0);
  await expect.poll(async () => (await readCollection<CateringOrder>(manager, 'orders')).find((x) => x.customerName === 'Desert Tech office')!.status).toBe('completed');

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

test('kitchen 1-hour heads-up: Got it is saved, a new time brings it back, late orders drop off', async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 1, viewport: { width: 1280, height: 800 } });
  await context.clock.install({ time: MIDDAY }); // an order 30 minutes away stays on the same day
  const page = await openScreen(context, '/kitchen');
  await expect(page.getByText('Enter the 4-digit PIN')).toBeVisible();
  // An order due in 30 minutes and one 3 hours late, written straight into the local store (test-only).
  await page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('tabla:orders') || '{}');
    for (const o of Object.values(t) as { status: string }[]) o.status = 'completed'; // only our orders are open
    const now = Date.now();
    const base = { phone: '555', type: 'pickup', items: 'Samosa, 20', status: 'open', createdAt: now, updatedAt: now };
    t.soon = { ...base, id: 'soon', customerName: 'Anita Rao', dueAt: now + 30 * 60_000 };
    t.old = { ...base, id: 'old', customerName: 'Old Late Order', dueAt: now - 3 * 3_600_000 };
    localStorage.setItem('tabla:orders', JSON.stringify(t));
  });
  await page.reload();
  await typePin(page, '1234');
  const banner = page.getByTestId('kitchen-reminder');
  await expect(banner).toContainText('Anita Rao pickup at');
  await expect(banner).toContainText('in 30 min');
  await expect(banner).not.toContainText('Old Late Order'); // its card already says it is late
  await expect(page.getByRole('article', { name: 'Order for Old Late Order' })).toContainText('late');
  const gotIt = banner.getByRole('button', { name: 'Got it' });
  await expect(gotIt).toHaveCSS('color', 'rgb(31, 30, 28)'); // readable: dark text on the white pill
  expect((await gotIt.boundingBox())!.height).toBeGreaterThanOrEqual(56);
  await shot(page, 'kitchen-reminder');

  // Also shown on the Calendar.
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(banner).toContainText('Anita Rao');
  await page.getByRole('button', { name: 'List', exact: true }).click();

  await gotIt.click();
  await expect(banner).toHaveCount(0);
  // Saved on the order: still gone after a reload (and on any other kitchen tablet).
  await page.reload();
  await expect(page.getByRole('article', { name: 'Order for Anita Rao' })).toBeVisible();
  await expect(banner).toHaveCount(0);

  // The manager moves the order 10 minutes later: the reminder comes back.
  await page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('tabla:orders') || '{}');
    t.soon.dueAt += 10 * 60_000;
    localStorage.setItem('tabla:orders', JSON.stringify(t));
  });
  await page.reload();
  await expect(banner).toContainText('Anita Rao');
  await context.close();
});

test('kitchen: long names wrap, portrait calendar rows fit, offline is clear', async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 1, viewport: { width: 800, height: 1280 } });
  const page = await openScreen(context, '/kitchen');
  await expect(page.getByText('Enter the 4-digit PIN')).toBeVisible();
  await page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('tabla:orders') || '{}');
    const now = Date.now();
    t.long = { id: 'long', customerName: 'Supercalifragilisticexpialidocious_Corporate_Holdings_LLC_Event', phone: '555', dueAt: now + 40 * 60_000, type: 'delivery', address: '1 Long Rd', items: 'Samosa, 20', status: 'open', createdAt: now, updatedAt: now };
    localStorage.setItem('tabla:orders', JSON.stringify(t));
  });
  await page.reload();
  await typePin(page, '1234');
  await expect(page.getByRole('article', { name: /Order for Supercali/ })).toBeVisible();
  const fits = () => page.evaluate(() => [...document.querySelectorAll('.k-root *')].every((el) => el.getBoundingClientRect().right <= window.innerWidth + 1));
  expect(await fits()).toBe(true);
  await shot(page, 'kitchen-portrait');
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(page.getByTestId('kitchen-cal-row').first()).toBeVisible();
  expect(await page.evaluate(() => (document.querySelector('.k-root') as HTMLElement).scrollTop)).toBe(0);
  expect(await fits()).toBe(true);
  await shot(page, 'kitchen-portrait-calendar');
  await context.setOffline(true);
  await expect(page.getByText('Offline: showing the last saved orders')).toBeVisible();
  await context.close();
});

test('scan paper order fills the new order form for checking, then saves', async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 1 });
  const manager = await openScreen(context, '/manager/catering');
  await manager.setViewportSize({ width: 390, height: 844 });
  await manager.getByRole('button', { name: '+ New order' }).click();
  const sheet = manager.getByRole('dialog', { name: 'New order' });
  // The preview store answers with a fixed sample instead of calling the AI.
  // The scan button is reachable by keyboard.
  await sheet.getByLabel('Scan paper order').focus();
  await expect(sheet.getByLabel('Scan paper order')).toBeFocused();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await sheet.getByLabel('Scan paper order').setInputFiles({ name: 'order.png', mimeType: 'image/png', buffer: png });
  await expect(sheet.getByText('Filled in from the photo.')).toBeVisible();
  await expect(sheet.getByLabel('Customer name')).toHaveValue('Meera Iyer');
  await expect(sheet.getByLabel('Time')).toHaveValue('18:30');
  await expect(sheet.getByLabel('Item 1 dish')).toHaveValue('Veg Dum Biryani');
  await expect(sheet.getByLabel('Item 1 quantity')).toHaveValue('2');
  await expect(sheet.getByLabel('Item 1 unit')).toHaveValue('Full tray');
  await expect(sheet.getByLabel('Item 2 dish')).toHaveValue('Gulab Jamun');
  await expect(sheet.getByLabel('Item 3 dish')).toHaveValue('Mirchi Bajji'); // matched to the menu
  await expect(sheet.getByLabel('Item 3 note')).toHaveValue('extra chutney');
  await expect(sheet.getByText('Please check this item.')).toHaveCount(1); // the AI was unsure of item 3
  await expect(sheet.getByText('Please check this:')).toHaveCount(1); // the phone number
  await shot(manager, 'manager-scan-filled');
  await sheet.getByLabel('Phone').fill('555 404 1213');
  await sheet.getByLabel('Item 3 quantity').fill('25');
  await expect(sheet.getByText(/Please check this/)).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Save order' }).click();
  await expect(sheet).toHaveCount(0);
  await manager.getByRole('dialog', { name: 'Order saved' }).getByRole('button', { name: 'Done' }).click();
  const saved = (await readCollection<CateringOrder>(manager, 'orders')).find((o) => o.customerName === 'Meera Iyer')!;
  expect(saved).toMatchObject({ phone: '555 404 1213', people: 40, notes: 'Less spicy', status: 'open' });
  expect(saved.items).toBe('Veg Dum Biryani, 2 Full trays\nGulab Jamun, 50 pieces\nMirchi Bajji, 25 pieces (extra chutney)\nRaita, 1/2 Full tray (extra)\nSalan, 1/2 Full tray (extra)');
  expect(saved.lines!.map((l) => l.dishId)).toEqual(['biryani-1', 'desserts-1', 'veg-starters-3', null, null]);
  expect(saved.lines!.some((l) => l.check)).toBe(false);
  await context.close();
});

test('paste a customer message fills the new order form, then saves', async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 1 });
  const manager = await openScreen(context, '/manager/catering');
  await manager.setViewportSize({ width: 390, height: 844 });
  await manager.getByRole('button', { name: '+ New order' }).click();
  const sheet = manager.getByRole('dialog', { name: 'New order' });
  await sheet.getByRole('button', { name: 'Paste message' }).click();
  const box = sheet.getByLabel("Customer's message");
  await expect(box).toBeFocused();
  // Nothing pasted yet: a plain message, no AI call.
  await sheet.getByRole('button', { name: 'Fill the form' }).click();
  await expect(sheet.getByText('Please paste the customer’s message first.')).toBeVisible();
  await shot(manager, 'manager-paste-open');
  // The preview store answers with a fixed sample instead of calling the AI.
  await box.fill('Hi! This is Meera, 555 404 1212. Need 2 trays veg biryani and 50 gulab jamun tomorrow 6:30pm pickup, 40 people, less spicy please');
  await sheet.getByRole('button', { name: 'Fill the form' }).click();
  await expect(sheet.getByText('Filled in from the message.')).toBeVisible();
  await expect(box).toHaveCount(0);
  await expect(sheet.getByLabel('Customer name')).toHaveValue('Meera Iyer');
  await expect(sheet.getByLabel('Item 1 dish')).toHaveValue('Veg Dum Biryani');
  await expect(sheet.getByLabel('Item 2 quantity')).toHaveValue('50');
  await expect(sheet.getByLabel('Item 2 unit')).toHaveValue('Pieces');
  await shot(manager, 'manager-paste-filled');
  await sheet.getByRole('button', { name: 'Save order' }).click();
  await expect(sheet).toHaveCount(0);
  await manager.getByRole('dialog', { name: 'Order saved' }).getByRole('button', { name: 'Done' }).click();
  const saved = (await readCollection<CateringOrder>(manager, 'orders')).find((o) => o.customerName === 'Meera Iyer')!;
  expect(saved).toMatchObject({ people: 40, notes: 'Less spicy', status: 'open' });
  await context.close();
});

test('one tap on Paste message reads what was copied and fills the form', async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 1, viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const manager = await openScreen(context, '/manager/catering');
  await manager.evaluate(() => navigator.clipboard.writeText('Hi, Meera here. 2 trays veg biryani and 50 gulab jamun tomorrow 6:30pm pickup'));
  await manager.getByRole('button', { name: '+ New order' }).click();
  const sheet = manager.getByRole('dialog', { name: 'New order' });
  await sheet.getByRole('button', { name: 'Paste message' }).click();
  await expect(sheet.getByText('Filled in from the message.')).toBeVisible();
  await expect(sheet.getByLabel("Customer's message")).toHaveCount(0); // no box, no extra tap
  await expect(sheet.getByLabel('Customer name')).toHaveValue('Meera Iyer');
  await context.close();
});

/** A small PNG, standing in for a screenshot of a WhatsApp order. */
const SCREENSHOT_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('paste message takes a screenshot too: picked, pasted, or copied', async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 1, viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const manager = await openScreen(context, '/manager/catering');
  const open = async () => {
    await manager.getByRole('button', { name: '+ New order' }).click();
    return manager.getByRole('dialog', { name: 'New order' });
  };
  const close = async () => {
    await manager.keyboard.press('Escape');
    const discard = manager.getByRole('button', { name: /^(Discard|Close without saving)/ });
    if (await discard.isVisible().catch(() => false)) await discard.click();
    await expect(manager.getByRole('dialog', { name: 'New order' })).toHaveCount(0);
  };

  // 1. Nothing copied: the box opens, with a button to pick a screenshot or photo.
  await manager.evaluate(() => navigator.clipboard.writeText(''));
  let sheet = await open();
  await sheet.getByRole('button', { name: 'Paste message' }).click();
  await expect(sheet.getByLabel("Customer's message")).toBeVisible();
  await expect(sheet.getByText('Photo or screenshot')).toBeVisible();
  await shot(manager, 'manager-paste-photo-open');
  await sheet.getByLabel('Message photo or screenshot').setInputFiles({ name: 'whatsapp.png', mimeType: 'image/png', buffer: SCREENSHOT_PNG });
  await expect(sheet.getByText('Filled in from the photo.')).toBeVisible();
  await expect(sheet.getByLabel("Customer's message")).toHaveCount(0);
  await expect(sheet.getByLabel('Customer name')).toHaveValue('Meera Iyer');
  await shot(manager, 'manager-paste-photo-filled');
  await close();

  // 2. A screenshot pasted into the box fills the form the same way.
  sheet = await open();
  await sheet.getByRole('button', { name: 'Paste message' }).click();
  const box = sheet.getByLabel("Customer's message");
  await box.evaluate((el, b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, SCREENSHOT_PNG.toString('base64'));
  await expect(sheet.getByText('Filled in from the photo.')).toBeVisible();
  await expect(sheet.getByLabel('Customer name')).toHaveValue('Meera Iyer');
  await close();

  // 3. One tap on Paste message with a copied screenshot: no box, the form fills at once.
  await manager.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
  }, SCREENSHOT_PNG.toString('base64'));
  sheet = await open();
  await sheet.getByRole('button', { name: 'Paste message' }).click();
  await expect(sheet.getByText('Filled in from the photo.')).toBeVisible();
  await expect(sheet.getByLabel("Customer's message")).toHaveCount(0);
  await expect(sheet.getByLabel('Customer name')).toHaveValue('Meera Iyer');
  await context.close();
});

test('calendar shows the month, and a new order from it warns about a nearby order', async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 1, viewport: { width: 390, height: 844 } });
  const manager = await openScreen(context, '/manager/catering');
  await manager.getByRole('button', { name: 'Calendar' }).click();
  const cal = manager.getByRole('dialog', { name: 'Calendar' });
  const long = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  // Seed: Priya today, Desert Tech tomorrow at 12:00 PM.
  await expect(cal.getByRole('button', { name: `${long(today)}: 1 order` })).toBeVisible();
  await expect(cal.getByRole('button', { name: 'Priya Sharma', exact: false })).toBeVisible();
  await manager.waitForTimeout(500); // let the sheet finish sliding in
  await shot(manager, 'manager-calendar');
  if (tomorrow.getMonth() !== today.getMonth()) await cal.getByRole('button', { name: 'Next month' }).click();
  await cal.getByRole('button', { name: `${long(tomorrow)}: 1 order` }).click();
  await expect(cal.getByText('Desert Tech office')).toBeVisible();
  await cal.getByRole('button', { name: /^\+ New order on/ }).click();
  const sheet = manager.getByRole('dialog', { name: 'New order' });
  const pad = (n: number) => String(n).padStart(2, '0');
  await expect(sheet.getByLabel('Date')).toHaveValue(`${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`);
  await expect(sheet.getByTestId('same-day')).toContainText('Also that day: 12:00 PM Desert Tech office');
  await sheet.getByLabel('Time').fill('12:30');
  await expect(sheet.getByText('⚠ Within 1 hour of Desert Tech office (12:00 PM).')).toBeVisible();
  await manager.waitForTimeout(500);
  await shot(manager, 'manager-calendar-clash');
  await sheet.getByLabel('Time').fill('15:00');
  await expect(sheet.getByText(/Within 1 hour/)).toHaveCount(0);
  await context.close();
});

test('manager can turn on 1-hour phone alerts', async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 1, viewport: { width: 390, height: 844 } });
  const manager = await openScreen(context, '/manager/catering');
  const card = manager.getByTestId('alerts');
  await expect(card).toContainText('Get a phone alert 1 hour before each order.');
  await shot(manager, 'manager-alerts-off');
  await card.getByRole('button', { name: 'Turn on alerts' }).click();
  await expect(card).toContainText('This phone gets an alert 1 hour before each order.');
  // Once on, it isn't shown again the next time Catering opens.
  await manager.evaluate(() => (location.hash = '#/manager/staff'));
  await manager.waitForTimeout(300);
  await manager.evaluate(() => (location.hash = '#/manager/catering'));
  await expect(manager.getByRole('heading', { name: 'Catering' })).toBeVisible();
  await manager.waitForTimeout(500);
  await expect(manager.getByTestId('alerts')).toHaveCount(0);
  await context.close();
});

test('catering list fits a phone with a long no-space customer name', async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 1, viewport: { width: 390, height: 844 } });
  const manager = await openScreen(context, '/manager/catering');
  await expect(manager.getByRole('heading', { name: 'Catering' })).toBeVisible();
  await manager.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('tabla:orders') || '{}');
    const now = Date.now();
    t.long = { id: 'long', customerName: 'Supercalifragilisticexpialidocious_Corporate_Holdings_LLC_Event', phone: '555 123 4567', dueAt: now + 3 * 3_600_000, type: 'pickup', items: 'Samosa, 20', status: 'open', createdAt: now, updatedAt: now };
    localStorage.setItem('tabla:orders', JSON.stringify(t));
  });
  await manager.reload();
  await expect(manager.getByText(/Supercali/)).toBeVisible();
  expect(await manager.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await shot(manager, 'manager-long-name');
  await context.close();
});

test('order summary: big time, Call link, items; Edit opens the form', async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 1, viewport: { width: 390, height: 844 } });
  const manager = await openScreen(context, '/manager/catering');
  await manager.getByRole('button', { name: /Priya Sharma/ }).click();
  const summary = manager.getByRole('dialog', { name: 'Order details' });
  await expect(summary.getByText('Today, 5:30 PM')).toBeVisible();
  await expect(summary.getByRole('link', { name: /Call 555 123 4567/ })).toHaveAttribute('href', 'tel:5551234567');
  await expect(summary.getByRole('listitem')).toHaveCount(4);
  await expect(summary.getByRole('link', { name: 'Share to WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=/);
  await expect(summary.getByText('Less spicy, add serving spoons')).toBeVisible();
  await expect(summary.getByLabel('Customer name')).toHaveCount(0); // not the form
  await manager.waitForTimeout(400);
  await shot(manager, 'manager-summary-priya');
  await summary.getByRole('button', { name: 'Edit' }).click();
  await expect(manager.getByRole('dialog', { name: 'Edit order' }).getByLabel('Customer name')).toHaveValue('Priya Sharma');
  // Calendar taps open the same summary.
  await manager.keyboard.press('Escape');
  await manager.getByRole('button', { name: 'Calendar' }).click();
  await manager.getByRole('dialog', { name: 'Calendar' }).getByRole('button', { name: /Priya Sharma/ }).click();
  await expect(manager.getByRole('dialog', { name: 'Order details' })).toBeVisible();
  await context.close();
});

test('closing a form with typed changes asks first; untouched forms close at once', async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 1, viewport: { width: 390, height: 844 } });
  const manager = await openScreen(context, '/manager/catering');
  // Untouched new order: Escape closes straight away.
  await manager.getByRole('button', { name: '+ New order' }).click();
  await manager.keyboard.press('Escape');
  await expect(manager.getByRole('dialog')).toHaveCount(0);

  // Typed something: Cancel, Escape and a backdrop tap all ask.
  await manager.getByRole('button', { name: '+ New order' }).click();
  const sheet = manager.getByRole('dialog', { name: 'New order' });
  await sheet.getByLabel('Customer name').fill('Half typed');
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  const ask = manager.getByRole('dialog', { name: 'Discard this order?' });
  await expect(ask).toBeVisible();
  await shot(manager, 'manager-discard-ask');
  await ask.getByRole('button', { name: 'Keep editing' }).click();
  await expect(sheet.getByLabel('Customer name')).toHaveValue('Half typed');
  await expect(sheet.getByRole('button', { name: 'Cancel' })).toBeFocused(); // focus back where it was
  await sheet.getByLabel('Phone').focus();
  await manager.keyboard.press('Escape');
  await expect(ask).toBeVisible();
  await manager.keyboard.press('Escape'); // Escape on the question = keep editing
  await expect(sheet.getByLabel('Customer name')).toHaveValue('Half typed');
  await expect(sheet.getByLabel('Phone')).toBeFocused();
  await manager.mouse.click(195, 10); // the dimmed backdrop above the sheet
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Discard' }).click();
  await expect(manager.getByRole('dialog')).toHaveCount(0);
  expect((await readCollection<CateringOrder>(manager, 'orders')).some((o) => o.customerName === 'Half typed')).toBe(false);

  // A key typed right before Escape still counts.
  await manager.getByRole('button', { name: '+ New order' }).click();
  await sheet.getByLabel('Customer name').focus();
  await manager.keyboard.type('Q');
  await manager.keyboard.press('Escape');
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Discard' }).click();

  // Editing an existing order asks "Discard your changes?".
  await manager.getByRole('button', { name: /Priya Sharma/ }).click();
  await manager.getByRole('dialog', { name: 'Order details' }).getByRole('button', { name: 'Edit' }).click();
  const edit = manager.getByRole('dialog', { name: 'Edit order' });
  await edit.getByLabel('Notes (optional)').fill('Changed');
  await edit.getByRole('button', { name: 'Cancel' }).click();
  await manager.getByRole('dialog', { name: 'Discard your changes?' }).getByRole('button', { name: 'Discard' }).click();
  await expect(manager.getByRole('dialog')).toHaveCount(0);
  expect((await readCollection<CateringOrder>(manager, 'orders')).find((o) => o.customerName === 'Priya Sharma')!.notes).toBe('Less spicy, add serving spoons');
  await context.close();
});

test('the edit form has no Mark completed or Delete: those stay on the order details', async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 1, viewport: { width: 390, height: 844 } });
  const manager = await openScreen(context, '/manager/catering');
  await manager.getByRole('button', { name: /Priya Sharma/ }).click();
  const details = manager.getByRole('dialog', { name: 'Order details' });
  await expect(details.getByRole('button', { name: /Mark completed/ })).toBeVisible();
  await expect(details.getByRole('button', { name: 'Delete' })).toBeVisible();
  await details.getByRole('button', { name: 'Edit' }).click();
  const edit = manager.getByRole('dialog', { name: 'Edit order' });
  await expect(edit.getByLabel('Customer name')).toBeVisible();
  await expect(edit.getByRole('button', { name: /Mark completed|Reopen|Delete/ })).toHaveCount(0);
  await context.close();
});

test('Save stays visible at the bottom of a long order form', async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 1, viewport: { width: 390, height: 844 } });
  const manager = await openScreen(context, '/manager/catering');
  await manager.getByRole('button', { name: '+ New order' }).click();
  const sheet = manager.getByRole('dialog', { name: 'New order' });
  const save = sheet.getByRole('button', { name: 'Save order' });
  await manager.waitForTimeout(400);
  const box = (await save.boundingBox())!;
  const sheetBox = (await sheet.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(sheetBox.y + sheetBox.height);
  expect(box.y).toBeGreaterThan(sheetBox.y + sheetBox.height - 120); // pinned to the bottom, not far down the form
  await shot(manager, 'manager-form-sticky-save');
  // A short screen (keyboard up): a focused field is scrolled clear of the Save bar.
  await manager.setViewportSize({ width: 390, height: 500 });
  const notes = sheet.getByLabel('Notes (optional)');
  await notes.focus();
  await manager.waitForTimeout(300);
  const n = (await notes.boundingBox())!;
  const bar = (await sheet.locator('.c-form-foot').boundingBox())!;
  expect(n.y + n.height).toBeLessThanOrEqual(bar.y + 1);
  await context.close();
});

test('kitchen edits an order: tablet shows only the updated order, manager app keeps the history', async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 1 });
  const manager = await openScreen(context, '/manager/catering');
  await manager.setViewportSize({ width: 390, height: 844 });
  const kitchen = await openScreen(context, '/kitchen');
  await kitchen.setViewportSize({ width: 1280, height: 800 });
  await typePin(kitchen, '1234');

  // Kitchen: Edit on the card opens the form, with no Delete.
  const card = kitchen.getByRole('article', { name: 'Order for Priya Sharma' });
  await expect(card.getByTestId('edit-history')).toHaveCount(0);
  await kitchenOption(kitchen, 'Priya Sharma', 'Edit order');
  const edit = kitchen.getByRole('dialog', { name: 'Edit order' });
  await expect(edit.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await expect(edit.getByRole('button', { name: 'Mark completed' })).toHaveCount(0);
  // Change one quantity and add a dish; the untouched rows stay exactly as they were typed.
  await expect(edit.getByTestId('item-row')).toHaveCount(4);
  await edit.getByLabel('Item 1 quantity').fill('3');
  await edit.getByRole('button', { name: '+ Add item' }).click();
  await expect(edit.getByLabel('Item 5 dish')).toBeFocused();
  await edit.getByLabel('Item 5 dish').fill('samosa');
  await edit.getByRole('listbox', { name: 'Dishes on the menu' }).getByRole('option', { name: /^Samosa \(2\)/ }).click();
  await expect(edit.getByLabel('Item 5 quantity')).toBeFocused();
  await edit.getByLabel('Item 5 quantity').fill('25');
  await edit.getByLabel('Item 5 unit').selectOption('Pieces');
  await edit.getByLabel('Number of people (optional)').fill('50');
  await kitchen.waitForTimeout(400);
  await shot(kitchen, 'kitchen-edit-form');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toHaveCount(0);

  // Saved with a Kitchen history entry.
  const o = (await readCollection<CateringOrder>(kitchen, 'orders')).find((x) => x.customerName === 'Priya Sharma')!;
  expect(o.people).toBe(50);
  expect(o.history).toHaveLength(1);
  expect(o.history![0]).toMatchObject({
    by: 'kitchen',
    // The old order had no raita or salan, so none are added; the new samosas bring their chutneys.
    changes: ['People: 40 → 50', 'Items: Chicken dum biryani, 2 large trays → Chicken Dum Biryani, 3 Full trays', 'Item added: Samosa (2), 25 pieces', 'Item added: Mint Chutney, 38 oz (extra)', 'Item added: Tamarind Chutney, 38 oz (extra)'],
  });

  // Tablet card shows only the updated order, no change history.
  await expect(card).toContainText('50 people');
  await expect(card).not.toContainText('Changed by');
  await expect(card.getByTestId('edit-history')).toHaveCount(0);
  await shot(kitchen, 'kitchen-card-updated');

  // Manager details show the same history, newest first, after a manager edit.
  await manager.getByRole('button', { name: /Priya Sharma/ }).click();
  const details = manager.getByRole('dialog', { name: 'Order details' });
  await expect(details.getByTestId('edit-history')).toContainText('Kitchen');
  await expect(details.getByTestId('edit-history')).toContainText('Item added: Samosa (2), 25 pieces');
  await details.getByRole('button', { name: 'Edit' }).click();
  const mEdit = manager.getByRole('dialog', { name: 'Edit order' });
  await mEdit.getByLabel('Time').fill('18:00');
  await mEdit.getByRole('button', { name: 'Save changes' }).click();
  await expect(mEdit).toHaveCount(0);
  await manager.getByRole('button', { name: /Priya Sharma/ }).click();
  const entries = details.getByTestId('edit-history').locator('.c-hist-entry');
  await expect(entries).toHaveCount(2);
  await expect(entries.first()).toContainText('Manager');
  await expect(entries.first()).toContainText('Time: 5:30 PM → 6:00 PM');
  await manager.waitForTimeout(400);
  await details.getByTestId('edit-history').scrollIntoViewIfNeeded();
  await shot(manager, 'manager-order-history');

  // The tablet shows the manager's change at once (the new time only, no history).
  await expect(card.locator('.k-due')).toHaveText('6:00 PM');
  await expect(card.getByTestId('edit-history')).toHaveCount(0);

  // Saving with nothing changed adds no entry.
  await details.getByRole('button', { name: 'Edit' }).click();
  await mEdit.getByRole('button', { name: 'Save changes' }).click();
  await expect(mEdit).toHaveCount(0);
  const again = (await readCollection<CateringOrder>(manager, 'orders')).find((x) => x.customerName === 'Priya Sharma')!;
  expect(again.history).toHaveLength(2);
  await context.close();
});

test('order items: old orders get structured once, unclear lines ask to be checked, units are remembered', async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 1, viewport: { width: 390, height: 844 } });
  const manager = await openScreen(context, '/manager/catering');
  const desert = async () => (await readCollection<CateringOrder>(manager, 'orders')).find((o) => o.customerName === 'Desert Tech office')!;
  // The sample orders were saved as text only. The Catering tab adds structured lines once, leaving the text alone.
  await expect.poll(async () => (await readCollection<CateringOrder>(manager, 'orders')).filter((o) => Array.isArray(o.lines)).length).toBe(3);
  const old = await desert();
  expect(old.items).toBe('Paneer butter masala, 1 tray\nButter chicken, 1 tray\nJeera rice, 2 trays\nGarlic naan, 30');
  expect(old.history).toBeUndefined();
  expect(old.lines![0]).toEqual({ dishId: 'veg-curries-1', name: 'Paneer Butter Masala', qty: 1, unit: 'Full tray', note: '', text: 'Paneer butter masala, 1 tray', check: true });
  expect(old.lines![3]).toEqual({ dishId: 'rice-breads-4', name: 'Garlic Naan', qty: 30, unit: '', note: '', text: 'Garlic naan, 30' });

  // The summary reads as before, with the guessed lines marked.
  await manager.getByRole('button', { name: /Desert Tech office/ }).click();
  const details = manager.getByRole('dialog', { name: 'Order details' });
  await expect(details.getByRole('listitem').first()).toHaveText('Paneer butter masala, 1 tray Check');
  await expect(details.getByTestId('items-to-check')).toHaveText('3 items were read automatically. Tap Edit to check them, then Save.');
  await manager.waitForTimeout(400);
  await details.getByTestId('items-to-check').scrollIntoViewIfNeeded();
  await shot(manager, 'manager-old-order-check');

  // Edit: each guessed row says how it was typed. Fixing it clears the mark; saving checks the rest.
  await details.getByRole('button', { name: 'Edit' }).click();
  const edit = manager.getByRole('dialog', { name: 'Edit order' });
  await expect(edit.getByLabel('Item 1 unit')).toHaveValue('Full tray');
  await expect(edit.getByText('Please check this item: it was typed as “Paneer butter masala, 1 tray”.')).toBeVisible();
  await edit.getByLabel('Item 1 unit').selectOption('Half tray');
  await expect(edit.getByText(/typed as “Paneer butter masala/)).toHaveCount(0);
  await edit.getByLabel('Item 3 dish').scrollIntoViewIfNeeded();
  await manager.waitForTimeout(300);
  await shot(manager, 'manager-edit-old-order');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toHaveCount(0);
  const fixed = await desert();
  expect(fixed.items).toBe('Paneer Butter Masala, 1 Half tray\nButter chicken, 1 tray\nJeera rice, 2 trays\nGarlic naan, 30');
  expect(fixed.history![0].changes).toEqual(['Items: Paneer butter masala, 1 tray → Paneer Butter Masala, 1 Half tray']);
  expect(fixed.lines!.some((l) => l.check)).toBe(false);
  await manager.getByRole('button', { name: /Desert Tech office/ }).click();
  await expect(details.getByTestId('items-to-check')).toHaveCount(0);
  await manager.keyboard.press('Escape');

  // A new order: the unit picked last is the first row's unit. Suggestions come from the menu as you type.
  await manager.getByRole('button', { name: '+ New order' }).click();
  const sheet = manager.getByRole('dialog', { name: 'New order' });
  await expect(sheet.getByLabel('Item 1 unit')).toHaveValue('Half tray');
  await sheet.getByLabel('Item 1 dish').fill('chick');
  const suggestions = sheet.getByRole('listbox', { name: 'Dishes on the menu' }).getByRole('option');
  await expect(suggestions).toHaveText([/^Chicken 65/, /^Chicken Tikka/, /^Chicken Dum Biryani/, /^Chicken Tikka Masala/, /^Butter Chicken/, /^Chilli Chicken/]);
  await sheet.getByLabel('Item 1 dish').fill('chick tik');
  await expect(suggestions).toHaveText([/^Chicken Tikka(Non-Veg Starters)$/, /^Chicken Tikka Masala/]);
  await manager.waitForTimeout(400);
  await shot(manager, 'manager-new-order-suggestions');
  await sheet.getByLabel('Item 1 dish').press('ArrowDown');
  await sheet.getByLabel('Item 1 dish').press('Enter');
  await expect(sheet.getByLabel('Item 1 dish')).toHaveValue('Chicken Tikka Masala');
  await expect(sheet.getByLabel('Item 1 quantity')).toBeFocused();
  await sheet.getByLabel('Item 1 quantity').fill('2');
  await sheet.getByLabel('Item 1 note').fill('mild');
  await sheet.getByLabel('Item 1 note').press('Enter'); // Enter in the last note starts the next item
  await expect(sheet.getByLabel('Item 2 dish')).toBeFocused();
  await sheet.getByLabel('Item 2 dish').fill('Kaju katli');
  await sheet.getByLabel('Item 2 quantity').fill('two');
  await expect(sheet.getByText('Not on the menu: saved as typed.')).toBeVisible();
  await sheet.getByLabel('Customer name').fill('Iyer Party');
  await sheet.getByLabel('Phone').fill('555 101 2020');
  await sheet.getByLabel('Time').fill('19:00');
  await sheet.getByRole('button', { name: 'Save order' }).click();
  await expect(sheet.getByText('Please check the quantity of item 2: enter a number like 2 or 1.5.')).toBeVisible();
  await expect(sheet.getByLabel('Item 2 quantity')).toBeFocused();
  await sheet.getByLabel('Item 2 quantity').fill('3');
  await sheet.getByLabel('Item 2 unit').selectOption('Lbs');
  await shot(manager, 'manager-new-order-items');
  await sheet.getByRole('button', { name: 'Save order' }).click();
  await expect(manager.getByRole('dialog', { name: 'Order saved' }).getByLabel('Message')).toContainText('• Chicken Tikka Masala, 2 Half trays (mild)\n• Kaju katli, 3 lbs');
  const saved = (await readCollection<CateringOrder>(manager, 'orders')).find((o) => o.customerName === 'Iyer Party')!;
  expect(saved.lines).toEqual([
    { dishId: 'nonveg-curries-1', name: 'Chicken Tikka Masala', qty: 2, unit: 'Half tray', note: 'mild' },
    { dishId: null, name: 'Kaju katli', qty: 3, unit: 'Lbs', note: '' },
  ]);
  await context.close();
});

test('print name tags: one tag per dish, veg or non-veg, printed 10 to a letter sheet', async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 1, viewport: { width: 390, height: 844 } });
  const manager = await openScreen(context, '/manager/catering');
  await expect(manager.getByRole('img', { name: 'Tabla Indian Restaurant' })).toBeVisible(); // the logo in the header
  await manager.getByRole('button', { name: /Priya Sharma/ }).click();
  await manager.getByRole('dialog', { name: 'Order details' }).getByRole('button', { name: /Print name tags/ }).click();
  const sheet = manager.getByRole('dialog', { name: 'Name tags' });
  const rows = sheet.getByTestId('tag-row');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0).getByRole('textbox')).toHaveValue('Chicken Dum Biryani');
  await expect(rows.nth(0).getByRole('button', { name: 'Non-veg' })).toHaveAttribute('aria-pressed', 'true');
  await expect(rows.nth(1).getByRole('textbox')).toHaveValue('Veg Dum Biryani');
  await expect(rows.nth(1).getByRole('button', { name: 'Veg', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(rows.nth(3).getByRole('textbox')).toHaveValue('Gulab Jamun');
  await manager.waitForTimeout(400);
  await shot(manager, 'manager-tags-sheet');

  // Fix a name, add one, remove one: the printout follows.
  await rows.nth(2).getByRole('textbox').fill('Cucumber Raita');
  await sheet.getByRole('button', { name: '+ Add a tag' }).click();
  await rows.nth(4).getByRole('textbox').fill('Mutton Kheema');
  await rows.nth(4).getByRole('button', { name: 'Non-veg' }).click();
  await sheet.getByRole('button', { name: 'Remove Gulab Jamun' }).click();
  await expect(sheet.getByRole('button', { name: 'Print 4 tags (1 sheet)' })).toBeEnabled();

  // On screen the tags are hidden; printing shows only them.
  await expect(manager.getByTestId('name-tag').first()).toBeHidden();
  await manager.emulateMedia({ media: 'print' });
  const tags = manager.getByTestId('name-tag');
  await expect(tags).toHaveCount(4);
  await expect(tags.nth(0)).toBeVisible();
  await expect(tags.nth(2)).toContainText('Cucumber Raita');
  await expect(tags.nth(3)).toContainText('Mutton Kheema');
  await expect(tags.nth(3)).toContainText('Non-vegetarian');
  await expect(tags.nth(1)).toContainText('Vegetarian');
  await expect(manager.getByRole('dialog', { name: 'Name tags' })).toBeHidden();
  await manager.emulateMedia({ media: 'screen' });

  // The Print button prints (window.print in a browser; the Android app's bridge when there is one).
  await manager.evaluate(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => void ((window as unknown as { printed: number }).printed += 1);
  });
  await sheet.getByRole('button', { name: 'Print 4 tags (1 sheet)' }).click();
  await expect.poll(() => manager.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);

  // Close goes back to the order.
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(manager.getByRole('dialog', { name: 'Order details' })).toBeVisible();
  await context.close();
});

test('print name tags on a phone: makes a PDF of the sheets for the phone\'s Share, or to save', async ({ browser }) => {
  const context = await newContext(browser, {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  });
  const manager = await openScreen(context, '/manager/catering');
  await manager.evaluate(() => {
    const w = window as unknown as { shared: { name: string; type: string; size: number }[]; printed: number };
    w.shared = [];
    w.printed = 0;
    window.print = () => void (w.printed += 1); // a home-screen app on a phone: print does nothing
    navigator.canShare = () => true;
    navigator.share = async (d?: ShareData) => {
      for (const f of d?.files ?? []) w.shared.push({ name: f.name, type: f.type, size: f.size });
    };
  });
  await manager.getByRole('button', { name: /Priya Sharma/ }).click();
  await manager.getByRole('dialog', { name: 'Order details' }).getByRole('button', { name: /Print name tags/ }).click();
  const sheet = manager.getByRole('dialog', { name: 'Name tags' });
  await expect(sheet.getByTestId('tag-row')).toHaveCount(4);
  await sheet.getByRole('button', { name: 'Print 4 tags (1 sheet)' }).click();

  // The PDF goes straight to the phone's Share sheet; Share and Save stay for another try.
  await expect(sheet.getByRole('status')).toContainText('The PDF is ready');
  const shared = await manager.evaluate(() => (window as unknown as { shared: { name: string; type: string; size: number }[] }).shared);
  expect(shared).toHaveLength(1);
  expect(shared[0].type).toBe('application/pdf');
  expect(shared[0].name).toMatch(/^Tags Priya Sharma .+\.pdf$/);
  expect(shared[0].size).toBeGreaterThan(50_000); // a drawn sheet, not an empty page
  expect(await manager.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(0);
  await expect(manager.getByTestId('name-tag').first()).toBeHidden(); // the sheets went back to hidden
  await shot(manager, 'manager-tags-pdf-ready');

  const [download] = await Promise.all([manager.waitForEvent('download'), sheet.getByRole('link', { name: 'Save PDF' }).click()]);
  const pdf = readFileSync(await download.path());
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.toString('latin1')).toContain('/Count 1 ');
  if (process.env.SHOT_DIR) await download.saveAs(`${SHOTS}/manager-tags.pdf`);

  // Changing a tag makes a new PDF on the next tap.
  await sheet.getByTestId('tag-row').nth(0).getByRole('textbox').fill('Chicken Biryani');
  await expect(sheet.getByRole('button', { name: 'Print 4 tags (1 sheet)' })).toBeEnabled();
  await context.close();
});

test('kitchen: Print tags on an order card uses the tablet app bridge, 2 sheets for 12 dishes', async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 1, viewport: { width: 1280, height: 800 } });
  const kitchen = await context.newPage();
  await kitchen.addInitScript(() => {
    (window as unknown as { jobs: string[] }).jobs = [];
    (window as unknown as { TablaPrint: { print: (n: string) => void } }).TablaPrint = { print: (n) => void (window as unknown as { jobs: string[] }).jobs.push(n) };
  });
  await kitchen.goto('/#/kitchen');
  for (const d of '1234') await kitchen.getByRole('button', { name: d, exact: true }).click();
  // Give Priya's order 12 dishes.
  await kitchenOption(kitchen, 'Priya Sharma', 'Edit order');
  const edit = kitchen.getByRole('dialog', { name: 'Edit order' });
  const dishes = [
    ['Rose Milk', '15', 'Gallons'], ['Reshampatti Chicken', '6', 'Full tray'], ['Kodi Vepudu', '5', 'Full tray'], ['Baby Corn Chilli', '4', 'Full tray'],
    ['Veg Hakka Noodles', '4', 'Full tray'], ['Mango Mudda Pappu Rice', '6', 'Full tray'], ['Donne Chicken Biryani', '6', 'Full tray'],
    ['Andhra Chicken Curry', '4', 'Full tray', 'Bone-in'], ['Phool Makhana Masala', '3', 'Half tray'], ['Madupu Karakam Podi'], ['Curd Rice', '4', 'Full tray'], ['Semiya Kheer', '4', 'Full tray'],
  ];
  await fillItems(edit, dishes.map(([dish, qty, unit, note]) => ({ dish, qty, unit, note })));
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toBeHidden();
  await kitchenOption(kitchen, 'Priya Sharma', 'Print name tags');
  const sheet = kitchen.getByRole('dialog', { name: 'Name tags' });
  await expect(sheet.getByTestId('tag-row')).toHaveCount(12);
  await kitchen.waitForTimeout(400);
  await shot(kitchen, 'kitchen-tags-sheet');
  await sheet.getByRole('button', { name: 'Print 12 tags (2 sheets)' }).click();
  await expect.poll(() => kitchen.evaluate(() => (window as unknown as { jobs: string[] }).jobs)).toEqual([expect.stringMatching(/^Tags Priya Sharma /)]);

  // The printout, as a PDF and as pictures for the eye check.
  await kitchen.emulateMedia({ media: 'print' });
  await expect(kitchen.getByTestId('name-tag')).toHaveCount(12);
  await kitchen.evaluate(() => document.fonts.ready);
  await kitchen.pdf({ path: `${SHOTS}/tags.pdf`, format: 'Letter', printBackground: true, preferCSSPageSize: true });
  await context.close();
});

test('order amount: manager only, kept apart from the order, never on the kitchen tablet', async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 1 });
  const manager = await openScreen(context, '/manager/catering');
  await manager.setViewportSize({ width: 390, height: 844 });
  const kitchen = await openScreen(context, '/kitchen');
  await kitchen.setViewportSize({ width: 1280, height: 800 });
  await typePin(kitchen, '1234');
  await expect(kitchen.getByTestId('kitchen-order')).toHaveCount(2);

  // New order with an amount. A bad amount is caught first.
  await manager.getByRole('button', { name: '+ New order' }).click();
  const sheet = manager.getByRole('dialog', { name: 'New order' });
  const tomorrow = await manager.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  await sheet.getByLabel('Customer name').fill('Mehta Party');
  await sheet.getByLabel('Phone').fill('555 444 1212');
  await sheet.getByLabel('Date').fill(tomorrow);
  await sheet.getByLabel('Time').fill('12:30');
  await fillItems(sheet, [{ dish: 'Veg biryani', qty: '2', unit: 'Full tray' }, { dish: 'Samosa', qty: '40', unit: 'Pieces' }]);
  const amount = sheet.getByLabel('Amount $ (optional)');
  await amount.fill('two hundred');
  await sheet.getByRole('button', { name: 'Save order' }).click();
  await expect(sheet.getByText('Please enter an amount like 200')).toBeVisible();
  await expect(amount).toBeFocused();
  await amount.fill('$1,250.50');
  await amount.scrollIntoViewIfNeeded();
  await manager.waitForTimeout(300);
  await shot(manager, 'manager-new-order-amount');
  await sheet.getByRole('button', { name: 'Save order' }).click();
  const saved = manager.getByRole('dialog', { name: 'Order saved' });
  await expect(saved.getByLabel('Message')).toContainText('Mehta Party');
  await expect(saved.getByLabel('Message')).not.toContainText('$'); // not in the WhatsApp message
  await expect(saved.getByLabel('Message')).not.toContainText('1,250');
  await saved.getByRole('button', { name: 'Done' }).click();

  // Stored in orderAmounts, not on the order.
  const orders = await readCollection<CateringOrder>(manager, 'orders');
  const o = orders.find((x) => x.customerName === 'Mehta Party')!;
  expect(o).not.toHaveProperty('amount');
  for (const x of orders) expect(JSON.stringify(x)).not.toContain('1250');
  const amounts = await readCollection<{ id: string; amount: number | null }>(manager, 'orderAmounts');
  expect(amounts.find((a) => a.id === o.id)?.amount).toBe(1250.5);

  // Manager list card and details show it.
  const mCard = manager.getByRole('button', { name: /Mehta Party/ });
  await expect(mCard).toContainText('$1,250.50 · Unpaid');
  await mCard.click();
  const details = manager.getByRole('dialog', { name: 'Order details' });
  await expect(details.getByTestId('order-amount')).toHaveText(/Amount\s*\$1,250\.50/);
  await manager.waitForTimeout(400);
  await shot(manager, 'manager-order-amount-details');

  // Kitchen: card, options, edit form and all orders never show it.
  const kCard = kitchen.getByRole('article', { name: 'Order for Mehta Party' });
  await expect(kCard).toBeVisible();
  await expect(kitchen.locator('body')).not.toContainText('1,250');
  await expect(kitchen.locator('body')).not.toContainText('Amount');
  await kitchenOption(kitchen, 'Mehta Party', 'Edit order');
  const kEdit = kitchen.getByRole('dialog', { name: 'Edit order' });
  await expect(kEdit.getByLabel('Customer name')).toHaveValue('Mehta Party');
  await expect(kEdit.getByTestId('amount-input')).toHaveCount(0);
  await expect(kEdit).not.toContainText('Amount');
  // A kitchen edit keeps the amount.
  await kEdit.getByLabel('Item 1 quantity').fill('3');
  await kEdit.getByRole('button', { name: 'Save changes' }).click();
  await expect(kEdit).toHaveCount(0);
  await expect(kitchen.locator('body')).not.toContainText('1,250');
  const afterKitchen = await readCollection<{ id: string; amount: number | null }>(manager, 'orderAmounts');
  expect(afterKitchen.find((a) => a.id === o.id)?.amount).toBe(1250.5);
  await expect(details.getByTestId('order-amount')).toContainText('$1,250.50');
  await expect(details.getByTestId('edit-history')).toContainText('Veg biryani, 3 Full trays');
  await expect(details.getByTestId('edit-history')).not.toContainText('$');

  // Manager changes the amount: no history entry (the kitchen sees the history), and the tablet still shows nothing.
  await details.getByRole('button', { name: 'Edit' }).click();
  const mEdit = manager.getByRole('dialog', { name: 'Edit order' });
  await expect(mEdit.getByLabel('Amount $ (optional)')).toHaveValue('1250.50');
  await mEdit.getByLabel('Amount $ (optional)').fill('200');
  await mEdit.getByRole('button', { name: 'Save changes' }).click();
  await expect(mEdit).toHaveCount(0);
  await expect(mCard).toContainText('$200 · Unpaid');
  // Marked paid from the order's summary (how and who are asked for).
  await mCard.click();
  await details.getByRole('button', { name: 'Mark paid', exact: true }).click();
  const pay = manager.getByRole('dialog', { name: 'Mark paid' });
  await pay.getByRole('button', { name: 'Cash' }).click();
  await pay.getByLabel('Taken by').selectOption('Siri');
  await pay.getByRole('button', { name: '✓ Mark paid' }).click();
  await expect(details.getByTestId('order-amount')).toContainText('✓ Paid');
  await details.getByRole('button', { name: 'Close' }).click();
  await expect(mCard).toContainText('$200 · Paid');
  const paidNow = await readCollection<{ id: string; amount: number | null; paid?: boolean }>(manager, 'orderAmounts');
  expect(paidNow.find((a) => a.id === o.id)).toMatchObject({ amount: 200, paid: true, method: 'cash', takenBy: 'Siri' });
  await mCard.click();
  await manager.waitForTimeout(400);
  await shot(manager, 'manager-order-paid-details');
  await details.getByRole('button', { name: 'Close' }).click();
  const after = (await readCollection<CateringOrder>(manager, 'orders')).find((x) => x.id === o.id)!;
  expect(after.history).toHaveLength(1);
  await expect(kitchen.getByText('Mehta Party').first()).toBeVisible();
  await expect(kitchen.locator('body')).not.toContainText('$200');
  await expect(kitchen.locator('body')).not.toContainText('Paid');
  await expect(kitchen.locator('body')).not.toContainText('paid');

  // Clearing it removes it from the card.
  await mCard.click();
  await details.getByRole('button', { name: 'Edit' }).click();
  await mEdit.getByLabel('Amount $ (optional)').fill('');
  await mEdit.getByRole('button', { name: 'Save changes' }).click();
  await expect(mEdit).toHaveCount(0);
  await mCard.click();
  await details.getByTestId('paid-row').getByRole('button', { name: 'Undo' }).click();
  await details.getByRole('button', { name: 'Tap to undo' }).click();
  await expect(details.getByTestId('payments')).toHaveCount(0);
  await details.getByRole('button', { name: 'Close' }).click();
  await expect(mCard).not.toContainText('$');
  await expect(mCard).not.toContainText('aid');
  await context.close();
});

test('mark paid: finished orders stay until paid, Unpaid count, deposits and who took it', async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 1 });
  const manager = await openScreen(context, '/manager/catering');
  await manager.setViewportSize({ width: 390, height: 844 });
  const kitchen = await openScreen(context, '/kitchen');
  await kitchen.setViewportSize({ width: 1280, height: 800 });
  await typePin(kitchen, '1234');

  // The sample's finished order (Rahul Verma) isn't paid: it stays in the list, and Unpaid counts it.
  const filter = manager.getByTestId('unpaid-filter');
  await expect(filter).toContainText('Unpaid1');
  await filter.click();
  const notPaid = manager.getByRole('region', { name: 'Unpaid' });
  const card = notPaid.getByRole('button', { name: /Rahul Verma/ });
  await expect(card).toContainText('Unpaid');
  await expect(card.getByText('Unpaid')).toHaveCount(1); // said once, in the badge
  await shot(manager, 'manager-unpaid-in-list');

  // Set the amount, then take a $100 deposit.
  await card.click();
  const details = manager.getByRole('dialog', { name: 'Order details' });
  await details.getByRole('button', { name: 'Edit' }).click();
  const edit = manager.getByRole('dialog', { name: 'Edit order' });
  await edit.getByLabel('Amount $ (optional)').fill('300');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await card.click();
  await details.getByRole('button', { name: 'Mark paid', exact: true }).click();
  const pay = manager.getByRole('dialog', { name: 'Mark paid' });
  await expect(pay.getByTestId('pay-totals')).toContainText('$300');
  await pay.getByRole('button', { name: 'Deposit' }).click();
  // Nothing chosen yet: each missing box says so.
  await pay.getByRole('button', { name: 'Save deposit' }).click();
  await expect(pay).toContainText('Please enter how much they paid.');
  await expect(pay).toContainText('Please choose how they paid.');
  await expect(pay).toContainText('Please choose who took the payment.');
  await pay.getByTestId('deposit-input').fill('300');
  await expect(pay).toContainText('whole balance');
  await pay.getByTestId('deposit-input').fill('100');
  await pay.getByRole('button', { name: 'Zelle' }).click();
  await pay.getByLabel('Taken by').selectOption('Tarun');
  await manager.waitForTimeout(300);
  await shot(manager, 'manager-mark-paid-deposit');
  await pay.getByRole('button', { name: 'Save deposit' }).click();
  await expect(details.getByTestId('payments')).toContainText('Deposit $100 · Zelle · Tarun');
  await expect(details.getByTestId('still-owed')).toContainText('$200 still owed');
  await expect(details.getByTestId('order-amount')).toContainText('$200 owed');
  await manager.waitForTimeout(300);
  await shot(manager, 'manager-order-deposit-details');
  await details.getByRole('button', { name: 'Close' }).click();
  await expect(card).toContainText('$300 · $200 owed');

  // The Unpaid view lists it with what's owed.
  await filter.click();
  await expect(manager.getByTestId('unpaid-list')).toContainText('$200 still owed');
  await expect(manager.getByTestId('unpaid-list')).not.toContainText('finished');
  await shot(manager, 'manager-unpaid-filter');

  // Paid in full: card, Siri took it. Saved with the time; it leaves the Unpaid list and the count goes.
  await manager.getByTestId('unpaid-list').getByRole('button', { name: /Rahul Verma/ }).click();
  await details.getByRole('button', { name: 'Mark paid', exact: true }).click();
  await expect(pay.getByRole('button', { name: 'Paid in full ($200)' })).toHaveAttribute('aria-pressed', 'true');
  await pay.getByRole('button', { name: 'Card' }).click();
  await pay.getByLabel('Taken by').selectOption('Siri');
  await pay.getByRole('button', { name: '✓ Mark paid' }).click();
  await expect(details.getByTestId('paid-row')).toContainText('✓ Paid in full · Card · Siri');
  await expect(details.getByRole('button', { name: 'Mark paid', exact: true })).toHaveCount(0);
  await manager.waitForTimeout(300);
  await shot(manager, 'manager-order-paid-full');
  await details.getByRole('button', { name: 'Close' }).click();
  await expect(manager.getByTestId('unpaid-list')).toContainText('Nothing to collect');
  await expect(filter).toHaveText('Unpaid');
  // (Every order in the list has an amount doc, paid: false until paid, so look it up by what was saved.)
  const saved = (await readCollection<Record<string, unknown>>(manager, 'orderAmounts')).find((a) => a.amount === 300)!;
  expect(saved).toMatchObject({ amount: 300, paid: true, method: 'card', takenBy: 'Siri', deposits: [{ amount: 100, method: 'zelle', takenBy: 'Tarun' }] });
  expect(typeof saved.paidAt).toBe('number');
  // Nothing about payments is on the order (the kitchen loads orders only).
  for (const o of await readCollection<CateringOrder>(manager, 'orders')) expect(JSON.stringify(o)).not.toMatch(/Zelle|zelle|paid|Siri|Tarun/);
  await kitchen.getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(kitchen.getByTestId('kitchen-calendar')).toBeVisible();
  await expect(kitchen.locator('body')).not.toContainText('Zelle');
  await expect(kitchen.locator('body')).not.toContainText('owed');
  await expect(kitchen.locator('body')).not.toContainText('paid');
  await context.close();
});

test('a paid order: changing its amount says it stays paid, also when another phone marked it paid meanwhile', async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 1 });
  const phone1 = await openScreen(context, '/manager/catering');
  const phone2 = await openScreen(context, '/manager/catering');
  for (const p of [phone1, phone2]) await p.setViewportSize({ width: 390, height: 844 });
  const open = async (p: Page) => {
    await p.getByTestId('unpaid-filter').click();
    await p.getByRole('region', { name: 'Unpaid' }).getByRole('button', { name: /Rahul Verma/ }).click();
    return p.getByRole('dialog', { name: 'Order details' });
  };
  // Phone 1 sets $300.
  let details = await open(phone1);
  await details.getByRole('button', { name: 'Edit' }).click();
  let edit = phone1.getByRole('dialog', { name: 'Edit order' });
  await edit.getByLabel('Amount $ (optional)').fill('300');
  await expect(edit.getByTestId('amount-paid-note')).toHaveCount(0); // not paid: no note
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toHaveCount(0);

  // Phone 2 opens the form and types $350 while phone 1 marks it paid.
  const details2 = await open(phone2);
  await details2.getByRole('button', { name: 'Edit' }).click();
  const edit2 = phone2.getByRole('dialog', { name: 'Edit order' });
  await expect(edit2.getByLabel('Amount $ (optional)')).toHaveValue('300');
  await edit2.getByLabel('Amount $ (optional)').fill('350');
  await expect(edit2.getByTestId('amount-paid-note')).toHaveCount(0);

  await phone1.getByRole('button', { name: /Rahul Verma/ }).first().click();
  details = phone1.getByRole('dialog', { name: 'Order details' });
  await details.getByRole('button', { name: 'Mark paid', exact: true }).click();
  const pay = phone1.getByRole('dialog', { name: 'Mark paid' });
  await pay.getByRole('button', { name: 'Card' }).click();
  await pay.getByLabel('Taken by').selectOption('Siri');
  await pay.getByRole('button', { name: '✓ Mark paid' }).click();
  await expect(details.getByTestId('paid-row')).toBeVisible();

  // Phone 2's open form now says so, before Save.
  await expect(edit2.getByTestId('amount-paid-note')).toHaveText("Already marked paid at $300. A new amount doesn't change that. If they owe more, tap Undo on the payment first.");
  await edit2.getByTestId('amount-paid-note').scrollIntoViewIfNeeded();
  await phone2.waitForTimeout(300);
  await shot(phone2, 'manager-amount-change-on-paid-order');
  // Typing the saved amount again: no change, no note.
  await edit2.getByLabel('Amount $ (optional)').fill('300');
  await expect(edit2.getByTestId('amount-paid-note')).toHaveCount(0);
  await context.close();
});

test('kitchen: small red notice at the top while offline, gone when the internet is back', async ({ browser }) => {
  const context = await newContext(browser, { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await openScreen(context, '/kitchen');
  await expect(page.getByRole('button', { name: '1', exact: true })).toBeVisible();
  const notice = page.getByTestId('kitchen-notice');
  await expect(notice).toHaveCount(0);
  await context.setOffline(true);
  await expect(notice).toContainText('Offline: showing the last saved orders');
  const box = await notice.boundingBox();
  expect(box && box.y < 40).toBe(true); // at the top of the screen
  await shot(page, 'kitchen-offline-pin');
  await typePin(page, '1234');
  await expect(page.getByRole('heading', { name: 'Open orders' })).toBeVisible();
  await expect(notice).toBeVisible(); // still there after unlocking
  await shot(page, 'kitchen-offline-board');
  await context.setOffline(false);
  await expect(notice).toHaveCount(0);
  await context.close();
});

test('kitchen list groups open orders by day, and Calendar shows the month with orders per day', async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 1, viewport: { width: 1280, height: 800 } });
  const page = await openScreen(context, '/kitchen');
  await expect(page.getByText('Enter the 4-digit PIN')).toBeVisible();
  // Seed has Priya today and Desert Tech tomorrow. Add one left open from 2 days ago and one in 10 days.
  await page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('tabla:orders') || '{}');
    const now = Date.now();
    const day = (n: number) => {
      const d = new Date();
      d.setDate(d.getDate() + n);
      d.setHours(13, 0, 0, 0);
      return d.getTime();
    };
    t.old = { id: 'old', customerName: 'Old Open Order', phone: '555', dueAt: day(-2), type: 'pickup', items: 'Samosa, 20', status: 'open', createdAt: now, updatedAt: now };
    t.far = { id: 'far', customerName: 'Far Future Party', phone: '555', dueAt: day(10), type: 'pickup', items: 'Naan, 50', status: 'open', createdAt: now, updatedAt: now };
    localStorage.setItem('tabla:orders', JSON.stringify(t));
  });
  await page.reload();
  await typePin(page, '1234');

  const groups = page.getByTestId('kitchen-group');
  await expect(groups).toHaveCount(4);
  await expect(groups.nth(0).getByRole('heading')).toContainText('Not completed from earlier days');
  await expect(groups.nth(0).getByRole('article', { name: 'Order for Old Open Order' })).toBeVisible();
  await expect(groups.nth(1).getByRole('heading')).toHaveText('Today');
  await expect(groups.nth(1).getByRole('article', { name: 'Order for Priya Sharma' })).toBeVisible();
  await expect(groups.nth(2).getByRole('heading')).toContainText('Tomorrow');
  await expect(groups.nth(2).getByRole('article', { name: 'Order for Desert Tech office' })).toBeVisible();
  await expect(groups.nth(3).getByRole('heading')).toContainText('Later');
  await expect(groups.nth(3).getByRole('article', { name: 'Order for Far Future Party' })).toBeVisible();
  await shot(page, 'kitchen-by-day');

  // Calendar: the month with a count per day; tap a day to see its orders, an open one opens its options.
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
  const cal = page.getByTestId('kitchen-calendar');
  const long = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  await expect(cal.getByRole('button', { name: `${long(today)}: 1 order` })).toBeVisible();
  await expect(cal.getByTestId('kitchen-cal-row')).toHaveCount(1);
  await expect(cal.getByTestId('kitchen-cal-row')).toContainText('Priya Sharma');
  await shot(page, 'kitchen-calendar');
  if (tomorrow.getMonth() !== today.getMonth()) await cal.getByRole('button', { name: 'Next month' }).click();
  await cal.getByRole('button', { name: `${long(tomorrow)}: 1 order` }).click();
  await cal.getByTestId('kitchen-cal-row').filter({ hasText: 'Desert Tech office' }).click();
  // The whole order shows above the same options as a list card: items, Mark completed, Edit, name tags.
  const sheet = page.getByRole('dialog', { name: 'Desert Tech office' });
  const details = sheet.getByTestId('kitchen-order-details');
  await expect(details).toBeVisible();
  await expect(details.locator('.k-items li').first()).toBeVisible();
  await expect(details).not.toContainText('$');
  await expect(sheet.getByRole('button', { name: 'Edit order' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: /Print name tags/ })).toBeVisible();
  await page.waitForTimeout(500); // let the sheet finish sliding in
  await shot(page, 'kitchen-calendar-order');
  await sheet.getByRole('button', { name: /Mark completed/ }).click();
  await expect(sheet).toHaveCount(0);
  const row = cal.getByTestId('kitchen-cal-row').filter({ hasText: 'Desert Tech office' });
  await expect(row).toContainText('Completed');
  // A completed order opens too, with Reopen in place of Mark completed.
  await row.click();
  await expect(details).toContainText('Completed');
  await sheet.getByRole('button', { name: /Reopen order/ }).click();
  await expect(sheet.getByRole('button', { name: /Mark completed/ })).toBeVisible();
  await expect(row).toContainText('Open');
  await page.keyboard.press('Escape');

  // Portrait: month above the day's orders, nothing runs off the side. In a fresh page: the kitchen goes
  // full screen once touched, and a full-screen window can't be resized.
  const tall = await context.newPage();
  await tall.setViewportSize({ width: 800, height: 1280 });
  await tall.goto('/#/kitchen');
  await tall.getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(tall.getByRole('heading', { name: 'Calendar' })).toBeVisible();
  const fits = () => tall.evaluate(() => [...document.querySelectorAll('.k-root *')].every((el) => el.getBoundingClientRect().right <= window.innerWidth + 1));
  expect(await fits()).toBe(true);
  await shot(tall, 'kitchen-calendar-portrait');

  await tall.getByRole('button', { name: 'List', exact: true }).click();
  await expect(tall.getByRole('heading', { name: 'Open orders' })).toBeVisible();
  expect(await fits()).toBe(true);
  await shot(tall, 'kitchen-by-day-portrait');
  await context.close();
});

test('kitchen: the Calendar view goes back to the open orders list after 3 minutes with no touch', async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 1, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.clock.install();
  await page.goto('/#/kitchen');
  await typePin(page, '1234');
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
  await page.clock.runFor(181_000);
  await expect(page.getByRole('heading', { name: 'Open orders' })).toBeVisible();
  await context.close();
});

test('kitchen: the countdown shows only in the last hour, and in red once the time has passed', async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 1, viewport: { width: 1280, height: 800 } });
  const page = await openScreen(context, '/kitchen');
  await expect(page.getByText('Enter the 4-digit PIN')).toBeVisible();
  await page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('tabla:orders') || '{}');
    for (const o of Object.values(t) as { status: string }[]) o.status = 'completed';
    const now = Date.now();
    const add = (id: string, name: string, inMin: number) =>
      (t[id] = { id, customerName: name, phone: '555', type: 'pickup', items: 'Samosa, 20', status: 'open', createdAt: now, updatedAt: now, dueAt: now + inMin * 60_000, kitchenAckFor: now + inMin * 60_000 });
    add('later', 'Two Hours Away', 120);
    add('soon', 'Forty Away', 40);
    add('late', 'Late Party', -25);
    localStorage.setItem('tabla:orders', JSON.stringify(t));
  });
  await page.reload();
  await typePin(page, '1234');
  const card = (name: string) => page.getByRole('article', { name: `Order for ${name}` });
  await expect(card('Two Hours Away')).toBeVisible();
  await expect(card('Two Hours Away').locator('.k-countdown')).toHaveCount(0);
  await expect(card('Forty Away').locator('.k-countdown')).toHaveText(/^in (39|40) min$/);
  const late = card('Late Party').locator('.k-countdown');
  await expect(late).toHaveText(/^2[56] min late$/);
  await expect(late).toHaveClass(/late/);
  await shot(page, 'kitchen-countdown-last-hour');
});

test('tapping a delivery address offers Copy (and Open in Maps in the manager app)', async ({ browser }) => {
  const addr = '1200 W Main St, Suite 300'; // seeded Desert Tech delivery
  const context = await newContext(browser, { deviceScaleFactor: 1, viewport: { width: 390, height: 844 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const manager = await openScreen(context, '/manager/catering');
  await manager.getByRole('button', { name: /Desert Tech office/ }).click();
  const summary = manager.getByRole('dialog', { name: 'Order details' });
  await expect(summary.getByTestId('copy-address')).toHaveCount(0);
  await summary.getByTestId('address').click();
  await expect(summary.getByRole('link', { name: 'Open in Maps' })).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr));
  await summary.getByRole('button', { name: 'Copy address' }).click();
  await expect(summary.getByRole('button', { name: '✓ Copied' })).toBeVisible();
  expect(await manager.evaluate(() => navigator.clipboard.readText())).toBe(addr);
  await manager.waitForTimeout(300);
  await shot(manager, 'manager-address-copy');
  await expect(summary.getByRole('button', { name: 'Copy address' })).toBeVisible({ timeout: 4000 });

  // Kitchen: the card shows the address as plain text (a tap opens the order's options, like the rest of
  // the card); Copy address is in the full order opened from the Calendar.
  await manager.evaluate(() => navigator.clipboard.writeText(''));
  const kitchen = await context.newPage();
  await kitchen.setViewportSize({ width: 1280, height: 800 });
  await kitchen.goto('/#/kitchen');
  await typePin(kitchen, '1234');
  const card = kitchen.getByRole('article', { name: 'Order for Desert Tech office' });
  await expect(card.getByText(addr)).toBeVisible();
  await expect(card.getByTestId('address')).toHaveCount(0);
  // And in the full order opened from the Calendar.
  await kitchen.getByRole('button', { name: 'Calendar', exact: true }).click();
  const cal = kitchen.getByTestId('kitchen-calendar');
  const long = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (tomorrow.getMonth() !== today.getMonth()) await cal.getByRole('button', { name: 'Next month' }).click();
  await cal.getByRole('button', { name: `${long(tomorrow)}: 1 order` }).click();
  await cal.getByTestId('kitchen-cal-row').filter({ hasText: 'Desert Tech office' }).click();
  const full = kitchen.getByRole('dialog', { name: 'Desert Tech office' }).getByTestId('kitchen-order-details');
  await full.getByTestId('address').click();
  await full.getByRole('button', { name: 'Copy address' }).click();
  expect(await kitchen.evaluate(() => navigator.clipboard.readText())).toBe(addr);
  await shot(kitchen, 'kitchen-address-copy');
  await context.close();
});

test('auto extras: biryani brings raita and salan, samosas their chutneys; they follow the dishes until changed by hand', async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 1 });
  const manager = await openScreen(context, '/manager/catering');
  await manager.setViewportSize({ width: 390, height: 844 });
  await manager.getByRole('button', { name: '+ New order' }).click();
  const sheet = manager.getByRole('dialog', { name: 'New order' });
  await sheet.getByLabel('Customer name').fill('Extras Test');
  await sheet.getByLabel('Phone').fill('555 777 8888');
  await sheet.getByLabel('Time').fill('23:30');
  await fillItems(sheet, [
    { dish: 'chick bir', pick: 'Chicken Dum Biryani', qty: '1', unit: 'Half tray' },
    { dish: 'samosa', pick: 'Samosa', qty: '20', unit: 'Pieces' },
  ]);
  const qty = (extra: string) => sheet.getByLabel(`Extra ${extra} quantity`);
  const unit = (extra: string) => sheet.getByLabel(`Extra ${extra} unit`);
  // Half tray of biryani: 24 oz each. 20 samosas: 20 oz each, so the 24 oz container.
  await expect(sheet.getByTestId('extra-row')).toHaveCount(4);
  await expect(qty('Raita')).toHaveValue('24');
  await expect(unit('Raita')).toHaveValue('Oz');
  await expect(qty('Salan')).toHaveValue('24');
  await expect(qty('Mint Chutney')).toHaveValue('24');
  await expect(qty('Tamarind Chutney')).toHaveValue('24');
  // A full tray of biryani: 1/4 tray each.
  await sheet.getByLabel('Item 1 unit').selectOption('Full tray');
  await expect(qty('Raita')).toHaveValue('0.25');
  await expect(unit('Raita')).toHaveValue('Full tray');
  await sheet.getByText('Extras, added for the dishes above').scrollIntoViewIfNeeded();
  await shot(manager, 'manager-order-extras');
  // Taken off: stays off. Changed by hand: stays as typed when the biryani changes.
  await sheet.getByRole('button', { name: 'Remove extra Salan' }).click();
  await qty('Raita').fill('38');
  await unit('Raita').selectOption('Oz');
  await sheet.getByLabel('Item 1 quantity').fill('2');
  await expect(sheet.getByLabel('Extra Salan quantity')).toHaveCount(0);
  await expect(qty('Raita')).toHaveValue('38');
  await expect(sheet.getByText('Changed by hand: stays as it is.')).toBeVisible();
  // A new dish row goes above the extras.
  await sheet.getByRole('button', { name: '+ Add item' }).click();
  await expect(sheet.getByLabel('Item 3 dish')).toBeFocused();
  await sheet.getByLabel('Item 3 dish').fill('Gulab jamun');
  await expect(sheet.getByLabel('Item 3 unit')).toHaveValue('Full tray'); // the last dish unit, not the extra's Oz
  await sheet.getByLabel('Item 3 quantity').fill('50');
  await sheet.getByLabel('Item 3 unit').selectOption('Pieces');
  await sheet.getByRole('button', { name: 'Save order' }).click();
  await expect(sheet).toHaveCount(0);

  const saved = (await readCollection<CateringOrder>(manager, 'orders')).find((o) => o.customerName === 'Extras Test')!;
  expect(saved.items).toBe(
    'Chicken Dum Biryani, 2 Full trays\nSamosa (2), 20 pieces\nGulab Jamun, 50 pieces\nRaita, 38 oz (extra)\nMint Chutney, 24 oz (extra)\nTamarind Chutney, 24 oz (extra)',
  );
  expect(saved.lines![3]).toMatchObject({ name: 'Raita', extra: 'Raita', extraEdited: true });
  expect(saved.lines![4]).toMatchObject({ name: 'Mint Chutney', extra: 'Mint Chutney' });
  expect(saved.lines![4].extraEdited).toBeUndefined();
  // The WhatsApp message carries them.
  const message = manager.getByRole('dialog', { name: 'Order saved' }).getByLabel('Message');
  await expect(message).toContainText('• Raita, 38 oz (extra)\n• Mint Chutney, 24 oz (extra)');

  // Opened again: Salan (taken off) doesn't come back; the samosa extras still follow the samosas.
  await manager.getByRole('dialog', { name: 'Order saved' }).getByRole('button', { name: 'Done' }).click();
  await manager.getByRole('button', { name: /Extras Test/ }).click();
  await manager.getByRole('dialog', { name: 'Order details' }).getByRole('button', { name: 'Edit' }).click();
  const edit = manager.getByRole('dialog', { name: 'Edit order' });
  await edit.getByLabel('Item 2 quantity').fill('40');
  await expect(edit.getByLabel('Extra Mint Chutney quantity')).toHaveValue('0.25');
  await expect(edit.getByLabel('Extra Tamarind Chutney unit')).toHaveValue('Full tray');
  await expect(edit.getByLabel('Extra Salan quantity')).toHaveCount(0);
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toHaveCount(0);

  // Kitchen: the extras are on the card, marked, and in Prep.
  const kitchen = await openScreen(context, '/kitchen');
  await kitchen.setViewportSize({ width: 1280, height: 800 });
  await typePin(kitchen, '1234');
  const card = kitchen.getByRole('article', { name: 'Order for Extras Test' });
  await expect(card.getByRole('listitem').filter({ hasText: 'Raita' })).toHaveText('38 oz Raita Extra');
  await expect(card.getByRole('listitem').filter({ hasText: 'Mint Chutney' })).toHaveText('1/4 Full tray Mint Chutney Extra');
  await card.scrollIntoViewIfNeeded();
  await shot(kitchen, 'kitchen-order-extras');
  await kitchen.getByRole('button', { name: 'Prep', exact: true }).click();
  await expect(kitchen.getByText('Raita', { exact: true })).toBeVisible();
  await shot(kitchen, 'kitchen-prep-extras');
  await context.close();
});

test('phone Back closes an open sheet through the same "Discard" question, and never leaves the page', async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 1, viewport: { width: 390, height: 844 } });
  const manager = await openScreen(context, '/manager/catering');
  const url = manager.url();
  // Nothing typed: Back just closes the form.
  await manager.getByRole('button', { name: '+ New order' }).click();
  const sheet = manager.getByRole('dialog', { name: 'New order' });
  await expect(sheet).toBeVisible();
  await manager.goBack();
  await expect(sheet).toHaveCount(0);
  expect(manager.url()).toBe(url);
  // Something typed: Back asks first; Keep editing keeps it, and Back asks again; Discard closes.
  await manager.getByRole('button', { name: '+ New order' }).click();
  await sheet.getByLabel('Customer name').fill('Back Test');
  await manager.goBack();
  const ask = manager.getByRole('dialog', { name: 'Discard this order?' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Keep editing' }).click();
  await expect(sheet.getByLabel('Customer name')).toHaveValue('Back Test');
  await manager.goBack();
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Discard' }).click();
  await expect(manager.getByRole('dialog')).toHaveCount(0);
  expect(manager.url()).toBe(url);
  // A sheet closed with its own button leaves no extra Back step behind: Back goes to the page before.
  await manager.getByRole('button', { name: '+ New order' }).click();
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet).toHaveCount(0);
  await manager.waitForTimeout(200);
  expect(manager.url()).toBe(url);
  // Opening one order from another sheet (Calendar) still closes with one Back.
  await manager.getByRole('button', { name: 'Calendar' }).click();
  await manager.getByRole('dialog', { name: 'Calendar' }).getByRole('button', { name: /Priya Sharma/ }).click();
  const details = manager.getByRole('dialog', { name: 'Order details' });
  await expect(details).toBeVisible();
  await manager.goBack();
  await expect(manager.getByRole('dialog')).toHaveCount(0);
  expect(manager.url()).toBe(url);
  await context.close();
});

test('an order time already passed: a soft warning, still saves', async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 1, viewport: { width: 390, height: 844 } });
  const manager = await openScreen(context, '/manager/catering');
  await manager.getByRole('button', { name: '+ New order' }).click();
  const sheet = manager.getByRole('dialog', { name: 'New order' });
  await sheet.getByLabel('Customer name').fill('Late Lunch');
  await sheet.getByLabel('Phone').fill('555 999 0000');
  const y = new Date(Date.now() - 24 * 3600_000);
  const ymd = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  await sheet.getByLabel('Date').fill(ymd);
  await sheet.getByLabel('Time').fill('12:00');
  await expect(sheet.getByTestId('past-time')).toHaveText('This time has already passed. Did you mean tomorrow?');
  await fillItems(sheet, [{ dish: 'Samosa', qty: '10', unit: 'Pieces' }]);
  await shot(manager, 'manager-form-past-time');
  await sheet.getByRole('button', { name: 'Save order' }).click();
  await expect(manager.getByTestId('order-saved')).toBeVisible();
  // Done sits above Share, which takes Save's place at the bottom.
  const saved = manager.getByTestId('order-saved');
  const done = (await saved.getByRole('button', { name: 'Done' }).boundingBox())!;
  const share = (await saved.getByRole('link', { name: 'Share to WhatsApp' }).boundingBox())!;
  expect(share.y).toBeGreaterThan(done.y);
  await context.close();
});

test('deposits that add up to the amount count as paid; the amount cannot be cleared once deposits exist', async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 1, viewport: { width: 390, height: 844 } });
  const manager = await openScreen(context, '/manager/catering');
  await manager.getByTestId('unpaid-filter').click();
  const card = manager.getByRole('region', { name: 'Unpaid' }).getByRole('button', { name: /Rahul Verma/ });
  await card.click();
  const details = manager.getByRole('dialog', { name: 'Order details' });
  // Deposit with no amount yet: "paid so far".
  await details.getByRole('button', { name: 'Mark paid', exact: true }).click();
  const pay = manager.getByRole('dialog', { name: 'Mark paid' });
  await pay.getByRole('button', { name: 'Deposit' }).click();
  await pay.getByTestId('deposit-input').fill('abc');
  await pay.getByRole('button', { name: 'Cash' }).click();
  await pay.getByLabel('Taken by').selectOption('Tarun');
  await pay.getByRole('button', { name: 'Save deposit' }).click();
  await expect(pay).toContainText('Please enter an amount like 100 or 100.50.');
  await pay.getByTestId('deposit-input').fill('100');
  await pay.getByRole('button', { name: 'Save deposit' }).click();
  await expect(details.getByTestId('order-amount')).toContainText('$100 paid so far');
  // The amount can't be cleared now.
  await details.getByRole('button', { name: 'Edit' }).click();
  const edit = manager.getByRole('dialog', { name: 'Edit order' });
  await edit.getByLabel('Amount $ (optional)').fill('250');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toHaveCount(0);
  await card.click();
  await details.getByRole('button', { name: 'Edit' }).click();
  await edit.getByLabel('Amount $ (optional)').fill('');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toContainText('Deposits already taken. Enter the full amount.');
  await edit.getByLabel('Amount $ (optional)').fill('100');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toHaveCount(0);
  // $100 of $100 in deposits: paid. Off the Unpaid list, no Mark paid, no count.
  await expect(manager.getByRole('region', { name: 'Unpaid' })).toHaveCount(0);
  await expect(manager.getByTestId('unpaid-filter')).toHaveText('Unpaid');
  await context.close();
});

test('calendar: moving to another month clears the day list until a day there is tapped', async ({ browser }) => {
  const context = await newContext(browser, { deviceScaleFactor: 1, viewport: { width: 390, height: 844 } });
  const manager = await openScreen(context, '/manager/catering');
  await manager.getByRole('button', { name: 'Calendar' }).click();
  const cal = manager.getByRole('dialog', { name: 'Calendar' });
  await expect(cal.getByRole('region', { name: 'Orders that day' })).toBeVisible();
  await cal.getByRole('button', { name: 'Next month' }).click();
  await expect(cal.getByRole('region', { name: 'Orders that day' })).toHaveCount(0);
  await expect(cal).toContainText('Tap a day to see its orders.');
  await cal.getByRole('grid').getByRole('button').first().click();
  await expect(cal.getByRole('region', { name: 'Orders that day' })).toBeVisible();
  await shot(manager, 'manager-calendar');
  await context.close();
});

test('small phones: the Catering title is never cut short, and the Unpaid count fits', async ({ browser }) => {
  for (const width of [320, 375]) {
    const context = await newContext(browser, { viewport: { width, height: 667 } });
    const manager = await openScreen(context, '/manager/catering');
    const title = manager.getByRole('heading', { name: 'Catering' });
    await expect(title).toBeVisible();
    expect(await title.evaluate((h) => h.scrollWidth <= h.clientWidth)).toBe(true);
    const count = manager.getByTestId('unpaid-filter').locator('.c-count');
    await expect(count).toBeVisible();
    const box = await count.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(width - 16);
    await context.close();
  }
});

test('Mark paid on an order with no amount asks for the amount first and saves it on the order', async ({ browser }) => {
  const context = await newContext(browser, { viewport: { width: 390, height: 844 } });
  const manager = await openScreen(context, '/manager/catering');
  await manager.getByRole('button', { name: /Priya Sharma/ }).click();
  const details = manager.getByRole('dialog', { name: 'Order details' });
  await details.getByRole('button', { name: 'Mark paid', exact: true }).click();
  const pay = manager.getByRole('dialog', { name: 'Mark paid' });
  await pay.getByRole('button', { name: 'Cash' }).click();
  await pay.getByLabel('Taken by').selectOption({ index: 1 });
  await pay.getByRole('button', { name: '✓ Mark paid' }).click();
  await expect(pay.getByText('Please enter the order amount.')).toBeVisible();
  // A deposit doesn't ask for it.
  await pay.getByRole('button', { name: 'Deposit' }).click();
  await expect(pay.getByTestId('full-amount-input')).toHaveCount(0);
  await pay.getByRole('button', { name: /Paid in full/ }).click();
  await pay.getByTestId('full-amount-input').fill('640');
  await pay.getByRole('button', { name: '✓ Mark paid' }).click();
  await expect(details.getByTestId('order-amount')).toContainText('$640');
  await expect(details.getByTestId('order-amount')).toContainText('✓ Paid');
  const amounts = await readCollection<{ id: string; amount: number | null; paid?: boolean; itemsAt?: string | null }>(manager, 'orderAmounts');
  const a = amounts.find((x) => x.amount === 640)!;
  expect(a).toMatchObject({ amount: 640, paid: true, method: 'cash' });
  expect(a.itemsAt).toBeTruthy();
  await context.close();
});
