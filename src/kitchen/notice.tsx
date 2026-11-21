// A small red notice at the top of the kitchen screen while something is wrong. It goes away by itself
// when things recover. Only the most important problem shows, in plain words.
import { useEffect, useState } from 'react';
import { useOnline } from '@shared/ui';

/** Orders still not loaded after this long counts as a problem. */
export const LOAD_WAIT_MS = 20_000;

// A failed Toast menu read is not shown here: the kitchen can't fix it, the tablet tries again by itself,
// and the server alerts the manager's phone if it keeps failing.
export type Problems = { online: boolean; ordersLoaded: boolean; waitedLong: boolean };

/** The one line to show, or null when all is well. */
export function noticeText(p: Problems): string | null {
  if (!p.online) return p.ordersLoaded ? 'Offline: showing the last saved orders' : 'Offline: orders will show when the internet is back';
  if (!p.ordersLoaded && p.waitedLong) return 'Can’t reach the orders. Trying again…';
  return null;
}

export function KitchenNotice({ ordersLoaded }: { ordersLoaded: boolean }) {
  const online = useOnline();
  const [waitedLong, setWaitedLong] = useState(false);
  useEffect(() => {
    if (ordersLoaded) return;
    const t = setTimeout(() => setWaitedLong(true), LOAD_WAIT_MS);
    return () => clearTimeout(t);
  }, [ordersLoaded]);
  const text = noticeText({ online, ordersLoaded, waitedLong });
  if (!text) return null;
  return (
    <div className="k-notice" role="status" data-testid="kitchen-notice">
      <span>{text}</span>
    </div>
  );
}
