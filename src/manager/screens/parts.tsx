// Small pieces shared by the Screens tab pages.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { isOnline, store, useCollection, useNow, usePictureUrl, type MusicSettings, type ScreenId, type Slot } from '@shared/data';
import { PageHeader } from '@shared/ui';
import { pictureInUse, pictureWarnings, screenName } from './logic';
import { useAppBase } from '../mode';

/** Page frame for one screen: back link, title, online badge. */
export function ScreenPage({ id, sub, children }: { id: ScreenId; sub?: string; children: ReactNode }) {
  const beats = useCollection('heartbeats');
  const now = useNow(5000);
  const online = isOnline(beats?.find((x) => x.id === id)?.lastSeen, now);
  const base = useAppBase();
  return (
    <main className="t-page sc-page">
      <Link className="sc-back" to={base + '/screens'}>‹ Screens</Link>
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

/** A button that opens the phone's camera / photo picker. A real button (Tab, Enter and Space
 *  work) that clicks a visually hidden file input. */
export function PictureInput({ label, onFile, className = 't-btn block', testId, disabled, accept = 'image/*' }: { label: ReactNode; onFile: (f: File) => void; className?: string; testId?: string; disabled?: boolean; accept?: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={className} disabled={disabled} onClick={() => input.current?.click()}>
        {label}
      </button>
      <input
        ref={input}
        className="sc-file"
        type="file"
        accept={accept}
        tabIndex={-1}
        aria-hidden
        disabled={disabled}
        data-testid={testId}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
    </>
  );
}

/** Preview of a picked file before it is saved, framed like the TV shows it (whole, on black),
 *  with a plain warning when the picture is tall, very wide or small. A file that isn't a picture
 *  (a PDF, a damaged photo) shows a plain message instead of the browser's broken-image icon,
 *  and `onBroken` tells the sheet so it can keep its save button off. */
export function FilePreview({ file, onBroken }: { file: File; onBroken?: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    setWarnings([]);
    setBroken(false);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <>
      <div className="sc-pic sc-pic-static">
        {url && !broken && (
          <img
            src={url}
            alt="Chosen picture"
            onLoad={(e) => setWarnings(pictureWarnings(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight))}
            onError={() => {
              setBroken(true);
              onBroken?.();
            }}
          />
        )}
      </div>
      {broken && (
        <p className="sc-error" role="alert" data-testid="picture-broken">This file isn't a picture that can be shown. Choose a photo (JPG or PNG).</p>
      )}
      {warnings.map((w) => (
        <p key={w} className="sc-warn" data-testid="picture-warning">{w}</p>
      ))}
    </>
  );
}

/** A video picked on the phone: a button that opens Files / Photos for videos. */
export function VideoInput(props: { label: ReactNode; onFile: (f: File) => void; className?: string; testId?: string; disabled?: boolean }) {
  return <PictureInput {...props} accept="video/mp4,video/*" />;
}

/** After a picture leaves a slot or the TV 5 clip: delete it from storage if nothing else shows it.
 *  `slots` is the slot list as it is after the change. Never throws (the change itself already saved). */
export async function deletePictureIfUnused(id: string | null | undefined, slots: readonly Pick<Slot, 'pictures'>[], clipPictures?: readonly string[]): Promise<void> {
  if (!id) return;
  try {
    // An ad's picture (with a video) is never deleted: it is the only way back to that ad.
    if ((await store.getDoc('pictures', id))?.video) return;
    const clip = clipPictures ?? ((await store.getDoc('singletons', 'music')) as Partial<MusicSettings> | null)?.clipPictures ?? [];
    if (!pictureInUse(id, slots, Array.isArray(clip) ? clip : [])) await store.deletePicture(id);
  } catch {
    /* leaving an unused picture behind is harmless */
  }
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
