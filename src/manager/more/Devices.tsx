// More > Devices: which phones, tablets and TVs may open the app, the restaurant code, and the lock.
// Open (the start): every device that opens the app adds itself here. When all the restaurant's devices are
// listed, the manager sets a code and locks: from then on a new device needs the code once, and the database
// refuses every device that isn't in this list. The server does every change (store.manageDevices).
// Manager phones: once a device is marked "Manager phone", only manager phones can change the code, the lock
// and the list (the server checks it too). Devices not seen for 30 days are folded away, but stay approved.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  activeManagers, appLabel, deviceLabel, isRecent, mayManage, MENU_SCREENS, store, useCollection, useDoc, useNow,
  type DeviceAction, type DeviceRecord, type ScreenId,
} from '@shared/data';
import { PageHeader, Segmented, Sheet, useSheetClose } from '@shared/ui';

/** A screen that reported in this recently is "in use" (and should be in the list before locking). */
const IN_USE_MS = 2 * 24 * 3600_000;

export default function Devices() {
  const devices = useCollection('devices');
  const info = useDoc('access', 'info');
  const beats = useCollection('heartbeats');
  const now = useNow(60_000);
  const me = store.thisDeviceId();
  const [sheet, setSheet] = useState<null | 'code' | 'lock' | 'unlock' | { edit: DeviceRecord } | { remove: DeviceRecord }>(null);
  const [showOld, setShowOld] = useState(false);
  const close = () => setSheet(null);

  const locked = !!info?.locked;
  const codeSet = !!info?.codeSetAt;
  const list = (devices ?? []).slice().sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : deviceLabel(a).localeCompare(deviceLabel(b))));
  // Only manager phones may change anything here, once one is marked (before that, any approved device).
  const canManage = mayManage(me, list, now);
  const managers = activeManagers(list, now);
  // Not seen for 30 days (e.g. a phone whose browser data was cleared comes back as a new device): folded away.
  // They are still approved, so they can be shown and removed.
  const recent = list.filter((d) => d.id === me || isRecent(d, now));
  const old = list.filter((d) => !recent.includes(d));
  const shown = showOld ? list : recent;
  // Screens that ran lately but aren't in the list yet (they add themselves the next time they open the app).
  const waiting = (beats ?? [])
    .filter((b) => now - (b.lastSeen ?? 0) < IN_USE_MS && [...MENU_SCREENS, 'tv5', 'kitchen'].includes(b.id))
    .map((b) => b.id as ScreenId)
    .filter((id) => !list.some((d) => d.app === id))
    .sort();

  return (
    <main className="t-page">
      <Link className="mo-back" to="/manager/more">‹ More</Link>
      <PageHeader title="Devices" sub="The phones, tablets and TVs that can open the Tabla app." />
      {devices === null || info === undefined ? (
        <p className="t-sub">Loading…</p>
      ) : (
        <div className="t-stack">
          <section className="t-card dv-card" data-testid="dv-status">
            <div className="dv-head">
              <h2 className="mo-h2">{locked ? 'Locked to these devices' : 'Open to anyone with a link'}</h2>
              <span className={'t-badge ' + (locked ? 'good' : 'accent')}>{locked ? 'Locked' : 'Open'}</span>
            </div>
            {locked ? (
              <p className="mo-note">Only the devices below can open the app. A new phone, tablet or TV asks for the restaurant code once.</p>
            ) : (
              <p className="mo-note">
                Every device that opens the app adds itself below. When every phone, tablet and TV you use is listed, set a restaurant code and lock.
              </p>
            )}
            {!canManage ? null : locked ? (
              <button className="t-btn block" onClick={() => setSheet('unlock')} data-testid="dv-unlock">Open the app to anyone again</button>
            ) : (
              <button className="t-btn accent block" onClick={() => setSheet('lock')} disabled={!codeSet} data-testid="dv-lock">
                Lock to these {list.length} devices
              </button>
            )}
            {canManage && !locked && !codeSet && <p className="mo-note">Set the restaurant code first.</p>}
          </section>

          {!canManage ? (
            <p className="dv-wait" data-testid="dv-not-manager">
              Only a manager phone can change the code, the lock or this list. Please ask the manager.
            </p>
          ) : managers.length === 0 ? (
            <p className="dv-wait" data-testid="dv-no-manager">
              Right now every phone that opens the manager app can change these settings. Tap Edit on your own phone and
              make it a manager phone, so only it can.
            </p>
          ) : null}

          <section className="t-card dv-card">
            <div className="dv-head">
              <h2 className="mo-h2">Restaurant code</h2>
              {canManage && <button className="t-btn" onClick={() => setSheet('code')} data-testid="dv-set-code">{codeSet ? 'Change' : 'Set code'}</button>}
            </div>
            <p className="mo-note">
              {codeSet
                ? `Set ${new Date(info!.codeSetAt!).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}. It isn't shown here: if you forget it, set a new one. Devices already in the list keep working.`
                : 'Not set yet. A new device enters this code once, after you lock.'}
            </p>
          </section>

          {!locked && waiting.length > 0 && (
            <p className="dv-wait" data-testid="dv-waiting">
              Not in the list yet: {waiting.map((id) => appLabel(id)).join(', ')}. Each adds itself the next time it opens the app (TVs reload at 4 AM). Wait for them before you lock.
            </p>
          )}

          <ul className="mo-list" data-testid="dv-list">
            {shown.map((d) => (
              <li key={d.id} className="dv-row" data-testid="dv-row">
                <div className="mo-row-main">
                  <b>
                    {deviceLabel(d)}
                    {d.id === me && <span className="t-badge dv-me">This device</span>}
                    {d.manager && <span className="t-badge accent dv-me" data-testid="dv-manager">Manager</span>}
                  </b>
                  <span className="mo-row-time">
                    {[d.name ? appLabel(d.app) : null, d.model, seen(d.lastSeen, now)].filter(Boolean).join(' · ')}
                  </span>
                </div>
                {canManage && (
                  <div className="dv-actions">
                    <button className="t-btn ghost" onClick={() => setSheet({ edit: d })} data-testid="dv-edit">Edit</button>
                    {d.id !== me && (
                      <button className="t-btn ghost danger" onClick={() => setSheet({ remove: d })} data-testid="dv-remove">Remove</button>
                    )}
                  </div>
                )}
              </li>
            ))}
            {list.length === 0 && <li className="mo-empty">No devices yet.</li>}
          </ul>
          {old.length > 0 && (
            <button className="t-btn ghost block" onClick={() => setShowOld((v) => !v)} data-testid="dv-show-old">
              {showOld ? 'Hide devices not seen for 30 days' : `Show ${old.length} more not seen for 30 days (still approved)`}
            </button>
          )}
        </div>
      )}

      <Sheet open={sheet === 'code'} title={codeSet ? 'Change the restaurant code' : 'Set the restaurant code'} onClose={close}>
        <CodeForm onDone={close} />
      </Sheet>
      <Sheet open={sheet === 'lock'} title="Lock to these devices?" onClose={close}>
        <Confirm
          text={`Only the ${list.length} devices in the list will open the app. Any other phone, tablet or TV will ask for the restaurant code first. You can open it again here at any time.`}
          button="Lock"
          req={{ action: 'lock' }}
          onDone={close}
        />
      </Sheet>
      <Sheet open={sheet === 'unlock'} title="Open the app to anyone?" onClose={close}>
        <Confirm text="Anyone with a link will be able to open the app again, and new devices add themselves to the list." button="Open the app" req={{ action: 'unlock' }} onDone={close} />
      </Sheet>
      {sheet && typeof sheet === 'object' && 'edit' in sheet && (
        <Sheet open title="Edit device" onClose={close}>
          <EditForm device={sheet.edit} isMe={sheet.edit.id === me} anyManager={managers.length > 0} onDone={close} />
        </Sheet>
      )}
      {sheet && typeof sheet === 'object' && 'remove' in sheet && (
        <Sheet open title={`Remove ${deviceLabel(sheet.remove)}?`} onClose={close}>
          <Confirm
            text={
              locked
                ? 'It stops working within 15 minutes and asks for the restaurant code. Use this for a lost phone or one from someone who left.'
                : 'It is signed out within 15 minutes. While the app is open to anyone it adds itself again, so lock the app too.'
            }
            button="Remove"
            danger
            req={{ action: 'remove', uid: sheet.remove.id }}
            onDone={close}
          />
        </Sheet>
      )}
    </main>
  );
}

function seen(at: number, now: number): string {
  const min = Math.round((now - at) / 60_000);
  if (min < 60 * 4) return 'in use now';
  if (min < 60 * 24) return `seen ${Math.round(min / 60)} h ago`;
  const days = Math.round(min / (60 * 24));
  return days === 1 ? 'seen yesterday' : `seen ${days} days ago`;
}

function useSave(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (...reqs: DeviceAction[]) => {
    setBusy(true);
    setError(null);
    try {
      for (const req of reqs) await store.manageDevices(req);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function Confirm({ text, button, req, danger, onDone }: { text: string; button: string; req: DeviceAction; danger?: boolean; onDone: () => void }) {
  const cancel = useSheetClose();
  const { busy, error, run } = useSave(onDone);
  return (
    <div className="t-stack">
      <p className="dv-text">{text}</p>
      {error && <p className="dv-error" role="alert">{error}</p>}
      <div className="t-grid2">
        <button className="t-btn" onClick={cancel}>Cancel</button>
        <button className={'t-btn ' + (danger ? 'danger' : 'accent')} onClick={() => run(req)} disabled={busy} data-testid="dv-confirm">
          {busy ? 'Saving…' : button}
        </button>
      </div>
    </div>
  );
}

function CodeForm({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const { busy, error, run } = useSave(onDone);
  const ok = /^\d{6,10}$/.test(code);
  return (
    <form className="t-stack" onSubmit={(e) => (e.preventDefault(), ok && run({ action: 'setCode', code }))}>
      <label className="t-field">
        <span>New code (6 to 10 digits)</span>
        <input
          className="t-input dv-code"
          inputMode="numeric"
          autoComplete="off"
          maxLength={10}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          data-testid="dv-code-input"
          autoFocus
        />
      </label>
      <p className="mo-note">Write it down somewhere safe. Staff type it once on each new device. Devices already approved keep working.</p>
      {error && <p className="dv-error" role="alert">{error}</p>}
      <button className="t-btn accent block" type="submit" disabled={!ok || busy} data-testid="dv-code-save">{busy ? 'Saving…' : 'Save code'}</button>
    </form>
  );
}

function EditForm({ device, isMe, anyManager, onDone }: { device: DeviceRecord; isMe: boolean; anyManager: boolean; onDone: () => void }) {
  const [name, setName] = useState(device.name ?? '');
  const [manager, setManager] = useState<'yes' | 'no'>(device.manager ? 'yes' : 'no');
  const { busy, error, run } = useSave(onDone);
  const save = () => {
    const reqs: DeviceAction[] = [];
    if (name.trim() !== (device.name ?? '')) reqs.push({ action: 'rename', uid: device.id, name });
    // The manager mark goes last: taking it off this phone ends its right to make changes.
    if ((manager === 'yes') !== !!device.manager) reqs.push({ action: 'setManager', uid: device.id, manager: manager === 'yes' });
    return reqs.length ? run(...reqs) : onDone();
  };
  return (
    <form className="t-stack" onSubmit={(e) => (e.preventDefault(), save())}>
      <label className="t-field">
        <span>Name</span>
        <input className="t-input" maxLength={40} placeholder={appLabel(device.app)} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <p className="mo-note">For example "Ravi's phone" or "TV over the counter". Empty uses "{appLabel(device.app)}".</p>
      <div className="t-field">
        <span>Manager phone</span>
        <Segmented label="Manager phone" value={manager} onChange={setManager} options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]} />
      </div>
      <p className="mo-note" data-testid="dv-manager-note">
        {manager === 'yes'
          ? 'Only manager phones can change the code, lock or open the app, and edit or remove devices.'
          : isMe && device.manager
            ? 'This phone will no longer be able to change these settings.'
            : !anyManager && !isMe
              ? 'Make your own phone a manager phone first, or you will lose these settings on this phone.'
              : 'It can use the app as usual, but not change these settings.'}
      </p>
      {error && <p className="dv-error" role="alert">{error}</p>}
      <button className="t-btn accent block" type="submit" disabled={busy} data-testid="dv-edit-save">{busy ? 'Saving…' : 'Save'}</button>
    </form>
  );
}
