// TV 5: plays the YouTube playlist full screen, with the catering clip between songs
// (or every N seconds). Anything wrong (no playlist, offline, YouTube unreachable,
// every video broken) → the catering clip loops with the restaurant name, and YouTube is retried.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScreenSurface } from '@shared/ui';
import { store, useHeartbeat, useSingleton, type MusicSettings } from '@shared/data';
import { Clip } from './Clip';
import { afterClip, clipDue, nextPlayable, onVideoEnded, planFrom, screenMode, stalled, startIndex } from './schedule';
import { loadYouTube, YT_STATE, type YtPlayer } from './youtube';
import './tv-music.css';

const RETRY_MS = 60_000;
/** Unmuted autoplay may be blocked; after this long without playing, play muted instead. */
const AUTOPLAY_CHECK_MS = 2500;
/** No video playing this long after the player is ready → treat the playlist as broken. */
const WATCHDOG_MS = 30_000;
/** How often video mode checks that the player is really playing. */
const STALL_CHECK_MS = 5000;

export default function MusicTv() {
  useHeartbeat('tv5');
  const music = useSingleton('music');
  const settings = useSingleton('settings');
  if (music === undefined) {
    return (
      <ScreenSurface testId="music-tv">
        <div className="tm-root" data-testid="tv-music" data-mode="loading" />
      </ScreenSurface>
    );
  }
  return <MusicPlayer music={music} brand={settings?.restaurantName?.trim() || 'Tabla'} />;
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

interface ClipState {
  cause: 'ended' | 'timer';
  endedIndex: number | null;
  key: number;
}

function MusicPlayer({ music, brand }: { music: MusicSettings | null; brand: string }) {
  const plan = useMemo(() => planFrom(music), [music]);
  const planRef = useRef(plan);
  planRef.current = plan;
  const online = useOnline();

  const [attempt, setAttempt] = useState(0);
  const [apiFailed, setApiFailed] = useState(false);
  const [allFailed, setAllFailed] = useState(false);
  const [started, setStarted] = useState(false);
  const [clip, setClip] = useState<ClipState | null>(null);
  const [needSound, setNeedSound] = useState(false);

  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YtPlayer | null>(null);
  const clipRef = useRef<ClipState | null>(clip);
  clipRef.current = clip;
  /** When the video last started counting toward an 'everySeconds' clip. */
  const sinceRef = useRef<number | null>(null);
  /** Last time the player was seen PLAYING in video mode (clip time not counted). */
  const lastPlayingRef = useRef(0);
  const needSoundRef = useRef(needSound);
  needSoundRef.current = needSound;

  const { mode, reason } = screenMode({ hasPlaylist: !!plan.playlistId, online, apiFailed, allFailed, inClip: !!clip, started });

  // The YouTube player. Rebuilt when the playlist or shuffle changes, when we come back online, and on each retry.
  useEffect(() => {
    const list = plan.playlistId;
    if (!list || !online) return;
    let alive = true;
    let player: YtPlayer | null = null;
    let begun = false;
    const failed = new Set<number>();
    const timers: ReturnType<typeof setTimeout>[] = [];
    setStarted(false);
    setClip(null);
    setApiFailed(false);
    setAllFailed(false);
    sinceRef.current = null;

    const safe = (fn: () => void) => {
      try {
        fn();
      } catch {
        /* a player call can throw while it is being torn down */
      }
    };

    loadYouTube()
      .then((YT) => {
        if (!alive || !hostRef.current) return;
        const el = document.createElement('div');
        hostRef.current.appendChild(el);
        let cued = false;
        player = new YT.Player(el, {
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: 0,
            controls: 0,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            disablekb: 1,
            fs: 0,
            iv_load_policy: 3,
            cc_load_policy: 0,
            origin: window.location.origin,
          },
          events: {
            onReady: (e) => safe(() => e.target.cuePlaylist({ listType: 'playlist', list })),
            onStateChange: (e) => {
              if (!alive) return;
              const p = e.target;
              if (e.data === YT_STATE.CUED && !cued) {
                cued = true;
                safe(() => {
                  const items = p.getPlaylist();
                  if (!items || !items.length) return setAllFailed(true);
                  const shuffle = planRef.current.shuffle;
                  p.setLoop(true);
                  p.setShuffle(shuffle);
                  p.playVideoAt(startIndex(items.length, shuffle, Math.random()));
                });
                // Unmuted autoplay can be blocked (it may also sit in BUFFERING). Not actually playing
                // after 2.5 s → play muted with the sound note; check once more and nudge it again.
                const notPlaying = () => alive && !begun && p.getPlayerState() !== YT_STATE.PLAYING;
                timers.push(
                  setTimeout(() => {
                    if (!notPlaying()) return;
                    safe(() => {
                      p.mute();
                      p.playVideo();
                    });
                    setNeedSound(true);
                    timers.push(setTimeout(() => notPlaying() && safe(() => p.playVideo()), AUTOPLAY_CHECK_MS));
                  }, AUTOPLAY_CHECK_MS),
                );
              } else if (e.data === YT_STATE.PLAYING) {
                if (clipRef.current) return safe(() => p.pauseVideo()); // the playlist moved on by itself under the clip
                begun = true;
                lastPlayingRef.current = store.now();
                setStarted(true);
                if (sinceRef.current === null) sinceRef.current = store.now();
                safe(() => p.isMuted() && setNeedSound(true));
              } else if (e.data === YT_STATE.ENDED) {
                if (onVideoEnded(planRef.current) === 'clip') {
                  // The playlist moves on by itself; keep the next song's first moment silent until after the clip.
                  safe(() => p.mute());
                  let idx: number | null = null;
                  safe(() => (idx = p.getPlaylistIndex()));
                  setClip({ cause: 'ended', endedIndex: idx, key: store.now() });
                }
              }
            },
            onError: (e) => {
              if (!alive) return;
              safe(() => {
                const p = e.target;
                const items = p.getPlaylist();
                if (!items || !items.length) return setAllFailed(true);
                const idx = p.getPlaylistIndex();
                failed.add(idx);
                const next = nextPlayable(items.length, idx, failed);
                if (next < 0) setAllFailed(true);
                else p.playVideoAt(next);
              });
            },
          },
        });
        playerRef.current = player;
        timers.push(setTimeout(() => alive && !begun && setAllFailed(true), WATCHDOG_MS));
      })
      .catch(() => alive && setApiFailed(true));

    return () => {
      alive = false;
      timers.forEach(clearTimeout);
      if (player) safe(() => player!.destroy());
      playerRef.current = null;
      if (hostRef.current) hostRef.current.innerHTML = '';
    };
  }, [plan.playlistId, plan.shuffle, online, attempt]);

  // Retry YouTube every minute while it is failing (coming back online retries at once, above).
  useEffect(() => {
    if (!(apiFailed || allFailed) || !online || !plan.playlistId) return;
    const t = setTimeout(() => setAttempt((a) => a + 1), RETRY_MS);
    return () => clearTimeout(t);
  }, [apiFailed, allFailed, online, plan.playlistId]);

  // End of a clip: next video (after a song) or carry on (after a timed break).
  useEffect(() => {
    if (!clip) return;
    const t = setTimeout(() => {
      clipRef.current = null;
      const p = playerRef.current;
      if (p) {
        try {
          if (clip.cause === 'ended' && !needSoundRef.current) p.unMute();
          if (afterClip(clip.cause, clip.endedIndex, p.getPlaylistIndex()) === 'next') p.nextVideo();
          else p.playVideo();
        } catch {
          /* player gone: the player effect rebuilds it */
        }
      }
      sinceRef.current = store.now();
      setClip(null);
    }, plan.clipMs);
    return () => clearTimeout(t);
  }, [clip, plan.clipMs]);

  // 'everySeconds': count from now when the mode or interval changes.
  useEffect(() => {
    if (sinceRef.current !== null) sinceRef.current = store.now();
  }, [plan.clipMode, plan.everyMs]);

  useEffect(() => {
    if (mode !== 'video' || plan.clipMode !== 'everySeconds') return;
    const t = setInterval(() => {
      if (!clipDue(planRef.current, store.now(), sinceRef.current)) return;
      try {
        playerRef.current?.pauseVideo();
      } catch {
        /* ignore */
      }
      setClip({ cause: 'timer', endedIndex: null, key: store.now() });
    }, 500);
    return () => clearInterval(t);
  }, [mode, plan.clipMode]);

  // Stall watchdog: the network can drop behind a working router and leave YouTube on a spinner
  // with no error. Not PLAYING for 20 s of video time → clip loop, and the 1-minute retry takes over.
  useEffect(() => {
    if (mode !== 'video') return;
    lastPlayingRef.current = store.now(); // time in a clip doesn't count
    const t = setInterval(() => {
      let st: number = YT_STATE.UNSTARTED;
      try {
        st = playerRef.current?.getPlayerState() ?? YT_STATE.UNSTARTED;
      } catch {
        /* treat as not playing */
      }
      const now = store.now();
      if (st === YT_STATE.PLAYING) lastPlayingRef.current = now;
      else if (stalled(lastPlayingRef.current, now)) setAllFailed(true);
    }, STALL_CHECK_MS);
    return () => clearInterval(t);
  }, [mode]);

  // Fallback / connecting: the clip stays up and keeps cycling its pictures. It is one mounted
  // element for as long as it shows (also from connecting into fallback, or a break into either),
  // so it never fades out and in again.
  const showClip = mode === 'clip' || mode === 'fallback' || mode === 'connecting';

  // Muted fallback: one click or key press turns the sound on.
  useEffect(() => {
    if (!needSound) return;
    const on = () => {
      try {
        playerRef.current?.unMute();
        playerRef.current?.setVolume(100);
      } catch {
        /* ignore */
      }
      setNeedSound(false);
    };
    window.addEventListener('pointerdown', on);
    window.addEventListener('keydown', on);
    return () => {
      window.removeEventListener('pointerdown', on);
      window.removeEventListener('keydown', on);
    };
  }, [needSound]);

  return (
    <ScreenSurface testId="music-tv">
      <div className="tm-root" data-testid="tv-music" data-mode={mode} data-reason={reason ?? ''} data-sound={needSound ? 'muted' : 'on'}>
        <div ref={hostRef} className={'tm-player' + (mode === 'video' ? ' on' : '')} data-testid="player" />
        <div className="tm-cover" />
        {showClip && <Clip plan={plan} brand={brand} />}
        {needSound && mode !== 'fallback' && (
          <div className="tm-sound" data-testid="sound-note">
            Click or press OK for sound
          </div>
        )}
      </div>
    </ScreenSurface>
  );
}
