import { useEffect, useState } from 'react';
import './address.css';

/** Copies text, with a fallback for WebViews where the Clipboard API is missing or refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the old way */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function mapsUrl(address: string): string {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address);
}

/**
 * A delivery address. Tapping it shows Copy (and, where `maps` is set, Open in Maps).
 * Clicks don't reach a tappable parent card.
 */
export function Address({ address, className, maps }: { address: string; className?: string; maps?: boolean }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<null | boolean>(null);

  useEffect(() => {
    if (copied === null) return;
    const t = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <div className={'c-addr' + (className ? ' ' + className : '')} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button type="button" className="c-addr-text" aria-expanded={open} data-testid="address" onClick={() => setOpen((v) => !v)}>
        {address}
      </button>
      {open && (
        <div className="c-addr-actions">
          <button type="button" className="t-btn" data-testid="copy-address" onClick={async () => setCopied(await copyText(address))}>
            {copied === true ? '✓ Copied' : copied === false ? 'Could not copy' : 'Copy address'}
          </button>
          {maps && (
            <a className="t-btn" href={mapsUrl(address)} target="_blank" rel="noreferrer">
              Open in Maps
            </a>
          )}
        </div>
      )}
    </div>
  );
}
