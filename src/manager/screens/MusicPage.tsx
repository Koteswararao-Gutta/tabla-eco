// TV 5: music settings and the catering clip shown between songs.
import { useCallback, useEffect, useRef, useState } from 'react';
import { store, updateSingleton, useCollection, useSingleton, type MusicSettings } from '@shared/data';
import { Field, Segmented } from '@shared/ui';
import { parseSeconds } from './logic';
import { CLIP_SECONDS, EVERY_SECONDS } from '../../tv-music/schedule';
import { parsePlaylistId } from '../../tv-music/playlist';
import { deletePictureIfUnused, PictureInput, ScreenPage, StoredPicture } from './parts';

const DEFAULTS: MusicSettings = {
  playlist: '', shuffle: true, clipMode: 'afterEachSong', everySeconds: 60, clipSeconds: 8,
  clipPictures: [], clipTitle: '', clipLine: '',
};

type Form = Omit<MusicSettings, 'everySeconds' | 'clipSeconds'> & { everySeconds: string; clipSeconds: string };
const toForm = (m: MusicSettings): Form => ({ ...m, everySeconds: String(m.everySeconds), clipSeconds: String(m.clipSeconds) });
type Section = 'music' | 'clip';
/** Typing waits this long before saving (or saves when the field loses focus, or the page closes). */
const TYPING_MS = 600;
/** How long "Picture removed" offers Undo before the stored file is deleted. */
const UNDO_MS = 6000;

export default function MusicPage() {
  const music = useSingleton('music');
  return (
    <ScreenPage id="tv5" sub="Music from YouTube, with a short catering clip between songs. Changes save as you make them.">
      {music === undefined ? <p className="t-sub">Loading…</p> : <MusicForm initial={{ ...DEFAULTS, ...(music ?? {}) }} />}
    </ScreenPage>
  );
}

/** Saves each change right away (typing: after a short pause), like TV 1 to TV 4.
 *  Only the changed fields are written, and anything still waiting is saved when the page closes. */
function useAutoSave() {
  const pending = useRef<Partial<MusicSettings>>({});
  const section = useRef<Section>('music');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const [saved, setSaved] = useState<{ section: Section; n: number } | null>(null);
  const [failed, setFailed] = useState(false);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const patch = pending.current;
    pending.current = {};
    if (!Object.keys(patch).length) return;
    const where = section.current;
    try {
      await updateSingleton('music', patch);
      if (alive.current) {
        setFailed(false);
        setSaved((x) => ({ section: where, n: (x?.n ?? 0) + 1 }));
      }
    } catch {
      if (alive.current) setFailed(true);
    }
  }, []);

  const save = useCallback(
    (patch: Partial<MusicSettings>, where: Section, delay = 0) => {
      pending.current = { ...pending.current, ...patch };
      section.current = where;
      if (timer.current) clearTimeout(timer.current);
      timer.current = delay ? setTimeout(flush, delay) : null;
      if (!delay) void flush();
    },
    [flush],
  );

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      void flush(); // leaving the page never drops a change
    };
  }, [flush]);

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(null), 2000);
    return () => clearTimeout(t);
  }, [saved]);

  return { save, flush, saved: saved?.section ?? null, failed };
}

function SectionHead({ title, saved }: { title: string; saved: boolean }) {
  return (
    <div className="sc-head">
      <h2 className="sc-h2">{title}</h2>
      <span className="sc-saved" role="status">{saved ? 'Saved' : ''}</span>
    </div>
  );
}

function MusicForm({ initial }: { initial: MusicSettings }) {
  const [f, setF] = useState<Form>(() => toForm(initial));
  const [uploading, setUploading] = useState(false);
  const [uploadFailed, setUploadFailed] = useState(false);
  const { save, flush, saved, failed } = useAutoSave();
  const slots = useCollection('slots');
  const pictures = useRef(f.clipPictures);
  pictures.current = f.clipPictures;

  // The same limits the TV uses, so what is saved is what plays.
  const within = (n: number | null, r: { min: number; max: number }) => (n != null && n >= r.min && n <= r.max ? n : null);
  const every = within(parseSeconds(f.everySeconds), { min: EVERY_SECONDS.min, max: 3600 });
  const clip = within(parseSeconds(f.clipSeconds), CLIP_SECONDS);
  const notPlaylist = f.playlist.trim() !== '' && !parsePlaylistId(f.playlist.trim());

  /** Changes the form and saves the matching stored fields. */
  const set = (patch: Partial<Form>, where: Section, stored: Partial<MusicSettings>, delay = 0) => {
    setF((x) => ({ ...x, ...patch }));
    save(stored, where, delay);
  };
  const typed = (patch: Partial<Form>, where: Section, stored: Partial<MusicSettings> | null) => {
    setF((x) => ({ ...x, ...patch }));
    if (stored) save(stored, where, TYPING_MS);
  };

  const setPictures = (list: string[]) => {
    pictures.current = list;
    set({ clipPictures: list }, 'clip', { clipPictures: list });
  };

  const addPicture = async (file: File) => {
    setUploading(true);
    setUploadFailed(false);
    try {
      const pic = await store.uploadPicture(file, file.name);
      setPictures([...pictures.current, pic.id]);
    } catch {
      setUploadFailed(true);
    }
    setUploading(false);
  };

  // A removed picture leaves the clip at once; its stored file is deleted only when Undo is no longer offered.
  const [removed, setRemoved] = useState<{ id: string; index: number } | null>(null);
  const removedRef = useRef(removed);
  const undoTimer = useRef<ReturnType<typeof setTimeout>>();
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const finishRemove = useCallback(() => {
    clearTimeout(undoTimer.current);
    const r = removedRef.current;
    removedRef.current = null;
    // Slots still loading: keep the file (leaving an unused picture behind is harmless).
    if (r && slotsRef.current) void deletePictureIfUnused(r.id, slotsRef.current, pictures.current);
  }, []);
  useEffect(() => finishRemove, [finishRemove]); // leaving the page ends the Undo

  const removePicture = (i: number) => {
    finishRemove(); // an earlier removal can no longer be undone
    const r = { id: pictures.current[i], index: i };
    setPictures(pictures.current.filter((_, j) => j !== i));
    removedRef.current = r;
    setRemoved(r);
    undoTimer.current = setTimeout(() => {
      finishRemove();
      setRemoved(null);
    }, UNDO_MS);
  };
  const undoRemove = () => {
    clearTimeout(undoTimer.current);
    const r = removedRef.current;
    removedRef.current = null;
    setRemoved(null);
    if (!r) return;
    const list = [...pictures.current];
    list.splice(Math.min(r.index, list.length), 0, r.id);
    setPictures(list);
  };

  return (
    <div className="t-stack">
      <section className="t-card t-stack">
        <SectionHead title="Music" saved={saved === 'music'} />
        <Field label="YouTube playlist link">
          <input
            className="t-input"
            type="url"
            inputMode="url"
            placeholder="https://www.youtube.com/playlist?list=…"
            value={f.playlist}
            onChange={(e) => typed({ playlist: e.target.value }, 'music', { playlist: e.target.value.trim() })}
            onBlur={flush}
            aria-invalid={notPlaylist}
          />
        </Field>
        {notPlaylist && <p className="sc-error" role="alert">This is not a playlist link, so no music will play. Open the playlist on YouTube and copy its link (it has "list=" in it).</p>}
        <div className="t-field" role="group" aria-label="Shuffle">
          <span>Shuffle</span>
          <Segmented label="Shuffle" value={f.shuffle ? 'on' : 'off'} options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} onChange={(v) => set({ shuffle: v === 'on' }, 'music', { shuffle: v === 'on' })} />
        </div>
      </section>

      <section className="t-card t-stack">
        <SectionHead title="Catering clip" saved={saved === 'clip'} />
        <div className="t-field" role="group" aria-label="When it plays">
          <span>When it plays</span>
          <Segmented
            label="When it plays"
            value={f.clipMode}
            options={[{ value: 'afterEachSong', label: 'After each song' }, { value: 'everySeconds', label: 'On a timer' }]}
            onChange={(v) => set({ clipMode: v }, 'clip', every == null || v !== 'everySeconds' ? { clipMode: v } : { clipMode: v, everySeconds: every })}
          />
        </div>
        {f.clipMode === 'everySeconds' && (
          <Field label="Show the clip every … seconds">
            <input
              className="t-input sc-seconds"
              inputMode="numeric"
              value={f.everySeconds}
              onChange={(e) => {
                const n = parseSeconds(e.target.value);
                typed({ everySeconds: e.target.value }, 'clip', n == null ? null : { everySeconds: n });
              }}
              onBlur={flush}
              aria-invalid={every == null}
            />
          </Field>
        )}
        <Field label="Clip length (seconds)">
          <input
            className="t-input sc-seconds"
            inputMode="numeric"
            value={f.clipSeconds}
            onChange={(e) => {
              const n = parseSeconds(e.target.value);
              typed({ clipSeconds: e.target.value }, 'clip', n == null ? null : { clipSeconds: n });
            }}
            onBlur={flush}
            aria-invalid={clip == null}
          />
        </Field>
        {(clip == null || (f.clipMode === 'everySeconds' && every == null)) && (
          <p className="sc-error" role="alert">
            Clip length must be {CLIP_SECONDS.min} to {CLIP_SECONDS.max} seconds{f.clipMode === 'everySeconds' ? `, and the timer ${EVERY_SECONDS.min} to 3600 seconds` : ''}. This is not saved yet.
          </p>
        )}
        <Field label="Title">
          <input className="t-input" value={f.clipTitle} placeholder="We do catering" onChange={(e) => typed({ clipTitle: e.target.value }, 'clip', { clipTitle: e.target.value.trim() })} onBlur={flush} />
        </Field>
        <Field label="Smaller line under the title">
          <input className="t-input" value={f.clipLine} placeholder="Parties, offices and weddings." onChange={(e) => typed({ clipLine: e.target.value }, 'clip', { clipLine: e.target.value.trim() })} onBlur={flush} />
        </Field>
        <div className="t-field">
          <span>Pictures</span>
          <div className="sc-clip-grid">
            {f.clipPictures.map((id, i) => (
              <div key={id + i} className="sc-clip" data-testid="clip-picture">
                <StoredPicture id={id} alt={`Clip picture ${i + 1}`} />
                <button className="sc-clip-x" aria-label={`Remove clip picture ${i + 1}`} onClick={() => removePicture(i)} />
              </div>
            ))}
            <PictureInput
              className="sc-clip sc-clip-add"
              label={<><span className="t-plus" aria-hidden>+</span><span>{uploading ? 'Adding…' : 'Add picture'}</span></>}
              onFile={addPicture}
              disabled={uploading}
              testId="clip-file"
            />
          </div>
        </div>
        {uploadFailed && <p className="sc-error" role="alert">That file could not be saved as a picture. Try another one.</p>}
        {removed && (
          <div className="sc-toast" role="status" data-testid="undo-toast" ref={(el) => el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })}>
            <span className="sc-toast-text">Picture removed</span>
            <button className="t-btn accent" onClick={undoRemove}>Undo</button>
          </div>
        )}
      </section>

      {failed && <p className="sc-error" role="alert">Could not save. Check the connection and try again.</p>}

    </div>
  );
}
