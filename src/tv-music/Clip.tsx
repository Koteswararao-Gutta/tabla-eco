// The catering clip: slow zoom/pan over the clip pictures, title and line fading in. CSS only.
import type { CSSProperties } from 'react';
import { usePictureUrl } from '@shared/data';
import type { MusicPlan } from './schedule';

function ClipPicture({ id, index, eachMs }: { id: string; index: number; eachMs: number }) {
  const url = usePictureUrl(id);
  if (!url) return null;
  const style = {
    backgroundImage: `url("${url}")`,
    animationDuration: `${eachMs}ms`,
    animationDelay: `${index * eachMs}ms`,
  } as CSSProperties;
  return <div className={'tm-pic' + (index % 2 ? ' alt' : '')} style={style} data-testid="clip-picture" />;
}

export function Clip({ plan, brand }: { plan: Pick<MusicPlan, 'pictures' | 'title' | 'line' | 'clipMs'>; brand: string }) {
  const n = plan.pictures.length;
  const eachMs = n ? Math.round(plan.clipMs / n) : plan.clipMs;
  const title = plan.title || brand;
  return (
    <div className="tm-clip" data-testid="clip" style={{ '--clip-ms': `${plan.clipMs}ms` } as CSSProperties}>
      <div className="tm-pics">
        {plan.pictures.map((id, i) => (
          <ClipPicture key={id + i} id={id} index={i} eachMs={eachMs} />
        ))}
      </div>
      <div className="tm-shade" />
      <div className="tm-brand" data-testid="clip-brand">
        <i />
        {brand}
      </div>
      <div className="tm-text">
        <h1 data-testid="clip-title">{title}</h1>
        {plan.line && <p data-testid="clip-line">{plan.line}</p>}
      </div>
    </div>
  );
}
