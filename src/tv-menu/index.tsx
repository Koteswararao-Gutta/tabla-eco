// Front menu TV (#/tv/1 … #/tv/4). Shows this TV's picture for the current slot of the shared loop.
// All four TVs compute the slot from the same shared clock, slot list and loop anchor, and wake
// with a timer aimed at the exact end of the slot, so they switch together without talking to each other.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Idle, ScreenSurface } from '@shared/ui';
import { store, useCollection, useHeartbeat, useSingleton, type ScreenId, type Slot, type Transition } from '@shared/data';
import { loopPosition, loopSlots, pictureFor } from '@shared/clock/loop';
import { msUntilNextChange, targetFor, type Target } from './schedule';
import './tv-menu.css';
import { useAdDrift } from './adSync';

/** How long a leaving picture stays on screen; matches the CSS animations. */
const TRANSITION_MS = 700;
/** Longest a switch waits for a picture that is still loading. */
const MAX_WAIT_MS = 500;

interface Layer {
  n: number;
  key: string;
  slotId: string | null;
  pictureId: string | null;
  /** How this layer came in: the slot's transition, or none for the first picture after a (re)load. */
  anim: Transition;
  /** Shared-clock time this slot started, so a video joins at the same point on every TV. */
  startedAt: number;
}

/** Loads picture URLs (and decodes them) ahead of time. `undefined` = still loading, `null` = missing or broken.
 *  A miss is never final: the id is asked again on the next slot change (`retry`), so a picture
 *  that was briefly unreachable comes back on its own. */
function usePictures(ids: (string | null)[], retry: number) {
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  const asked = useRef(new Set<string>());
  const key = ids.join('|');
  useEffect(() => {
    for (const id of ids) {
      if (!id || asked.current.has(id)) continue;
      asked.current.add(id);
      store
        .pictureUrl(id)
        .then(async (url) => {
          if (!url) return null;
          const img = new Image();
          img.src = url;
          await img.decode(); // ready to paint, so the switch never flashes black
          return url;
        })
        .catch(() => null)
        .then((url) => {
          if (!url) asked.current.delete(id); // try again next time
          setUrls((m) => ({ ...m, [id]: url }));
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, retry]);
  const broken = (id: string) => {
    asked.current.delete(id);
    setUrls((m) => ({ ...m, [id]: null }));
  };
  return { urls, broken };
}

/** Loads this TV's ad videos ahead of time into memory (a blob: URL from the store), so they start at once and
 *  play without the internet. `undefined` = loading, `null` = failed: the TV then shows the picture instead. A
 *  failure is asked again on the next slot change, like pictures. Videos this TV no longer plays are let go, so
 *  their memory is freed (a Fire TV Stick has little). Only one video is fetched at a time, so two big
 *  downloads never fight over a slow connection or the TV's memory. */
function useVideos(srcs: string[], retry: number) {
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  const asked = useRef(new Set<string>());
  const keep = useRef(new Set<string>());
  const loading = useRef(false);
  // Videos that failed since the last tick: asked again only on the next tick (slot change), never at once.
  const failed = useRef(new Set<string>());
  const lastRetry = useRef(retry);
  const [loaded, setLoaded] = useState(0);
  const key = [...new Set(srcs)].sort().join('|');
  useEffect(() => {
    if (lastRetry.current !== retry) {
      lastRetry.current = retry;
      failed.current.clear();
    }
    const want = new Set(key ? key.split('|') : []);
    keep.current = want;
    for (const src of asked.current) {
      if (want.has(src)) continue;
      asked.current.delete(src);
      store.releaseVideo(src);
      setUrls(({ [src]: _gone, ...rest }) => rest);
    }
    if (loading.current) return;
    const src = [...want].find((s) => !asked.current.has(s) && !failed.current.has(s));
    if (!src) return;
    asked.current.add(src);
    loading.current = true;
    store
      .videoUrl(src)
      .catch(() => null)
      .then((url) => {
        loading.current = false;
        setLoaded((n) => n + 1);
        // Let go while it was loading (releaseVideo already frees it): if it is wanted again, the next
        // run asks afresh.
        if (!asked.current.has(src) || !keep.current.has(src)) return;
        if (!url) {
          asked.current.delete(src);
          failed.current.add(src);
        }
        setUrls((m) => ({ ...m, [src]: url }));
      });
  }, [key, retry, loaded]);
  useEffect(
    () => () => {
      for (const src of asked.current) store.releaseVideo(src);
    },
    [],
  );
  const broken = (src: string) => {
    asked.current.delete(src);
    failed.current.add(src);
    store.releaseVideo(src);
    setUrls((m) => ({ ...m, [src]: null }));
  };
  return { videoUrls: urls, videoBroken: broken };
}

/** Plays an ad video from where the slot is now (so every TV is at the same point), with sound when the
 *  picture says so. If sound is refused it plays muted rather than not at all; if it can't play, `onFail`. */
/** A see-through 1x1 picture: Android TV's WebView otherwise draws a grey play icon on a video before its first frame. */
const NO_POSTER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function AdVideo({ url, sound, startedAt, onFail }: { url: string; sound: boolean; startedAt: number; onFail: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  // Hidden until it really plays, so nothing (no icon, no empty frame) shows before the first picture.
  const [playing, setPlaying] = useState(false);
  // Keeps it at the same point as the other TVs while it plays (small speed nudges, a jump if far off).
  useAdDrift(ref, startedAt);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const start = () => {
      const into = (store.now() - startedAt) / 1000;
      // Joining late (a reload mid-spot): jump to the same point; past the end it stays on the last frame.
      if (into > 0.3) v.currentTime = Math.min(into, Math.max(v.duration - 0.05, 0) || into);
      v.play().catch(() => {
        v.muted = true;
        v.play().catch(onFail);
      });
    };
    if (v.readyState >= 1) start();
    else v.addEventListener('loadedmetadata', start, { once: true });
    return () => {
      v.removeEventListener('loadedmetadata', start);
      // Give the video decoder back (a Fire TV has only a few): stop and empty the element once it has left
      // the page (checked a moment later, so an effect that only re-runs leaves a playing video alone).
      setTimeout(() => {
        if (v.isConnected) return;
        v.pause();
        v.removeAttribute('src');
        v.load();
      }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  return (
    <video
      ref={ref}
      className={'tvm-pic tvm-video' + (playing ? '' : ' tvm-video-wait')}
      src={url}
      poster={NO_POSTER}
      muted={!sound}
      playsInline
      preload="auto"
      onPlaying={() => setPlaying(true)}
      onError={onFail}
      data-testid="menu-tv-video"
    />
  );
}

export default function MenuTv({ screenId }: { screenId: ScreenId }) {
  useHeartbeat(screenId);
  // A half-saved slot (no pictures or seconds) is skipped, never allowed to break the TV.
  const allSlots = useCollection('slots');
  const slots = useMemo(() => allSlots && allSlots.filter((s: Partial<Slot>) => !!s.pictures && typeof s.pictures === 'object' && typeof s.seconds === 'number' && typeof s.order === 'number'), [allSlots]);
  const screens = useCollection('screens');
  // Only the spots this TV plays (a picture added to TV 3 alone is not a spot on TV 1).
  const mine = useMemo(() => slots && screens && loopSlots(slots, screenId, screens), [slots, screens, screenId]);
  const loop = useSingleton('loop');
  const pictures = useCollection('pictures');
  const videoOf = (id: string | null | undefined) => (id && pictures?.find((p) => p.id === id)?.video) || null;
  const settings = useSingleton('settings');
  const name = settings?.restaurantName || 'Tabla';

  // Wake exactly when the current slot ends (or whenever the data changes) and look again.
  const [tick, setTick] = useState(0);
  const ready = slots !== null && screens !== null && loop !== undefined;
  useEffect(() => {
    if (!mine || loop === undefined) return;
    const t = setTimeout(() => setTick((n) => n + 1), msUntilNextChange(mine, loop, store.now()));
    return () => clearTimeout(t);
  }, [mine, loop, tick]);
  useEffect(() => {
    const onVis = () => document.visibilityState === 'visible' && setTick((n) => n + 1);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const target: Target | null = ready ? targetFor(slots!, screens!, loop ?? null, screenId, store.now()) : null;
  const { urls, broken } = usePictures([target?.pictureId ?? null, target?.nextPictureId ?? null], tick);
  // The videos of the ads that are live now (not paused or ended), kept loaded while they are in the loop.
  // Looked at again on every tick, so a paused ad's video is let go and a resumed one loads again.
  const videoSrcs = useMemo(() => {
    if (!mine || !screens || !pictures) return [];
    const out: string[] = [];
    const now = store.now();
    for (const s of mine) {
      if (!(s.seconds > 0) || (s.endsAt != null && s.endsAt <= now)) continue;
      const v = videoOf(pictureFor(s, screenId, screens));
      if (v?.src) out.push(v.src);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine, screens, pictures, screenId, tick]);
  const { videoUrls, videoBroken } = useVideos(videoSrcs, tick);
  const resolved = !!target && (target.pictureId === null || urls[target.pictureId] !== undefined);

  // Switch once the new picture is ready, so the old one stays up instead of a black flash.
  // If it is slow (not preloaded, e.g. just after a restart), switch anyway after a short wait
  // so this TV stays in step with the others; the picture shows when it arrives.
  const [late, setLate] = useState<string | null>(null);
  useEffect(() => {
    if (!target || resolved) return;
    const k = target.key;
    const t = setTimeout(() => setLate(k), MAX_WAIT_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.key, resolved]);
  const canSwitch = resolved || (!!target && late === target.key);

  const [shown, setShown] = useState<Layer | null>(null);
  const [leaving, setLeaving] = useState<Layer | null>(null);
  const counter = useRef(0);
  useEffect(() => {
    if (!target || !canSwitch || shown?.key === target.key) return;
    setLeaving(shown);
    setShown({
      n: ++counter.current,
      key: target.key,
      slotId: target.slotId,
      pictureId: target.pictureId,
      anim: shown ? target.transition : 'none',
      startedAt: (mine && loopPosition(mine, store.now(), loop ?? null)?.startedAt) ?? store.now(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.key, canSwitch]);
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setLeaving(null), TRANSITION_MS + 100);
    return () => clearTimeout(t);
  }, [leaving]);

  /** A layer's URL: a string, null (show idle) or undefined (still loading: stay black). */
  const urlOf = (l: Layer) => (l.pictureId ? urls[l.pictureId] : null);
  const layer = (l: Layer, out: boolean) => {
    const url = urlOf(l);
    const anim = out ? (shown?.anim ?? 'none') : l.anim;
    const video = videoOf(l.pictureId);
    const videoUrl = video ? videoUrls[video.src] : null;
    return (
      <div key={l.n} className={`tvm-layer tvm-${out ? 'out' : 'in'}-${anim}`} aria-hidden={out || undefined}>
        {url && !(videoUrl && !out) ? (
          <img className="tvm-pic" src={url} alt="" draggable={false} onError={() => l.pictureId && broken(l.pictureId)} />
        ) : url === null && !videoUrl ? (
          <Idle line={name} />
        ) : null}
        {video && videoUrl && !out && <AdVideo key={videoUrl} url={videoUrl} sound={video.sound} startedAt={l.startedAt} onFail={() => videoBroken(video.src)} />}
      </div>
    );
  };

  const shownUrl = shown ? urlOf(shown) : undefined;
  const shownVideo = shown ? videoOf(shown.pictureId) : null;
  const playing = !!shownVideo && !!videoUrls[shownVideo.src];
  return (
    <ScreenSurface testId="menu-tv">
      <div
        className="tvm"
        data-testid="menu-tv-now"
        data-state={playing || shownUrl ? 'picture' : shownUrl === undefined ? 'loading' : 'idle'}
        data-slot-id={shown?.slotId ?? ''}
        data-picture-id={shownUrl ? shown!.pictureId! : ''}
        data-video={playing ? 'playing' : ''}
      >
        {leaving && shown && leaving.n !== shown.n && layer(leaving, true)}
        {shown && layer(shown, false)}
      </div>
    </ScreenSurface>
  );
}
