import { expect, test, type Page } from '@playwright/test';
import { openScreen } from './helpers';

const SHOTS = process.env.SHOT_DIR || 'test-results';
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/favicon/.test(m.location().url) && errors.push(m.text() + ' ' + m.location().url));
  return errors;
}

type Person = { id: string; name: string; active: boolean };
const staffConfig = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('tabla:singletons') || '{}').staffConfig as { people: Person[] } | undefined);
const staffWeeks = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('tabla:staffWeeks') || '{}') as Record<string, { shifts: Record<string, { s: number; e: number; pos?: string }[]>[] }>);

/** The bottom of `sel` must sit above the manager's fixed tab bar. */
async function aboveTabBar(page: Page, sel: string) {
  const box = await page.locator(sel).first().boundingBox();
  const bar = await page.locator('.t-tabbar').boundingBox();
  expect(box && bar).toBeTruthy();
  expect(box!.y + box!.height).toBeLessThanOrEqual(bar!.y + 1);
}

test('staff planner: seeded week, live staff sync, shifts saved, tab switching', async ({ context }) => {
  const page = await openScreen(context, '/manager/staff');
  const errors = watchErrors(page);
  const planner = page.getByTestId('staff-planner');
  await expect(planner.getByRole('heading', { name: 'Shift planner' })).toBeVisible();
  await expect(page.locator('#savepill')).toHaveText('Saved ✓');

  // Seeded from the planner's defaults.
  await expect.poll(async () => (await staffConfig(page))?.people.length).toBe(7);
  expect(Object.keys(await staffWeeks(page))).toContain('2026-09-21');

  // Go back to the seeded week of Sep 21.
  for (let i = 0; i < 30 && !(await page.locator('.wlabel').innerText()).includes('Sep 21 – 27'); i++) await page.locator('#prev').click();
  await expect(page.locator('.wlabel')).toContainText('Sep 21 – 27');
  await expect(page.locator('.tab')).toHaveCount(7);
  await expect(page.locator('.tlname', { hasText: 'Tarun' }).first()).toBeVisible();
  await expect(page.locator('.bar').first()).toBeVisible();
  await aboveTabBar(page, '.dock');
  await page.screenshot({ path: `${SHOTS}/staff-schedule.png` });

  // A second window on the Staff page, then add a person in the first: it shows up live.
  const page2 = await openScreen(context, '/manager/staff');
  const errors2 = watchErrors(page2);
  await page2.locator('.views [data-v="staff"]').click();
  await expect(page2.locator('input[data-id]')).toHaveCount(7);

  await page.locator('.views [data-v="staff"]').click();
  await page.getByLabel("New person's name").fill('Meena');
  await page.getByRole('button', { name: 'Add person' }).click();
  await expect(page.locator('input[data-id]')).toHaveCount(8);
  await expect(page2.locator('input[data-id]')).toHaveCount(8);
  await expect(page2.locator('input[data-id]').last()).toHaveValue('Meena');
  const meena = (await staffConfig(page))!.people.find((p) => p.name === 'Meena');
  expect(meena).toBeTruthy();
  await page.screenshot({ path: `${SHOTS}/staff-staff.png` });

  // Add a shift for Meena on Monday of the seeded week.
  await page.locator('.views [data-v="schedule"]').click();
  await page.locator('.tab[data-d="0"]').click();
  const track = page.locator(`.track[data-p="${meena!.id}"]`);
  await track.scrollIntoViewIfNeeded();
  const tb = await track.boundingBox();
  await page.mouse.click(tb!.x + tb!.width * 0.3, tb!.y + tb!.height / 2);
  await expect(page.locator('#edit')).toBeVisible();
  await page.locator('#editBox').getByRole('button', { name: 'Food prep' }).click();
  await expect(page.locator('#edit')).toBeHidden();
  await expect.poll(async () => (await staffWeeks(page))['2026-09-21']?.shifts[0][meena!.id]?.[0]?.pos).toBe('prep');
  await expect(track.locator('.bar.prep')).toHaveCount(1);
  // ...and the other window has it too.
  await page2.locator('.views [data-v="schedule"]').click();
  for (let i = 0; i < 30 && !(await page2.locator('.wlabel').innerText()).includes('Sep 21 – 27'); i++) await page2.locator('#prev').click();
  await page2.locator('.tab[data-d="0"]').click();
  await expect(page2.locator(`.track[data-p="${meena!.id}"] .bar.prep`)).toHaveCount(1);

  // Settings page.
  await page.locator('.views [data-v="settings"]').click();
  await expect(page.getByRole('heading', { name: 'Opening hours' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/staff-settings.png` });
  await page.locator('#minStaff').selectOption('3');
  await aboveTabBar(page, '.savebar');
  // Unsaved settings survive a trip to another manager tab.
  await page.getByRole('link', { name: 'Screens' }).click();
  await expect(page.getByTestId('staff-planner')).toHaveCount(0);
  await page.getByRole('link', { name: 'Staff' }).click();
  await expect(page.locator('.savebar.dirty')).toBeVisible();
  await expect(page.locator('#minStaff')).toHaveValue('3');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect.poll(async () => ((await staffConfig(page)) as unknown as { settings: { minStaff: number } }).settings.minStaff).toBe(3);

  // Switch to Screens and back: no errors, planner comes back.
  await page.getByRole('link', { name: 'Screens' }).click();
  await expect(page.getByTestId('staff-planner')).toHaveCount(0);
  await page.getByRole('link', { name: 'Staff' }).click();
  await expect(page.getByRole('heading', { name: 'Shift planner' })).toBeVisible();
  await expect(page.locator('#savepill')).toHaveText('Saved ✓');
  await expect(page.locator('.wlabel')).toContainText('This week');

  expect(errors).toEqual([]);
  expect(errors2).toEqual([]);
});
