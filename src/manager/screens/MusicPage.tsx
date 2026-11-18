// TV 5: music settings and the catering clip shown between songs.
import { useEffect, useState } from 'react';
import { store, updateSingleton, useSingleton, type MusicSettings } from '@shared/data';
import { Field, Segmented } from '@shared/ui';
import { parseSeconds } from './logic';
import { PictureInput, ScreenPage, StoredPicture } from './parts';

const DEFAULTS: MusicSettings = {
  playlist: '', shuffle: true, clipMode: 'afterEachSong', everySeconds: 60, clipSeconds: 8,
  clipPictures: [], clipTitle: '', clipLine: '',
};

type Form = Omit<MusicSettings, 'everySeconds' | 'clipSeconds'> & { everySeconds: string; clipSeconds: string };
const toForm = (m: MusicSettings): Form => ({ ...m, everySeconds: String(m.everySeconds), clipSeconds: String(m.clipSeconds) });

export default function MusicPage() {
  const music = useSingleton('music');
  return (
    <ScreenPage id="tv5" sub="Music from YouTube, with a short catering clip between songs.">
      {music === undefined ? <p className="t-sub">Loading…</p> : <MusicForm initial={{ ...DEFAULTS, ...(music ?? {}) }} />}
    </ScreenPage>
  );
}

function MusicForm({ initial }: { initial: MusicSettings }) {
  const [f, setF] = useState<Form>(() => toForm(initial));
  const [status, setStatus] = useState<'' | 'saving' | 'saved' | 'error' | 'invalid'>('');
  const [uploading, setUploading] = useState(false);
  const set = (patch: Partial<Form>) => {
    setF((x) => ({ ...x, ...patch }));
    setStatus('');
  };
  useEffect(() => {
    if (status !== 'saved') return;
    const t = setTimeout(() => setStatus(''), 2500);
    return () => clearTimeout(t);
  }, [status]);

  const every = parseSeconds(f.everySeconds);
  const clip = parseSeconds(f.clipSeconds);

  const addPicture = async (file: File) => {
    setUploading(true);
    try {
      const pic = await store.uploadPicture(file, file.name);
      set({ clipPictures: [...f.clipPictures, pic.id] });
    } catch {
      setStatus('error');
    }
    setUploading(false);
  };

  const save = async () => {
    if (clip == null || (f.clipMode === 'everySeconds' && every == null)) return setStatus('invalid');
    setStatus('saving');
    try {
      await updateSingleton('music', {
        playlist: f.playlist.trim(), shuffle: f.shuffle, clipMode: f.clipMode,
        everySeconds: every ?? initial.everySeconds, clipSeconds: clip,
        clipPictures: f.clipPictures, clipTitle: f.clipTitle.trim(), clipLine: f.clipLine.trim(),
      });
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  };

  return (
    <div className="t-stack">
      <section className="t-card t-stack">
        <h2 className="sc-h2">Music</h2>
        <Field label="YouTube playlist link">
          <input className="t-input" type="url" inputMode="url" placeholder="https://www.youtube.com/playlist?list=…" value={f.playlist} onChange={(e) => set({ playlist: e.target.value })} />
        </Field>
        <Field label="Shuffle">
          <Segmented label="Shuffle" value={f.shuffle ? 'on' : 'off'} options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} onChange={(v) => set({ shuffle: v === 'on' })} />
        </Field>
      </section>

      <section className="t-card t-stack">
        <h2 className="sc-h2">Catering clip</h2>
        <Field label="When it plays">
          <Segmented
            label="When it plays"
            value={f.clipMode}
            options={[{ value: 'afterEachSong', label: 'After each song' }, { value: 'everySeconds', label: 'Every N seconds' }]}
            onChange={(v) => set({ clipMode: v })}
          />
        </Field>
        <div className="t-grid2">
          {f.clipMode === 'everySeconds' && (
            <Field label="Every (seconds)">
              <input className="t-input" inputMode="numeric" value={f.everySeconds} onChange={(e) => set({ everySeconds: e.target.value })} aria-invalid={every == null} />
            </Field>
          )}
          <Field label="Clip length (seconds)">
            <input className="t-input" inputMode="numeric" value={f.clipSeconds} onChange={(e) => set({ clipSeconds: e.target.value })} aria-invalid={clip == null} />
          </Field>
        </div>
        <Field label="Title">
          <input className="t-input" value={f.clipTitle} placeholder="We do catering" onChange={(e) => set({ clipTitle: e.target.value })} />
        </Field>
        <Field label="Line">
          <input className="t-input" value={f.clipLine} placeholder="Parties, offices and weddings." onChange={(e) => set({ clipLine: e.target.value })} />
        </Field>
        <div className="t-field">
          <span>Pictures</span>
          <div className="sc-clip-grid">
            {f.clipPictures.map((id, i) => (
              <div key={id + i} className="sc-clip" data-testid="clip-picture">
                <StoredPicture id={id} alt={`Clip picture ${i + 1}`} />
                <button className="sc-clip-x" aria-label={`Remove clip picture ${i + 1}`} onClick={() => set({ clipPictures: f.clipPictures.filter((_, j) => j !== i) })}>×</button>
              </div>
            ))}
            <PictureInput
              className="sc-clip sc-clip-add"
              label={<><span className="t-plus" aria-hidden>+</span><span>{uploading ? 'Adding…' : 'Add'}</span></>}
              onFile={addPicture}
              disabled={uploading}
              testId="clip-file"
            />
          </div>
        </div>
      </section>

      {status === 'invalid' && <p className="sc-error" role="alert">Seconds must be whole numbers from 1 to 3600.</p>}
      {status === 'error' && <p className="sc-error" role="alert">Could not save. Try again.</p>}
      <button className="t-btn primary block" onClick={save} disabled={status === 'saving' || uploading}>
        {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Save'}
      </button>
    </div>
  );
}
