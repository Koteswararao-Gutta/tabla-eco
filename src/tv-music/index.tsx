// Agent 3 builds this screen. Placeholder from the foundation.
import { Idle, ScreenSurface } from '@shared/ui';
import { useHeartbeat } from '@shared/data';

export default function MusicTv() {
  useHeartbeat('tv5');
  return (
    <ScreenSurface testId="music-tv">
      <Idle line="TV 5 music" small="Being built" />
    </ScreenSurface>
  );
}
