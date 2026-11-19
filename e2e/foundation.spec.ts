import { expect, test } from '@playwright/test';
import { openScreen, readCollection } from './helpers';

test('every link opens and sample data is seeded', async ({ context }) => {
  const home = await openScreen(context, '/');
  await expect(home.getByRole('heading', { name: 'Tabla' })).toBeVisible();
  for (const p of ['/tv/1', '/tv/2', '/tv/3', '/tv/4', '/tv/5', '/kitchen', '/manager/screens', '/manager/catering', '/manager/staff']) {
    const errors: string[] = [];
    context.once('page', (pg) => pg.on('pageerror', (e) => errors.push(e.message)));
    const page = await openScreen(context, p);
    // Menu TVs show only a picture (no text), so check that something rendered rather than for text.
    await expect(page.locator('#root > *').first()).toBeAttached();
    expect(errors, p).toEqual([]);
    await page.close();
  }
  expect((await readCollection(home, 'screens')).length).toBe(6);
  expect((await readCollection(home, 'slots')).length).toBe(4);
});

test('a change in one window reaches another window', async ({ context }) => {
  const a = await openScreen(context, '/');
  const b = await openScreen(context, '/');
  await b.evaluate(() => {
    (window as unknown as { __seen: string[] }).__seen = [];
    window.addEventListener('storage', (e) => (window as unknown as { __seen: string[] }).__seen.push(e.key || ''));
  });
  await a.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('tabla:orders') || '{}');
    t.probe = { id: 'probe' };
    localStorage.setItem('tabla:orders', JSON.stringify(t));
  });
  await expect.poll(() => b.evaluate(() => (window as unknown as { __seen: string[] }).__seen)).toContain('tabla:orders');
});

test('a crash shows a calm screen instead of a white page', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/?crash#/tv/1');
  await expect(page.getByTestId('crash')).toHaveText('Restarting…');
  await expect(page.locator('.t-crash-tv')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  expect(errors.join('\n')).toContain('Test crash');

  await page.goto('/?crash#/manager/catering');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
});

test('no time zone warning on Arizona time', async ({ context }) => {
  const page = await openScreen(context, '/manager/catering');
  await expect(page.getByRole('heading').first()).toBeVisible();
  await expect(page.getByTestId('tz-note')).toHaveCount(0);
});

test.describe('device on another time zone', () => {
  test.use({ timezoneId: 'America/New_York' });

  test('every screen warns, TVs with a small corner note', async ({ context }) => {
    const phone = await openScreen(context, '/manager/catering');
    await expect(phone.getByTestId('tz-note')).toHaveText(/time zone isn't Arizona/);
    await expect(phone.getByTestId('tz-note')).toHaveClass('t-tz');
    const kitchen = await openScreen(context, '/kitchen');
    await expect(kitchen.getByTestId('tz-note')).toBeVisible();
    const tv = await openScreen(context, '/tv/1');
    await expect(tv.getByTestId('tz-note')).toHaveClass('t-tz-tv');
  });
});
