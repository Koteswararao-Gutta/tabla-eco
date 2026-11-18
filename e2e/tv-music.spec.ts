import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { openScreen } from './helpers';

// Tests never reach youtube.com: the IFrame API is either blocked or replaced by a small fake
// that the test drives (window.__yt.fire(state), window.__yt.error()).

const PLAYLIST = 'https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG';

const FAKE_YT = `
(() => {
  const yt = { calls: [], player: null, blockSound: !!window.__ytBlockSound };
  window.__yt = yt;
  class Player {
    constructor(el, opts) {
      this.opts = opts; this.state = -1; this.index = 0; this.muted = false;
      const f = document.createElement('div');
      f.style.cssText = 'position:absolute;inset:0;background:#123';
      f.setAttribute('data-testid', 'fake-iframe');
      el.replaceWith(f); this.el = f;
      yt.player = this;
      setTimeout(() => opts.events.onReady({ target: this, data: 0 }), 10);
    }
    fire(s) { this.state = s; yt.calls.push('state:' + s); this.opts.events.onStateChange({ target: this, data: s }); }
    later(s) { setTimeout(() => this.fire(s), 10); }
    cuePlaylist(o) { yt.calls.push('cue:' + o.list); this.later(5); }
    setLoop() {} setShuffle(v) { yt.calls.push('shuffle:' + v); }
    getPlaylist() { return ['a', 'b', 'c']; }
    getPlaylistIndex() { return this.index; }
    getPlayerState() { return this.state; }
    playVideoAt(i) { this.index = i; yt.calls.push('playAt:' + i); if (!(yt.blockSound && !this.muted)) this.later(1); }
    playVideo() { yt.calls.push('play'); if (!(yt.blockSound && !this.muted)) this.later(1); }
    pauseVideo() { yt.calls.push('pause'); this.state = 2; }
    nextVideo() { this.index = (this.index + 1) % 3; yt.calls.push('next:' + this.index); this.later(1); }
    mute() { this.muted = true; yt.calls.push('mute'); }
    unMute() { this.muted = false; yt.calls.push('unmute'); }
    isMuted() { return this.muted; }
    setVolume() {}
    destroy() { yt.calls.push('destroy'); this.el.remove(); }
  }
  window.YT = { Player };
  yt.fire = (s) => yt.player.fire(s);
  yt.error = () => yt.player.opts.events.onError({ target: yt.player, data: 150 });
  setTimeout(() => window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady(), 0);
})();
`;

async function fakeYouTube(context: BrowserContext) {
  await context.route('https://www.youtube.com/iframe_api', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_YT }));
}

/** Open the home page (seeds sample data) and merge fields into the music settings. */
async function setMusic(context: BrowserContext, patch: Record<string, unknown>, admin?: Page): Promise<Page> {
  const page = admin ?? (await openScreen(context, '/'));
  await page.waitForFunction(() => !!JSON.parse(localStorage.getItem('tabla:singletons') || '{}').music);
  await page.evaluate((p) => {
    const t = JSON.parse(localStorage.getItem('tabla:singletons') || '{}');
    t.music = { ...t.music, ...p };
    localStorage.setItem('tabla:singletons', JSON.stringify(t));
  }, patch);
  return page;
}

const root = (page: Page) => page.getByTestId('tv-music');

test('no playlist: catering clip loops with title and restaurant name', async ({ context }) => {
  await setMusic(context, { playlist: '' });
  const tv = await openScreen(context, '/tv/5');
  await expect(root(tv)).toHaveAttribute('data-mode', 'fallback');
  await expect(root(tv)).toHaveAttribute('data-reason', 'noPlaylist');
  await expect(tv.getByTestId('clip-title')).toHaveText('We do catering');
  await expect(tv.getByTestId('clip-title')).toBeVisible();
  await expect(tv.getByTestId('clip-brand')).toHaveText('Tabla');
  await expect(tv.getByTestId('clip-picture')).toHaveCount(1); // seeded catering picture
  // the TV reports in for the manager's online dot
  const lastSeen = await tv.evaluate(() => JSON.parse(localStorage.getItem('tabla:screens') || '{}').tv5?.lastSeen);
  expect(lastSeen).toBeGreaterThan(0);
});

test('settings change shows live on the TV', async ({ context }) => {
  const admin = await setMusic(context, { playlist: '' });
  const tv = await openScreen(context, '/tv/5');
  await expect(tv.getByTestId('clip-title')).toHaveText('We do catering');
  await setMusic(context, { clipTitle: 'Biryani trays for your party', clipLine: 'Call us today' }, admin);
  await expect(tv.getByTestId('clip-title')).toHaveText('Biryani trays for your party');
  await expect(tv.getByTestId('clip-line')).toHaveText('Call us today');
});

test('YouTube unreachable: falls back to the clip, never an error page', async ({ context }) => {
  await context.route('https://www.youtube.com/**', (r) => r.abort());
  await setMusic(context, { playlist: PLAYLIST });
  const tv = await openScreen(context, '/tv/5');
  await expect(root(tv)).toHaveAttribute('data-mode', 'fallback');
  await expect(root(tv)).toHaveAttribute('data-reason', 'apiFailed');
  await expect(tv.getByTestId('clip-title')).toBeVisible();
});

test('plays the playlist; clip after each song, then the next video', async ({ context }) => {
  await fakeYouTube(context);
  await setMusic(context, { playlist: PLAYLIST, shuffle: false, clipMode: 'afterEachSong', clipSeconds: 3 });
  const tv = await openScreen(context, '/tv/5');
  await expect(root(tv)).toHaveAttribute('data-mode', 'video');
  const calls = () => tv.evaluate(() => (window as unknown as { __yt: { calls: string[] } }).__yt.calls);
  expect(await calls()).toContain('cue:PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG');
  expect(await calls()).toContain('playAt:0');
  await expect(tv.getByTestId('fake-iframe')).toBeVisible();

  await tv.evaluate(() => (window as unknown as { __yt: { fire(s: number): void } }).__yt.fire(0)); // ENDED
  await expect(root(tv)).toHaveAttribute('data-mode', 'clip');
  await expect(tv.getByTestId('clip-title')).toBeVisible();
  await expect(root(tv)).toHaveAttribute('data-mode', 'video', { timeout: 6000 });
  expect(await calls()).toContain('next:1');
});

test('everySeconds: pauses for the clip, then resumes', async ({ context }) => {
  await fakeYouTube(context);
  await setMusic(context, { playlist: PLAYLIST, clipMode: 'everySeconds', everySeconds: 5, clipSeconds: 3 });
  const tv = await openScreen(context, '/tv/5');
  await expect(root(tv)).toHaveAttribute('data-mode', 'video');
  await expect(root(tv)).toHaveAttribute('data-mode', 'clip', { timeout: 8000 });
  const calls = () => tv.evaluate(() => (window as unknown as { __yt: { calls: string[] } }).__yt.calls);
  expect(await calls()).toContain('pause');
  await expect(root(tv)).toHaveAttribute('data-mode', 'video', { timeout: 6000 });
  expect((await calls()).filter((c) => c === 'play').length).toBe(1);
});

test('broken videos are skipped; all broken → clip loop', async ({ context }) => {
  await fakeYouTube(context);
  await setMusic(context, { playlist: PLAYLIST, shuffle: false });
  const tv = await openScreen(context, '/tv/5');
  await expect(root(tv)).toHaveAttribute('data-mode', 'video');
  const err = () => tv.evaluate(() => (window as unknown as { __yt: { error(): void } }).__yt.error());
  await err();
  await expect.poll(() => tv.evaluate(() => (window as unknown as { __yt: { calls: string[] } }).__yt.calls)).toContain('playAt:1');
  await expect(root(tv)).toHaveAttribute('data-mode', 'video');
  await err();
  await err();
  await expect(root(tv)).toHaveAttribute('data-mode', 'fallback');
  await expect(root(tv)).toHaveAttribute('data-reason', 'allFailed');
  await expect(tv.getByTestId('clip-title')).toBeVisible();
});

test('sound blocked: plays muted with a small note that goes after one key press', async ({ context }) => {
  await fakeYouTube(context);
  await context.addInitScript(() => ((window as unknown as { __ytBlockSound: boolean }).__ytBlockSound = true));
  await setMusic(context, { playlist: PLAYLIST });
  const tv = await openScreen(context, '/tv/5');
  await expect(root(tv)).toHaveAttribute('data-mode', 'video', { timeout: 8000 });
  await expect(tv.getByTestId('sound-note')).toHaveText('Click or press OK for sound');
  await tv.keyboard.press('Enter');
  await expect(tv.getByTestId('sound-note')).toHaveCount(0);
  expect(await tv.evaluate(() => (window as unknown as { __yt: { calls: string[] } }).__yt.calls)).toContain('unmute');
});

test('offline: clip loop, then back to YouTube when online', async ({ context }) => {
  await fakeYouTube(context);
  await setMusic(context, { playlist: PLAYLIST });
  const tv = await openScreen(context, '/tv/5');
  await expect(root(tv)).toHaveAttribute('data-mode', 'video');
  await context.setOffline(true);
  await expect(root(tv)).toHaveAttribute('data-mode', 'fallback');
  await expect(root(tv)).toHaveAttribute('data-reason', 'offline');
  await expect(tv.getByTestId('clip-title')).toBeVisible();
  await context.setOffline(false);
  await expect(root(tv)).toHaveAttribute('data-mode', 'video');
});

test('TV view at 1920x1080 (screenshot)', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await setMusic(context, { playlist: '', clipSeconds: 20 });
  const tv = await openScreen(context, '/tv/5');
  await expect(tv.getByTestId('clip-picture')).toHaveCount(1);
  await tv.waitForTimeout(4000); // let the title and line fade in
  const dir = process.env.TM_SHOT_DIR || 'test-results';
  await tv.screenshot({ path: `${dir}/tv5-clip.png` });
  // no pictures: the clip still looks finished (warm gradient, title, line)
  await setMusic(context, { clipPictures: [] });
  await expect(tv.getByTestId('clip-picture')).toHaveCount(0);
  await tv.waitForTimeout(3000);
  await tv.screenshot({ path: `${dir}/tv5-clip-nopictures.png` });
  await context.close();
});
