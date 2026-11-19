import { test, expect } from '@playwright/test';

// index.html: if the app never starts (old TV web viewer), a plain message appears after 20 s.
const MESSAGE = /web viewer is too old or failed to start/;

test('app starts: the boot message never shows', async ({ page }) => {
  await page.clock.install();
  await page.goto('/#/tv/1');
  await expect(page.locator('#root > *').first()).toBeAttached();
  await page.clock.runFor(25_000);
  await expect(page.getByText(MESSAGE)).toBeHidden();
});

test('app fails to start: grey message on black after 20 s', async ({ page }) => {
  await page.route(/\/assets\/.*\.js$/, (route) => route.abort());
  await page.clock.install();
  await page.goto('/#/tv/1');
  await page.clock.runFor(19_000);
  await expect(page.getByText(MESSAGE)).toBeHidden();
  await page.clock.runFor(2_000);
  await expect(page.getByText(MESSAGE)).toBeInViewport();
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(0, 0, 0)');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.clock.resume(); // let the page paint for the screenshot
  await page.screenshot({ path: 'test-results/boot-fail-tv.png' });
});
