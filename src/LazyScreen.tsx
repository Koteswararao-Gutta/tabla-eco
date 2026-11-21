// Owned by the foundation. Wraps a screen whose code loads when it first opens (React.lazy).
// If that code can't be fetched (a new version replaced the old files, or the internet dropped at the
// wrong moment), the page reloads once to pick up the current version, instead of the whole app
// showing "Something went wrong". Any other crash goes on to the app's ErrorBoundary as before.
import { Component, Suspense, type ReactNode } from 'react';
import { deviceValue, setDeviceValue } from '@shared/data';
import { isChunkLoadError } from './chunkError';

const KEY = 'chunk-reload-at';
/** At most one reload a minute, so a screen whose code is really missing can't reload forever. */
const ONCE_MS = 60_000;

type Props = { children: ReactNode; fallback: ReactNode };

export class LazyScreen extends Component<Props, { error: unknown; reloading: boolean }> {
  state = { error: null as unknown, reloading: false };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown) {
    if (!isChunkLoadError(error)) return;
    const last = Number(deviceValue(KEY) || 0);
    if (Date.now() - last < ONCE_MS) return; // already tried just now: let the crash screen take over
    setDeviceValue(KEY, String(Date.now()));
    this.setState({ reloading: true });
    location.reload();
  }

  render() {
    const { error, reloading } = this.state;
    if (reloading) return this.props.fallback;
    if (error) {
      // Not a load error, or the reload already happened: the app's ErrorBoundary shows its screen.
      // (Until componentDidCatch decides, show the fallback for this one frame.)
      if (!isChunkLoadError(error) || Date.now() - Number(deviceValue(KEY) || 0) < ONCE_MS) throw error;
      return this.props.fallback;
    }
    return <Suspense fallback={this.props.fallback}>{this.props.children}</Suspense>;
  }
}
