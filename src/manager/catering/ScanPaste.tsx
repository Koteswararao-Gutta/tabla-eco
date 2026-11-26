// "Scan paper" and "Paste message": Claude reads a photo of a handwritten order or a customer's message
// (typed, or a screenshot of it) and fills the form. Used by New order and New estimate; each form decides how to fill itself.
import { useRef, useState } from 'react';
import { store, type ScannedOrder } from '@shared/data';

export type ScanFrom = 'photo' | 'message';

type Props = {
  /** Fills the form from what was read (only called when it looks like an order). */
  onFilled: (got: ScannedOrder, from: ScanFrom) => void;
  /** The button named in the "check every field" note, e.g. "Save order". */
  saveLabel: string;
  /** Called with true while pasted text sits in the box unread (so closing the sheet asks first). */
  onPending?: (pending: boolean) => void;
};

export function ScanPaste({ onFilled, saveLabel, onPending }: Props) {
  // `pasted`: a picture that came through Paste message (a copied screenshot), not Scan paper.
  const [scan, setScan] = useState<{ state: 'idle' | 'reading' | 'done' | 'failed'; from?: ScanFrom; pasted?: boolean; message?: string }>({ state: 'idle' });
  const [pasting, setPasting] = useState(false);
  const [pasted, setPastedText] = useState('');
  const setPasted = (t: string) => {
    setPastedText(t);
    onPending?.(t.trim() !== '');
  };

  // Set at once (before the button greys out), so a double tap never reads the same message twice:
  // each read costs a little and counts toward the day's limit.
  const busy = useRef(false);
  const fillFrom = async (from: ScanFrom, read: () => Promise<ScannedOrder>, pasted = from === 'message') => {
    busy.current = true;
    setScan({ state: 'reading', from, pasted });
    try {
      const got = await read();
      if (!got.isOrder) {
        const message =
          from === 'message'
            ? "This message doesn't look like an order. Please check what you pasted."
            : pasted
              ? "This picture doesn't look like an order. Please try another one."
              : "This photo doesn't look like an order. Please try another photo.";
        return setScan({ state: 'failed', from, pasted, message });
      }
      onFilled(got, from);
      setScan({ state: 'done', from, pasted });
      setPasting(false);
    } catch (e) {
      setScan({ state: 'failed', from, pasted, message: e instanceof Error ? e.message : `Couldn't read the ${from}.` });
    } finally {
      busy.current = false;
    }
  };
  const scanPhoto = (photo: Blob | undefined, pasted = false) => photo && !busy.current && fillFrom('photo', () => store.readOrderPhoto(photo), pasted);
  const readPasted = (text = pasted) => {
    if (busy.current) return;
    if (text.trim().length < 5) return setScan({ state: 'failed', from: 'message', message: 'Please paste the customer’s message first.' });
    fillFrom('message', () => store.readOrderText(text));
  };
  // One tap: read what was copied (text, or a copied screenshot) and fill the form at once. If the phone
  // won't share the clipboard, the box opens instead, and pasting text or a picture into it fills the form the same way.
  const openPaste = async () => {
    if (busy.current) return;
    busy.current = true; // while the clipboard is read: a second tap waits for this one
    setScan({ state: 'idle' });
    let copied = '';
    let picture: Blob | undefined;
    try {
      const got = await readClipboard();
      copied = got.text.slice(0, 8000);
      picture = got.picture;
    } catch {
      /* not allowed here: the person pastes into the box */
    }
    busy.current = false;
    if (copied.trim().length < 5 && picture) {
      scanPhoto(picture, true);
    } else if (copied.trim().length >= 5) {
      setPasted(copied);
      readPasted(copied);
    } else {
      setPasting(true);
    }
  };

  const reading = (from: ScanFrom, pasted: boolean) => scan.state === 'reading' && scan.from === from && !!scan.pasted === pasted;

  return (
    <div className="c-scan">
      <div className="c-scan-row">
        <label className={'t-btn block c-scan-btn' + (reading('photo', false) ? ' busy' : '')} aria-disabled={scan.state === 'reading'}>
          <input
            type="file"
            accept="image/*"
            className="c-file"
            disabled={scan.state === 'reading'}
            aria-label="Scan paper order"
            onChange={(e) => {
              scanPhoto(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          {reading('photo', false) ? 'Reading…' : 'Scan paper'}
        </label>
        <button
          type="button"
          className={'t-btn block c-scan-btn' + (pasting ? ' on' : '')}
          disabled={scan.state === 'reading'}
          aria-expanded={pasting}
          onClick={() => (pasting ? setPasting(false) : openPaste())}
        >
          {scan.state === 'reading' && scan.pasted ? 'Reading…' : 'Paste message'}
        </button>
      </div>
      {pasting && (
        <div className="c-paste">
          <textarea
            className="t-input c-paste-box"
            aria-label="Customer's message"
            placeholder="Press and hold here, then tap Paste. A copied screenshot works too."
            rows={5}
            maxLength={8000}
            value={pasted}
            autoFocus
            onChange={(e) => setPasted(e.target.value)}
            onPaste={(e) => {
              const picture = pastedPicture(e.clipboardData);
              if (picture && !e.clipboardData.getData('text').trim()) {
                e.preventDefault();
                scanPhoto(picture, true);
                return;
              }
              const text = e.clipboardData.getData('text').slice(0, 8000);
              if (pasted.trim() || text.trim().length < 5) return; // adding to typed text: let them tap Fill the form
              e.preventDefault();
              setPasted(text);
              readPasted(text);
            }}
          />
          <div className="c-scan-row">
            <label className={'t-btn block c-scan-btn' + (reading('photo', true) ? ' busy' : '')} aria-disabled={scan.state === 'reading'}>
              <input
                type="file"
                accept="image/*"
                className="c-file"
                disabled={scan.state === 'reading'}
                aria-label="Message photo or screenshot"
                onChange={(e) => {
                  scanPhoto(e.target.files?.[0], true);
                  e.target.value = '';
                }}
              />
              {reading('photo', true) ? 'Reading…' : 'Photo or screenshot'}
            </label>
            <button type="button" className="t-btn primary block c-paste-fill" disabled={scan.state === 'reading'} onClick={() => readPasted()}>
              {scan.state === 'reading' && scan.from === 'message' ? 'Reading…' : 'Fill the form'}
            </button>
          </div>
        </div>
      )}
      {scan.state === 'done' && (
        <p className="c-scan-note" role="status">
          Filled in from the {scan.from === 'message' ? 'message' : scan.pasted ? 'picture' : 'photo'}. Please check every field, then tap {saveLabel}.
        </p>
      )}
      {scan.state === 'failed' && (
        <p className="c-err" role="alert">
          {scan.message}
        </p>
      )}
    </div>
  );
}

/** A picture in a paste (a copied screenshot or photo), or undefined. */
function pastedPicture(data: DataTransfer): File | undefined {
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile() ?? undefined;
  }
  return Array.from(data.files ?? []).find((f) => f.type.startsWith('image/'));
}

/** What was copied: its text, and a picture when only a picture was copied. Throws when the phone won't share it. */
async function readClipboard(): Promise<{ text: string; picture?: Blob }> {
  const clip = navigator.clipboard;
  if (clip?.read) {
    try {
      const items = await clip.read();
      for (const item of items) {
        if (item.types.includes('text/plain')) {
          const text = await (await item.getType('text/plain')).text();
          if (text.trim()) return { text };
        }
      }
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (type) return { text: '', picture: await item.getType(type) };
      }
      return { text: '' };
    } catch (e) {
      // Refused (the Paste bubble was dismissed, or the phone said no): asking again with readText
      // would only pop up a second Paste bubble on iPhone. Other errors: some browsers allow only readText.
      if ((e as Error)?.name === 'NotAllowedError') throw e;
    }
  }
  return { text: (await clip?.readText?.()) ?? '' };
}
