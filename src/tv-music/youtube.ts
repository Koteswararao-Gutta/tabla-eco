// Loads the YouTube IFrame Player API once, with a timeout. A failed load can be retried later.

export const YT_STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

export interface YtPlayer {
  playVideo(): void;
  pauseVideo(): void;
  nextVideo(): void;
  playVideoAt(index: number): void;
  cuePlaylist(o: { listType: 'playlist'; list: string; index?: number }): void;
  setShuffle(on: boolean): void;
  setLoop(on: boolean): void;
  getPlaylist(): string[] | null;
  getPlaylistIndex(): number;
  getPlayerState(): number;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  setVolume(v: number): void;
  destroy(): void;
}

export interface YtEvent {
  target: YtPlayer;
  data: number;
}

export interface YtNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      width?: string;
      height?: string;
      host?: string;
      playerVars?: Record<string, string | number>;
      events?: { onReady?: (e: YtEvent) => void; onStateChange?: (e: YtEvent) => void; onError?: (e: YtEvent) => void };
    },
  ) => YtPlayer;
}

type W = Window & { YT?: Partial<YtNamespace>; onYouTubeIframeAPIReady?: () => void };

export const YT_API_URL = 'https://www.youtube.com/iframe_api';
let pending: Promise<YtNamespace> | null = null;

export function loadYouTube(timeoutMs = 10_000): Promise<YtNamespace> {
  const w = window as W;
  if (w.YT?.Player) return Promise.resolve(w.YT as YtNamespace);
  if (pending) return pending;
  pending = new Promise<YtNamespace>((resolve, reject) => {
    const script = document.createElement('script');
    const fail = (why: string) => {
      clearTimeout(timer);
      script.remove();
      pending = null;
      reject(new Error(why));
    };
    const timer = setTimeout(() => fail('timeout'), timeoutMs);
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer);
      prev?.();
      if (w.YT?.Player) resolve(w.YT as YtNamespace);
      else fail('no player');
    };
    script.src = YT_API_URL;
    script.async = true;
    script.onerror = () => fail('load');
    document.head.appendChild(script);
  });
  return pending;
}
