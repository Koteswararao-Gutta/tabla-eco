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
  await expect(planner.getByRole('heading', { level: 1, name: 'Staff', exact: true })).toBeVisible();
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
  await page2.locator('.views [data-v="people"]').click();
  await expect(page2.locator('input[data-id]')).toHaveCount(7);

  await page.locator('.views [data-v="people"]').click();
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
  // No save bar until something changes.
  await expect(page.locator('#savebar')).toBeHidden();
  await page.screenshot({ path: `${SHOTS}/staff-settings.png` });
  await page.locator('#minStaff').selectOption('3');
  await expect(page.locator('#savebar')).toBeVisible();
  await expect(page.locator('#savebar')).toContainText('Unsaved changes');
  // The header pill never says "Saved" over unsaved settings.
  await expect(page.locator('#savepill')).toHaveClass(/off/);
  await aboveTabBar(page, '#savebar');
  const sb = await page.locator('#savebar').boundingBox();
  expect(sb!.height).toBeLessThan(90);
  // Changing it back makes the bar go away again.
  await page.locator('#minStaff').selectOption('2');
  await expect(page.locator('#savebar')).toBeHidden();
  await page.locator('#minStaff').selectOption('3');
  // Unsaved settings survive a trip to another manager tab.
  await page.getByRole('link', { name: 'Screens' }).click();
  await expect(page.getByTestId('staff-planner')).toHaveCount(0);
  await page.getByRole('link', { name: 'Staff' }).click();
  await expect(page.locator('#savebar')).toBeVisible();
  await expect(page.locator('#minStaff')).toHaveValue('3');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => ((await staffConfig(page)) as unknown as { settings: { minStaff: number } }).settings.minStaff).toBe(3);
  await expect(page.locator('#savebar')).toBeHidden();
  await expect(page.locator('#savepill')).toHaveText('Saved ✓');
  await expect(page.locator('#savepill')).not.toHaveClass(/off/);

  // Switch to Screens and back: no errors, planner comes back.
  await page.getByRole('link', { name: 'Screens' }).click();
  await expect(page.getByTestId('staff-planner')).toHaveCount(0);
  await page.getByRole('link', { name: 'Staff' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Staff', exact: true })).toBeVisible();
  await expect(page.locator('#savepill')).toHaveText('Saved ✓');
  await expect(page.locator('.wlabel')).toContainText('This week');

  expect(errors).toEqual([]);
  expect(errors2).toEqual([]);
});

test.describe('staff sheets on a touch phone', () => {
  test.use({ hasTouch: true });

  test('edit sheet: Escape and dragging the handle close it; remove asks with a red button and Keep', async ({ context }) => {
    const page = await openScreen(context, '/manager/staff');
    const errors = watchErrors(page);
    await expect(page.locator('#savepill')).toHaveText('Saved ✓');
    for (let i = 0; i < 30 && !(await page.locator('.wlabel').innerText()).includes('Sep 21 – 27'); i++) await page.locator('#prev').click();
    await expect(page.locator('.wlabel')).toContainText('Sep 21 – 27');
    const bar = page.locator('.bar').first();
    const open = async () => {
      await bar.evaluate((e) => e.scrollIntoView({ block: 'center' }));
      await bar.click();
      await expect(page.locator('#edit')).toBeVisible();
    };
    // No cryptic "?" on shifts without a position.
    expect(await page.locator('.bar span').allInnerTexts()).not.toContainEqual(expect.stringMatching(/^\?/));

    await open();
    await page.keyboard.press('Escape');
    await expect(page.locator('#edit')).toBeHidden();

    const cdp = await context.newCDPSession(page);
    const drag = async (dy: number) => {
      const g = (await page.locator('#editBox .t-sheet-grab').boundingBox())!;
      const x = g.x + g.width / 2, y = g.y + g.height / 2;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (dy * i) / 8 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await open();
    await drag(20); // a small pull springs back
    await page.waitForTimeout(400);
    await expect(page.locator('#edit')).toBeVisible();
    await drag(400); // a long pull closes it
    await expect(page.locator('#edit')).toBeHidden();

    await open();
    await page.getByRole('button', { name: 'Remove shift' }).click();
    const ask = page.locator('#ask');
    await expect(ask).toBeVisible();
    await expect(ask.getByRole('heading', { name: 'Remove this shift?' })).toBeVisible();
    await expect(ask.getByRole('button', { name: 'Remove shift' })).toHaveClass(/solid-danger/);
    await ask.getByRole('button', { name: 'Keep' }).click();
    await expect(ask).toBeHidden();
    await expect(page.locator('#edit')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test('keyboard: focus stays put in the shift sheet and comes back when a sheet closes', async ({ context }) => {
  const page = await openScreen(context, '/manager/staff');
  const errors = watchErrors(page);
  await expect(page.locator('#savepill')).toHaveText('Saved ✓');
  for (let i = 0; i < 30 && !(await page.locator('.wlabel').innerText()).includes('Sep 21 – 27'); i++) await page.locator('#prev').click();
  const focused = () => page.evaluate(() => { const a = document.activeElement as HTMLElement; return a.id || a.getAttribute('aria-label') || a.tagName; });

  // Open a shift with Enter, press "+" twice with the keyboard: focus stays on "+".
  const bar = page.locator('.bar').first();
  const pid = await bar.getAttribute('data-p');
  await bar.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#edit')).toBeVisible();
  await expect.poll(focused).toBe('editTitle');
  const plus = page.locator('#editBox [aria-label="End 15 minutes later"]');
  await plus.focus();
  await page.keyboard.press('Enter');
  await expect.poll(focused).toBe('End 15 minutes later');
  await page.keyboard.press('Enter');
  await expect(page.locator('#editBox .when')).toContainText('2:30pm');
  await expect.poll(focused).toBe('End 15 minutes later');
  // Escape: back on the same shift.
  await page.keyboard.press('Escape');
  await expect(page.locator('#edit')).toBeHidden();
  await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement).dataset.p)).toBe(pid);

  // Send to staff, then Escape: back on the button.
  await page.locator('#copyPic').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#shot')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#shot')).toBeHidden();
  await expect.poll(focused).toBe('copyPic');

  // People: an arrow keeps focus, so it can be pressed again.
  await page.locator('.views [data-v="people"]').click();
  const third = await page.locator('input[data-id]').nth(2).getAttribute('data-id');
  await page.locator(`[data-up="${third}"]`).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(page.locator('input[data-id]').first()).toHaveAttribute('data-id', third!);
  await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement).dataset.down || (document.activeElement as HTMLElement).dataset.up)).toBe(third);
  expect(errors).toEqual([]);
});

test('small text on the green and amber tints is readable (4.5:1 or more)', async ({ context }) => {
  const page = await openScreen(context, '/manager/staff');
  await expect(page.locator('#savepill')).toHaveText('Saved ✓');
  for (let i = 0; i < 30 && !(await page.locator('.wlabel').innerText()).includes('Sep 21 – 27'); i++) await page.locator('#prev').click();
  let sawOk = false;
  for (let d = 0; d < 7; d++) {
    await page.locator(`.tab[data-d="${d}"]`).click();
    const ratios = await page.locator('#savepill, .chip.ok, .chip.warn').evaluateAll((els) => {
      const lin = (c: string) => {
        const n = (c.match(/[\d.]+/g) || []).map(Number).slice(0, 3).map((v) => (c.startsWith('color(') ? v : v / 255));
        const [r, g, b] = n.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      return els.map((e) => {
        const s = getComputedStyle(e), a = lin(s.color), b = lin(s.backgroundColor);
        return { cls: e.className, r: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
      });
    });
    for (const x of ratios) expect(x.r, x.cls).toBeGreaterThanOrEqual(4.5);
    sawOk ||= ratios.some((x) => /chip ok/.test(x.cls));
  }
  expect(sawOk).toBe(true);
});

test('two phones rename different people at once: each phone shows both names', async ({ context }) => {
  const page = await openScreen(context, '/manager/staff');
  await expect(page.locator('#savepill')).toHaveText('Saved ✓');
  const page2 = await openScreen(context, '/manager/staff');
  await expect(page2.locator('#savepill')).toHaveText('Saved ✓');
  await page.locator('.views [data-v="people"]').click();
  await page2.locator('.views [data-v="people"]').click();
  await expect(page2.locator('input[data-id]')).toHaveCount(7);
  // Both type before either one applies: phone 2 is mid-typing when phone 1's rename arrives.
  await page.locator('input[data-id]').nth(0).fill('Anil');
  await page2.locator('input[data-id]').nth(1).fill('Bala');
  await page.locator('input[data-id]').nth(0).press('Enter');
  await page2.locator('input[data-id]').nth(1).press('Enter');
  await expect.poll(async () => (await staffConfig(page))!.people.slice(0, 2).map((p) => p.name)).toEqual(['Anil', 'Bala']);
  // Phone 2 saved both (merged); its page must show phone 1's rename too, not the old name.
  await expect(page2.locator('input[data-id]').nth(0)).toHaveValue('Anil');
  await expect(page2.locator('input[data-id]').nth(1)).toHaveValue('Bala');
  await expect(page.locator('input[data-id]').nth(1)).toHaveValue('Bala');
});
