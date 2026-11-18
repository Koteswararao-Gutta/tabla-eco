// Turns whatever the manager pasted into a YouTube playlist id, or null if it isn't one.
// Accepts a playlist URL, a watch URL with list=, a youtu.be link with list=, or a bare id.

/** Playlist ids are 12+ chars (PL…, OLAK5uy_…, RD…). 11-char video ids are rejected on purpose. */
const LIST_ID = /^[A-Za-z0-9_-]{12,64}$/;
const HOSTS = ['youtube.com', 'youtu.be', 'youtube-nocookie.com'];

export function parsePlaylistId(input: string | null | undefined): string | null {
  const s = (input ?? '').trim();
  if (!s) return null;
  if (LIST_ID.test(s)) return s;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : 'https://' + s);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  if (!HOSTS.includes(host)) return null;
  const list = url.searchParams.get('list');
  return list && LIST_ID.test(list) ? list : null;
}
