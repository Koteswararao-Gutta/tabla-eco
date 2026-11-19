// Catches a screen that crashes while drawing, so no device is left on a white page.
// TVs: black screen, a small grey "Restarting…", reload after 30 s.
// Everything else: a plain card with a Reload button, reloaded by itself after 60 s.
import { Component, type ErrorInfo, type ReactNode } from 'react';

const isTv = () => typeof location !== 'undefined' && location.hash.startsWith('#/tv/');

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  private timer: ReturnType<typeof setTimeout> | undefined;

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Screen crashed', error, info.componentStack);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => location.reload(), isTv() ? 30_000 : 60_000);
  }

  componentWillUnmount() {
    clearTimeout(this.timer);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (isTv())
      return (
        <div className="t-crash-tv" data-testid="crash">
          <span>Restarting…</span>
        </div>
      );
    return (
      <main className="t-page t-crash" data-testid="crash">
        <div className="t-card">
          <h2>Something went wrong</h2>
          <p className="t-sub">This page will reload by itself in a minute.</p>
          <button type="button" className="t-btn primary block" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </main>
    );
  }
}
