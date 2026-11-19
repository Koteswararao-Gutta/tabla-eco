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
  await sheet.getByLabel('Order items (one per line)').fill('Chicken dum biryani, 4 large trays\nPaneer butter masala, 2 trays\nGarlic naan, 150');
  await sheet.getByLabel('Notes (optional)').fill('Set up by 1 PM');
  await sheet.getByRole('button', { name: 'Save order' }).click();
  await expect(sheet.getByText('Please enter the delivery address.')).toBeVisible();
  await expect(sheet.getByLabel('Delivery address')).toBeFocused();
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
  // Upcoming days first: Today, then Tomorrow, then past days.
  const days = await kitchen.locator('.k-day-group h2').allTextContents();
  expect(days.slice(0, 2)).toEqual(['Today', 'Tomorrow']);
  expect(days.indexOf('Yesterday')).toBeGreaterThan(1);
  const row = kitchen.getByTestId('kitchen-row').filter({ hasText: 'Anika Wedding' });
  await expect(row).toContainText('✓ Completed');
  await expect(kitchen.getByTestId('kitchen-row').filter({ hasText: 'Rahul Verma' })).toContainText('✓ Completed');
  await shot(kitchen, 'kitchen-show-all');
  await row.getByRole('button', { name: 'Reopen' }).click();
  await expect(row).toContainText('Open');
  await kitchen.getByRole('button', { name: '← Back to open orders' }).click();
  await expect(card).toBeVisible();

  // The manager sees the kitchen's change and can complete / delete from the order summary.
  await manager.getByRole('button', { name: /Anika Wedding/ }).click();
  const summary = manager.getByRole('dialog', { name: 'Order details' });
  await expect(summary.getByText('Tomorrow, 1:30 PM')).toBeVisible();
  await expect(summary.getByText('48 Lake View Rd, Hall B')).toBeVisible();
  await expect(summary.getByRole('listitem')).toHaveText(['Chicken dum biryani, 4 large trays', 'Paneer butter masala, 2 trays', 'Garlic naan, 150']);
  await shot(manager, 'manager-order-summary');
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
  await expect(manager.getByText('Anika Wedding')).toHaveCount(0);
  expect((await readCollection<CateringOrder>(manager, 'orders')).some((o) => o.customerName === 'Anika Wedding')).toBe(false);

  await context.close();
});

test('kitchen stays unlocked on this tablet through a reload, until Lock or a new PIN', async ({ browser }) => {
  const context = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1024, height: 768 } });
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

test('kitchen heads-up shows over the PIN screen, rings every 45 s until Got it', async ({ browser }) => {
  const context = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1024, height: 768 } });
  // Count chimes and sound wake-ups with a stand-in for the browser's sound output.
  await context.addInitScript(() => {
    const w = window as unknown as { chimeNotes: number; audioResumes: number; AudioContext: unknown };
    w.chimeNotes = 0;
    w.audioResumes = 0;
    const Real = window.AudioContext;
    w.AudioContext = class extends Real {
      createOscillator() {
        w.chimeNotes++;
        return super.createOscillator();
      }
      resume() {
        w.audioResumes++;
        return super.resume();
      }
    };
  });
  const page = await context.newPage();
  await page.clock.install();
  await page.goto('/#/kitchen');
  await expect(page.getByText('Enter the 4-digit PIN')).toBeVisible();
  await page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('tabla:orders') || '{}');
    for (const o of Object.values(t) as { status: string }[]) o.status = 'completed';
    const now = Date.now();
    t.soon = { id: 'soon', customerName: 'Anita Rao', phone: '555', type: 'pickup', items: 'Samosa, 20', status: 'open', createdAt: now, updatedAt: now, dueAt: now + 30 * 60_000 };
    localStorage.setItem('tabla:orders', JSON.stringify(t));
  });
  await page.reload();
  const banner = page.getByTestId('kitchen-reminder');
  await expect(banner).toContainText('Anita Rao pickup at'); // locked, still shown
  await expect(page.getByText('Enter the 4-digit PIN')).toBeVisible();
  await shot(page, 'kitchen-reminder-locked');
  const notes = () => page.evaluate(() => (window as unknown as { chimeNotes: number }).chimeNotes);
  const first = await notes();
  expect(first).toBeGreaterThan(0); // rang once
  // A tap anywhere wakes the sound.
  await page.mouse.click(5, 760);
  expect(await page.evaluate(() => (window as unknown as { audioResumes: number }).audioResumes)).toBeGreaterThan(0);
  await page.clock.runFor(46_000);
  expect(await notes()).toBe(first * 2); // rang again
  await page.clock.runFor(45_000);
  expect(await notes()).toBe(first * 3);
  // Got it works without the PIN, and the ringing stops.
  await banner.getByRole('button', { name: 'Got it' }).click();
  await expect(banner).toHaveCount(0);
  await page.clock.runFor(100_000);
  expect(await notes()).toBe(first * 3);
  await expect(page.getByText('Enter the 4-digit PIN')).toBeVisible();
  await context.close();
});

test('kitchen: Show all orders goes back to open orders after 3 minutes with no touch', async ({ browser }) => {
  const context = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.clock.install();
  await page.goto('/#/kitchen');
  await typePin(page, '1234');
  await page.getByRole('button', { name: 'Show all orders' }).click();
  await expect(page.getByRole('heading', { name: 'All orders' })).toBeVisible();
  await page.clock.runFor(120_000);
  await page.mouse.click(640, 700); // a touch restarts the 3 minutes
  await page.clock.runFor(120_000);
  await expect(page.getByRole('heading', { name: 'All orders' })).toBeVisible();
  await page.clock.runFor(61_000);
  await expect(page.getByRole('heading', { name: 'Open orders' })).toBeVisible();
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
  await manager.getByRole('dialog', { name: 'Order details' }).getByRole('button', { name: 'Edit' }).click();
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

test('kitchen 1-hour heads-up: Got it is saved, a new time brings it back, late orders drop off', async ({ browser }) => {
  const context = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1280, height: 800 } });
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

  // Also shown on the all orders view.
  await page.getByRole('button', { name: 'Show all orders' }).click();
  await expect(banner).toContainText('Anita Rao');
  await page.getByRole('button', { name: '← Back to open orders' }).click();

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

test('kitchen: long names wrap, portrait all-orders rows fit, offline is clear', async ({ browser }) => {
  const context = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 800, height: 1280 } });
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
  await page.getByRole('button', { name: 'Show all orders' }).click();
  await expect(page.getByTestId('kitchen-row').first()).toBeVisible();
  expect(await page.evaluate(() => (document.querySelector('.k-root') as HTMLElement).scrollTop)).toBe(0);
  expect(await fits()).toBe(true);
  await shot(page, 'kitchen-portrait-all');
  await context.setOffline(true);
  await expect(page.getByText('Offline: showing the last saved orders')).toBeVisible();
  await context.close();
});

test('scan paper order fills the new order form for checking, then saves', async ({ browser }) => {
  const context = await browser.newContext({ deviceScaleFactor: 1 });
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
  await expect(sheet.getByLabel('Order items (one per line)')).toHaveValue('Veg biryani, 2 large trays\nGulab jamun, 50');
  await expect(sheet.getByText('Please check this')).toHaveCount(1); // the phone number
  await shot(manager, 'manager-scan-filled');
  await sheet.getByLabel('Phone').fill('555 404 1213');
  await expect(sheet.getByText('Please check this')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Save order' }).click();
  await expect(sheet).toHaveCount(0);
  const saved = (await readCollection<CateringOrder>(manager, 'orders')).find((o) => o.customerName === 'Meera Iyer')!;
  expect(saved).toMatchObject({ phone: '555 404 1213', people: 40, notes: 'Less spicy', status: 'open' });
  await context.close();
});

test('paste a customer message fills the new order form, then saves', async ({ browser }) => {
  const context = await browser.newContext({ deviceScaleFactor: 1 });
  const manager = await openScreen(context, '/manager/catering');
  await manager.setViewportSize({ width: 390, height: 844 });
  await manager.getByRole('button', { name: '+ New order' }).click();
  const sheet = manager.getByRole('dialog', { name: 'New order' });
  await sheet.getByRole('button', { name: '📋 Paste message' }).click();
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
  await expect(sheet.getByLabel('Order items (one per line)')).toHaveValue('Veg biryani, 2 large trays\nGulab jamun, 50');
  await shot(manager, 'manager-paste-filled');
  await sheet.getByRole('button', { name: 'Save order' }).click();
  await expect(sheet).toHaveCount(0);
  const saved = (await readCollection<CateringOrder>(manager, 'orders')).find((o) => o.customerName === 'Meera Iyer')!;
  expect(saved).toMatchObject({ people: 40, notes: 'Less spicy', status: 'open' });
  await context.close();
});

test('one tap on Paste message reads what was copied and fills the form', async ({ browser }) => {
  const context = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const manager = await openScreen(context, '/manager/catering');
  await manager.evaluate(() => navigator.clipboard.writeText('Hi, Meera here. 2 trays veg biryani and 50 gulab jamun tomorrow 6:30pm pickup'));
  await manager.getByRole('button', { name: '+ New order' }).click();
  const sheet = manager.getByRole('dialog', { name: 'New order' });
  await sheet.getByRole('button', { name: '📋 Paste message' }).click();
  await expect(sheet.getByText('Filled in from the message.')).toBeVisible();
  await expect(sheet.getByLabel("Customer's message")).toHaveCount(0); // no box, no extra tap
  await expect(sheet.getByLabel('Customer name')).toHaveValue('Meera Iyer');
  await context.close();
});

test('calendar shows the month, and a new order from it warns about a nearby order', async ({ browser }) => {
  const context = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 390, height: 844 } });
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
  const context = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 390, height: 844 } });
  const manager = await openScreen(context, '/manager/catering');
  const card = manager.getByTestId('alerts');
  await expect(card).toContainText('Get a phone alert 1 hour before each order.');
  await shot(manager, 'manager-alerts-off');
  await card.getByRole('button', { name: 'Turn on alerts' }).click();
  await expect(card).toContainText('This phone gets an alert 1 hour before each order.');
  await context.close();
});

test('catering list fits a phone with a long no-space customer name', async ({ browser }) => {
  const context = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 390, height: 844 } });
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
  const context = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 390, height: 844 } });
  const manager = await openScreen(context, '/manager/catering');
  await manager.getByRole('button', { name: /Priya Sharma/ }).click();
  const summary = manager.getByRole('dialog', { name: 'Order details' });
  await expect(summary.getByText('Today, 5:30 PM')).toBeVisible();
  await expect(summary.getByRole('link', { name: /Call 555 123 4567/ })).toHaveAttribute('href', 'tel:5551234567');
  await expect(summary.getByRole('listitem')).toHaveCount(4);
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
  const context = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 390, height: 844 } });
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
  await manager.keyboard.press('Escape');
  await expect(ask).toBeVisible();
  await manager.keyboard.press('Escape'); // Escape on the question = keep editing
  await expect(sheet.getByLabel('Customer name')).toHaveValue('Half typed');
  await manager.mouse.click(195, 10); // the dimmed backdrop above the sheet
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Discard' }).click();
  await expect(manager.getByRole('dialog')).toHaveCount(0);
  expect((await readCollection<CateringOrder>(manager, 'orders')).some((o) => o.customerName === 'Half typed')).toBe(false);

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

test('Mark completed in the edit form saves the typed changes too, and checks them first', async ({ browser }) => {
  const context = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 390, height: 844 } });
  const manager = await openScreen(context, '/manager/catering');
  await manager.getByRole('button', { name: /Priya Sharma/ }).click();
  await manager.getByRole('dialog', { name: 'Order details' }).getByRole('button', { name: 'Edit' }).click();
  const edit = manager.getByRole('dialog', { name: 'Edit order' });
  // An invalid change: shown, and the status is left alone.
  await edit.getByLabel('Customer name').fill('');
  await edit.getByRole('button', { name: 'Mark completed' }).click();
  await expect(edit.getByText("Please enter the customer's name.")).toBeVisible();
  const priya = async () => (await readCollection<CateringOrder>(manager, 'orders')).find((o) => o.phone === '555 123 4567')!;
  expect((await priya()).status).toBe('open');
  // Fixed: both the edits and the status are saved.
  await edit.getByLabel('Customer name').fill('Priya S.');
  await edit.getByLabel('Notes (optional)').fill('Extra raita');
  await edit.getByRole('button', { name: 'Mark completed' }).click();
  await expect(edit).toHaveCount(0);
  expect(await priya()).toMatchObject({ customerName: 'Priya S.', notes: 'Extra raita', status: 'completed', completedAt: expect.any(Number) });
  await expect(manager.getByRole('status').filter({ hasText: 'Marked completed' })).toBeVisible();
  await context.close();
});

test('Save stays visible at the bottom of a long order form', async ({ browser }) => {
  const context = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 390, height: 844 } });
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
  await context.close();
});
