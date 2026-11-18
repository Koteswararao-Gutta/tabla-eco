// Agent 1 builds this screen. Placeholder from the foundation.
import { Idle, ScreenSurface } from '@shared/ui';
import { useHeartbeat, type ScreenId } from '@shared/data';

export default function MenuTv({ screenId }: { screenId: ScreenId }) {
  useHeartbeat(screenId);
  return (
    <ScreenSurface testId="menu-tv">
      <Idle line={`Menu ${screenId.toUpperCase()}`} small="Being built" />
    </ScreenSurface>
  );
}
