// Ads on the menu TVs (slot kind 'catering', shown as "Ad"): adding one from two videos, and the ad sheet.
// An ad is a pair: the left video plays on TV 1 (and TV 3), the right one on TV 2 (and TV 4). Ads are never
// deleted from the app: they are paused, stopped after a date, or get new videos (the old ones are kept).
import { useEffect, useMemo, useState } from 'react';
import { newId, restartLoop, store, useCollection, useNow, type AdEvery, type Picture, type PictureVideo, type Slot, type WithId } from '@shared/data';
import { streamSlots } from '@shared/clock/loop';
import { Field, Segmented, Sheet } from '@shared/ui';
import { pairProblems, readVideo, videoFormat, videoProblems, videoSummary, videoWarnings, type VideoInfo } from './adVideo';
import { adSeconds, adVideos, everyLabel, fromLocalInput, insertOrder, moveSlotTo, parseEvery, roundsHint, toLocalInput, tvsOnOldCode } from './logic';
import { StoredPicture, Switch, VideoInput } from './parts';

type S = WithId<Slot>;

/** A video picked on the phone and what the phone found out about it. */
export interface PickedVideo {
  file: File;
  reading: boolean;
  info: VideoInfo | null;
  still: Blob | null;
  problems: string[];
  warnings: string[];
}

/** Checks a picked video (format from its bytes, then length, size and a still from a hidden video). */
async function checkVideo(file: File): Promise<PickedVideo> {
  const base = { file, reading: false, still: null as Blob | null };
  let format: VideoInfo['format'];
  try {
    format = videoFormat(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return { ...base, info: null, problems: ["This file can't be read. Try picking it again."], warnings: [] };
  }
  if (format !== 'ok') {
    const info: VideoInfo = { size: file.size, width: 0, height: 0, duration: 0, format };
    return { ...base, info, problems: videoProblems(info), warnings: [] };
  }
  try {
    const r = await readVideo(file);
    const info: VideoInfo = { size: file.size, width: r.width, height: r.height, duration: r.duration, format };
    return { ...base, info, still: r.still, problems: videoProblems(info), warnings: videoWarnings(info) };
  } catch {
    return { ...base, info: null, problems: ["This video can't be opened on this phone. Download it from Higgsfield again as MP4 and pick it from Files."], warnings: [] };
  }
}

function usePickedVideo(): [PickedVideo | null, (f: File) => void] {
  const [picked, setPicked] = useState<PickedVideo | null>(null);
  const pick = (file: File) => {
    setPicked({ file, reading: true, info: null, still: null, problems: [], warnings: [] });
    checkVideo(file).then((p) => setPicked((cur) => (cur?.file === file ? p : cur)));
  };
  return [picked, pick];
}

const ready = (p: PickedVideo | null): p is PickedVideo & { info: VideoInfo; still: Blob } => !!p && !p.reading && !!p.info && !!p.still && !p.problems.length;

/** A picked file's still picture, shown whole on black like the TV. */
function BlobPicture({ blob, alt }: { blob: Blob; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url ? <img src={url} alt={alt} draggable={false} /> : null;
}

/** One side of an ad: the picker, then the video's last frame, its length and size, and any problem. */
function VideoPick({ side, picked, onFile, testId }: { side: 'left' | 'right'; picked: PickedVideo | null; onFile: (f: File) => void; testId: string }) {
  const tv = side === 'left' ? 'TV 1 (left)' : 'TV 2 (right)';
  return (
    <div className="sc-ad-side" data-testid={`ad-side-${side}`}>
      {picked?.still && (
        <div className="sc-pic sc-pic-static">
          <BlobPicture blob={picked.still} alt={`Video for ${tv}`} />
        </div>
      )}
      <VideoInput label={picked ? `Choose a different video for ${tv}` : `Video for ${tv}`} className={'t-btn block' + (picked ? '' : ' accent')} onFile={onFile} testId={testId} />
      {picked?.reading && <p className="sc-hint">Checking the video…</p>}
      {picked?.info && !picked.reading && !picked.problems.length && <p className="sc-hint" data-testid={`ad-summary-${side}`}>{videoSummary(picked.info)}</p>}
      {picked?.problems.map((p) => (
        <p key={p} className="sc-error" role="alert" data-testid="ad-video-problem">{p}</p>
      ))}
      {picked?.warnings.map((w) => (
        <p key={w} className="sc-warn">{w}</p>
      ))}
    </div>
  );
}

const EVERY_BY: { value: AdEvery['by']; label: string }[] = [
  { value: 'rounds', label: 'After rounds' },
  { value: 'minutes', label: 'By minutes' },
];

/** "How often" in a sheet: the state, whether it may be saved yet, and what to save. */
function useEvery(initial: AdEvery | null | undefined) {
  const [by, setBy] = useState<AdEvery['by']>(initial?.by ?? 'rounds');
  const [n, setN] = useState(String(initial?.n ?? 1));
  const beats = useCollection('heartbeats');
  const now = useNow(30_000);
  const waiting = beats ? tvsOnOldCode(beats, now) : [];
  const every = parseEvery(by, n);
  return { by, setBy, n, setN, every, waiting, open: !!beats && !waiting.length };
}
type EveryState = ReturnType<typeof useEvery>;

/** Seconds of one round of the menu on these TVs (ads that play by rounds or minutes left out). */
function useRoundSeconds(sorted: readonly S[]): number {
  const now = useNow(30_000);
  return useMemo(() => streamSlots(sorted, now).reduce((a, s) => a + s.seconds, 0), [sorted, now]);
}

function EveryField({ state, roundSeconds, current }: { state: EveryState; roundSeconds: number; current?: AdEvery | null }) {
  if (!state.open) {
    return (
      <div className="t-field" data-testid="ad-every-waiting">
        <span>How often</span>
        <p className="sc-note">
          {current ? `Now ${everyLabel(current)}. ` : 'It plays once every round for now. '}
          You can choose how often after the TVs update (tonight at 4 AM).
          {state.waiting.length ? ` Still on the old version: ${state.waiting.join(', ')}.` : ''}
        </p>
      </div>
    );
  }
  const max = state.by === 'rounds' ? 20 : 120;
  return (
    <>
      <div className="t-field" role="group" aria-label="How often">
        <span>How often</span>
        <Segmented label="How often" value={state.by} options={EVERY_BY} onChange={state.setBy} />
      </div>
      <Field label={state.by === 'rounds' ? 'After every … rounds of the menu' : 'Every … minutes'}>
        <input className="t-input sc-seconds" inputMode="numeric" value={state.n} onChange={(e) => state.setN(e.target.value)} aria-invalid={!state.every} data-testid="ad-every-n" />
      </Field>
      <p className="sc-hint" data-testid="ad-every-hint">
        {!state.every
          ? `A whole number from 1 to ${max}.`
          : state.by === 'rounds'
            ? roundsHint(state.every.n, roundSeconds)
            : `All 4 TVs show it at the first picture change after every ${state.every.n === 1 ? 'minute' : state.every.n + ' minutes'}.`}
      </p>
    </>
  );
}

/** Uploads both videos and their stills (the pictures the TVs show while a video loads). Nothing reaches the TVs
 *  until the slot is saved after this, so a failure leaves the TVs as they were. */
async function uploadPair(left: PickedVideo & { info: VideoInfo; still: Blob }, right: PickedVideo & { info: VideoInfo; still: Blob }, sound: boolean, onProgress: (p: number) => void): Promise<{ l: WithId<Picture>; r: WithId<Picture>; seconds: number }> {
  const total = left.file.size + right.file.size || 1;
  const srcL = await store.uploadVideo(left.file, (p) => onProgress((p * left.file.size) / total));
  const srcR = await store.uploadVideo(right.file, (p) => onProgress((left.file.size + p * right.file.size) / total));
  const video = (src: string, secs: number): PictureVideo => ({ src, sound, seconds: Math.round(secs * 100) / 100 });
  const l = await store.uploadPicture(left.still, 'Ad left · ' + left.file.name, video(srcL, left.info.duration));
  const r = await store.uploadPicture(right.still, 'Ad right · ' + right.file.name, video(srcR, right.info.duration));
  return { l, r, seconds: adSeconds(left.info.duration, right.info.duration) };
}

/** Keeps the phone's screen on during an upload, where the phone allows it. */
async function keepAwake(): Promise<() => void> {
  try {
    const lock = await (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen');
    return () => void lock?.release().catch(() => {});
  } catch {
    return () => {};
  }
}

function useUpload() {
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [error, setError] = useState('');
  const run = async (fn: (progress: (p: number) => void) => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setPct(0);
    const release = await keepAwake();
    try {
      await fn((p) => setPct(Math.min(100, Math.round(p * 100))));
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Could not save. Try again.');
    } finally {
      release();
      setBusy(false);
    }
  };
  return { busy, pct, error, setError, run };
}

function UploadLine({ busy, pct }: { busy: boolean; pct: number }) {
  if (!busy) return null;
  return (
    <div className="sc-progress" data-testid="ad-progress">
      <div className="sc-progress-bar" style={{ width: `${pct}%` }} />
      <p className="sc-hint">Uploading… {pct}%. Keep this screen open until it says Done.</p>
    </div>
  );
}

/** The ad part of the Add sheet (Type = Ad). Returns the fields; the sheet's own buttons call `save`. */
export function AdAddFields({ sorted, after, onDone, onCancel }: { sorted: readonly S[]; after: number; onDone: () => void; onCancel: () => void }) {
  const [left, pickLeft] = usePickedVideo();
  const [right, pickRight] = usePickedVideo();
  const [sound, setSound] = useState(false);
  const [ends, setEnds] = useState('');
  const every = useEvery({ by: 'rounds', n: 1 });
  const roundSeconds = useRoundSeconds(sorted);
  const up = useUpload();
  const pair = ready(left) && ready(right) ? pairProblems(left.info, right.info) : [];
  const canSave = ready(left) && ready(right) && !pair.length && (!every.open || !!every.every) && !up.busy;

  const save = () => {
    if (!ready(left) || !ready(right)) return up.setError('Choose both videos first.');
    if (pair.length) return;
    if (every.open && !every.every) return up.setError('How often must be a whole number.');
    const endsAt = ends ? fromLocalInput(ends) : null;
    if (ends && endsAt == null) return up.setError('That end date is not a valid date.');
    if (endsAt != null && endsAt <= store.now()) return up.setError('That end date has already passed, so the ad would never show.');
    up.run(async (progress) => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('No internet. Please add the ad when online.');
      const { l, r, seconds } = await uploadPair(left, right, sound, progress);
      const id = newId();
      await store.setDoc('slots', id, {
        id,
        order: insertOrder(sorted, after),
        seconds,
        transition: 'fade',
        kind: 'catering',
        pictures: { tv1: l.id, tv2: r.id },
        endsAt,
        every: every.open ? every.every : null,
      });
      await restartLoop(id);
      onDone();
    });
  };

  return (
    <>
      <p className="sc-hint">Pick the MP4 files from Files, not Photos. TV 3 and TV 4 show the same as TV 1 and TV 2.</p>
      <VideoPick side="left" picked={left} onFile={pickLeft} testId="ad-file-left" />
      <VideoPick side="right" picked={right} onFile={pickRight} testId="ad-file-right" />
      {pair.map((p) => (
        <p key={p} className="sc-error" role="alert">{p}</p>
      ))}
      <Switch label="Play with sound" sub="Music plays on all 4 TVs at the same time" on={sound} onChange={setSound} />
      <EveryField state={every} roundSeconds={roundSeconds} />
      <Field label="Stop the ad after (optional)">
        <input className="t-input sc-when" type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} />
      </Field>
      <UploadLine busy={up.busy} pct={up.pct} />
      {up.error && <p className="sc-error" role="alert">{up.error}</p>}
      <div className="sc-end">
        <button className="t-btn block primary" onClick={save} disabled={!canSave} data-testid="ad-save">{up.busy ? 'Uploading…' : 'Add ad'}</button>
        <button className="t-btn block ghost" onClick={onCancel} disabled={up.busy}>Cancel</button>
      </div>
    </>
  );
}

/** Saves a change to a slot only if it still exists (another phone may have removed it meanwhile). */
async function updateSlot(id: string, patch: Partial<Slot>) {
  if (!(await store.getDoc('slots', id))) return;
  await store.updateDoc('slots', id, patch);
}

/** A muted preview of one side, loaded only when asked (an ad video can be 10 MB on a phone's data plan). */
function Preview({ picture, alt }: { picture: WithId<Picture> | undefined; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  const [failed, setFailed] = useState(false);
  const src = picture?.video?.src;
  useEffect(() => {
    if (!asked || !src) return;
    let alive = true;
    store.videoUrl(src).then((u) => {
      if (!alive) return;
      if (u) setUrl(u);
      else setFailed(true);
    });
    return () => {
      alive = false;
      store.releaseVideo(src);
      setUrl(null);
    };
  }, [asked, src]);
  return (
    <>
      <div className="sc-pic sc-pic-static" data-testid="ad-preview">
        {url ? <video src={url} muted autoPlay loop playsInline controls={false} /> : <StoredPicture id={picture?.id} alt={alt} />}
      </div>
      {!asked && src && (
        <button className="t-btn block" onClick={() => setAsked(true)} data-testid="ad-play-preview">
          ▶ Play preview
        </button>
      )}
      {asked && !url && !failed && <p className="sc-hint">Loading the video…</p>}
      {failed && <p className="sc-error">The video could not be loaded on this phone right now.</p>}
    </>
  );
}

/** The sheet for an ad with videos: no picture actions that could lose the ad. */
export function AdSheet({ slot, sorted, side, onClose }: { slot: S; sorted: readonly S[]; side: 'tv1' | 'tv2'; onClose: () => void }) {
  const pictures = useCollection('pictures');
  const vids = pictures ? adVideos(slot, pictures) : [];
  const pic = (tv: 'tv1' | 'tv2') => pictures?.find((p) => p.id === slot.pictures[tv]);
  const now = useNow(5_000);
  const paused = slot.endsAt != null && slot.endsAt <= now;
  const allSound = vids.length > 0 && vids.every((p) => p.video?.sound);
  const someSound = vids.some((p) => p.video?.sound);
  const every = useEvery(slot.every ?? null);
  const roundSeconds = useRoundSeconds(sorted);
  const [ends, setEnds] = useState(slot.endsAt != null && slot.endsAt > now ? toLocalInput(slot.endsAt) : '');
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const index = sorted.findIndex((s) => s.id === slot.id);

  const act = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch {
      setError('Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  // Sound: the same on both videos, so on means music on all 4 TVs; it needs no restart.
  const setSound = (on: boolean) =>
    act(async () => {
      await Promise.all(vids.map((p) => store.updateDoc('pictures', p.id, { video: { ...p.video!, sound: on } })));
    });
  const setPlaying = (on: boolean) =>
    act(async () => {
      if (on) {
        await updateSlot(slot.id, { endsAt: null });
        setEnds('');
        await restartLoop(slot.id);
      } else {
        await updateSlot(slot.id, { endsAt: store.now() });
        await restartLoop(null);
      }
    });

  const endsMs = ends ? fromLocalInput(ends) : null;
  const shownEnds = slot.endsAt != null && slot.endsAt > now ? slot.endsAt : null;
  const everyChanged = every.open && !!every.every && (every.every.by !== slot.every?.by || every.every.n !== slot.every?.n);
  const endsChanged = !paused && (endsMs ?? null) !== shownEnds;
  const dirty = everyChanged || endsChanged;
  const save = () => {
    if (ends && endsMs == null) return setError('That end date is not a valid date.');
    if (endsMs != null && endsMs <= store.now()) return setError('That end date has already passed. To stop the ad now, turn off "Ad is playing".');
    if (every.open && !every.every) return setError('How often must be a whole number.');
    act(async () => {
      const patch: Partial<Slot> = {};
      if (everyChanged) patch.every = every.every;
      if (endsChanged) patch.endsAt = endsMs;
      await updateSlot(slot.id, patch);
      await restartLoop(slot.id);
      onClose();
    });
  };
  const move = (to: number) =>
    act(async () => {
      const changed = moveSlotTo(sorted, index, to);
      if (!changed.length) return;
      await Promise.all(changed.map((s) => updateSlot(s.id, { order: s.order })));
      await restartLoop(slot.id);
    });

  if (replacing) return <ReplaceVideosSheet slot={slot} sound={allSound} onClose={onClose} onBack={() => setReplacing(false)} />;

  return (
    <Sheet open title="Ad" onClose={onClose}>
      <Preview picture={pic(side)} alt={side === 'tv1' ? 'Ad, left side' : 'Ad, right side'} />
      <div className="sc-under" data-testid="ad-badges">
        <span className="t-badge accent">Ad</span>
        <span className="t-badge">{allSound ? 'Sound on' : someSound ? 'Sound on TV 1 and TV 3' : 'No sound'}</span>
        <span className="t-badge">{slot.seconds} s</span>
        <span className="t-badge">{paused ? 'Paused' : everyLabel(slot.every)}</span>
      </div>
      <div className="t-grid2 sc-pair" data-testid="ad-pair">
        <figure>
          <div className="sc-pic sc-pic-static"><StoredPicture id={slot.pictures.tv1} alt="TV 1, left" /></div>
          <figcaption>TV 1 · left</figcaption>
        </figure>
        <figure>
          <div className="sc-pic sc-pic-static"><StoredPicture id={slot.pictures.tv2} alt="TV 2, right" /></div>
          <figcaption>TV 2 · right</figcaption>
        </figure>
      </div>
      <p className="sc-hint">TV 3 and TV 4 show the same as TV 1 and TV 2.</p>
      <Switch label="Play with sound" sub={!allSound && someSound ? 'Now: sound on TV 1 and TV 3 only. Turn on for music on all 4 TVs.' : 'Music plays on all 4 TVs at the same time'} on={allSound} onChange={setSound} />
      <Switch label="Ad is playing" sub={paused ? 'Paused on all TVs. Turn on to play it again.' : 'Turn off to pause the ad on all TVs'} on={!paused} onChange={setPlaying} />
      {!paused && (
        <>
          <EveryField state={every} roundSeconds={roundSeconds} current={slot.every ?? null} />
          <Field label="Stop the ad after (optional)">
            <input className="t-input sc-when" type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} data-testid="ends-input" />
          </Field>
          {ends && (
            <button className="t-btn ghost sc-clear" onClick={() => setEnds('')}>Clear end date</button>
          )}
        </>
      )}
      <hr className="sc-rule" />
      <div className="sc-menu">
        <button className="t-btn block" onClick={() => setReplacing(true)} data-testid="ad-replace">Replace videos</button>
        {slot.every == null && sorted.length > 1 && (
          <>
            <div className="t-grid2">
              <button className="t-btn" onClick={() => move(index - 1)} disabled={busy || index <= 0}>Move up</button>
              <button className="t-btn" onClick={() => move(index + 1)} disabled={busy || index >= sorted.length - 1}>Move down</button>
            </div>
            <p className="sc-hint">Moves the ad on all TVs.</p>
          </>
        )}
      </div>
      <p className="sc-hint">The ad plays {slot.seconds} s, the length of its video. To stop it, turn off "Ad is playing".</p>
      {error && <p className="sc-error" role="alert">{error}</p>}
      {dirty ? (
        <div className="sc-end">
          <button className="t-btn block primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
          <button className="t-btn block ghost" onClick={onClose}>Cancel</button>
        </div>
      ) : (
        <button className="t-btn block" onClick={onClose}>Done</button>
      )}
    </Sheet>
  );
}

/** New videos for an ad. The old pictures and videos are kept (never deleted). */
function ReplaceVideosSheet({ slot, sound, onClose, onBack }: { slot: S; sound: boolean; onClose: () => void; onBack: () => void }) {
  const [left, pickLeft] = usePickedVideo();
  const [right, pickRight] = usePickedVideo();
  const up = useUpload();
  const pair = ready(left) && ready(right) ? pairProblems(left.info, right.info) : [];
  const canSave = ready(left) && ready(right) && !pair.length && !up.busy;
  const save = () => {
    if (!ready(left) || !ready(right) || pair.length) return;
    up.run(async (progress) => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('No internet. Please change the ad when online.');
      const { l, r, seconds } = await uploadPair(left, right, sound, progress);
      const cur = await store.getDoc('slots', slot.id);
      if (!cur) throw new Error('This ad was changed on another phone. Close and open it again.');
      await store.setDoc('slots', slot.id, { ...cur, pictures: { ...cur.pictures, tv1: l.id, tv2: r.id }, seconds });
      await restartLoop(slot.id);
      onClose();
    });
  };
  return (
    <Sheet open title="Replace videos" onClose={onClose}>
      <p className="sc-hint">Pick the new MP4 files from Files. The ad keeps its sound, how often and end date.</p>
      <VideoPick side="left" picked={left} onFile={pickLeft} testId="ad-file-left" />
      <VideoPick side="right" picked={right} onFile={pickRight} testId="ad-file-right" />
      {pair.map((p) => (
        <p key={p} className="sc-error" role="alert">{p}</p>
      ))}
      <UploadLine busy={up.busy} pct={up.pct} />
      {up.error && <p className="sc-error" role="alert">{up.error}</p>}
      <div className="sc-end">
        <button className="t-btn block primary" onClick={save} disabled={!canSave}>{up.busy ? 'Uploading…' : 'Save new videos'}</button>
        <button className="t-btn block ghost" onClick={onBack} disabled={up.busy}>Back</button>
      </div>
    </Sheet>
  );
}
