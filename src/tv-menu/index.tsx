// Front menu TV (#/tv/1 … #/tv/4). Shows this TV's picture for the current slot of the shared loop.
// All four TVs compute the slot from the same shared clock, slot list and loop anchor, and wake
// with a timer aimed at the exact end of the slot, so they switch together without talking to each other.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Idle, ScreenSurface } from '@shared/ui';
import { store, useCollection, useHeartbeat, useSingleton, type ScreenId, type Slot, type Transition } from '@shared/data';
import { loopSlots } from '@shared/clock/loop';
import { msUntilNextChange, targetFor, type Target } from './schedule';
import './tv-menu.css';

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

export default function MenuTv({ screenId }: { screenId: ScreenId }) {
  useHeartbeat(screenId);
  // A half-saved slot (no pictures or seconds) is skipped, never allowed to break the TV.
  const allSlots = useCollection('slots');
  const slots = useMemo(() => allSlots && allSlots.filter((s: Partial<Slot>) => !!s.pictures && typeof s.pictures === 'object' && typeof s.seconds === 'number' && typeof s.order === 'number'), [allSlots]);
  const screens = useCollection('screens');
  // Only the spots this TV plays (a picture added to TV 3 alone is not a spot on TV 1).
  const mine = useMemo(() => slots && screens && loopSlots(slots, screenId, screens), [slots, screens, screenId]);
  const loop = useSingleton('loop');
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
    return (
      <div key={l.n} className={`tvm-layer tvm-${out ? 'out' : 'in'}-${anim}`} aria-hidden={out || undefined}>
        {url ? (
          <img className="tvm-pic" src={url} alt="" draggable={false} onError={() => l.pictureId && broken(l.pictureId)} />
        ) : url === null ? (
          <Idle line={name} />
        ) : null}
      </div>
    );
  };

  const shownUrl = shown ? urlOf(shown) : undefined;
  return (
    <ScreenSurface testId="menu-tv">
      <div
        className="tvm"
        data-testid="menu-tv-now"
        data-state={shownUrl === undefined ? 'loading' : shownUrl ? 'picture' : 'idle'}
        data-slot-id={shown?.slotId ?? ''}
        data-picture-id={shownUrl ? shown!.pictureId! : ''}
      >
        {leaving && shown && leaving.n !== shown.n && layer(leaving, true)}
        {shown && layer(shown, false)}
      </div>
    </ScreenSurface>
  );
}
