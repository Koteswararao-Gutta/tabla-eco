// A small red notice at the top of the kitchen screen while something is wrong. It goes away by itself
// when things recover. Only the most important problem shows, in plain words.
import { useEffect, useState } from 'react';
import { useOnline } from '@shared/ui';

/** Orders still not loaded after this long counts as a problem. */
export const LOAD_WAIT_MS = 20_000;

export type Problems = { online: boolean; ordersLoaded: boolean; waitedLong: boolean; toastError: string | null };

/** The one line to show, or null when all is well. */
export function noticeText(p: Problems): string | null {
  if (!p.online) return p.ordersLoaded ? 'Offline: showing the last saved orders' : 'Offline: orders will show when the internet is back';
  if (!p.ordersLoaded && p.waitedLong) return 'Can’t reach the orders. Trying again…';
  if (p.toastError) return 'Toast menu could not be read. Trying again in an hour';
  return null;
}

export function KitchenNotice({ ordersLoaded, toastError }: { ordersLoaded: boolean; toastError: string | null }) {
  const online = useOnline();
  const [waitedLong, setWaitedLong] = useState(false);
  useEffect(() => {
    if (ordersLoaded) return;
    const t = setTimeout(() => setWaitedLong(true), LOAD_WAIT_MS);
    return () => clearTimeout(t);
  }, [ordersLoaded]);
  const text = noticeText({ online, ordersLoaded, waitedLong, toastError });
  if (!text) return null;
  return (
    <div className="k-notice" role="status" data-testid="kitchen-notice">
      <span>{text}</span>
    </div>
  );
}
