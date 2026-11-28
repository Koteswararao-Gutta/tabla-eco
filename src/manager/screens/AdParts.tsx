// Ads on the menu TVs (slot kind 'catering', shown as "Ad"): adding one from two videos, and the ad sheet.
// An ad is a pair: the left video plays on TV 1 (and TV 3), the right one on TV 2 (and TV 4). Ad pictures and
// videos are never deleted from the app: an ad is paused, stopped after a date, removed from the TVs (its spot
// only), or gets new videos (the old ones are kept).
// Known limit: with TV 3 / TV 4 not mirroring and showing pictures of their own, their round is longer than TV 1 /
// TV 2's, so an ad by rounds or minutes falls at other moments there.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { newId, restartLoop, store, useCollection, useNow, useSingleton, type AdEvery, type Picture, type PictureVideo, type Slot, type WithId } from '@shared/data';
import { loopPosition, streamSlots } from '@shared/clock/loop';
import { Field, Segmented, Sheet } from '@shared/ui';
import { pairProblems, readVideo, videoFormat, videoProblems, videoSummary, videoWarnings, type VideoInfo } from './adVideo';
import { EVERY_MIN, adSeconds, adShare, adVideos, everyLabel, everyProblem, fromLocalInput, insertOrder, isPaused, moveSlotTo, parseEvery, roundsHint, toLocalInput, tvsOnOldCode } from './logic';
import { StoredPicture, Switch, VideoInput } from './parts';

type S = WithId<Slot>;

export const SOUND_LINE = "Music plays on all 4 TVs at the same time, whenever the TVs are on. TV 5's music keeps playing. Both videos should have the same music, or keep the right one silent.";
const UPLOAD_FAILED = "Upload didn't work. Nothing changed on the TVs. Check the internet and try again.";
const UPLOAD_SLOW = 'The upload is taking too long. It may still finish in the background: look at the list in a minute before you try again.';

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

const SIDE_LABEL = {
  left: "Video for TV 1 (left) – ends with 'Scan the code'",
  right: 'Video for TV 2 (right) – shows the QR code',
};

/** One side of an ad: the picker, then the video's last frame, its length and size, and any problem. */
function VideoPick({ side, picked, onFile, testId }: { side: 'left' | 'right'; picked: PickedVideo | null; onFile: (f: File) => void; testId: string }) {
  const tv = side === 'left' ? 'TV 1' : 'TV 2';
  return (
    <div className="sc-ad-side" data-testid={`ad-side-${side}`}>
      {picked?.still && (
        <div className="sc-pic sc-pic-static">
          <BlobPicture blob={picked.still} alt={`Video for ${tv}`} />
        </div>
      )}
      <VideoInput label={picked ? `Change ${tv} video` : SIDE_LABEL[side]} className={'t-btn block sc-wrap' + (picked ? '' : ' accent')} onFile={onFile} testId={testId} />
      {picked?.reading && <p className="sc-hint">Checking the video…</p>}
      {picked?.info && !picked.reading && !picked.problems.length && <p className="sc-hint" data-testid={`ad-summary-${side}`}>{tv}: {videoSummary(picked.info)}</p>}
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
function useEvery(initial: AdEvery | null | undefined, adSecs: number) {
  const [by, setBy] = useState<AdEvery['by']>(initial?.by ?? 'rounds');
  const [n, setN] = useState(String(initial?.n ?? 2));
  const beats = useCollection('heartbeats');
  const now = useNow(30_000);
  const waiting = beats ? tvsOnOldCode(beats, now) : [];
  const every = parseEvery(by, n);
  const problem = everyProblem(every, adSecs);
  return { by, setBy, n, setN, every, problem, valid: !!every && !problem, waiting, open: !!beats && !waiting.length };
}
type EveryState = ReturnType<typeof useEvery>;

/** Seconds of one round of the menu on these TVs (ads that play by rounds or minutes left out). */
function useRoundSeconds(sorted: readonly S[]): number {
  const now = useNow(30_000);
  return useMemo(() => streamSlots(sorted, now).reduce((a, s) => a + s.seconds, 0), [sorted, now]);
}

function EveryField({ state, roundSeconds, adSecs, current }: { state: EveryState; roundSeconds: number; adSecs: number; current?: AdEvery | null }) {
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
  const min = EVERY_MIN[state.by];
  const max = state.by === 'rounds' ? 20 : 120;
  const share = state.every && !state.problem ? ` The ad will be about ${adShare(state.every, adSecs, roundSeconds)}% of the time.` : '';
  return (
    <>
      <div className="t-field" role="group" aria-label="How often">
        <span>How often</span>
        <Segmented label="How often" value={state.by} options={EVERY_BY} onChange={state.setBy} />
      </div>
      <Field label={state.by === 'rounds' ? 'After every … rounds of the menu' : 'Every … minutes'}>
        <input className="t-input sc-seconds" inputMode="numeric" value={state.n} onChange={(e) => state.setN(e.target.value)} aria-invalid={!state.valid} data-testid="ad-every-n" />
      </Field>
      {state.problem ? (
        <p className="sc-error" role="alert" data-testid="ad-every-problem">{state.problem}</p>
      ) : (
        <p className="sc-hint" data-testid="ad-every-hint">
          {!state.every
            ? `A whole number from ${min} to ${max}.`
            : (state.by === 'rounds'
                ? roundsHint(state.every.n, roundSeconds)
                : `All 4 TVs show it at the first picture change after every ${state.every.n} minutes.`) + share}
        </p>
      )}
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
      if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('offline');
      await fn((p) => setPct(Math.min(100, Math.round(p * 100))));
    } catch (e) {
      // Only plain words for the owner; the real reason goes to the console.
      console.error('ad upload', e);
      setError(e instanceof Error && e.name === 'UploadTimeout' ? UPLOAD_SLOW : UPLOAD_FAILED);
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

/** What's still missing before "Add ad" / "Save new videos" can be tapped, in plain words. */
function missingLine(left: PickedVideo | null, right: PickedVideo | null): string | null {
  const need = [!ready(left) && 'the video for TV 1', !ready(right) && 'the video for TV 2'].filter(Boolean);
  if (!need.length || left?.reading || right?.reading) return null;
  return `Still needed: ${need.join(' and ')}.`;
}

/** The Add sheet with Type = Ad: two videos, sound, how often, stop after. */
export function AdAddSheet<K extends string>({ typeRow, onKind, sorted, after, onClose, onNotice }: {
  /** The Type row, built with the change handler to use (so this sheet can lock it or ask first). */
  typeRow: (onChange: (kind: K) => void) => ReactNode;
  onKind: (kind: K) => void;
  sorted: readonly S[];
  after: number;
  onClose: () => void;
  onNotice: (text: string) => void;
}) {
  // Another type tapped while videos are picked: asked first, like closing the sheet.
  const [leaving, setLeaving] = useState<K | null>(null);
  const [left, pickLeft] = usePickedVideo();
  const [right, pickRight] = usePickedVideo();
  const [sound, setSound] = useState(false);
  const [ends, setEnds] = useState('');
  const adSecs = ready(left) && ready(right) ? adSeconds(left.info.duration, right.info.duration) : 15;
  const every = useEvery(null, adSecs);
  const roundSeconds = useRoundSeconds(sorted);
  const up = useUpload();
  const pair = ready(left) && ready(right) ? pairProblems(left.info, right.info) : [];
  const canSave = ready(left) && ready(right) && !pair.length && (!every.open || every.valid) && !up.busy;
  const missing = missingLine(left, right);

  const save = () => {
    if (!ready(left) || !ready(right)) return up.setError('Choose both videos first.');
    if (pair.length) return;
    if (every.open && !every.valid) return;
    const endsAt = ends ? fromLocalInput(ends) : null;
    if (ends && endsAt == null) return up.setError('That end date is not a valid date.');
    if (endsAt != null && endsAt <= store.now()) return up.setError('That end date has already passed, so the ad would never show.');
    up.run(async (progress) => {
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
      // A new ad shows once right away, so the owner can check it on the TVs.
      await restartLoop(id);
      onClose();
      onNotice('Done. The ad is on the TVs now.');
    });
  };

  return (
    <Sheet
      open
      title="Add an ad"
      // While uploading the sheet stays open (closing would leave the upload running); picked videos ask first.
      onClose={up.busy ? () => {} : onClose}
      confirmClose={() => (!up.busy && (left || right) ? 'Discard the videos you picked?' : null)}
    >
      {/* Locked while uploading: switching away would leave the upload running behind another sheet. */}
      <fieldset className="sc-plain" disabled={up.busy}>
        {typeRow((k) => (up.busy ? undefined : left || right ? setLeaving(k) : onKind(k)))}
      </fieldset>
      {leaving && (
        <div className="sc-ask" role="alert" data-testid="ad-leave-ask">
          <p>Discard the videos you picked?</p>
          <div className="t-grid2">
            <button className="t-btn" onClick={() => onKind(leaving)}>Discard</button>
            <button className="t-btn primary" onClick={() => setLeaving(null)}>Keep editing</button>
          </div>
        </div>
      )}
      <p className="sc-hint">Pick the MP4 files from Files, not Photos. TV 3 and TV 4 show the same as TV 1 and TV 2.</p>
      <VideoPick side="left" picked={left} onFile={pickLeft} testId="ad-file-left" />
      <VideoPick side="right" picked={right} onFile={pickRight} testId="ad-file-right" />
      {pair.map((p) => (
        <p key={p} className="sc-error" role="alert">{p}</p>
      ))}
      <Switch label="Play with sound" sub={SOUND_LINE} on={sound} onChange={setSound} />
      <EveryField state={every} roundSeconds={roundSeconds} adSecs={adSecs} />
      <Field label="Stop the ad after (optional)">
        <input className="t-input sc-when" type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} />
      </Field>
      <UploadLine busy={up.busy} pct={up.pct} />
      {up.error && <p className="sc-error" role="alert">{up.error}</p>}
      {missing && !up.busy && <p className="sc-hint" data-testid="ad-missing">{missing}</p>}
      <div className="sc-end">
        <button className="t-btn block primary" onClick={save} disabled={!canSave} data-testid="ad-save">{up.busy ? 'Uploading…' : 'Add ad'}</button>
        <button className="t-btn block ghost" onClick={onClose} disabled={up.busy}>Cancel</button>
      </div>
    </Sheet>
  );
}

/** Saves a change to a slot only if it still exists (another phone may have removed it meanwhile). */
async function updateSlot(id: string, patch: Partial<Slot>) {
  if (!(await store.getDoc('slots', id))) return;
  await store.updateDoc('slots', id, patch);
}

/** A muted preview, loaded only when asked (an ad video can be 10 MB on a phone's data plan). */
function Preview({ picture }: { picture: WithId<Picture> | undefined }) {
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
  if (!src) return null;
  if (!asked) {
    return (
      <button className="t-btn block" onClick={() => setAsked(true)} data-testid="ad-play-preview">
        ▶ Play preview
      </button>
    );
  }
  return (
    <>
      {url && (
        <div className="sc-pic sc-pic-static" data-testid="ad-preview">
          <video src={url} muted autoPlay loop playsInline />
        </div>
      )}
      {!url && !failed && <p className="sc-hint">Loading the video…</p>}
      {failed && <p className="sc-error">The video could not be loaded on this phone right now.</p>}
    </>
  );
}

/** The sheet for an ad with videos: nothing here deletes a picture or a video. */
export function AdSheet({ slot, sorted, side, onClose, onNotice }: { slot: S; sorted: readonly S[]; side: 'tv1' | 'tv2'; onClose: () => void; onNotice: (text: string) => void }) {
  const pictures = useCollection('pictures');
  const loop = useSingleton('loop');
  const vids = pictures ? adVideos(slot, pictures) : [];
  const now = useNow(2_000);
  const paused = isPaused(slot, now, loop === undefined ? null : loopPosition(sorted, now, loop)?.endsAt);
  const allSound = vids.length > 0 && vids.every((p) => p.video?.sound);
  const someSound = vids.some((p) => p.video?.sound);
  const every = useEvery(slot.every ?? null, slot.seconds);
  const roundSeconds = useRoundSeconds(sorted);
  const [ends, setEnds] = useState(slot.endsAt != null && !paused ? toLocalInput(slot.endsAt) : '');
  const [mode, setMode] = useState<'main' | 'replace' | 'remove'>('main');
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
  const setShown = (on: boolean) =>
    act(async () => {
      if (on) {
        // Shown again: the menu starts from its first picture on every TV (the ad waits for its turn).
        await updateSlot(slot.id, { endsAt: null });
        setEnds('');
        await restartLoop(null);
      } else {
        // Paused at the next picture change (the end of what plays now), so no TV jumps mid-picture.
        const pos = loopPosition(sorted, store.now(), loop ?? null);
        await updateSlot(slot.id, { endsAt: pos ? pos.endsAt : store.now() });
      }
    });

  const endsMs = ends ? fromLocalInput(ends) : null;
  const shownEnds = slot.endsAt != null && !paused ? slot.endsAt : null;
  const everyChanged = every.open && every.valid && (every.every!.by !== slot.every?.by || every.every!.n !== slot.every?.n);
  const endsChanged = !paused && (endsMs ?? null) !== shownEnds;
  const dirty = (every.open && (everyChanged || (!every.valid && every.n !== String(slot.every?.n ?? 2)))) || endsChanged;
  const save = () => {
    if (ends && endsMs == null) return setError('That end date is not a valid date.');
    if (endsMs != null && endsMs <= store.now()) return setError('That end date has already passed. To stop the ad now, turn off "Show this ad".');
    if (every.open && !every.valid) return;
    act(async () => {
      const patch: Partial<Slot> = {};
      if (everyChanged) patch.every = every.every;
      if (endsChanged) patch.endsAt = endsMs;
      await updateSlot(slot.id, patch);
      // How often changed: the menu starts from its first picture on every TV, so all agree on the new timing.
      await restartLoop(null);
      onClose();
    });
  };
  const move = (to: number) =>
    act(async () => {
      const changed = moveSlotTo(sorted, index, to);
      if (!changed.length) return;
      await Promise.all(changed.map((s) => updateSlot(s.id, { order: s.order })));
      await restartLoop(null);
    });
  const remove = () =>
    act(async () => {
      // Only the ad's spot goes; its pictures and videos stay saved.
      await store.deleteDoc('slots', slot.id);
      await restartLoop(null);
      onClose();
      onNotice('Ad removed from the TVs.');
    });

  if (mode === 'replace') return <ReplaceVideosSheet slot={slot} sound={allSound} onClose={onClose} onBack={() => setMode('main')} onNotice={onNotice} />;
  if (mode === 'remove') {
    return (
      <Sheet open title="Remove this ad?" onClose={onClose}>
        <p className="sc-note">Removes the ad from all 4 TVs. The videos stay saved.</p>
        {error && <p className="sc-error" role="alert">{error}</p>}
        <div className="sc-end">
          <button className="t-btn block sc-danger-solid" onClick={remove} disabled={busy} data-testid="ad-remove-confirm">{busy ? 'Removing…' : 'Remove ad'}</button>
          <button className="t-btn block ghost" onClick={() => setMode('main')}>Keep it</button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open title="Ad" onClose={onClose} confirmClose={() => (dirty ? 'Discard your changes?' : null)}>
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
      <Preview picture={pictures?.find((p) => p.id === slot.pictures[side])} />
      <div className="sc-under" data-testid="ad-badges">
        <span className="t-badge accent">Ad</span>
        <span className="t-badge">{allSound ? 'Sound on' : someSound ? 'Sound on TV 1 and TV 3' : 'No sound'}</span>
        <span className="t-badge">{slot.seconds} s</span>
        <span className="t-badge">{paused ? 'Paused' : everyLabel(slot.every)}</span>
      </div>
      <Switch label="Play with sound" sub={!allSound && someSound ? 'Now: sound on TV 1 and TV 3 only. Turn on for music on all 4 TVs.' : SOUND_LINE} on={allSound} onChange={setSound} />
      <Switch label="Show this ad" sub="Off pauses it on all TVs" on={!paused} onChange={setShown} />
      {!paused && (
        <>
          <EveryField state={every} roundSeconds={roundSeconds} adSecs={slot.seconds} current={slot.every ?? null} />
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
        <button className="t-btn block" onClick={() => setMode('replace')} data-testid="ad-replace">Replace videos</button>
        {slot.every == null && sorted.length > 1 && (
          <>
            <div className="t-grid2">
              <button className="t-btn" onClick={() => move(index - 1)} disabled={busy || index <= 0}>Move up</button>
              <button className="t-btn" onClick={() => move(index + 1)} disabled={busy || index >= sorted.length - 1}>Move down</button>
            </div>
            <p className="sc-hint">Moves the ad on all TVs.</p>
          </>
        )}
        <button className="t-btn block danger" onClick={() => setMode('remove')} data-testid="ad-remove">Remove ad</button>
      </div>
      <p className="sc-hint">The ad plays {slot.seconds} s, the length of its video.</p>
      {error && <p className="sc-error" role="alert">{error}</p>}
      {dirty ? (
        <div className="sc-end">
          <button className="t-btn block primary" onClick={save} disabled={busy || (every.open && !every.valid)}>{busy ? 'Saving…' : 'Save changes'}</button>
          <button className="t-btn block ghost" onClick={onClose}>Cancel</button>
        </div>
      ) : (
        <button className="t-btn block" onClick={onClose}>Done</button>
      )}
    </Sheet>
  );
}

/** New videos for an ad. The old pictures and videos are kept (never deleted). */
function ReplaceVideosSheet({ slot, sound, onClose, onBack, onNotice }: { slot: S; sound: boolean; onClose: () => void; onBack: () => void; onNotice: (text: string) => void }) {
  const [left, pickLeft] = usePickedVideo();
  const [right, pickRight] = usePickedVideo();
  const up = useUpload();
  const pair = ready(left) && ready(right) ? pairProblems(left.info, right.info) : [];
  const canSave = ready(left) && ready(right) && !pair.length && !up.busy;
  const missing = missingLine(left, right);
  const save = () => {
    if (!ready(left) || !ready(right) || pair.length) return;
    up.run(async (progress) => {
      const { l, r, seconds } = await uploadPair(left, right, sound, progress);
      const cur = await store.getDoc('slots', slot.id);
      if (!cur) throw new Error('slot gone');
      await store.setDoc('slots', slot.id, { ...cur, pictures: { ...cur.pictures, tv1: l.id, tv2: r.id }, seconds });
      // The menu starts from its first picture on every TV; the new videos play at the ad's next turn.
      await restartLoop(null);
      onClose();
      onNotice('Done. The new videos play at the ad’s next turn.');
    });
  };
  return (
    <Sheet open title="Replace videos" onClose={up.busy ? () => {} : onClose} confirmClose={() => (!up.busy && (left || right) ? 'Discard the videos you picked?' : null)}>
      <p className="sc-hint">Pick the new MP4 files from Files. The ad keeps its sound, how often and end date.</p>
      <VideoPick side="left" picked={left} onFile={pickLeft} testId="ad-file-left" />
      <VideoPick side="right" picked={right} onFile={pickRight} testId="ad-file-right" />
      {pair.map((p) => (
        <p key={p} className="sc-error" role="alert">{p}</p>
      ))}
      <UploadLine busy={up.busy} pct={up.pct} />
      {up.error && <p className="sc-error" role="alert">{up.error}</p>}
      {missing && !up.busy && <p className="sc-hint">{missing}</p>}
      <div className="sc-end">
        <button className="t-btn block primary" onClick={save} disabled={!canSave}>{up.busy ? 'Uploading…' : 'Save new videos'}</button>
        <button className="t-btn block ghost" onClick={onBack} disabled={up.busy}>Back</button>
      </div>
    </Sheet>
  );
}
