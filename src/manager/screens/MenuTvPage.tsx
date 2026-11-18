// One front menu TV (TV 1 to TV 4): its pictures in play order, + to add, tap to change.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { newId, restartLoop, store, useCollection, useNow, type Screen, type ScreenId, type Slot, type Transition, type WithId } from '@shared/data';
import { PARTNER, pictureFor } from '@shared/clock/loop';
import { Field, Segmented, Sheet } from '@shared/ui';
import { MIRROR_SOURCE, TRANSITIONS, fromLocalInput, insertOrder, moveSlot, parseSeconds, screenName, slotLine, sortSlots, toLocalInput, withoutPicture } from './logic';
import { FilePreview, PictureInput, ScreenPage, StoredPicture, Switch } from './parts';

type S = WithId<Slot>;
type Kind = NonNullable<Slot['kind']>;

const SIDE_LINE: Partial<Record<ScreenId, string>> = {
  tv1: 'Left side. Pictures play top to bottom, then start again.',
  tv2: 'Right side. Pictures play top to bottom, then start again.',
};

export default function MenuTvPage({ tv }: { tv: ScreenId }) {
  const screens = useCollection('screens');
  const slots = useCollection('slots');
  const now = useNow(30_000);
  if (!screens || !slots) {
    return <ScreenPage id={tv}><p className="t-sub">Loading…</p></ScreenPage>;
  }
  const screen = screens.find((s) => s.id === tv);
  const mirrorSrc = MIRROR_SOURCE[tv];
  const source = screen?.mirrorOf ?? null;
  const mirroring = !!(mirrorSrc && source);
  const sub = SIDE_LINE[tv] ?? (mirroring ? undefined : 'Pictures play top to bottom, then start again.');
  return (
    <ScreenPage id={tv} sub={sub}>
      {mirrorSrc && (
        <Switch
          label={`Mirror ${screenName(mirrorSrc)}`}
          sub={mirroring ? `Shows the same pictures as ${screenName(mirrorSrc)}` : 'Shows its own pictures'}
          on={mirroring}
          onChange={(on) => store.updateDoc('screens', tv, { mirrorOf: on ? mirrorSrc : null })}
        />
      )}
      {mirroring && source ? (
        <>
          <p className="sc-note" data-testid="mirror-note">
            {screenName(tv)} shows the same pictures as {screenName(source)}. To change them, open{' '}
            <Link to={'/manager/screens/' + source}>{screenName(source)}</Link> or turn off mirroring.
          </p>
          <PictureList tv={source} slots={slots} screens={screens} now={now} readOnly />
        </>
      ) : (
        <PictureList tv={tv} slots={slots} screens={screens} now={now} />
      )}
    </ScreenPage>
  );
}

type Open =
  | { kind: 'add'; after: number }
  | { kind: 'fill'; slotId: string; replace: boolean }
  | { kind: 'options'; slotId: string }
  | { kind: 'timing'; slotId: string }
  | null;

function PictureList({ tv, slots, screens, now, readOnly }: { tv: ScreenId; slots: S[]; screens: Screen[]; now: number; readOnly?: boolean }) {
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);
  const sorted = sortSlots(slots);
  const name = screenName(tv);
  const partner = PARTNER[tv];
  const find = (id: string) => sorted.find((s) => s.id === id);

  if (!sorted.length) {
    return (
      <>
        {readOnly ? (
          <div className="t-empty">No pictures yet.</div>
        ) : (
          <button className="sc-big-plus" onClick={() => setOpen({ kind: 'add', after: -1 })}>
            <span className="t-plus" aria-hidden>+</span>
            Add the first picture
          </button>
        )}
        {open?.kind === 'add' && <AddSheet tv={tv} sorted={sorted} after={-1} onClose={close} />}
      </>
    );
  }

  const openSlot = open && open.kind !== 'add' ? find(open.slotId) : undefined;
  return (
    <>
      <ol className="sc-list" data-testid="picture-list">
        {sorted.map((slot, i) => {
          const own = slot.pictures[tv];
          const shown = pictureFor(slot, tv, screens);
          const shared = !own && !!shown;
          const ended = slot.endsAt != null && slot.endsAt <= now;
          const kind = slot.kind ?? 'menu';
          const inner = (
            <>
              <StoredPicture id={shown} alt={`Picture ${i + 1}`} />
              {kind !== 'menu' && <span className="t-badge accent sc-kind">{kind === 'special' ? 'Special' : 'Catering'}</span>}
              {shared && partner && <span className="t-badge sc-shared">Shared with {screenName(partner)}</span>}
            </>
          );
          return (
            <li key={slot.id} className={'sc-item' + (ended ? ' sc-ended' : '')} data-testid="slot" data-slot-id={slot.id} data-picture-id={shown ?? ''}>
              {!shown ? (
                readOnly ? (
                  <div className="sc-pic sc-pic-empty">No picture for {name}</div>
                ) : (
                  <button className="sc-pic sc-pic-empty" onClick={() => setOpen({ kind: 'fill', slotId: slot.id, replace: false })}>
                    <span className="t-plus" aria-hidden>+</span>
                    Add a picture for {name}
                  </button>
                )
              ) : readOnly ? (
                <div className="sc-pic">{inner}</div>
              ) : (
                <button className="sc-pic" aria-label={`Picture ${i + 1}: options`} onClick={() => setOpen({ kind: 'options', slotId: slot.id })}>
                  {inner}
                </button>
              )}
              {readOnly ? (
                <p className="sc-meta">{slotLine(slot, now)}</p>
              ) : (
                <button className="sc-meta" data-testid="slot-line" onClick={() => setOpen({ kind: 'timing', slotId: slot.id })}>
                  {slotLine(slot, now)} <span aria-hidden>›</span>
                </button>
              )}
              {!readOnly && (
                <div className="sc-insert">
                  <button className="t-plus" aria-label={`Add a picture after picture ${i + 1}`} onClick={() => setOpen({ kind: 'add', after: i })}>
                    +
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {open?.kind === 'add' && <AddSheet tv={tv} sorted={sorted} after={open.after} onClose={close} />}
      {open?.kind === 'fill' && openSlot && <FillSheet tv={tv} slot={openSlot} replace={open.replace} onClose={close} />}
      {open?.kind === 'timing' && openSlot && <TimingSheet slot={openSlot} onClose={close} />}
      {open?.kind === 'options' && openSlot && (
        <OptionsSheet
          tv={tv}
          sorted={sorted}
          slot={openSlot}
          onClose={close}
          onReplace={() => setOpen({ kind: 'fill', slotId: openSlot.id, replace: true })}
        />
      )}
    </>
  );
}

/** Runs one save at a time and keeps a plain error message. */
function useSaver() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<void>, failText = 'Could not save. Try again.') => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch {
      setError(failText);
      setBusy(false);
      return;
    }
    setBusy(false);
  };
  return { busy, error, setError, run };
}

const KINDS: { value: Kind; label: string }[] = [
  { value: 'menu', label: 'Menu' },
  { value: 'special', label: 'Special' },
  { value: 'catering', label: 'Catering' },
];

function AddSheet({ tv, sorted, after, onClose }: { tv: ScreenId; sorted: S[]; after: number; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<Kind>('menu');
  const [seconds, setSeconds] = useState('10');
  const [transition, setTransition] = useState<Transition>('fade');
  const [ends, setEnds] = useState('');
  const { busy, error, setError, run } = useSaver();
  const secs = parseSeconds(seconds);

  const save = () => {
    if (!file) return setError('Choose a picture first.');
    if (secs == null) return setError('Seconds must be a whole number from 1 to 3600.');
    const endsAt = kind !== 'menu' && ends ? fromLocalInput(ends) : null;
    run(async () => {
      const pic = await store.uploadPicture(file, file.name);
      const id = newId();
      await store.setDoc('slots', id, { id, order: insertOrder(sorted, after), seconds: secs, transition, kind, pictures: { [tv]: pic.id }, endsAt });
      await restartLoop(id);
      onClose();
    }, 'That file could not be saved as a picture. Try another one.');
  };

  return (
    <Sheet open title={`Add a picture to ${screenName(tv)}`} onClose={onClose}>
      {file && <FilePreview file={file} />}
      <PictureInput label={file ? 'Choose a different picture' : 'Choose a picture'} className={'t-btn block' + (file ? '' : ' accent')} onFile={setFile} testId="add-file" />
      <Field label="Type">
        <Segmented label="Type" value={kind} options={KINDS} onChange={setKind} />
      </Field>
      <div className="t-grid2">
        <Field label="Seconds on screen">
          <input className="t-input" inputMode="numeric" value={seconds} onChange={(e) => setSeconds(e.target.value)} aria-invalid={secs == null} />
        </Field>
        <Field label="Change with">
          <Segmented label="Change with" value={transition} options={TRANSITIONS} onChange={setTransition} />
        </Field>
      </div>
      {kind !== 'menu' && (
        <Field label="Stop showing after (optional)">
          <input className="t-input" type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} />
        </Field>
      )}
      <p className="sc-hint">It plays right away on all front TVs, then in this spot in the loop.</p>
      {error && <p className="sc-error" role="alert">{error}</p>}
      <div className="sc-actions">
        <button className="t-btn" onClick={onClose}>Cancel</button>
        <button className="t-btn primary" onClick={save} disabled={busy || !file}>{busy ? 'Saving…' : 'Add picture'}</button>
      </div>
    </Sheet>
  );
}

function FillSheet({ tv, slot, replace, onClose }: { tv: ScreenId; slot: S; replace: boolean; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const { busy, error, run } = useSaver();
  const save = () =>
    file &&
    run(async () => {
      const pic = await store.uploadPicture(file, file.name);
      await store.setDoc('slots', slot.id, { ...slot, pictures: { ...slot.pictures, [tv]: pic.id } });
      await restartLoop(slot.id);
      onClose();
    }, 'That file could not be saved as a picture. Try another one.');
  return (
    <Sheet open title={replace ? 'Replace picture' : `Add a picture for ${screenName(tv)}`} onClose={onClose}>
      {file && <FilePreview file={file} />}
      <PictureInput label={file ? 'Choose a different picture' : 'Choose a picture'} className={'t-btn block' + (file ? '' : ' accent')} onFile={setFile} testId="fill-file" />
      <p className="sc-hint">Keeps this spot's seconds and transition ({slotLine(slot, store.now())}).</p>
      {error && <p className="sc-error" role="alert">{error}</p>}
      <div className="sc-actions">
        <button className="t-btn" onClick={onClose}>Cancel</button>
        <button className="t-btn primary" onClick={save} disabled={busy || !file}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </Sheet>
  );
}

function TimingSheet({ slot, onClose }: { slot: S; onClose: () => void }) {
  const [seconds, setSeconds] = useState(String(slot.seconds));
  const [transition, setTransition] = useState<Transition>(slot.transition ?? 'fade');
  const { busy, error, setError, run } = useSaver();
  const secs = parseSeconds(seconds);
  const save = () => {
    if (secs == null) return setError('Seconds must be a whole number from 1 to 3600.');
    run(async () => {
      await store.setDoc('slots', slot.id, { ...slot, seconds: secs, transition });
      await restartLoop(slot.id);
      onClose();
    });
  };
  return (
    <Sheet open title="Time on screen" onClose={onClose}>
      <p className="sc-note">This applies to all front TVs (TV 1 to TV 4) for this spot, because they change pictures together.</p>
      <Field label="Seconds on screen">
        <input className="t-input" inputMode="numeric" value={seconds} onChange={(e) => setSeconds(e.target.value)} aria-invalid={secs == null} data-testid="timing-seconds" />
      </Field>
      <Field label="Change with">
        <Segmented label="Change with" value={transition} options={TRANSITIONS} onChange={setTransition} />
      </Field>
      {error && <p className="sc-error" role="alert">{error}</p>}
      <div className="sc-actions">
        <button className="t-btn" onClick={onClose}>Cancel</button>
        <button className="t-btn primary" onClick={save} disabled={busy}>Save</button>
      </div>
    </Sheet>
  );
}

function OptionsSheet({ tv, sorted, slot, onClose, onReplace }: { tv: ScreenId; sorted: S[]; slot: S; onClose: () => void; onReplace: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [ends, setEnds] = useState(slot.endsAt != null ? toLocalInput(slot.endsAt) : '');
  const { busy, error, run } = useSaver();
  const index = sorted.findIndex((s) => s.id === slot.id);
  const own = !!slot.pictures[tv];
  const name = screenName(tv);
  const partner = PARTNER[tv];

  const move = (dir: -1 | 1) =>
    run(async () => {
      for (const s of moveSlot(sorted, index, dir)) await store.setDoc('slots', s.id, s);
      await restartLoop(slot.id);
    });
  const saveEnds = (value: number | null) =>
    run(async () => {
      await store.setDoc('slots', slot.id, { ...slot, endsAt: value });
      await restartLoop(slot.id);
      if (value == null) setEnds('');
    });
  const remove = () =>
    run(async () => {
      const next = withoutPicture(slot, tv);
      if (next) await store.setDoc('slots', slot.id, next);
      else await store.deleteDoc('slots', slot.id);
      await restartLoop(null);
      onClose();
    });

  if (confirm) {
    const lastOne = !withoutPicture(slot, tv);
    return (
      <Sheet open title={`Remove this picture from ${name}?`} onClose={onClose}>
        <p className="sc-note">
          {lastOne ? 'No other TV uses this spot, so it leaves the loop.' : `${partner ? screenName(partner) : 'The other TV'} keeps its picture in this spot.`}
        </p>
        {error && <p className="sc-error" role="alert">{error}</p>}
        <div className="sc-actions">
          <button className="t-btn" onClick={() => setConfirm(false)}>Keep it</button>
          <button className="t-btn danger" onClick={remove} disabled={busy}>Remove</button>
        </div>
      </Sheet>
    );
  }

  const endsMs = ends ? fromLocalInput(ends) : null;
  return (
    <Sheet open title={`Picture ${index + 1} of ${sorted.length}`} onClose={onClose}>
      <div className="sc-menu">
        <button className="t-btn block" onClick={onReplace}>{own ? 'Replace picture' : `Use a different picture on ${name}`}</button>
        <div className="t-grid2">
          <button className="t-btn" onClick={() => move(-1)} disabled={busy || index <= 0}>Move up</button>
          <button className="t-btn" onClick={() => move(1)} disabled={busy || index >= sorted.length - 1}>Move down</button>
        </div>
      </div>
      <Field label="Stop showing after (optional)">
        <input className="t-input" type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} data-testid="ends-input" />
      </Field>
      <div className="t-grid2">
        <button className="t-btn" onClick={() => saveEnds(endsMs)} disabled={busy || endsMs == null || endsMs === slot.endsAt}>Save end date</button>
        <button className="t-btn" onClick={() => saveEnds(null)} disabled={busy || slot.endsAt == null}>No end date</button>
      </div>
      {error && <p className="sc-error" role="alert">{error}</p>}
      {own && (
        <button className="t-btn block danger" onClick={() => setConfirm(true)}>Remove from {name}</button>
      )}
      <button className="t-btn block ghost" onClick={onClose}>Done</button>
    </Sheet>
  );
}
