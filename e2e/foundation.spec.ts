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
