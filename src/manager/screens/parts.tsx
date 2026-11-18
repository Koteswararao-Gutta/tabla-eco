// Small pieces shared by the Screens tab pages.
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { isOnline, useCollection, useNow, usePictureUrl, type ScreenId } from '@shared/data';
import { PageHeader } from '@shared/ui';
import { screenName } from './logic';

/** Page frame for one screen: back link, title, online badge. */
export function ScreenPage({ id, sub, children }: { id: ScreenId; sub?: string; children: ReactNode }) {
  const screens = useCollection('screens');
  const now = useNow(5000);
  const online = isOnline(screens?.find((x) => x.id === id)?.lastSeen, now);
  return (
    <main className="t-page sc-page">
      <Link className="sc-back" to="/manager/screens">‹ Screens</Link>
      <PageHeader
        title={screenName(id)}
        sub={sub}
        action={<span className={'t-badge' + (online ? ' good' : '')}>{online ? 'Online' : 'Offline'}</span>}
      />
      {children}
    </main>
  );
}

/** A stored picture, or a calm grey box while it loads or if it is missing. */
export function StoredPicture({ id, alt }: { id: string | null | undefined; alt: string }) {
  const url = usePictureUrl(id);
  return url ? <img src={url} alt={alt} draggable={false} /> : <span className="sc-pic-wait" aria-label={alt} />;
}

/** A button that opens the phone's camera / photo picker. */
export function PictureInput({ label, onFile, className = 't-btn block', testId, disabled }: { label: ReactNode; onFile: (f: File) => void; className?: string; testId?: string; disabled?: boolean }) {
  return (
    <label className={className + (disabled ? ' sc-disabled' : '')}>
      {label}
      <input
        type="file"
        accept="image/*"
        hidden
        disabled={disabled}
        data-testid={testId}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
    </label>
  );
}

/** Preview of a picked file before it is saved. */
export function FilePreview({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return <div className="sc-pic sc-pic-static">{url && <img src={url} alt="Chosen picture" />}</div>;
}

/** On/off switch with a label, full-width row. */
export function Switch({ label, on, onChange, sub }: { label: string; sub?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="sc-switch-row" onClick={() => onChange(!on)}>
      <span className="sc-switch-text">
        <span>{label}</span>
        {sub && <small>{sub}</small>}
      </span>
      <i className="sc-switch" aria-hidden />
    </button>
  );
}
