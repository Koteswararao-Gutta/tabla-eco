// Shared building blocks. Screens compose these; they don't restyle them.
import { useEffect, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import './theme.css';

export function PageHeader({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <>
      <header className="t-header">
        <h1>{title}</h1>
        {action}
      </header>
      {sub && <p className="t-sub">{sub}</p>}
    </>
  );
}

export function Tile(props: { name: string; sub?: string; online?: boolean; selected?: boolean; onClick?: () => void; testId?: string }) {
  return (
    <button className="t-tile" aria-pressed={!!props.selected} onClick={props.onClick} data-testid={props.testId}>
      {props.online !== undefined && <i className={'t-dot' + (props.online ? ' on' : '')} aria-label={props.online ? 'online' : 'offline'} />}
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

/** Bottom sheet on phones, centred dialog on wider screens. Closes on backdrop tap and Escape. */
export function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="t-sheet-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="t-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function TabBar({ tabs }: { tabs: { to: string; label: string }[] }) {
  return (
    <div className="t-tabbar">
      <nav>
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => (isActive ? 'active' : '')}>
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
