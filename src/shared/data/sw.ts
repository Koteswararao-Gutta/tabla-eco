// The service worker's address. There is one worker for the whole site, kept at the site's top folder, so
// it covers both pages: index.html and the front app's own page, front/index.html (one folder down).
export function swUrl(): string {
  return new URL(isFrontPage() ? '../alerts-sw.js' : './alerts-sw.js', location.href).href;
}

/** True on the front app's own page (…/front/). */
export function isFrontPage(): boolean {
  return /\/front\/(index\.html)?$/.test(location.pathname);
}
