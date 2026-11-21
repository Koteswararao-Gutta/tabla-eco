// "Scan paper" and "Paste message": Claude reads a photo of a handwritten order or a customer's message
// and fills the form. Used by New order and New estimate; each form decides how to fill itself.
import { useState } from 'react';
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
  const [scan, setScan] = useState<{ state: 'idle' | 'reading' | 'done' | 'failed'; from?: ScanFrom; message?: string }>({ state: 'idle' });
  const [pasting, setPasting] = useState(false);
  const [pasted, setPastedText] = useState('');
  const setPasted = (t: string) => {
    setPastedText(t);
    onPending?.(t.trim() !== '');
  };

  const fillFrom = async (from: ScanFrom, read: () => Promise<ScannedOrder>) => {
    setScan({ state: 'reading', from });
    try {
      const got = await read();
      if (!got.isOrder) {
        const message = from === 'photo' ? "This photo doesn't look like an order. Please try another photo." : "This message doesn't look like an order. Please check what you pasted.";
        return setScan({ state: 'failed', from, message });
      }
      onFilled(got, from);
      setScan({ state: 'done', from });
      setPasting(false);
    } catch (e) {
      setScan({ state: 'failed', from, message: e instanceof Error ? e.message : `Couldn't read the ${from}.` });
    }
  };
  const scanPhoto = (photo: File | undefined) => photo && fillFrom('photo', () => store.readOrderPhoto(photo));
  const readPasted = (text = pasted) => {
    if (text.trim().length < 5) return setScan({ state: 'failed', from: 'message', message: 'Please paste the customer’s message first.' });
    fillFrom('message', () => store.readOrderText(text));
  };
  // One tap: read what was copied and fill the form at once. If the phone won't share the clipboard,
  // the box opens instead, and pasting into it fills the form the same way.
  const openPaste = async () => {
    setScan({ state: 'idle' });
    let copied = '';
    try {
      copied = ((await navigator.clipboard?.readText?.()) ?? '').slice(0, 8000);
    } catch {
      /* not allowed here: the person pastes into the box */
    }
    if (copied.trim().length >= 5) {
      setPasted(copied);
      readPasted(copied);
    } else {
      setPasting(true);
    }
  };

  return (
    <div className="c-scan">
      <div className="c-scan-row">
        <label className={'t-btn block c-scan-btn' + (scan.state === 'reading' && scan.from === 'photo' ? ' busy' : '')} aria-disabled={scan.state === 'reading'}>
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
          {scan.state === 'reading' && scan.from === 'photo' ? 'Reading…' : 'Scan paper'}
        </label>
        <button
          type="button"
          className={'t-btn block c-scan-btn' + (pasting ? ' on' : '')}
          disabled={scan.state === 'reading'}
          aria-expanded={pasting}
          onClick={() => (pasting ? setPasting(false) : openPaste())}
        >
          {scan.state === 'reading' && scan.from === 'message' ? 'Reading…' : 'Paste message'}
        </button>
      </div>
      {pasting && (
        <div className="c-paste">
          <textarea
            className="t-input c-paste-box"
            aria-label="Customer's message"
            placeholder="Press and hold here, then tap Paste"
            rows={5}
            maxLength={8000}
            value={pasted}
            autoFocus
            onChange={(e) => setPasted(e.target.value)}
            onPaste={(e) => {
              const text = e.clipboardData.getData('text').slice(0, 8000);
              if (pasted.trim() || text.trim().length < 5) return; // adding to typed text: let them tap Fill the form
              e.preventDefault();
              setPasted(text);
              readPasted(text);
            }}
          />
          <button type="button" className="t-btn primary block" disabled={scan.state === 'reading'} onClick={() => readPasted()}>
            {scan.state === 'reading' && scan.from === 'message' ? 'Reading the message…' : 'Fill the form'}
          </button>
        </div>
      )}
      {scan.state === 'done' && (
        <p className="c-scan-note" role="status">
          Filled in from the {scan.from === 'message' ? 'message' : 'photo'}. Please check every field, then tap {saveLabel}.
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
