// Front menu TV (#/tv/1 … #/tv/4). Shows this TV's picture for the current slot of the shared loop.
// All four TVs compute the slot from the same shared clock, slot list and loop anchor, and wake
// with a timer aimed at the exact end of the slot, so they switch together without talking to each other.
import { useEffect, useRef, useState } from 'react';
import { Idle, ScreenSurface } from '@shared/ui';
import { store, useCollection, useHeartbeat, useSingleton, type ScreenId, type Transition } from '@shared/data';
import { msUntilNextChange, targetFor, type Target } from './schedule';
import './tv-menu.css';

/** How long a leaving picture stays on screen; matches the CSS animations. */
const TRANSITION_MS = 700;

interface Layer {
  n: number;
  key: string;
  slotId: string | null;
  pictureId: string | null;
  /** How this layer came in: the slot's transition, or none for the first picture after a (re)load. */
  anim: Transition;
}

/** Loads picture URLs (and decodes them) ahead of time. `undefined` = still loading, `null` = missing or broken. */
function usePictures(ids: (string | null)[]) {
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
        .then((url) => setUrls((m) => ({ ...m, [id]: url })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const broken = (id: string) => setUrls((m) => ({ ...m, [id]: null }));
  return { urls, broken };
}

export default function MenuTv({ screenId }: { screenId: ScreenId }) {
  useHeartbeat(screenId);
  const slots = useCollection('slots');
  const screens = useCollection('screens');
  const loop = useSingleton('loop');
  const settings = useSingleton('settings');
  const name = settings?.restaurantName || 'Tabla';

  // Wake exactly when the current slot ends (or whenever the data changes) and look again.
  const [tick, setTick] = useState(0);
  const ready = slots !== null && screens !== null && loop !== undefined;
  useEffect(() => {
    if (!slots || loop === undefined) return;
    const t = setTimeout(() => setTick((n) => n + 1), msUntilNextChange(slots, loop, store.now()));
    return () => clearTimeout(t);
  }, [slots, loop, tick]);
  useEffect(() => {
    const onVis = () => document.visibilityState === 'visible' && setTick((n) => n + 1);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const target: Target | null = ready ? targetFor(slots!, screens!, loop ?? null, screenId, store.now()) : null;
  const { urls, broken } = usePictures([target?.pictureId ?? null, target?.nextPictureId ?? null]);
  const resolved = !!target && (target.pictureId === null || urls[target.pictureId] !== undefined);

  // Switch only once the new picture is ready; until then the old one stays up.
  const [shown, setShown] = useState<Layer | null>(null);
  const [leaving, setLeaving] = useState<Layer | null>(null);
  const counter = useRef(0);
  useEffect(() => {
    if (!target || !resolved || shown?.key === target.key) return;
    setLeaving(shown);
    setShown({
      n: ++counter.current,
      key: target.key,
      slotId: target.slotId,
      pictureId: target.pictureId,
      anim: shown ? target.transition : 'none',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.key, resolved]);
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setLeaving(null), TRANSITION_MS + 100);
    return () => clearTimeout(t);
  }, [leaving]);

  const urlOf = (l: Layer) => (l.pictureId ? urls[l.pictureId] ?? null : null);
  const layer = (l: Layer, out: boolean) => {
    const url = urlOf(l);
    const anim = out ? (shown?.anim ?? 'none') : l.anim;
    return (
      <div key={l.n} className={`tvm-layer tvm-${out ? 'out' : 'in'}-${anim}`} aria-hidden={out || undefined}>
        {url ? (
          <img className="tvm-pic" src={url} alt="" draggable={false} onError={() => l.pictureId && broken(l.pictureId)} />
        ) : (
          <Idle line={name} />
        )}
      </div>
    );
  };

  const shownUrl = shown ? urlOf(shown) : null;
  return (
    <ScreenSurface testId="menu-tv">
      <div
        className="tvm"
        data-testid="menu-tv-now"
        data-state={!shown ? 'loading' : shownUrl ? 'picture' : 'idle'}
        data-slot-id={shown?.slotId ?? ''}
        data-picture-id={shownUrl ? shown!.pictureId! : ''}
      >
        {leaving && shown && leaving.n !== shown.n && layer(leaving, true)}
        {shown && layer(shown, false)}
      </div>
    </ScreenSurface>
  );
}
