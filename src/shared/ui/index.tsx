// Shared building blocks. Screens compose these; they don't restyle them.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import './theme.css';
import logoUrl from './brand/tabla-logo.webp';

/** The Tabla logo (transparent background). */
export const LOGO_URL: string = logoUrl;

export function Logo({ className }: { className?: string }) {
  return <img className={'t-logo' + (className ? ' ' + className : '')} src={logoUrl} alt="Tabla Indian Restaurant" draggable={false} />;
}

export { ErrorBoundary } from './ErrorBoundary';
export { TimeZoneNote } from './TimeZoneNote';

export function PageHeader({ title, sub, action, logo }: { title: string; sub?: string; action?: ReactNode; logo?: boolean }) {
  return (
    <>
      <header className="t-header">
        {logo ? (
          <div className="t-title">
            <Logo />
            <h1>{title}</h1>
          </div>
        ) : (
          <h1>{title}</h1>
        )}
        {action}
      </header>
      {sub && <p className="t-sub">{sub}</p>}
    </>
  );
}

export function Tile(props: { name: string; sub?: string; online?: boolean; selected?: boolean; onClick?: () => void; testId?: string }) {
  return (
    <button className="t-tile" aria-pressed={!!props.selected} onClick={props.onClick} data-testid={props.testId}>
      {props.online !== undefined && (
        <span className={'t-status' + (props.online ? ' on' : '')}>
          <i className="t-dot" aria-hidden="true" />
          {props.online ? 'Online' : 'Offline'}
        </span>
      )}
      <span className="t-tile-name">{props.name}</span>
      {props.sub && <span className="t-tile-sub">{props.sub}</span>}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="t-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Segmented<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="t-seg" role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === props.value} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/* Phone Back button: while any sheet is open there is one extra history entry (same URL, so the hash
   route doesn't change). Back pops it and closes the top sheet the same way a backdrop tap does; when a
   sheet closes any other way the entry is taken off again. One sheet closing as another opens shares it. */
const backStack: { onBack: () => void }[] = [];
let entryPushed = false;
let dropTimer: ReturnType<typeof setTimeout> | undefined;
const ourEntry = () => !!(window.history.state && (window.history.state as { tSheet?: boolean }).tSheet);
function pushEntry() {
  if (entryPushed) return;
  entryPushed = true;
  window.history.pushState({ ...(window.history.state ?? {}), tSheet: true }, '');
}
function onPop() {
  if (!entryPushed || ourEntry()) return; // not our entry that was popped
  entryPushed = false;
  backStack[backStack.length - 1]?.onBack();
}
function addBackHandler(h: { onBack: () => void }) {
  if (backStack.length === 0) window.addEventListener('popstate', onPop);
  backStack.push(h);
  clearTimeout(dropTimer);
  pushEntry();
}
function removeBackHandler(h: { onBack: () => void }) {
  const i = backStack.indexOf(h);
  if (i >= 0) backStack.splice(i, 1);
  clearTimeout(dropTimer);
  // Wait a moment: another sheet opening right now keeps the same entry.
  dropTimer = setTimeout(() => {
    if (backStack.length > 0) return pushEntry();
    window.removeEventListener('popstate', onPop);
    if (!entryPushed) return;
    entryPushed = false;
    // Only step back if our entry is still on top (a link inside the sheet may have moved on).
    if (ourEntry()) window.history.back();
  }, 0);
}

const SheetClose = createContext<() => void>(() => {});
/** Inside a Sheet: closes it the same way a backdrop tap does (asking first when `confirmClose` is set).
 *  Use it for the sheet's own Cancel button. */
export const useSheetClose = () => useContext(SheetClose);

/** Bottom sheet on phones, centred dialog on wider screens. Closes on backdrop tap, Escape,
 *  the phone's Back button, or (phones) dragging it down from the handle or from the top of its content.
 *  `confirmClose` (e.g. "Discard your changes?", or a function returning it or null, read at the moment
 *  of closing so a change typed just before always counts): while set, those ways of closing ask first,
 *  with "Discard" and "Keep editing". The content stays mounted behind the question. */
export function Sheet({ open, title, onClose, confirmClose, children }: { open: boolean; title: string; onClose: () => void; confirmClose?: string | null | (() => string | null); children: ReactNode }) {
  const sheet = useRef<HTMLDivElement>(null);
  const [asking, setAsking] = useState<string | null>(null); // the question being asked
  const close = useRef(onClose);
  close.current = onClose;
  const askFirst = useRef(confirmClose);
  askFirst.current = confirmClose;
  const askingRef = useRef(asking);
  askingRef.current = asking;
  const question = () => (typeof askFirst.current === 'function' ? askFirst.current() : askFirst.current) || null;
  // Where focus was before the question, so "Keep editing" puts it back.
  const before = useRef<HTMLElement | null>(null);
  const ask = (q: string) => {
    before.current = document.activeElement as HTMLElement | null;
    setAsking(q);
  };
  const keepEditing = () => {
    setAsking(null);
    const el = before.current;
    requestAnimationFrame(() => (el && el.isConnected && sheet.current?.contains(el) ? el : sheet.current)?.focus({ preventScroll: true }));
  };
  const request = useRef(() => {
    const q = question();
    if (q) ask(q);
    else close.current();
  });
  const keep = useRef(keepEditing);
  keep.current = keepEditing;
  useEffect(() => {
    if (!open) setAsking(null);
  }, [open]);
  // Phone Back: closes the sheet through the same question as a backdrop tap. If the question shows,
  // the entry goes back so a second Back press asks again rather than leaving the page.
  useEffect(() => {
    if (!open) return;
    const h = {
      onBack: () => {
        if (askingRef.current) return pushEntry(), keep.current();
        const q = question();
        if (q) {
          pushEntry();
          ask(q);
        } else close.current();
      },
    };
    addBackHandler(h);
    return () => removeBackHandler(h);
  }, [open]);
  useEffect(() => {
    if (asking) sheet.current?.focus({ preventScroll: true });
  }, [asking]);

  useEffect(() => {
    if (!open) return;
    const el = sheet.current;
    // Move focus into the sheet, keep Tab inside it, and give focus back to the opener on close.
    const opener = document.activeElement as HTMLElement | null;
    const focusables = () =>
      el ? Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((f) => f.offsetParent !== null || f === document.activeElement) : [];
    // The sheet itself takes focus (not its first field), so phones don't pop up the keyboard.
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return askingRef.current ? keep.current() : request.current();
      if (e.key !== 'Tab' || !el) return;
      const list = focusables();
      if (!list.length) return e.preventDefault(), el.focus();
      const first = list[0], last = list[list.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === first || at === el || !el.contains(at))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (at === last || !el.contains(at))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', k);
    // Keep the page behind still while the sheet is open.
    const html = document.documentElement;
    const before = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', k);
      html.style.overflow = before;
      if (opener && opener.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
    };
  }, [open]);

  // Drag down to close. Starts only when the content is scrolled to the top (or on the handle),
  // so scrolling a long form still works.
  useEffect(() => {
    const el = sheet.current;
    if (!open || !el) return;
    let startY = 0, dy = 0, startT = 0, dragging = false, maybe = false;
    const set = (y: number, animate: boolean) => {
      el.style.transition = animate ? 'transform 0.22s ease' : 'none';
      el.style.transform = y ? `translateY(${y}px)` : '';
    };
    const down = (e: TouchEvent) => {
      const onHandle = (e.target as HTMLElement).closest('.t-sheet-grab');
      if (!onHandle && el.scrollTop > 0) return;
      maybe = true;
      dragging = false;
      startY = e.touches[0].clientY;
      startT = performance.now();
      dy = 0;
    };
    const move = (e: TouchEvent) => {
      if (!maybe) return;
      dy = e.touches[0].clientY - startY;
      if (!dragging) {
        if (dy < 6) {
          if (dy < 0) maybe = false; // scrolling up the content: not a drag
          return;
        }
        dragging = true;
      }
      e.preventDefault();
      set(Math.max(0, dy), false);
    };
    const up = () => {
      if (!maybe) return;
      maybe = false;
      if (!dragging) return;
      dragging = false;
      const fast = dy / Math.max(1, performance.now() - startT) > 0.6;
      if (dy > Math.min(160, el.offsetHeight * 0.3) || (fast && dy > 40)) {
        const q = question();
        if (q) {
          set(0, true);
          ask(q);
          return;
        }
        set(el.offsetHeight + 40, true);
        setTimeout(() => close.current(), 200);
      } else set(0, true);
    };
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', up);
    el.addEventListener('touchcancel', up);
    return () => {
      el.removeEventListener('touchstart', down);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', up);
      el.removeEventListener('touchcancel', up);
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="t-sheet-back" onClick={(e) => e.target === e.currentTarget && !asking && request.current()}>
      <div ref={sheet} className="t-sheet" role="dialog" aria-modal="true" aria-label={asking ?? title} tabIndex={-1}>
        <div className="t-sheet-head">
          <div className="t-sheet-grab" aria-hidden="true" />
          <h2>{asking ?? title}</h2>
        </div>
        {asking && (
          <div className="t-stack">
            <button type="button" className="t-btn block danger" onClick={() => close.current()}>
              Discard
            </button>
            <button type="button" className="t-btn primary block" onClick={keepEditing}>
              Keep editing
            </button>
          </div>
        )}
        <SheetClose.Provider value={request.current}>
          <div className="t-sheet-body" hidden={!!asking}>
            {children}
          </div>
        </SheetClose.Provider>
      </div>
    </div>
  );
}

/** Manager tab bar. A `narrow` tab (e.g. the ☰ More button) takes a small fixed width; `name` is its spoken name. */
export function TabBar({ tabs }: { tabs: { to: string; label: string; name?: string; narrow?: boolean }[] }) {
  const columns = tabs.map((t) => (t.narrow ? 'var(--t-tab-narrow, 64px)' : 'minmax(0, 1fr)')).join(' ');
  return (
    <div className="t-tabbar">
      <nav style={{ gridTemplateColumns: columns }}>
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} aria-label={t.name} className={({ isActive }) => (isActive ? 'active' : '') + (t.narrow ? ' t-tab-icon' : '')}>
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

/** Full-screen black surface for TVs. Keeps the screen awake where the browser allows it. */
export function ScreenSurface({ children, testId }: { children: ReactNode; testId?: string }) {
  useEffect(() => {
    type Lock = { release(): Promise<void> };
    let lock: Lock | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<Lock> } };
    const grab = () => nav.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => {});
    grab();
    const onVis = () => document.visibilityState === 'visible' && grab();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      lock?.release().catch(() => {});
    };
  }, []);
  return (
    <div className="t-screen" data-testid={testId}>
      {children}
    </div>
  );
}

export function Idle({ line, small }: { line: string; small?: string }) {
  return (
    <div className="t-idle">
      <span>{line}</span>
      {small && <small>{small}</small>}
    </div>
  );
}

/** True while the browser has no internet connection. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** A calm notice shown while the device is offline. Changes still save and sync when it is back. */
export function OfflineBanner() {
  if (useOnline()) return null;
  return (
    <div className="t-offline" role="status">
      <p>
        <i className="t-dot" aria-hidden="true" />
        Offline. Changes will be saved when the internet is back.
      </p>
    </div>
  );
}
