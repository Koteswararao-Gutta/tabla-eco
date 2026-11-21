// One front menu TV (TV 1 to TV 4): its pictures in play order, + to add, tap to change.
// Writes: picture changes save the whole slot (so a removed TV entry really goes, even on a
// merging backend); seconds, transition, order and end date update only that field, so two
// phones editing different things never overwrite each other.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { newId, restartLoop, store, useCollection, useNow, type Screen, type ScreenId, type Slot, type Transition, type WithId } from '@shared/data';
import { MAIN_OF, PARTNER, loopSlots, pictureFor } from '@shared/clock/loop';
import { Field, Segmented, Sheet } from '@shared/ui';
import { MIRROR_SOURCE, TRANSITIONS, fromLocalInput, insertOrder, moveSlotTo, parseSeconds, screenName, slotLine, sortSlots, toLocalInput, withoutPicture } from './logic';
import { useAppBase } from '../mode';
import { deletePictureIfUnused, FilePreview, PictureInput, ScreenPage, StoredPicture, Switch } from './parts';

type S = WithId<Slot>;
type Kind = NonNullable<Slot['kind']>;

const SIDE_LINE: Partial<Record<ScreenId, string>> = {
  tv1: 'Left side. Pictures play top to bottom, then start again.',
  tv2: 'Right side. Pictures play top to bottom, then start again.',
};
const PLAY_LINE = 'Pictures play top to bottom, then start again.';

/** Saves a change to a slot only if it still exists: another phone may have removed it meanwhile, and a
 *  merge into a missing slot would leave a half slot (no pictures) that breaks every TV. */
async function updateSlot(id: string, patch: Partial<Slot>) {
  if (!(await store.getDoc('slots', id))) return;
  await store.updateDoc('slots', id, patch);
}

/** Slots with the fields a TV needs; anything half-saved is left out rather than breaking the page. */
export const isWholeSlot = (s: Partial<Slot>): boolean => !!s.pictures && typeof s.pictures === 'object' && typeof s.seconds === 'number' && typeof s.order === 'number';

export default function MenuTvPage({ tv }: { tv: ScreenId }) {
  const screens = useCollection('screens');
  const allSlots = useCollection('slots');
  const slots = useMemo(() => allSlots && allSlots.filter(isWholeSlot), [allSlots]);
  const now = useNow(30_000);
  const base = useAppBase();
  if (!screens || !slots) {
    return <ScreenPage id={tv}><p className="t-sub">Loading…</p></ScreenPage>;
  }
  const screen = screens.find((s) => s.id === tv);
  const mirrorSrc = MIRROR_SOURCE[tv];
  const source = screen?.mirrorOf ?? null;
  const mirroring = !!(mirrorSrc && source);
  // The same line whether mirroring is on or off, so the switch never moves under the finger.
  const sub = SIDE_LINE[tv] ?? PLAY_LINE;
  return (
    <ScreenPage id={tv} sub={sub}>
      {mirrorSrc && (
        <Switch
          label={`Mirror ${screenName(mirrorSrc)}`}
          sub={mirroring ? `Shows the same pictures as ${screenName(mirrorSrc)}` : `Shows ${screenName(mirrorSrc)}'s pictures until you add its own`}
          on={mirroring}
          onChange={(on) => store.updateDoc('screens', tv, { mirrorOf: on ? mirrorSrc : null })}
        />
      )}
      {mirroring && source ? (
        <>
          <p className="sc-note sc-mirror-note" data-testid="mirror-note">
            To change these pictures, open
            <Link className="sc-link" to={base + '/screens/' + source}>{screenName(source)} ›</Link>
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
  // Only the spots this TV plays: TV 1 and TV 2 never list spots that exist only on TV 3 / TV 4.
  const sorted = sortSlots(loopSlots(slots, tv, screens));
  const name = screenName(tv);
  const partner = PARTNER[tv];
  const main = MAIN_OF[tv];
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
          const inner = <StoredPicture id={shown} alt={`Picture ${i + 1}`} />;
          const badges = (
            <>
              {kind !== 'menu' && <span className="t-badge accent">{kind === 'special' ? 'Special' : 'Catering'}</span>}
              {shared && main && shown === slot.pictures[main] ? (
                <span className="t-badge">Same as {screenName(main)}</span>
              ) : (
                shared && partner && <span className="t-badge">Shared with {screenName(partner)}</span>
              )}
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
              <div className="sc-under">
                {badges}
                {readOnly ? (
                  <p className="sc-meta">{slotLine(slot, now)}</p>
                ) : (
                  <button className="sc-meta" data-testid="slot-line" onClick={() => setOpen({ kind: 'timing', slotId: slot.id })}>
                    {slotLine(slot, now)} <span aria-hidden>›</span>
                  </button>
                )}
              </div>
              {!readOnly && i < sorted.length - 1 && (
                <div className="sc-insert">
                  <button className="t-plus sc-insert-plus" aria-label={`Add a picture between ${i + 1} and ${i + 2}`} onClick={() => setOpen({ kind: 'add', after: i })}>
                    +
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {!readOnly && (
        <button className="t-btn block sc-add-end" onClick={() => setOpen({ kind: 'add', after: sorted.length - 1 })}>
          <span aria-hidden>+</span> Add a picture
        </button>
      )}
      {open?.kind === 'add' && <AddSheet tv={tv} sorted={sorted} after={open.after} onClose={close} />}
      {open?.kind === 'fill' && openSlot && <FillSheet tv={tv} sorted={sorted} slot={openSlot} replace={open.replace} onClose={close} />}
      {open?.kind === 'timing' && openSlot && <TimingSheet slot={openSlot} onClose={close} />}
      {open?.kind === 'options' && openSlot && (
        <OptionsSheet
          tv={tv}
          sorted={sorted}
          slot={openSlot}
          screens={screens}
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

/** What the TVs show for a newly added picture, in plain words. */
function addHint(tv: ScreenId, kind: Kind): string {
  const partner = PARTNER[tv];
  const other = partner ? screenName(partner) : 'The other TV';
  const mainsSame = MAIN_OF[tv] ? ' TV 1 and TV 2 don\'t change.' : '';
  return (kind === 'menu'
    ? `${screenName(tv)} shows it right away, then in this spot in the loop. ${other} shows the restaurant name in this spot until you add its picture.`
    : `It shows right away, then in this spot in the loop. ${other} shows it too until you add a picture for ${other}.`) + mainsSame;
}

/** Seconds and "Change with", each on its own full row (the same in every sheet). */
function TimingFields({ seconds, setSeconds, transition, setTransition, invalid, testId }: { seconds: string; setSeconds: (v: string) => void; transition: Transition; setTransition: (t: Transition) => void; invalid: boolean; testId?: string }) {
  return (
    <>
      <Field label="Seconds on screen">
        <input className="t-input sc-seconds" inputMode="numeric" value={seconds} onChange={(e) => setSeconds(e.target.value)} aria-invalid={invalid} data-testid={testId} />
      </Field>
      <div className="t-field" role="group" aria-label="Change with">
        <span>Change with</span>
        <Segmented label="Change with" value={transition} options={TRANSITIONS} onChange={setTransition} />
      </div>
    </>
  );
}

/** Primary action full-width, ghost Cancel below: how every sheet here ends. */
function SheetEnd({ label, onSave, onCancel, disabled, cancel = 'Cancel', primary = 'primary' }: { label: string; onSave: () => void; onCancel: () => void; disabled?: boolean; cancel?: string; primary?: string }) {
  return (
    <div className="sc-end">
      <button className={'t-btn block ' + primary} onClick={onSave} disabled={disabled}>{label}</button>
      <button className="t-btn block ghost" onClick={onCancel}>{cancel}</button>
    </div>
  );
}

const SECONDS_ERROR = 'Seconds must be a whole number from 1 to 3600.';

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
    if (secs == null) return setError(SECONDS_ERROR);
    const endsAt = kind !== 'menu' && ends ? fromLocalInput(ends) : null;
    if (kind !== 'menu' && ends && endsAt == null) return setError('That end date is not a valid date.');
    if (endsAt != null && endsAt <= store.now()) return setError('That end date has already passed, so the picture would never show.');
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
      <div className="t-field" role="group" aria-label="Type">
        <span>Type</span>
        <Segmented label="Type" value={kind} options={KINDS} onChange={setKind} />
      </div>
      <TimingFields seconds={seconds} setSeconds={setSeconds} transition={transition} setTransition={setTransition} invalid={secs == null} />
      {kind !== 'menu' && (
        <Field label="Stop showing after (optional)">
          <input className="t-input sc-when" type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} />
        </Field>
      )}
      <p className="sc-hint" data-testid="add-hint">{addHint(tv, kind)}</p>
      {error && <p className="sc-error" role="alert">{error}</p>}
      <SheetEnd label={busy ? 'Saving…' : 'Add picture'} onSave={save} onCancel={onClose} disabled={busy || !file} />
    </Sheet>
  );
}

function FillSheet({ tv, sorted, slot, replace, onClose }: { tv: ScreenId; sorted: S[]; slot: S; replace: boolean; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const { busy, error, run } = useSaver();
  const save = () =>
    file &&
    run(async () => {
      const old = slot.pictures[tv];
      const pic = await store.uploadPicture(file, file.name);
      const next = { ...slot, pictures: { ...slot.pictures, [tv]: pic.id } };
      await store.setDoc('slots', slot.id, next);
      await restartLoop(slot.id);
      onClose();
      await deletePictureIfUnused(old, sorted.map((s) => (s.id === slot.id ? next : s)));
    }, 'That file could not be saved as a picture. Try another one.');
  return (
    <Sheet open title={replace ? 'Replace picture' : `Add a picture for ${screenName(tv)}`} onClose={onClose}>
      {file && <FilePreview file={file} />}
      <PictureInput label={file ? 'Choose a different picture' : 'Choose a picture'} className={'t-btn block' + (file ? '' : ' accent')} onFile={setFile} testId="fill-file" />
      <p className="sc-hint">Keeps this spot's seconds and transition ({slotLine(slot, store.now())}).</p>
      {error && <p className="sc-error" role="alert">{error}</p>}
      <SheetEnd label={busy ? 'Saving…' : 'Save'} onSave={save} onCancel={onClose} disabled={busy || !file} />
    </Sheet>
  );
}

const ALL_TVS_NOTE = 'Order, seconds and change are shared by TV 1 to TV 4.';

function TimingSheet({ slot, onClose }: { slot: S; onClose: () => void }) {
  const [seconds, setSeconds] = useState(String(slot.seconds));
  const [transition, setTransition] = useState<Transition>(slot.transition ?? 'fade');
  const { busy, error, setError, run } = useSaver();
  const secs = parseSeconds(seconds);
  const save = () => {
    if (secs == null) return setError(SECONDS_ERROR);
    run(async () => {
      await updateSlot(slot.id, { seconds: secs, transition });
      await restartLoop(slot.id);
      onClose();
    });
  };
  return (
    <Sheet open title="Time on screen" onClose={onClose}>
      <TimingFields seconds={seconds} setSeconds={setSeconds} transition={transition} setTransition={setTransition} invalid={secs == null} testId="timing-seconds" />
      <p className="sc-hint">{ALL_TVS_NOTE}</p>
      {error && <p className="sc-error" role="alert">{error}</p>}
      <SheetEnd label={busy ? 'Saving…' : 'Save'} onSave={save} onCancel={onClose} disabled={busy} />
    </Sheet>
  );
}

function OptionsSheet({ tv, sorted, slot, screens, onClose, onReplace }: { tv: ScreenId; sorted: S[]; slot: S; screens: Screen[]; onClose: () => void; onReplace: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [ends, setEnds] = useState(slot.endsAt != null ? toLocalInput(slot.endsAt) : '');
  const { busy, error, setError, run } = useSaver();
  const index = sorted.findIndex((s) => s.id === slot.id);
  const own = slot.pictures[tv];
  const name = screenName(tv);
  const partner = PARTNER[tv];
  const main = MAIN_OF[tv];
  const kind = slot.kind ?? 'menu';
  // Menu pictures never end (the Add sheet doesn't offer it); an old end date can still be cleared.
  const showEnds = kind !== 'menu' || slot.endsAt != null;

  const endsMs = ends ? fromLocalInput(ends) : null;
  const dirty = (endsMs ?? null) !== (slot.endsAt ?? null);

  /** Moves this picture to position `to` (0 = top): all order changes are saved together, then the loop
   *  restarts once, so the TVs never show a half-moved order. */
  const move = (to: number) =>
    run(async () => {
      const changed = moveSlotTo(sorted, index, to);
      if (!changed.length) return;
      await Promise.all(changed.map((s) => updateSlot(s.id, { order: s.order })));
      await restartLoop(slot.id);
    });
  const first = index <= 0;
  const last = index >= sorted.length - 1;
  const save = () => {
    if (ends && endsMs == null) return setError('That end date is not a valid date.');
    run(async () => {
      await updateSlot(slot.id, { endsAt: endsMs });
      await restartLoop(slot.id);
      onClose();
    });
  };
  const remove = () =>
    run(async () => {
      const next = withoutPicture(slot, tv);
      if (next) await store.setDoc('slots', slot.id, next);
      else await store.deleteDoc('slots', slot.id);
      await restartLoop(null);
      onClose();
      const after = sorted.flatMap((s) => (s.id !== slot.id ? [s] : next ? [next] : []));
      await deletePictureIfUnused(own, after);
    });

  if (confirm) {
    const lastOne = !withoutPicture(slot, tv);
    return (
      <Sheet open title={`Remove this picture from ${name}?`} onClose={onClose}>
        <p className="sc-note">
          {lastOne
            ? 'No other TV uses this spot, so it leaves the loop.'
            : main && slot.pictures[main]
              ? `${name} shows ${screenName(main)}'s picture here again.`
              : `${partner ? screenName(partner) : 'The other TV'} keeps its picture in this spot.`}
        </p>
        {error && <p className="sc-error" role="alert">{error}</p>}
        <SheetEnd label={busy ? 'Removing…' : 'Remove picture'} primary="sc-danger-solid" onSave={remove} onCancel={() => setConfirm(false)} cancel="Keep it" disabled={busy} />
      </Sheet>
    );
  }

  const shown = pictureFor(slot, tv, screens);
  return (
    <Sheet open title={`Picture ${index + 1} of ${sorted.length}`} onClose={onClose}>
      <div className="sc-pic sc-pic-static" data-testid="options-preview">
        <StoredPicture id={shown} alt={`Picture ${index + 1}`} />
      </div>
      <div className="sc-menu">
        <button className="t-btn block" onClick={onReplace}>{own ? 'Replace picture' : `Use a different picture on ${name}`}</button>
        <div className="t-grid2">
          <button className="t-btn" onClick={() => move(index - 1)} disabled={busy || first}>Move up</button>
          <button className="t-btn" onClick={() => move(index + 1)} disabled={busy || last}>Move down</button>
        </div>
        {own && (
          <button className="t-btn block danger" onClick={() => setConfirm(true)}>Remove from {name}</button>
        )}
      </div>
      {showEnds && (
        <>
          <hr className="sc-rule" />
          <Field label="Stop showing after (optional)">
            <input className="t-input sc-when" type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} data-testid="ends-input" />
          </Field>
          {ends && (
            <button className="t-btn ghost sc-clear" onClick={() => setEnds('')}>Clear end date</button>
          )}
        </>
      )}
      <p className="sc-hint">{ALL_TVS_NOTE}</p>
      {error && <p className="sc-error" role="alert">{error}</p>}
      {dirty ? (
        <SheetEnd label={busy ? 'Saving…' : 'Save changes'} onSave={save} onCancel={onClose} disabled={busy} />
      ) : (
        <button className="t-btn block" onClick={onClose}>Done</button>
      )}
    </Sheet>
  );
}
