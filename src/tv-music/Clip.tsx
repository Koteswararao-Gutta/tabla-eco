// The catering clip. Stays mounted for as long as it is on screen (a whole break between songs,
// or the endless fallback loop), and cycles its pictures with a cross-fade: the next picture fades
// in on top of the one before, so the screen never passes through black.
// Each picture is shown whole (contain) over a blurred, darkened copy of itself (each layer is
// opaque, so a picture of another shape never shows through). The title and line sit on their own
// dark band underneath, so they never cover the picture, however long they are.
import { useEffect, useState, type CSSProperties } from 'react';
import { store } from '@shared/data';
import { clipEachMs, type MusicPlan } from './schedule';

/** Picture URLs for these ids (null = missing or broken). */
function usePictureUrls(ids: string[]): Record<string, string | null> {
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  const key = ids.join('|');
  useEffect(() => {
    let alive = true;
    for (const id of new Set(ids)) {
      store
        .pictureUrl(id)
        .catch(() => null)
        .then((u) => alive && setUrls((m) => (m[id] === u ? m : { ...m, [id]: u })));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return urls;
}

/** The picture on top fades in; the one before stays fully up under it until it is covered. */
function layerClass(i: number, active: number, prev: number, step: number): string {
  if (i === active) return step === 0 ? ' on first' : ' on';
  if (i === prev && step > 0) return ' under';
  return '';
}

export function Clip({ plan, brand }: { plan: Pick<MusicPlan, 'pictures' | 'title' | 'line' | 'clipMs'>; brand: string }) {
  const urls = usePictureUrls(plan.pictures);
  // Only pictures that loaded take part, so the cycle never lands on an empty frame.
  const ready = plan.pictures
    .map((id, i) => ({ key: id + ':' + i, url: urls[id] }))
    .filter((p): p is { key: string; url: string } => !!p.url);
  const n = ready.length;
  const eachMs = clipEachMs(n, plan.clipMs);

  const [step, setStep] = useState(0);
  useEffect(() => {
    if (n < 2) return;
    const t = setInterval(() => setStep((s) => s + 1), eachMs);
    return () => clearInterval(t);
  }, [n, eachMs]);
  const active = n ? step % n : -1;
  const prev = n > 1 ? (step - 1) % n : -1;

  const title = plan.title || brand;
  return (
    <div className={'tm-clip' + (n ? '' : ' tm-nopics')} data-testid="clip" style={{ '--each-ms': `${eachMs}ms` } as CSSProperties}>
      <div className="tm-stage">
        {ready.map((p, i) => (
          <div key={p.key} className={'tm-layer' + layerClass(i, active, prev, step)} data-testid="clip-picture">
            <div className="tm-blur" style={{ backgroundImage: `url("${p.url}")` }} />
            <img src={p.url} alt="" draggable={false} />
          </div>
        ))}
      </div>
      <div className="tm-band">
        <div className="tm-text">
          <h1 data-testid="clip-title">{title}</h1>
          {plan.line && <p data-testid="clip-line">{plan.line}</p>}
        </div>
        <div className="tm-brand" data-testid="clip-brand">
          <i />
          {brand}
        </div>
      </div>
    </div>
  );
}
