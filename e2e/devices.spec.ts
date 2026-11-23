import { expect, test, type Page } from '@playwright/test';
import { openScreen } from './helpers';

// More > Devices and the restaurant code screen. In the local store a browser tab is one device.
const SHOTS = process.env.SHOT_DIR || 'test-results/devices-shots';
const shot = (p: Page, name: string) => p.screenshot({ path: `${SHOTS}/${name}.png` });

test.setTimeout(60_000);
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });

async function typeCode(page: Page, code: string) {
  for (const d of code) await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByTestId('access-ok').click();
}

test('open at first; set a code and lock; a new device needs the code once; removed devices are asked again', async ({ context }) => {
  // Staff hours "closed", so no kitchen alarm gets in the way.
  await context.addInitScript(() => {
    if (localStorage.getItem('tabla:singletons')) return;
    const days = Array.from({ length: 7 }, () => ({ closed: true }));
    localStorage.setItem('tabla:singletons', JSON.stringify({ staffConfig: { id: 'staffConfig', settings: { days } } }));
  });
  const manager = await openScreen(context, '/manager/more');
  await manager.getByTestId('devices').click();
  await expect(manager.getByRole('heading', { name: 'Open to anyone with a link' })).toBeVisible();
  // This phone added itself; Lock waits for a code.
  await expect(manager.getByTestId('dv-row')).toHaveCount(1);
  await expect(manager.getByText('This device')).toBeVisible();
  await expect(manager.getByTestId('dv-lock')).toBeDisabled();

  // A TV opened while open: no code asked, and it shows in the list.
  const tv = await openScreen(context, '/tv/1');
  await expect(tv.getByTestId('access-code')).toHaveCount(0);
  await expect(manager.getByTestId('dv-row')).toHaveCount(2);
  await expect(manager.getByTestId('dv-list')).toContainText('TV 1');
  await shot(manager, 'devices-open');

  // Set the code (too short can't be saved), then lock.
  await manager.getByTestId('dv-set-code').click();
  await manager.getByTestId('dv-code-input').fill('12345');
  await expect(manager.getByTestId('dv-code-save')).toBeDisabled();
  await manager.getByTestId('dv-code-input').fill('482913');
  await manager.getByTestId('dv-code-save').click();
  await expect(manager.getByTestId('dv-set-code')).toHaveText('Change');
  await manager.getByTestId('dv-lock').click();
  await manager.getByTestId('dv-confirm').click();
  await expect(manager.getByRole('heading', { name: 'Locked to these devices' })).toBeVisible();
  await shot(manager, 'devices-locked');

  // Devices already in the list keep working.
  await tv.reload();
  await expect(tv.getByTestId('access-code')).toHaveCount(0);

  // A new kitchen tablet: the code screen, a wrong code, then the right one opens the kitchen.
  const kitchen = await openScreen(context, '/kitchen');
  await kitchen.setViewportSize({ width: 1280, height: 800 });
  await expect(kitchen.getByTestId('access-code')).toBeVisible();
  await expect(kitchen.getByText('Enter the 4-digit PIN')).toHaveCount(0);
  await shot(kitchen, 'code-kitchen');
  await typeCode(kitchen, '111111');
  await expect(kitchen.getByText("That code didn't work. Please try again.")).toBeVisible();
  await typeCode(kitchen, '482913');
  await expect(kitchen.getByText('Enter the 4-digit PIN')).toBeVisible();
  await expect(manager.getByTestId('dv-row')).toHaveCount(3);

  // A new TV, typed with the keyboard (a remote's number keys), at TV size.
  const tv3 = await openScreen(context, '/tv/3');
  await tv3.setViewportSize({ width: 1920, height: 1080 });
  await expect(tv3.getByTestId('access-code')).toBeVisible();
  await shot(tv3, 'code-tv');
  await tv3.keyboard.type('482913');
  await tv3.getByTestId('access-ok').click();
  await expect(tv3.getByTestId('access-code')).toHaveCount(0);

  // A phone (front app) at phone size.
  const front = await openScreen(context, '/front');
  await expect(front.getByTestId('access-code')).toBeVisible();
  await shot(front, 'code-phone');

  // Rename TV 1, then remove it: it is asked for the code again.
  const tvRow = manager.getByTestId('dv-row').filter({ hasText: 'TV 1' });
  await tvRow.getByRole('button', { name: 'Rename' }).click();
  await manager.getByRole('dialog').getByRole('textbox').fill('Counter TV left');
  await manager.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(manager.getByTestId('dv-list')).toContainText('Counter TV left');
  await shot(manager, 'devices-list');
  await manager.getByTestId('dv-row').filter({ hasText: 'Counter TV left' }).getByTestId('dv-remove').click();
  await manager.getByTestId('dv-confirm').click();
  await expect(tv.getByTestId('access-code')).toBeVisible();
  // This device can't remove itself.
  await expect(manager.getByTestId('dv-row').filter({ hasText: 'This device' }).getByTestId('dv-remove')).toHaveCount(0);

  // Open again: the code screen goes away on its own.
  await manager.getByTestId('dv-unlock').click();
  await manager.getByTestId('dv-confirm').click();
  await expect(front.getByTestId('access-code')).toHaveCount(0);
});
