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
    await expect(phone.getByTestId('tz-note')).toHaveText(/Time zone isn't Arizona/);
    await expect(phone.getByTestId('tz-note')).toHaveClass('t-tz');
    await phone.setViewportSize({ width: 390, height: 844 });
    // Two lines at most on a phone.
    await expect.poll(async () => (await phone.getByTestId('tz-note').boundingBox())!.height).toBeLessThan(70);
    const kitchen = await openScreen(context, '/kitchen');
    await expect(kitchen.getByTestId('tz-note')).toBeVisible();
    const tv = await openScreen(context, '/tv/1');
    await expect(tv.getByTestId('tz-note')).toHaveClass('t-tz-tv');
  });
});

// A screen's code that can't be fetched (a new version replaced the files, or the internet dropped):
// the page reloads once and opens normally, instead of "Something went wrong".
test.describe('screen code fails to load', () => {
  test('reloads once and opens', async ({ browser }) => {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    // Count page loads, not file requests: a browser may fetch the same file twice in one load (preload, then import).
    let loads = 0;
    page.on('request', (r) => { if (r.resourceType() === 'document' && r.frame() === page.mainFrame()) loads++; });
    await page.route(/\/assets\/kitchen-[\w-]+\.js$/, (route) => (loads <= 1 ? route.abort() : route.continue()));
    await page.goto('/#/kitchen');
    await expect(page.getByTestId('kitchen')).toBeVisible();
    expect(loads).toBe(2);
    await expect(page.getByRole('heading', { name: 'Something went wrong' })).toHaveCount(0);
    await context.close();
  });

  test('still missing after the reload: the calm crash screen, no reload loop', async ({ browser }) => {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    let loads = 0;
    page.on('request', (r) => { if (r.resourceType() === 'document' && r.frame() === page.mainFrame()) loads++; });
    await page.route(/\/assets\/kitchen-[\w-]+\.js$/, (route) => route.abort());
    await page.goto('/#/kitchen');
    await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
    await page.waitForTimeout(1500);
    expect(loads).toBe(2); // the first load, then exactly one reload
    await context.close();
  });
});

// The service worker keeps the last good page: a bad answer from the server (e.g. GitHub's error page
// during a deploy) never replaces the app on a reload.
test('a reload that gets a server error still opens the app', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/#/tv/1');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(async () => !!(await caches.open('tabla-shell-v2').then((c) => c.keys())).length)).toBe(true);
  await page.reload(); // now controlled by the worker
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.route(/\/(index\.html)?(\?.*)?$/, (route) =>
    route.request().resourceType() === 'document' || route.request().url().endsWith('/')
      ? route.fulfill({ status: 503, contentType: 'text/html', body: '<h1>Server error</h1>' })
      : route.continue(),
  );
  await page.reload();
  await expect(page.getByText('Server error')).toHaveCount(0);
  await expect(page.locator('#root > *').first()).toBeAttached();
  await context.close();
});

test('Add to Home Screen: the front link installs the front app, the manager link the manager app', async ({ page }) => {
  const install = () =>
    page.evaluate(async () => {
      const href = (document.querySelector('link[rel="manifest"]') as HTMLLinkElement).href;
      return {
        manifest: await (await fetch(href)).json(),
        icon: (document.querySelector('link[rel="apple-touch-icon"]') as HTMLLinkElement).href,
        title: (document.querySelector('meta[name="apple-mobile-web-app-title"]') as HTMLMetaElement).content,
      };
    });
  await page.goto('/#/front/catering');
  let a = await install();
  expect(a.manifest.start_url).toBe('./#/front');
  expect(a.icon).toContain('icon-front-180.png');
  expect(a.title).toBe('Front');
  expect((await page.request.get(a.icon)).ok()).toBe(true);

  await page.goto('/#/manager/catering');
  a = await install();
  expect(a.manifest.start_url).toBe('./#/manager');
  expect(a.icon).toContain('icon-manager-180.png');
  expect(a.title).toBe('Manager');
  expect((await page.request.get(a.icon)).ok()).toBe(true);
});
