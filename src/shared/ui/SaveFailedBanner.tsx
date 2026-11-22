// A red notice when the server refused a save after the screen already showed it as saved (for example a
// change made offline that the server turned down once the internet was back). Shown once app-wide, never on TVs.
import { useSaveFailures } from '@shared/data';

export const SAVE_FAILED_MESSAGE = 'Not saved: a change was refused by the server. Please check it and try again.';

export function SaveFailedBanner({ hidden }: { hidden?: boolean }) {
  // Always listening (also while hidden), so a refusal is never missed; only drawn where `hidden` is false.
  const { failures, dismiss } = useSaveFailures();
  if (hidden || failures.length === 0) return null;
  return (
    <div className="t-savefail" role="alert" data-testid="save-failed">
      <div>
        <p>{SAVE_FAILED_MESSAGE}</p>
        <button type="button" className="t-btn" onClick={dismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
