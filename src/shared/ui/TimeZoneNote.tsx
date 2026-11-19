// A warning on every screen when the device isn't on Arizona time, because order times and
// reminders use the device's clock. On TVs it is a tiny note in the corner.
import { useEffect, useRef, useState } from 'react';
import { deviceZoneIsWrong } from '../clock/timezone';

const MESSAGE = "Time zone isn't Arizona. Set it to Arizona (Phoenix) in this device's settings.";

function useHash(): string {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export function TimeZoneNote() {
  const [wrong, setWrong] = useState(() => deviceZoneIsWrong());
  const tv = useHash().startsWith('#/tv/');
  useEffect(() => {
    // Other zones change with daylight saving, so look again every hour.
    const t = setInterval(() => setWrong(deviceZoneIsWrong()), 60 * 60 * 1000);
    return () => clearInterval(t);
  }, []);
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The page leaves room at the top for the warning strip (see theme.css), as tall as the strip is.
    const root = document.documentElement;
    const el = strip.current;
    root.classList.toggle('t-tz-on', !!el);
    if (!el) return;
    const fit = () => root.style.setProperty('--t-tz-h', el.offsetHeight + 'px');
    fit();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.classList.remove('t-tz-on');
    };
  }, [wrong, tv]);
  if (!wrong) return null;
  return (
    <div ref={tv ? undefined : strip} className={tv ? 't-tz-tv' : 't-tz'} role="status" data-testid="tz-note">
      {MESSAGE}
    </div>
  );
}
