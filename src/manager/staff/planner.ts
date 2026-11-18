// The Shift planner, ported from reference/shift-planner.html with the same pages and behaviour.
// It renders into a container element it is given and returns a function that tears it down
// (all listeners, timers and DOM). Storage goes through the PlannerIO it is given (see index.tsx);
// there is no fetch and no localStorage here.

import {
  DAYS, SHORT, STEP, POS, POSSHORT,
  iso, parse, addDays, mondayOf, shiftWeek, dshort, wrange, toHM, fromHM, fmt, rng, clone, esc, newPersonId,
  sorted, hoursOf, hstr, shiftTxt, key, short, emptyWeek, defaults, normalizeDB,
} from './model';
import type { Config, DayHours, Person, PlannerDB, Pos, Settings, Shift, SpecialDay, Week } from './model';

export interface PlannerIO {
  /** Shared-clock time in ms. */
  now(): number;
  /** Live config; null when missing. Must call back once with the current value. */
  watchConfig(cb: (config: unknown | null) => void): () => void;
  /** Live weeks by week id. Must call back once with the current value. */
  watchWeeks(cb: (weeks: Record<string, unknown>) => void): () => void;
  saveConfig(config: Config): Promise<void>;
  /** null deletes the week. */
  saveWeek(id: string, week: Week | null): Promise<void>;
}

type Hours =
  | { closed: true; special: true; lead1: number; lead2: number }
  | { closed?: false; special?: boolean; open: number; close: number; brk: [number, number] | null; lead1: number; lead2: number };
interface Range { start: number; end: number; n: number }
interface Gap { s: number; e: number; n: number; c: number }

// Per-session view preferences (zoom, tip dismissed). Kept in memory: screens don't use browser storage directly.
const prefs: Record<string, string> = {};
// Unsaved Settings changes are kept here when the tab is left (e.g. switching to Screens), and come back on return.
let keptSettings: Settings | null = null;

const SHELL = `<div class="wrap">
  <div class="top">
    <h1>Shift planner</h1>
    <span class="savepill" id="savepill" aria-live="polite">Loading…</span>
  </div>
  <nav class="views" role="tablist">
    <button role="tab" data-v="schedule" aria-selected="true">Schedule</button>
    <button role="tab" data-v="staff" aria-selected="false">Staff</button>
    <button role="tab" data-v="settings" aria-selected="false">Settings</button>
  </nav>
  <main id="main"><p class="loading">Loading schedule…</p></main>
</div>
<div class="modal" id="ask" hidden role="alertdialog" aria-modal="true" aria-labelledby="askMsg">
  <div class="sheet askbox">
    <p id="askMsg"></p>
    <div class="row"><button class="primary" id="askOk">OK</button><button class="ghost" id="askCancel">Cancel</button></div>
  </div>
</div>
<div class="modal sheetwrap" id="edit" hidden role="dialog" aria-modal="true" aria-labelledby="editTitle"><div class="sheet editbox" id="editBox"></div></div>
<div class="dragtip" id="dragTip" hidden></div>
<div class="modal" id="shot" hidden role="dialog" aria-modal="true" aria-label="Schedule picture">
  <div class="sheet">
    <div class="imgbox"><img id="shotImg" alt="Schedule table"></div>
    <p id="shotMsg">On a phone, press and hold the picture to save or share it.</p>
    <div class="row"><button class="primary" id="shotShare">Share</button><button class="ghost" id="shotCopy">Copy picture</button><button class="ghost" id="shotClose">Close</button></div>
  </div>
</div>`;

const LOCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
const UNLOCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>';
const MINLEN = 30;

export function mountPlanner(root: HTMLElement, io: PlannerIO): () => void {
  root.innerHTML = SHELL;
  let disposed = false;
  const ac = new AbortController();
  const sig = { signal: ac.signal };
  const timers = new Set<number>();
  const later = (fn: () => void, ms: number): number => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (!disposed) fn();
    }, ms);
    timers.add(id);
    return id;
  };
  const cancel = (id: number | undefined) => {
    if (id === undefined) return;
    clearTimeout(id);
    timers.delete(id);
  };
  const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null => root.querySelector<T>('#' + id);
  const must = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const e = $<T>(id);
    if (!e) throw new Error('Shift planner: missing #' + id);
    return e;
  };
  const all = <T extends HTMLElement = HTMLElement>(sel: string, from: ParentNode = root): T[] => [...from.querySelectorAll<T>(sel)];

  const today = () => new Date(io.now());
  let THIS = iso(mondayOf(today()));

  /* ---------- saving ---------- */
  let DB: PlannerDB | null = null;
  const db = (): PlannerDB => DB as PlannerDB;
  let inflight = 0;
  function setStatus(s: 'saved' | 'saving' | 'error') {
    const el = $('savepill');
    if (!el) return;
    const map = { saved: ['Saved ✓', ''], saving: ['Saving…', 'saving'], error: ['Not saved, try again', 'error'] };
    el.textContent = map[s][0];
    el.className = 'savepill ' + map[s][1];
  }
  // Writes from this window echo back through the watchers; while writing, an echo only marks a refresh as due.
  let writing = false;
  function track(p: () => Promise<void>) {
    inflight++;
    setStatus('saving');
    writing = true;
    let pr: Promise<void>;
    try {
      pr = p();
    } catch (e) {
      pr = Promise.reject(e);
    } finally {
      writing = false;
    }
    pr.then(
      () => {
        inflight--;
        if (!disposed && !inflight) setStatus('saved');
      },
      () => {
        inflight--;
        if (!disposed) setStatus('error');
      },
    );
  }
  const saveWeek = (id: string) => {
    const w = db().weeks[id];
    track(() => io.saveWeek(id, w ? clone(w) : null));
  };
  const saveConfig = () => {
    const c = clone(db().config);
    track(() => io.saveConfig(c));
  };
  // Replace everything (used by "Paste data"): saves config and every week, deletes weeks that are gone.
  function replaceAll(next: PlannerDB, oldWeeks: string[]) {
    DB = next;
    saveConfig();
    new Set([...oldWeeks, ...Object.keys(next.weeks)]).forEach((id) => saveWeek(id));
  }

  /* ---------- live data from the store ---------- */
  let rawConfig: unknown | null | undefined;
  let rawWeeks: Record<string, unknown> | undefined;
  let refreshDue = false;
  function editing(): boolean {
    if (!must('edit').hidden || !must('ask').hidden) return true;
    if (settingsDirty()) return true;
    if (root.querySelector('.bar.drag')) return true;
    // Something typed but not yet applied (a name, a time).
    const a = document.activeElement;
    if (a && root.contains(a) && (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement)) {
      if (a.type !== 'checkbox' && a.value !== a.defaultValue) return true;
    }
    return false;
  }
  function onData() {
    if (disposed || rawConfig === undefined || rawWeeks === undefined) return;
    if (!DB) {
      // First load. No config yet: start from the planner's own defaults (and its sample week if there are no weeks).
      if (rawConfig === null) {
        const d = defaults();
        const hasWeeks = Object.keys(rawWeeks).length > 0;
        DB = hasWeeks ? normalizeDB({ config: d.config, weeks: rawWeeks }) || d : d;
        // Save once the watchers are fully set up (this may run inside the first watch callback),
        // so the echo of these writes is heard.
        later(() => {
          saveConfig();
          if (!hasWeeks) Object.keys(db().weeks).forEach((id) => saveWeek(id));
        }, 0);
      } else {
        DB = normalizeDB({ config: rawConfig, weeks: rawWeeks }) || defaults();
      }
      if (!inflight) setStatus('saved');
      render();
      return;
    }
    if (writing) {
      refreshDue = true;
      return;
    }
    refresh();
  }
  function refresh() {
    if (!DB || rawConfig === undefined || rawWeeks === undefined) return;
    if (editing()) {
      refreshDue = true;
      return;
    }
    refreshDue = false;
    const n = rawConfig === null ? null : normalizeDB({ config: rawConfig, weeks: rawWeeks });
    if (!n || JSON.stringify(n) === JSON.stringify({ config: DB.config, weeks: DB.weeks })) return;
    draft = null;
    DB = n;
    render();
  }
  const pollId = window.setInterval(() => {
    if (refreshDue && !disposed) refresh();
  }, 800);

  /* ---------- in-page yes/no box ---------- */
  function ask(msg: string, { ok = 'OK', cancel = 'Cancel' as string | null, danger = false } = {}): Promise<boolean> {
    return new Promise((res) => {
      const box = must('ask'), okB = must<HTMLButtonElement>('askOk'), noB = must<HTMLButtonElement>('askCancel');
      const back = document.activeElement as HTMLElement | null;
      must('askMsg').textContent = msg;
      okB.textContent = ok;
      okB.className = 'primary' + (danger ? ' red' : '');
      noB.hidden = !cancel;
      if (cancel) noB.textContent = cancel;
      box.hidden = false;
      okB.focus();
      const done = (v: boolean) => {
        box.hidden = true;
        okB.onclick = noB.onclick = box.onclick = null;
        document.removeEventListener('keydown', keyH);
        try {
          back?.focus();
        } catch {
          /* gone */
        }
        res(v);
      };
      const keyH = (e: KeyboardEvent) => {
        if (e.key === 'Escape') done(false);
      };
      okB.onclick = () => done(true);
      noB.onclick = () => done(false);
      box.onclick = (e) => {
        if (e.target === box) done(false);
      };
      document.addEventListener('keydown', keyH, sig);
    });
  }

  /* ---------- data helpers ---------- */
  let view: 'schedule' | 'staff' | 'settings' = 'schedule';
  let wk = THIS, cur = (today().getDay() + 6) % 7;
  let selSlot: number | null = null, tlScroll: number | null = null, hoursOpen = false, posFlow = false;
  let zoom = prefs.zoom === '1';
  const phone = () => window.innerWidth <= 560;
  let _hrs = 13;
  const hourW = (): number => {
    if (zoom) return 64;
    if (!phone()) return 56;
    const nw = parseFloat(getComputedStyle(root).getPropertyValue('--namew')) || 62;
    const avail = Math.min(window.innerWidth, 820) - 24 - 28 - 2 - nw - 6;
    return Math.max(18, Math.floor((avail / _hrs) * 10) / 10);
  };
  const P = (): Person[] => db().config.people;
  const SET = (): Settings => db().config.settings;
  const SP = (): Record<string, SpecialDay> => db().config.special;
  const W = (id: string): Week | undefined => db().weeks[id];
  const Wk = (id: string): Week => db().weeks[id] as Week;
  const dateOf = (id: string, d: number) => iso(addDays(parse(id), d));
  const nameOf = (pid: string) => (P().find((p) => p.id === pid) || { name: '?' }).name;
  const isActive = (pid: string) => !!P().find((p) => p.id === pid)?.active;
  function hoursFor(id: string, d: number): Hours {
    const sp = SP()[dateOf(id, d)];
    const S = SET(), base = S.days[d], lead1 = Math.max(0, base.open - S.prepStart), lead2 = Math.max(0, base.open - S.secondAt);
    if (sp) {
      if (sp.closed) return { closed: true, special: true, lead1, lead2 };
      const b = sp.brk && sp.brk[0] > sp.open && sp.brk[1] > sp.brk[0] && sp.brk[1] < sp.close ? ([sp.brk[0], sp.brk[1]] as [number, number]) : null;
      return { open: sp.open, close: sp.close, brk: b, special: true, lead1, lead2 };
    }
    return { lead1, lead2, ...base };
  }
  const shifts = (id: string, d: number, pid: string) => sorted(Wk(id).shifts[d][pid]);
  const hasShifts = (id: string, pid: string) => Wk(id).shifts.some((day) => (day[pid] || []).length);
  const peopleIn = (id: string) => P().filter((p) => p.active || hasShifts(id, p.id));
  const prevSaved = (id: string): string | null => Object.keys(db().weeks).filter((k) => k < id).sort().pop() || null;
  function changed(d: number, pid: string) {
    const p = prevSaved(wk);
    if (!p) return false;
    return key(Wk(wk).shifts[d][pid]) !== key(Wk(p).shifts[d][pid]);
  }
  function copyWeekData(src: Week): Week {
    const w = emptyWeek();
    const act = new Set(P().filter((p) => p.active).map((p) => p.id));
    for (let d = 0; d < 7; d++)
      Object.keys(src.shifts[d]).forEach((pid) => {
        if (act.has(pid) && src.shifts[d][pid].length) w.shifts[d][pid] = clone(src.shifts[d][pid]);
      });
    return w;
  }

  // Each day's timeline covers that day's own hours: first prep time to an hour after closing.
  function dayRange(id: string, d: number): Range {
    const S = SET(), h = hoursFor(id, d);
    const base: DayHours = h.closed ? S.days[d] : h;
    let lo = base.open - (h.closed ? 0 : h.lead1 || 0), hi = base.close;
    Object.values(Wk(id).shifts[d]).forEach((l) =>
      l.forEach(([s, e]) => {
        lo = Math.min(lo, s);
        hi = Math.max(hi, e);
      }),
    );
    const start = Math.floor(lo / 60) * 60, end = Math.min(Math.ceil(hi / 60) * 60 + 60, 24 * 60);
    return { start, end, n: (end - start) / STEP };
  }
  function need(h: Hours, t: number): number {
    const S = SET();
    if (h.closed || t >= h.close) return 0;
    if (t < h.open) {
      if (t < h.open - h.lead1) return 0;
      return t < h.open - h.lead2 ? 1 : S.minStaff;
    }
    if (h.brk && t >= h.brk[0] && t < h.brk[1]) return 0;
    return S.minStaff;
  }
  function coverage(id: string, d: number, R: Range): string[][] {
    const cov: string[][] = Array.from({ length: R.n }, () => []);
    const day = Wk(id).shifts[d];
    Object.keys(day).forEach((pid) =>
      day[pid].forEach(([s, e]) => {
        for (let t = s; t < e; t += STEP) {
          const i = (t - R.start) / STEP;
          if (i >= 0 && i < R.n && !cov[i].includes(pid)) cov[i].push(pid);
        }
      }),
    );
    return cov;
  }
  function gaps(id: string, d: number, R: Range = dayRange(id, d)): Gap[] {
    const h = hoursFor(id, d), cov = coverage(id, d, R), out: Gap[] = [];
    let run: Gap | null = null;
    for (let i = 0; i < R.n; i++) {
      const t = R.start + i * STEP, n = need(h, t), c = cov[i].length;
      if (n && c < n) {
        if (run && run.e === t && run.n === n && run.c === c) run.e = t + STEP;
        else {
          run = { s: t, e: t + STEP, n, c };
          out.push(run);
        }
      }
    }
    return out;
  }
  const unsetCount = (id: string, d: number) => Object.values(Wk(id).shifts[d]).reduce((a, l) => a + l.filter((x) => !x[2]).length, 0);
  function hoursText(h: Hours): string {
    if (h.closed) return 'Closed';
    return h.brk ? `Open ${rng(h.open, h.brk[0])} and ${rng(h.brk[1], h.close)}` : `Open ${rng(h.open, h.close)}`;
  }

  /* Time boxes fire "change" while you're still typing on a computer.
     Apply the value once the box loses focus (or Enter), so the page doesn't redraw mid-typing. */
  function commitTime(inputs: HTMLInputElement[], apply: (inp: HTMLInputElement) => void) {
    inputs.forEach((inp) => {
      let dirty = false;
      inp.addEventListener('change', () => {
        dirty = true;
        if (document.activeElement !== inp) {
          dirty = false;
          apply(inp);
        }
      });
      inp.addEventListener('blur', () => {
        if (dirty) {
          dirty = false;
          apply(inp);
        }
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          inp.blur();
        }
      });
    });
  }

  /* ---------- render: shell ---------- */
  function render() {
    if (disposed || !DB) return;
    all('.views button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === view)));
    if (view === 'schedule') renderSchedule();
    else if (view === 'staff') renderStaff();
    else renderSettings();
  }
  all('.views button').forEach(
    (b) =>
      (b.onclick = async () => {
        if (!DB || b.dataset.v === view) return;
        if (!(await leaveSettingsOk())) return;
        view = b.dataset.v as typeof view;
        selSlot = null;
        savedMsg = '';
        closeEdit();
        render();
        window.scrollTo(0, 0);
      }),
  );
  function goWeek(id: string) {
    wk = id;
    selSlot = null;
    tlScroll = null;
    hoursOpen = false;
    closeEdit();
    render();
  }
  function goDay(d: number) {
    cur = d;
    selSlot = null;
    tlScroll = null;
    hoursOpen = false;
    closeEdit();
    render();
  }

  /* ---------- render: schedule ---------- */
  function renderSchedule() {
    const main = must('main'), w = W(wk);
    let sub = '';
    if (wk === THIS) sub = '<small class="now">This week</small>';
    else if (wk === shiftWeek(THIS, 1)) sub = '<small>Next week</small>';
    else if (wk === shiftWeek(THIS, -1)) sub = '<small>Last week</small>';
    else sub = parse(wk).getFullYear() !== today().getFullYear() ? `<small>${parse(wk).getFullYear()}</small>` : '<small>&nbsp;</small>';
    const L = !!(w && w.locked);
    const nav = `<div class="weeknav">
    <button class="arrow" id="prev" aria-label="Previous week">‹</button>
    <div class="wlabel">${wrange(wk)}${sub}</div>
    <button class="arrow" id="next" aria-label="Next week">›</button>
  </div>`;
    if (!w) {
      const p = prevSaved(wk);
      main.innerHTML =
        nav +
        `<section class="empty-week"><h2>No schedule for ${wrange(wk)} yet</h2>
      <p>${p ? "Start from a copy, then change only what's different." : 'Start empty and tap a row in the timeline to add shifts.'}</p>
      <div class="choices">${p ? `<button class="primary" id="fromPrev">Copy week of ${wrange(p)}</button>` : ''}<button class="ghost" id="fromBlank">Start empty</button></div>
      ${wk !== THIS ? '<p class="note"><button class="linkbtn" id="today">Back to this week</button></p>' : ''}</section>`;
      bindNav();
      const fp = $('fromPrev');
      if (fp && p)
        fp.onclick = () => {
          db().weeks[wk] = copyWeekData(Wk(p));
          saveWeek(wk);
          render();
        };
      must('fromBlank').onclick = () => {
        db().weeks[wk] = emptyWeek();
        saveWeek(wk);
        render();
      };
      const td = $('today');
      if (td) td.onclick = () => goWeek(THIS);
      return;
    }
    const m = parse(wk);
    let tabs = '<div class="tabs" role="tablist" aria-label="Day">';
    for (let d = 0; d < 7; d++) {
      const h = hoursFor(wk, d), ok = !gaps(wk, d).length;
      tabs += `<button class="tab" role="tab" data-d="${d}" aria-selected="${d === cur}" aria-label="${DAYS[d]} ${addDays(m, d).getDate()}, ${h.closed ? 'closed' : ok ? 'covered' : 'short on staff'}"><span>${SHORT[d]}</span><small>${addDays(m, d).getDate()}</small><span class="dot ${h.closed ? 'closed' : ok ? 'ok' : ''}" aria-hidden="true">${h.closed ? '–' : ok ? '✓' : '!'}</span></button>`;
    }
    tabs += '</div>';
    const banner = L ? '<div class="banner"><b>This week is locked.</b> Nothing can be changed. Tap <b>Unlock</b> at the bottom to make changes.</div>' : '';
    const dock = `<div class="dock"><button class="lockbtn ${L ? 'on' : ''}" id="lock" aria-pressed="${L}">${L ? LOCK_SVG : UNLOCK_SVG}<span>${L ? 'Unlock' : 'Lock week'}</span></button><button class="${L ? 'primary' : 'ghost'}" id="copyPic">Send to staff</button></div>`;
    main.innerHTML = nav + banner + tabs + `<section class="panel" id="day">${dayHTML(L)}</section>` + weekHTML(L) + dock;
    bindNav();
    all('.tab', main).forEach((b) => (b.onclick = () => goDay(+(b.dataset.d || 0))));
    must('lock').onclick = async () => {
      if (L) {
        if (!(await ask(`Unlock the week of ${wrange(wk)} so it can be changed?`, { ok: 'Unlock' }))) return;
        w.locked = false;
      } else w.locked = true;
      saveWeek(wk);
      closeEdit();
      render();
    };
    bindDay(L);
    bindWeek(L);
  }
  function bindNav() {
    must('prev').onclick = () => goWeek(shiftWeek(wk, -1));
    must('next').onclick = () => goWeek(shiftWeek(wk, 1));
  }

  function dayHTML(L: boolean): string {
    const d = cur, h = hoursFor(wk, d), R = dayRange(wk, d), date = addDays(parse(wk), d), dkey = dateOf(wk, d), sp = SP()[dkey];
    const cov = coverage(wk, d, R), g = gaps(wk, d, R), un = unsetCount(wk, d);
    if (selSlot !== null && selSlot >= R.n) selSlot = null;
    _hrs = (R.end - R.start) / 60;
    const span = R.end - R.start, pct = (t: number) => (((t - R.start) / span) * 100).toFixed(3) + '%', wid = (a: number, b: number) => (((b - a) / span) * 100).toFixed(3) + '%';
    const cols = `grid-template-columns:repeat(${R.n},1fr)`;

    // hours for this date
    const mode = !sp ? 'normal' : sp.closed ? 'closed' : 'custom';
    const showCtl = hoursOpen || !!sp;
    const hours = `<div class="hours"><span>${esc(hoursText(h))}${h.special ? ' (this date only)' : ''}</span>
    ${showCtl || L ? '' : '<button class="linkbtn" id="hoursChange">Change</button>'}
    ${showCtl ? `<select id="spMode" aria-label="Hours for this date" ${L ? 'disabled' : ''}>
      <option value="normal" ${mode === 'normal' ? 'selected' : ''}>Normal hours</option>
      <option value="closed" ${mode === 'closed' ? 'selected' : ''}>Closed this day</option>
      <option value="custom" ${mode === 'custom' ? 'selected' : ''}>Different hours</option>
    </select>` : ''}
    ${sp && !sp.closed ? `<span>open <input type="time" step="900" id="spOpen" value="${toHM(sp.open)}" ${L ? 'disabled' : ''}> close <input type="time" step="900" id="spClose" value="${toHM(sp.close)}" ${L ? 'disabled' : ''}></span><span class="err" id="spErr" style="width:100%;margin:0;min-height:0"></span>` : ''}
  </div>`;

    // status chips
    let chips = '';
    if (h.closed) chips += '<span class="chip off">Closed</span>';
    else if (!g.length) chips += '<span class="chip ok">Fully covered</span>';
    else {
      const r = g[0], more = r.n - r.c;
      chips += `<button class="chip bad" id="gapChip">Need ${more} more ${more === 1 ? 'person' : 'people'}, ${rng(r.s, r.e)}${g.length > 1 ? ` (+${g.length - 1} more ${g.length === 2 ? 'gap' : 'gaps'})` : ''}</button>`;
    }
    if (un) chips += `<button class="chip warn" id="posChip" ${L ? 'disabled' : ''}>${un} ${un === 1 ? 'shift needs' : 'shifts need'} a position</button>`;

    // coverage row + ticks
    let covCells = '';
    const hw = hourW();
    for (let i = 0; i < R.n; i++) {
      const t = R.start + i * STEP, n = need(h, t), c = cov[i].length;
      const cls = !n ? 'closed' : c < n ? 'short' : 'ok';
      const lab = n && (i === 0 || need(h, t - STEP) !== n || cov[i - 1].length !== c || (t - R.start) % 60 === 0);
      covCells += `<button class="${cls} ${selSlot === i ? 'sel' : ''}" data-i="${i}" ${n ? '' : 'tabindex="-1" aria-hidden="true"'} aria-label="${fmt(t)}: ${c} of ${n} working">${lab && hw >= 40 ? c : ''}</button>`;
    }
    const tstep = hw < 45 ? 120 : 60;
    let ticks = '';
    for (let t = R.start; t < R.end; t += tstep)
      ticks += `<span style="grid-column:span ${Math.min(tstep, R.end - t) / 15}">${R.end - t >= tstep || R.end - t >= 60 ? short(t) : ''}</span>`;

    // person rows
    const opens: [number, number][] = h.closed ? [] : h.brk ? [[h.open, h.brk[0]], [h.brk[1], h.close]] : [[h.open, h.close]];
    const bg =
      opens.map(([a, b]) => `<i class="open" style="left:${pct(a)};width:${wid(a, b)}"></i>`).join('') +
      Array.from({ length: span / 60 - 1 }, (_, i) => `<i class="hr" style="left:${pct(R.start + (i + 1) * 60)}"></i>`).join('') +
      (selSlot !== null ? `<i class="mark" style="left:${pct(R.start + selSlot * STEP)}"></i>` : '');
    const shown = peopleIn(wk).filter((p) => p.active || (Wk(wk).shifts[d][p.id] || []).length);
    const rows = shown
      .map((p) => {
        const sh = Wk(wk).shifts[d][p.id] || [];
        const bars = sh
          .map(
            ([a, b, r], k) =>
              `<div class="bar ${r || 'unset'} ${L ? 'ro' : ''}" data-p="${p.id}" data-k="${k}" data-a="${a}" data-b="${b}" style="left:${pct(a)};width:${wid(a, b)}" role="button" tabindex="0" aria-label="${esc(p.name)} ${rng(a, b)} ${r ? POS[r] : 'no position yet'}">${L ? '' : '<i class="h l"></i>'}<span>${r ? '' : '? '}${short(a)}–${short(b)}</span>${L ? '' : '<i class="h r"></i>'}</div>`,
          )
          .join('');
        const hint = !sh.length && !L && p.active ? '<span class="addhint">Tap to add a shift</span>' : '';
        return `<div class="tlrow"><span class="tlname ${p.active ? '' : 'gone'}" title="${esc(p.name)}${p.active ? '' : ' (removed from staff)'}"><span>${esc(p.name)}</span></span><div class="track ${L || !p.active ? 'ro' : ''}" data-p="${p.id}">${bg}${hint}${bars}</div></div>`;
      })
      .join('');

    let info = L ? 'Tap a shift to see its details.' : 'Tap a time in the Working row to see who is on.';
    if (selSlot !== null) {
      const t = R.start + selSlot * STEP, ww = cov[selSlot];
      const who = ww.map((pid) => {
        const x = (Wk(wk).shifts[d][pid] || []).find(([a, b]) => t >= a && t < b);
        return esc(nameOf(pid)) + (x && x[2] ? ` (${POSSHORT[x[2]]})` : '');
      });
      info = `<b>${fmt(t)}</b>: ${who.length ? who.join(', ') : 'nobody working'}.`;
    }
    const touchTip = matchMedia('(hover:none)').matches
      ? '<b>Tap</b> a shift to edit it. <b>Hold</b> it for a moment, then drag to move it, or drag its ends. <b>Tap an empty spot</b> to add a shift.'
      : '<b>Click</b> a shift to edit it. <b>Drag</b> it to move it, or drag its ends. <b>Click an empty spot</b> to add a shift.';

    return `<div class="dayhead"><h2>${DAYS[d]}, ${dshort(date)}</h2></div>
    ${hours}<div class="chips">${chips}</div>
    ${shown.length ? `${!L && prefs.tip !== '1' ? `<div class="tip1"><p>${touchTip}</p><button id="tipOk">Got it</button></div>` : ''}
    <div class="tlbar"><span class="note" style="margin:0">${phone() && !zoom ? 'Whole day' : 'Zoomed in'}</span><button class="linkbtn" id="zoomBtn">${zoom ? 'Show whole day' : 'Zoom in'}</button></div>
    <div class="tlscroll" id="tlscroll"><div class="tlin" style="--hrs:${span / 60};--hourw:${hw}px;--tspan:${tstep / 15}">
      <div class="tlrow"><span class="tlname"></span><div class="ticks" style="${cols}">${ticks}</div></div>
      <div class="tlrow"><span class="tlname cov">Working</span><div class="covrow" style="${cols}">${covCells}</div></div>
      ${rows}
    </div></div>
    <p class="info" id="info">${info}</p>
    <div class="key"><span><i style="background:var(--sp-on)"></i>Food prep</span><span><i style="background:var(--sp-accent)"></i>Food runner</span><span><i style="border:2px dashed var(--sp-muted)"></i>No position yet</span><span><i style="background:var(--sp-bg);border:1px solid var(--sp-line)"></i>Open</span></div>`
      : '<p class="note">Nobody on staff yet. Add people on the Staff page.</p>'}`;
  }

  let covTipTimer: number | undefined;
  function bindDay(L: boolean) {
    const el = must('day'), d = cur, Sd = Wk(wk).shifts[d], dkey = dateOf(wk, d), R = dayRange(wk, d);
    const span = R.end - R.start, snap = (m: number) => Math.round(m / STEP) * STEP;
    const sc = $('tlscroll'), tip = must('dragTip');
    // Open the timeline near the start of opening hours; remember where you scrolled to.
    if (sc) {
      if (tlScroll === null) {
        const h = hoursFor(wk, d);
        const first = h.closed ? R.start : Math.max(R.start, Math.min(SET().prepStart, h.open));
        const inner = sc.querySelector('.track,.covrow');
        tlScroll = inner ? Math.max(0, ((first - R.start) / span) * inner.getBoundingClientRect().width - 8) : 0;
      }
      sc.scrollLeft = tlScroll;
      sc.addEventListener('scroll', () => (tlScroll = sc.scrollLeft), { passive: true });
    }
    all('.bar', el).forEach((b) => {
      const w_ = b.getBoundingClientRect().width;
      if (w_ && w_ < 84) b.classList.add('narrow');
      if (w_ && w_ < 56) {
        const a = +(b.dataset.a || 0), sp_ = b.querySelector('span');
        if (sp_) sp_.textContent = (b.classList.contains('unset') ? '? ' : '') + short(a);
      }
    });
    all('.covrow button:not(.closed)', el).forEach(
      (c) =>
        (c.onclick = () => {
          const i = +(c.dataset.i || 0);
          selSlot = selSlot === i ? null : i;
          render();
          if (selSlot === null) return;
          const nc = root.querySelector(`.covrow button[data-i="${i}"]`), tipEl = must('dragTip');
          if (!nc) return;
          const r = nc.getBoundingClientRect(), t = R.start + i * STEP, ww = coverage(wk, d, R)[i];
          tipEl.textContent = `${fmt(t)}: ${ww.length ? ww.map(nameOf).join(', ') : 'nobody'}`;
          tipEl.style.left = Math.min(Math.max(r.left + r.width / 2, 90), innerWidth - 90) + 'px';
          tipEl.style.top = Math.max(r.top - 6, 40) + 'px';
          tipEl.hidden = false;
          cancel(covTipTimer);
          covTipTimer = later(() => (tipEl.hidden = true), 2600);
        }),
    );
    const tok = $('tipOk');
    if (tok)
      tok.onclick = () => {
        prefs.tip = '1';
        render();
      };
    const zb = $('zoomBtn');
    if (zb)
      zb.onclick = () => {
        zoom = !zoom;
        prefs.zoom = zoom ? '1' : '0';
        tlScroll = null;
        render();
      };
    const gc = $('gapChip');
    if (gc)
      gc.onclick = () => {
        const g0 = gaps(wk, d, R)[0];
        if (!g0 || !sc) return;
        const tr = sc.querySelector('.track,.covrow');
        if (!tr) return;
        const wpx = tr.getBoundingClientRect().width;
        sc.scrollLeft = Math.max(0, ((g0.s - R.start) / span) * wpx - 40);
        selSlot = (g0.s - R.start) / STEP;
        tlScroll = sc.scrollLeft;
        render();
      };
    const pc = $('posChip');
    if (pc)
      pc.onclick = () => {
        posFlow = true;
        const n = nextUnset(d, null);
        if (n) openEdit(n.pid, n.k);
      };
    const hc = $('hoursChange');
    if (hc)
      hc.onclick = () => {
        hoursOpen = true;
        render();
        $('spMode')?.focus();
      };

    const limits = (list: Shift[], k: number, a: number, b: number): [number, number] => {
      let lo = R.start, hi = R.end;
      list.forEach((o, i) => {
        if (i === k) return;
        if (o[1] <= a) lo = Math.max(lo, o[1]);
        if (o[0] >= b) hi = Math.min(hi, o[0]);
      });
      return [lo, hi];
    };
    interface Drag {
      active: boolean; moved: boolean; cancel: boolean; x0: number; y0: number; lastX: number; sl0: number;
      ns: number; ne: number; edge: number; mpp: number; timer?: number;
    }
    all('.bar', el).forEach((bar) => {
      const pid = bar.dataset.p as string, k = +(bar.dataset.k || 0), ro = L;
      let st: Drag | null = null;
      bar.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openEdit(pid, k);
        }
      });
      bar.addEventListener('touchmove', (e) => {
        if (st && st.active) e.preventDefault();
      }, { passive: false });
      bar.addEventListener('contextmenu', (e) => e.preventDefault());
      bar.addEventListener('pointerdown', (ev) => {
        if (ev.button > 0) return;
        ev.stopPropagation();
        const touch = ev.pointerType !== 'mouse';
        if (!touch) ev.preventDefault();
        const list = Sd[pid], v = list[k], [a, b] = v, track = bar.parentElement as HTMLElement;
        const tcl = (ev.target as Element).classList;
        const mode = tcl.contains('l') ? 'l' : tcl.contains('r') ? 'r' : 'move';
        const [lo, hi] = limits(list, k, a, b), tail = v[2] ? ' ' + POSSHORT[v[2]] : '', label = bar.querySelector('span') as HTMLElement;
        const s: Drag = {
          active: false, moved: false, cancel: false, x0: ev.clientX, y0: ev.clientY, lastX: ev.clientX, sl0: sc ? sc.scrollLeft : 0,
          ns: a, ne: b, edge: 0, mpp: span / track.getBoundingClientRect().width,
        };
        st = s;
        try {
          bar.setPointerCapture(ev.pointerId);
        } catch {
          /* not capturable */
        }
        const showTip = () => {
          const r = bar.getBoundingClientRect();
          tip.textContent = rng(s.ns, s.ne);
          tip.style.left = Math.min(Math.max(s.lastX, 80), innerWidth - 80) + 'px';
          tip.style.top = Math.max(r.top - 10, 50) + 'px';
          tip.hidden = false;
        };
        const start = () => {
          if (ro || s.cancel) return;
          s.active = true;
          bar.classList.add('drag');
          try {
            if (typeof navigator.vibrate === 'function') navigator.vibrate(12);
          } catch {
            /* no vibration */
          }
          showTip();
        };
        if (touch) s.timer = later(start, 250);
        const update = () => {
          const dm = snap((s.lastX - s.x0 + (sc ? sc.scrollLeft - s.sl0 : 0)) * s.mpp);
          if (mode === 'move') {
            s.ns = Math.max(lo, Math.min(a + dm, hi - (b - a)));
            s.ne = s.ns + (b - a);
          } else if (mode === 'l') {
            s.ns = Math.max(lo, Math.min(a + dm, b - MINLEN));
            if (s.ns > a && b - s.ns < MINLEN) s.ns = a;
            s.ne = b;
          } else {
            s.ne = Math.min(hi, Math.max(b + dm, a + MINLEN));
            if (s.ne < b && s.ne - a < MINLEN) s.ne = b;
            s.ns = a;
          }
          bar.style.left = ((s.ns - R.start) / span) * 100 + '%';
          bar.style.width = ((s.ne - s.ns) / span) * 100 + '%';
          label.textContent = short(s.ns) + '–' + short(s.ne) + tail;
          showTip();
        };
        const tick = () => {
          if (disposed || st !== s || !s.active || !s.edge || !sc) return;
          sc.scrollLeft += s.edge * 9;
          update();
          requestAnimationFrame(tick);
        };
        const move = (e: PointerEvent) => {
          s.lastX = e.clientX;
          const far = Math.abs(e.clientX - s.x0) > 8 || Math.abs(e.clientY - s.y0) > 8;
          if (!s.active) {
            if (far) {
              s.moved = true;
              if (touch) {
                cancel(s.timer);
                s.cancel = true;
              } else start();
            }
            if (!s.active) return;
          }
          s.moved = s.moved || far;
          update();
          if (sc) {
            const r = sc.getBoundingClientRect(), edge = e.clientX < r.left + 40 ? -1 : e.clientX > r.right - 40 ? 1 : 0;
            if (edge && !s.edge) {
              s.edge = edge;
              requestAnimationFrame(tick);
            } else s.edge = edge;
          }
        };
        const end = (e: PointerEvent) => {
          bar.removeEventListener('pointermove', move);
          bar.removeEventListener('pointerup', end);
          bar.removeEventListener('pointercancel', end);
          cancel(s.timer);
          tip.hidden = true;
          bar.classList.remove('drag');
          st = null;
          if (s.active && (s.ns !== a || s.ne !== b)) {
            v[0] = s.ns;
            v[1] = s.ne;
            saveWeek(wk);
            render();
            return;
          }
          if (e.type === 'pointerup' && !s.moved && !s.cancel) {
            swallowNextClick();
            openEdit(pid, k);
            return;
          }
          if (s.active) render();
        };
        bar.addEventListener('pointermove', move);
        bar.addEventListener('pointerup', end);
        bar.addEventListener('pointercancel', end);
      });
    });
    all('.track:not(.ro)', el).forEach((track) => {
      let down: { x: number; y: number } | null = null;
      track.addEventListener('pointerdown', (e) => {
        if ((e.target as Element).closest('.bar')) return;
        down = { x: e.clientX, y: e.clientY };
      });
      track.addEventListener('pointercancel', () => (down = null));
      track.addEventListener('pointerup', (e) => {
        if (!down || (e.target as Element).closest('.bar')) return;
        const moved = Math.abs(e.clientX - down.x) > 8 || Math.abs(e.clientY - down.y) > 8;
        down = null;
        if (moved) return;
        const rect = track.getBoundingClientRect(), t = Math.floor((R.start + ((e.clientX - rect.left) / rect.width) * span) / STEP) * STEP;
        const pid = track.dataset.p as string, list = Sd[pid] || [];
        if (list.some(([a, b]) => t >= a && t < b)) return;
        const [lo, hi] = limits(list, -1, t, t);
        let ns = t;
        const ne = Math.min(t + 180, hi);
        if (ne - ns < MINLEN) ns = Math.max(lo, ne - MINLEN);
        if (ne - ns < MINLEN) return;
        (Sd[pid] = list).push([ns, ne]);
        saveWeek(wk);
        render();
        swallowNextClick();
        openEdit(pid, list.length - 1);
      });
    });

    if (L) return;
    const spm = $<HTMLSelectElement>('spMode');
    if (spm)
      spm.onchange = async () => {
        const v = spm.value, base = SET().days[d];
        if (v === 'closed') {
          const n = Object.values(Sd).reduce((a, l) => a + l.length, 0);
          if (n && (await ask(`${DAYS[d]} has ${n} ${n === 1 ? 'shift' : 'shifts'}. Remove ${n === 1 ? 'it' : 'them'} too?`, { ok: 'Remove shifts', cancel: 'Keep them' }))) {
            Object.keys(Sd).forEach((k) => delete Sd[k]);
            saveWeek(wk);
          }
        }
        if (v === 'normal') delete SP()[dkey];
        else if (v === 'closed') SP()[dkey] = { closed: true };
        else {
          const s: SpecialDay = { open: base.open, close: base.close };
          if (base.brk) s.brk = base.brk.slice();
          SP()[dkey] = s;
        }
        saveConfig();
        tlScroll = null;
        render();
      };
    const so = $<HTMLInputElement>('spOpen'), scl = $<HTMLInputElement>('spClose');
    if (so && scl)
      commitTime([so, scl], () => {
        const o = fromHM(so.value), c = fromHM(scl.value), err = must('spErr');
        if (o == null || c == null) return;
        if (c <= o) {
          err.textContent = 'Closing time has to be after opening time.';
          return;
        }
        err.textContent = '';
        const old = SP()[dkey];
        const s: SpecialDay = { open: o, close: c };
        if (old && !old.closed && old.brk) s.brk = old.brk;
        SP()[dkey] = s;
        saveConfig();
        afterTap(render);
      });
  }

  /* ---------- week at a glance ---------- */
  function weekHTML(L: boolean): string {
    const m = parse(wk), p = prevSaved(wk);
    let days = '';
    for (let d = 0; d < 7; d++) {
      const h = hoursFor(wk, d), g = gaps(wk, d), ok = !g.length;
      const people = peopleIn(wk)
        .map((pp) => ({ pp, sh: shifts(wk, d, pp.id) }))
        .filter((o) => o.sh.length)
        .sort((a, b) => a.sh[0][0] - b.sh[0][0]);
      const nchg = people.filter((o) => changed(d, o.pp.id)).length;
      const sum = h.closed ? 'Closed' : `${people.length} ${people.length === 1 ? 'person' : 'people'} · ${ok ? 'covered' : 'short'}${nchg ? ` · ${nchg} changed` : ''}`;
      const list = people.length
        ? `<ul>${people
            .map(
              (o) =>
                `<li class="${changed(d, o.pp.id) ? 'chg' : ''}"><span class="n">${esc(o.pp.name)}</span><span class="t">${o.sh
                  .map((x) => rng(x[0], x[1]) + (x[2] ? `<span class="tagp ${x[2]}">${POSSHORT[x[2]]}</span>` : ''))
                  .join('<br>')}</span></li>`,
            )
            .join('')}</ul>`
        : `<p class="none">${h.closed ? 'Closed' : 'Nobody scheduled'}</p>`;
      days += `<details class="dayblock ${d === cur ? 'cur' : ''}"><summary><span class="dn">${SHORT[d]} ${addDays(m, d).getDate()}</span><span class="ds">${sum}</span><span class="dot ${h.closed ? 'closed' : ok ? 'ok' : ''}" aria-hidden="true">${h.closed ? '–' : ok ? '✓' : '!'}</span></summary>${list}<button class="ghost go" data-d="${d}">Open ${DAYS[d]}</button></details>`;
    }
    const tot = peopleIn(wk)
      .map((pp) => {
        let t = 0;
        for (let d = 0; d < 7; d++) t += hoursOf(shifts(wk, d, pp.id));
        return { pp, t };
      })
      .filter((o) => o.t);
    return `<section class="week"><h2>Week at a glance</h2>
    <div class="daylist">${days}</div>
    ${p ? `<p class="legend"><i></i>Changed from the week of ${wrange(p)}</p>` : ''}
    <details class="more"><summary>Hours, text copy and more</summary>
      ${tot.length ? `<ul class="hrs">${tot.map((o) => `<li><span>${esc(o.pp.name)}</span><b>${hstr(o.t)}</b></li>`).join('')}</ul>` : ''}
      <div class="choices"><button class="ghost" id="copyTxt">Copy as text</button>${L ? '' : '<button class="danger" id="delWeek">Delete this week</button>'}</div>
    </details></section>`;
  }
  function bindWeek(L: boolean) {
    must('copyPic').onclick = () => void showPicture();
    must('copyTxt').onclick = (e) => copyText(weekText(), e.currentTarget as HTMLElement, 'Copy as text');
    all('.dayblock .go').forEach(
      (b) =>
        (b.onclick = () => {
          goDay(+(b.dataset.d || 0));
          root.querySelector('.tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }),
    );
    if (L) return;
    must('delWeek').onclick = async () => {
      if (await ask(`Delete the schedule for ${wrange(wk)}? This can't be undone.`, { ok: 'Delete', danger: true })) {
        delete db().weeks[wk];
        saveWeek(wk);
        render();
      }
    };
  }

  /* ---------- tap safety ---------- */
  // On phones the browser sends a click right after a tap ends. When that tap opened the editor,
  // the click would land on the sheet that just appeared. Swallow that one click.
  let swallowUntil = 0;
  const swallowNextClick = () => (swallowUntil = performance.now() + 450);
  document.addEventListener('click', (e) => {
    if (performance.now() < swallowUntil) {
      swallowUntil = 0;
      e.stopPropagation();
      e.preventDefault();
    }
  }, { capture: true, signal: ac.signal });
  // Run fn after the current tap finishes (so a redraw doesn't eat the button being tapped).
  let ptrDown = false;
  document.addEventListener('pointerdown', () => (ptrDown = true), { capture: true, signal: ac.signal });
  document.addEventListener('pointercancel', () => (ptrDown = false), { capture: true, signal: ac.signal });
  document.addEventListener('pointerup', () => (ptrDown = false), { capture: true, signal: ac.signal });
  function afterTap(fn: () => void) {
    if (!ptrDown) {
      fn();
      return;
    }
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      document.removeEventListener('pointerup', h, true);
      later(fn, 0);
    };
    const h = () => go();
    document.addEventListener('pointerup', h, { capture: true, signal: ac.signal });
    later(go, 1500);
  }

  /* ---------- shift editor (bottom sheet) ---------- */
  function closeEdit() {
    const b = $('edit');
    if (b) b.hidden = true;
    posFlow = false;
  }
  // Next shift on this day that has no position yet (in timeline order), skipping the one being edited.
  function nextUnset(d: number, skip: { pid: string; k: number } | null) {
    const out: { pid: string; k: number; s: number; o: number }[] = [];
    const day = Wk(wk).shifts[d];
    Object.keys(day).forEach((pid) =>
      (day[pid] || []).forEach((x, k) => {
        if (!x[2] && !(skip && skip.pid === pid && skip.k === k)) out.push({ pid, k, s: x[0], o: P().findIndex((p) => p.id === pid) });
      }),
    );
    out.sort((a, b) => a.o - b.o || a.s - b.s);
    return out[0] || null;
  }
  const dayShifts = (d: number) => Wk(wk).shifts[d];
  function openEdit(pid: string, k: number) {
    const box = must('edit'), el = must('editBox'), d = cur;
    const list = Wk(wk).shifts[d][pid] || [], v = list[k];
    if (!v) {
      closeEdit();
      return;
    }
    const L = !!Wk(wk).locked, R = dayRange(wk, d);
    const opts = (from: number, to: number, sel: number) => {
      let o = '';
      for (let t = from; t <= to; t += STEP) o += `<option value="${t}" ${t === sel ? 'selected' : ''}>${fmt(t)}</option>`;
      return o;
    };
    let lo = R.start, hi = R.end;
    list.forEach((o, i) => {
      if (i === k) return;
      if (o[1] <= v[0]) lo = Math.max(lo, o[1]);
      if (o[0] >= v[1]) hi = Math.min(hi, o[0]);
    });
    const dis = L ? 'disabled' : '';
    el.innerHTML = `<div class="grab" aria-hidden="true"></div>
    <h3 id="editTitle" tabindex="-1" style="outline:none">${esc(nameOf(pid))}${isActive(pid) ? '' : ' <small style="color:var(--sp-muted);font-weight:600">(removed from staff)</small>'}</h3>
    <p class="when">${DAYS[d]}, ${dshort(addDays(parse(wk), d))} · ${rng(v[0], v[1])} · ${hstr((v[1] - v[0]) / 60)}</p>
    <div class="poschoice" role="group" aria-label="Position">${(Object.keys(POS) as Pos[]).map((r) => `<button data-r="${r}" aria-pressed="${v[2] === r}" ${dis}>${POS[r]}</button>`).join('')}</div>
    <div class="stepper"><span class="lbl">Start</span><button data-s="0" data-dir="-1" aria-label="Start 15 minutes earlier" ${dis}>−</button><select id="eS" aria-label="Start time" ${dis}>${opts(Math.min(lo, v[0]), Math.max(v[1] - MINLEN, v[0]), v[0])}</select><button data-s="0" data-dir="1" aria-label="Start 15 minutes later" ${dis}>+</button></div>
    <div class="stepper"><span class="lbl">End</span><button data-s="1" data-dir="-1" aria-label="End 15 minutes earlier" ${dis}>−</button><select id="eE" aria-label="End time" ${dis}>${opts(Math.min(v[0] + MINLEN, v[1]), Math.max(hi, v[1]), v[1])}</select><button data-s="1" data-dir="1" aria-label="End 15 minutes later" ${dis}>+</button></div>
    ${!L && nextUnset(d, { pid, k }) ? `<button class="ghost nextbtn" id="eNext">Next shift without a position (${unsetCount(wk, d) - (v[2] ? 0 : 1)} left) →</button>` : ''}
    <div class="row">${L ? '' : '<button class="textdanger" id="eDel">Remove shift</button>'}<button class="primary" id="eDone">Done</button></div>`;
    box.hidden = false;
    box.onclick = (e) => {
      if (e.target === box) closeEdit();
    };
    must('eDone').onclick = closeEdit;
    later(() => {
      try {
        $('editTitle')?.focus({ preventScroll: true });
      } catch {
        /* gone */
      }
    }, 30);
    if (L) return;
    const apply = () => {
      saveWeek(wk);
      render();
      openEdit(pid, k);
    };
    all('.poschoice button', el).forEach(
      (b) =>
        (b.onclick = () => {
          if (v[2] === b.dataset.r) {
            v.length = 2; // tap the chosen one again to clear it
            apply();
            return;
          }
          v[2] = b.dataset.r as Pos;
          saveWeek(wk);
          const n = posFlow ? nextUnset(d, null) : null;
          render();
          if (n) {
            openEdit(n.pid, n.k);
            posFlow = true;
          } else closeEdit();
        }),
    );
    const nx = $('eNext');
    if (nx)
      nx.onclick = () => {
        const n = nextUnset(d, { pid, k });
        if (n) {
          posFlow = true;
          openEdit(n.pid, n.k);
          posFlow = true;
        }
      };
    all('.stepper button', el).forEach(
      (b) =>
        (b.onclick = () => {
          const i = +(b.dataset.s || 0) as 0 | 1, n = v[i] + +(b.dataset.dir || 0) * STEP;
          if (i === 0 && (n < lo || n > v[1] - MINLEN)) return;
          if (i === 1 && (n > hi || n < v[0] + MINLEN)) return;
          v[i] = n;
          apply();
        }),
    );
    const eS = must<HTMLSelectElement>('eS'), eE = must<HTMLSelectElement>('eE');
    eS.onchange = () => {
      v[0] = +eS.value;
      apply();
    };
    eE.onchange = () => {
      v[1] = +eE.value;
      apply();
    };
    must('eDel').onclick = async () => {
      if (!(await ask(`Remove ${nameOf(pid)}'s ${rng(v[0], v[1])} shift?`, { ok: 'Remove', danger: true }))) return;
      list.splice(k, 1);
      if (!list.length) delete dayShifts(d)[pid];
      saveWeek(wk);
      closeEdit();
      render();
    };
  }
  let resizeTimer: number | undefined;
  window.addEventListener('resize', () => {
    cancel(resizeTimer);
    resizeTimer = later(() => {
      if (DB && view === 'schedule' && !root.querySelector('.bar.drag')) {
        tlScroll = null;
        render();
      }
    }, 250);
  }, sig);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !must('edit').hidden && must('ask').hidden) closeEdit();
  }, sig);
  // A new week may have started while the page sat in the background.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !DB) return;
    const t = iso(mondayOf(today()));
    if (t !== THIS) {
      if (wk === THIS) {
        wk = t;
        tlScroll = null;
      }
      THIS = t;
      closeEdit();
      render();
    }
  }, sig);
  window.addEventListener('beforeunload', (e) => {
    if (settingsDirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  }, sig);

  /* ---------- copy: text and picture ---------- */
  function copyText(txt: string, btn: HTMLElement, label: string) {
    const done = (m: string) => {
      btn.textContent = m;
      later(() => (btn.textContent = label), 1800);
    };
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject(new Error('no clipboard')))
      .then(() => done('Copied'))
      .catch(() => {
        const ta = document.createElement('textarea');
        ta.value = txt;
        root.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
          done('Copied');
        } catch {
          done('Copy failed');
        }
        ta.remove();
      });
  }
  function weekText(): string {
    let txt = `*Shift schedule, ${wrange(wk)}*\n`;
    const closed = [0, 1, 2, 3, 4, 5, 6].filter((d) => hoursFor(wk, d).closed);
    if (closed.length) txt += `Closed: ${closed.map((d) => SHORT[d]).join(', ')}\n`;
    peopleIn(wk).forEach((p) => {
      const groups: { t: string; d: string[] }[] = [];
      for (let d = 0; d < 7; d++) {
        const sh = shifts(wk, d, p.id);
        if (!sh.length) continue;
        const t = sh.map(shiftTxt).join(', ');
        const g = groups.find((x) => x.t === t);
        if (g) g.d.push(SHORT[d]);
        else groups.push({ t, d: [SHORT[d]] });
      }
      if (groups.length) txt += `\n*${p.name}*\n` + groups.map((g) => `${g.d.join(', ')}: ${g.t}`).join('\n') + '\n';
    });
    return txt;
  }
  async function tableImage(): Promise<HTMLCanvasElement> {
    try {
      await document.fonts.ready;
    } catch {
      /* fonts not ready */
    }
    const css = getComputedStyle(root);
    const col = (name: string, fb: string) => css.getPropertyValue(name).trim() || fb;
    const INK = col('--ink', '#1f1e1c'), HEAD = col('--surface', '#f7f7f5'), LINE = col('--line', '#e4e2dc'), DIM = col('--muted', '#6b6963'), PAPER = col('--bg', '#ffffff');
    const m = parse(wk), S2 = 2;
    const head = ['', ...SHORT.map((x, d) => x + ' ' + addDays(m, d).getDate())];
    const rows: string[][][] = peopleIn(wk).map((p) => [
      [p.name],
      ...[0, 1, 2, 3, 4, 5, 6].map((d) => {
        const sh = shifts(wk, d, p.id);
        return sh.length ? sh.map(shiftTxt) : [hoursFor(wk, d).closed ? 'closed' : '–'];
      }),
    ]);
    const fam = css.fontFamily || 'system-ui, sans-serif';
    const FN = '15px ' + fam, FB = '700 15px ' + fam, FT = '700 20px ' + fam;
    const c = document.createElement('canvas'), x = c.getContext('2d') as CanvasRenderingContext2D;
    const padX = 12, padY = 9, lh = 20, titleH = 48;
    const widths = head.map((hd, ci) => {
      x.font = FB;
      let w = x.measureText(hd).width;
      rows.forEach((r) =>
        r[ci].forEach((t) => {
          x.font = ci === 0 ? FB : FN;
          w = Math.max(w, x.measureText(t).width);
        }),
      );
      return Math.ceil(w) + padX * 2;
    });
    const headH = lh + padY * 2, rh = rows.map((r) => Math.max(...r.map((l) => l.length)) * lh + padY * 2);
    const W2 = widths.reduce((a, b) => a + b, 0), H2 = titleH + headH + rh.reduce((a, b) => a + b, 0);
    c.width = W2 * S2;
    c.height = H2 * S2;
    x.scale(S2, S2);
    x.fillStyle = PAPER;
    x.fillRect(0, 0, W2, H2);
    x.fillStyle = INK;
    x.font = FT;
    x.textBaseline = 'middle';
    x.fillText('Shift schedule, ' + wrange(wk), padX, titleH / 2);
    let y = titleH;
    x.fillStyle = HEAD;
    x.fillRect(0, y, W2, headH);
    let cx = 0;
    x.font = FB;
    x.fillStyle = INK;
    head.forEach((hd, ci) => {
      x.fillText(hd, cx + padX, y + headH / 2);
      cx += widths[ci];
    });
    y += headH;
    rows.forEach((r, ri) => {
      x.strokeStyle = LINE;
      x.lineWidth = 1;
      x.beginPath();
      x.moveTo(0, y + 0.5);
      x.lineTo(W2, y + 0.5);
      x.stroke();
      cx = 0;
      r.forEach((lines, ci) => {
        x.font = ci === 0 ? FB : FN;
        x.fillStyle = lines[0] === '–' || lines[0] === 'closed' ? DIM : INK;
        lines.forEach((t, li) => x.fillText(t, cx + padX, y + padY + lh * li + lh / 2));
        cx += widths[ci];
      });
      y += rh[ri];
    });
    cx = 0;
    x.strokeStyle = LINE;
    widths.slice(0, -1).forEach((w) => {
      cx += w;
      x.beginPath();
      x.moveTo(cx + 0.5, titleH);
      x.lineTo(cx + 0.5, H2);
      x.stroke();
    });
    return c;
  }
  const toBlob = (c: HTMLCanvasElement) =>
    new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('no picture'))), 'image/png'));
  let shotBlob: Blob | null = null;
  async function showPicture() {
    const blobP = tableImage().then(toBlob);
    let copied: Promise<boolean>;
    try {
      copied = navigator.clipboard.write([new ClipboardItem({ 'image/png': blobP })]).then(
        () => true,
        () => false,
      );
    } catch {
      copied = Promise.resolve(false);
    }
    const c = await tableImage();
    if (disposed) return;
    const img = must<HTMLImageElement>('shotImg'), msg = must('shotMsg');
    img.src = c.toDataURL('image/png');
    img.style.width = c.width / 2 + 'px';
    shotBlob = await toBlob(c);
    if (disposed) return;
    const file = new File([shotBlob], 'shift-schedule-' + wk + '.png', { type: 'image/png' });
    must('shotShare').hidden = !(typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] }));
    msg.textContent = 'On a phone, press and hold the picture to save or share it.';
    must('shot').hidden = false;
    if ((await copied) && !disposed) msg.textContent = 'Copied. Paste it into WhatsApp, or press and hold the picture to save it.';
  }
  must('shotCopy').onclick = async () => {
    const m = must('shotMsg');
    try {
      if (!shotBlob) throw new Error('no picture');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': shotBlob })]);
      m.textContent = 'Copied. Paste it into WhatsApp.';
    } catch {
      m.textContent = "This browser won't copy pictures. Press and hold (or right-click) the picture to copy or save it.";
    }
  };
  must('shotShare').onclick = async () => {
    if (!shotBlob) return;
    try {
      await navigator.share({ files: [new File([shotBlob], 'shift-schedule-' + wk + '.png', { type: 'image/png' })], title: 'Shift schedule ' + wrange(wk) });
    } catch {
      /* cancelled */
    }
  };
  must('shotClose').onclick = () => (must('shot').hidden = true);
  must('shot').onclick = (e) => {
    if ((e.target as HTMLElement).id === 'shot') must('shot').hidden = true;
  };

  /* ---------- render: staff ---------- */
  function renderStaff() {
    const main = must('main');
    const act = P().filter((p) => p.active), gone = P().filter((p) => !p.active);
    main.innerHTML = `<section class="card"><h2>Staff</h2>
    <p class="sub">Change a name by typing over it. The order here is the order on the schedule.</p>
    <div id="staffList">${
      act
        .map(
          (p, i) => `<div class="staffrow">
      <input type="text" value="${esc(p.name)}" data-id="${p.id}" aria-label="Name">
      <button class="sq" data-up="${p.id}" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(p.name)} up">↑</button>
      <button class="sq" data-down="${p.id}" ${i === act.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(p.name)} down">↓</button>
      <button class="iconbtn" data-rm="${p.id}" aria-label="Remove ${esc(p.name)}" title="Remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg></button></div>`,
        )
        .join('') || '<p class="note">No staff yet.</p>'
    }</div>
    <div class="addrow"><input type="text" id="newName" placeholder="New person's name" aria-label="New person's name"><button class="primary" id="addP">Add person</button></div>
    <div class="err" id="staffErr"></div></section>
    ${
      gone.length
        ? `<section class="card"><h2>Removed</h2><p class="sub">They still show in the weeks they worked, but not in new weeks.</p>
      ${gone.map((p) => `<div class="staffrow"><span style="flex:1">${esc(p.name)}</span><button class="ghost" data-restore="${p.id}">Add back</button></div>`).join('')}</section>`
        : ''
    }`;
    const err = must('staffErr');
    const dup = (n: string, id?: string) => P().some((p) => p.id !== id && p.name.trim().toLowerCase() === n.trim().toLowerCase());
    all<HTMLInputElement>('input[data-id]', main).forEach((inp) => {
      inp.onkeydown = (e) => {
        if (e.key === 'Enter') inp.blur();
      };
      inp.onchange = () => {
        const n = inp.value.trim(), p = P().find((x) => x.id === inp.dataset.id);
        if (!p) return;
        if (!n) {
          err.textContent = "A name can't be empty.";
          inp.value = p.name;
          return;
        }
        if (dup(n, p.id)) {
          err.textContent = `There's already someone called ${n}.`;
          inp.value = p.name;
          return;
        }
        err.textContent = '';
        p.name = n;
        inp.defaultValue = n;
        saveConfig();
      };
    });
    const move = (id: string, dir: number) => {
      const L = P(), i = L.findIndex((p) => p.id === id);
      let j = i + dir;
      while (j >= 0 && j < L.length && !L[j].active) j += dir;
      if (j < 0 || j >= L.length) return;
      [L[i], L[j]] = [L[j], L[i]];
      saveConfig();
      renderStaff();
    };
    all('[data-up]', main).forEach((b) => (b.onclick = () => move(b.dataset.up as string, -1)));
    all('[data-down]', main).forEach((b) => (b.onclick = () => move(b.dataset.down as string, 1)));
    all('[data-rm]', main).forEach(
      (b) =>
        (b.onclick = async () => {
          const p = P().find((x) => x.id === b.dataset.rm);
          if (!p) return;
          if (!(await ask(`Remove ${p.name}? They stay in this week and past weeks. Their shifts in later weeks are taken off, except in locked weeks.`, { ok: 'Remove', danger: true }))) return;
          p.active = false;
          Object.keys(db().weeks)
            .filter((id) => id > THIS && !db().weeks[id].locked)
            .forEach((id) => {
              let hit = false;
              db().weeks[id].shifts.forEach((day) => {
                if (day[p.id]) {
                  delete day[p.id];
                  hit = true;
                }
              });
              if (hit) saveWeek(id);
            });
          saveConfig();
          renderStaff();
        }),
    );
    all('[data-restore]', main).forEach(
      (b) =>
        (b.onclick = () => {
          const p = P().find((x) => x.id === b.dataset.restore);
          if (p) p.active = true;
          saveConfig();
          renderStaff();
        }),
    );
    const add = () => {
      const inp = must<HTMLInputElement>('newName'), n = inp.value.trim();
      if (!n) return;
      const back = P().find((p) => !p.active && p.name.trim().toLowerCase() === n.toLowerCase());
      if (back) {
        back.active = true;
        saveConfig();
        renderStaff();
        must('staffErr').textContent = `${back.name} was added back.`;
        return;
      }
      if (dup(n)) {
        err.textContent = `There's already someone called ${n}.`;
        return;
      }
      err.textContent = '';
      P().push({ id: newPersonId(), name: n, active: true });
      saveConfig();
      renderStaff();
      must('newName').focus();
    };
    must('addP').onclick = add;
    must('newName').onkeydown = (e) => {
      if (e.key === 'Enter') add();
    };
  }

  /* ---------- render: settings (edits a draft; nothing changes until Save) ---------- */
  let draft: Settings | null = null, savedMsg = '';
  function settingsDirty(): boolean {
    return !!draft && !!DB && JSON.stringify(draft) !== JSON.stringify(SET());
  }
  function validate(S: Settings): string {
    for (let d = 0; d < 7; d++) {
      const h = S.days[d];
      if (h.close <= h.open) return `${DAYS[d]}: closing time has to be after opening time.`;
      if (h.brk && !(h.brk[0] > h.open && h.brk[1] > h.brk[0] && h.brk[1] < h.close)) return `${DAYS[d]}: the break has to be inside opening hours.`;
    }
    if (S.secondAt < S.prepStart) return 'The second person has to start at or after the first.';
    const early = Math.min(...S.days.map((h) => h.open));
    if (S.prepStart > early) return `The first person has to start at or before opening (${fmt(early)}).`;
    return '';
  }
  function renderSettings() {
    if (!draft) draft = clone(SET());
    const main = must('main'), S = draft, dirty = settingsDirty();
    const rows = S.days
      .map(
        (h, d) => `
    <span class="dname"><b>${DAYS[d]}</b></span>
    <input type="time" step="900" data-d="${d}" data-f="open" value="${toHM(h.open)}" aria-label="${DAYS[d]} opens">
    <input type="time" step="900" data-d="${d}" data-f="close" value="${toHM(h.close)}" aria-label="${DAYS[d]} closes">
    <span class="brk brkcell"><label><input type="checkbox" data-d="${d}" data-f="brk" ${h.brk ? 'checked' : ''}> Break</label>
      ${h.brk ? `<input type="time" step="900" data-d="${d}" data-f="b0" value="${toHM(h.brk[0])}" aria-label="${DAYS[d]} break starts"> to <input type="time" step="900" data-d="${d}" data-f="b1" value="${toHM(h.brk[1])}" aria-label="${DAYS[d]} break ends">` : ''}</span>`,
      )
      .join('');
    const bar = `<div class="savebar ${dirty ? 'dirty' : ''}">
      <span>${dirty ? '<b>You have unsaved changes.</b>' : savedMsg || 'No changes.'}</span>
      <span class="choices"><button class="ghost" id="discard" ${dirty ? '' : 'disabled'}>Discard changes</button><button class="primary" id="saveSettings" ${dirty ? '' : 'disabled'}>Save settings</button></span>
    </div><div class="err" id="sErr"></div>`;
    main.innerHTML = `<section class="card"><h2>Opening hours</h2>
      <p class="sub">Normal hours for every week. To change one date only (a holiday, say), use the hours menu on that day in the schedule.</p>
      <div class="hgrid"><span class="hd">Day</span><span class="hd">Opens</span><span class="hd">Closes</span><span class="hd brkhd">Break (closed between)</span>${rows}</div></section>
    <section class="card"><h2>Staffing rules</h2>
      <p class="sub">These decide when the Working row on the timeline turns red.</p>
      <div class="field"><label for="prepStart">Before opening, first person starts at</label><input type="time" step="900" id="prepStart" value="${toHM(S.prepStart)}"></div>
      <div class="field"><label for="secondAt">Second person starts at</label><input type="time" step="900" id="secondAt" value="${toHM(S.secondAt)}"></div>
      <div class="field"><label for="minStaff">People you need while open</label><select id="minStaff">${[1, 2, 3, 4, 5, 6].map((n) => `<option ${n === S.minStaff ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    </section>${bar}
    <section class="card"><h2>Move your data</h2>
      <p class="sub">To move everything (staff, settings and all weeks) to another device or to your website: tap Copy all data here, then on the other one paste it below and tap Replace.</p>
      <div class="choices"><button class="ghost" id="dataCopy">Copy all data</button></div>
      <p class="sub" style="margin:14px 0 6px">Paste data from another device</p>
      <textarea class="data" id="dataIn" aria-label="Paste data here" placeholder="Paste here"></textarea>
      <div class="choices" style="margin-top:8px"><button class="danger" id="dataUse">Use pasted data</button></div>
      <div class="err" id="dataErr"></div></section>`;
    const updBar = () => {
      const b = main.querySelector('.savebar'), dty = settingsDirty();
      if (!b) return;
      b.classList.toggle('dirty', dty);
      const sp = b.querySelector('span');
      if (sp) sp.innerHTML = dty ? '<b>You have unsaved changes.</b>' : savedMsg || 'No changes.';
      must<HTMLButtonElement>('discard').disabled = !dty;
      must<HTMLButtonElement>('saveSettings').disabled = !dty;
      must('sErr').textContent = '';
    };
    const touch = () => {
      savedMsg = '';
      updBar();
    };
    all<HTMLInputElement>('.hgrid input[type=checkbox]', main).forEach(
      (inp) =>
        (inp.onchange = () => {
          const h = S.days[+(inp.dataset.d || 0)];
          // Default break: 2pm-5pm, kept inside opening hours
          h.brk = inp.checked ? [Math.max(h.open + 15, Math.min(840, h.close - 30)), Math.min(Math.max(h.open + 30, 1020), h.close - 15)] : null;
          savedMsg = '';
          renderSettings();
        }),
    );
    commitTime(all<HTMLInputElement>('.hgrid input[type=time]', main), (inp) => {
      const d = +(inp.dataset.d || 0), f = inp.dataset.f, h = S.days[d], v = fromHM(inp.value);
      if (v == null) return;
      if (f === 'open') h.open = v;
      else if (f === 'close') h.close = v;
      else if (h.brk) {
        if (f === 'b0') h.brk[0] = v;
        else h.brk[1] = v;
      }
      inp.defaultValue = inp.value;
      touch();
    });
    commitTime([must<HTMLInputElement>('prepStart')], (inp) => {
      const v = fromHM(inp.value);
      if (v != null) {
        S.prepStart = v;
        inp.defaultValue = inp.value;
        touch();
      }
    });
    commitTime([must<HTMLInputElement>('secondAt')], (inp) => {
      const v = fromHM(inp.value);
      if (v != null) {
        S.secondAt = v;
        inp.defaultValue = inp.value;
        touch();
      }
    });
    const ms = must<HTMLSelectElement>('minStaff');
    ms.onchange = () => {
      S.minStaff = +ms.value;
      touch();
    };
    must('dataCopy').onclick = (e) =>
      copyText(JSON.stringify({ app: 'shift-planner', v: 1, config: db().config, weeks: db().weeks }), e.currentTarget as HTMLElement, 'Copy all data');
    must('dataUse').onclick = async () => {
      const err = must('dataErr'), dataIn = must<HTMLTextAreaElement>('dataIn');
      const bad = "That doesn't look like copied planner data. Copy it again and paste the whole thing.";
      // "Add" codes carry only weeks, with people by name. They add or replace those weeks and leave everything else alone.
      let raw: { add?: unknown; weeks?: Record<string, { shifts?: unknown }> } | null = null;
      try {
        raw = JSON.parse(dataIn.value.trim());
      } catch {
        /* not JSON */
      }
      if (raw && raw.add === true && raw.weeks && typeof raw.weeks === 'object') {
        const rw = raw.weeks;
        const ids = Object.keys(rw).filter((id) => /^\d{4}-\d{2}-\d{2}$/.test(id) && rw[id] && Array.isArray(rw[id].shifts));
        if (!ids.length) {
          err.textContent = bad;
          return;
        }
        const daysOf = (id: string) => rw[id].shifts as (Record<string, unknown> | null)[];
        const names = new Set<string>();
        ids.forEach((id) => daysOf(id).forEach((day) => Object.keys(day || {}).forEach((n) => names.add(n.trim()))));
        const existing = ids.filter((id) => db().weeks[id]);
        if (!(await ask(`Add ${ids.map(wrange).join(', ')} (${names.size} people)?${existing.length ? " This replaces what's saved for " + (existing.length === 1 ? 'that week' : 'those weeks') + '.' : ''} Nothing else changes.`, { ok: 'Add' }))) return;
        const idOf = (n: string) => {
          const k = n.trim().toLowerCase();
          let p = P().find((x) => x.name.trim().toLowerCase() === k);
          if (!p) {
            p = { id: newPersonId(), name: n.trim(), active: true };
            P().push(p);
          } else if (!p.active) p.active = true;
          return p.id;
        };
        ids.forEach((id) => {
          const w = emptyWeek();
          daysOf(id).slice(0, 7).forEach((day, d) =>
            Object.entries(day || {}).forEach(([n, l]) => {
              if (Array.isArray(l) && l.length) w.shifts[d][idOf(n)] = l as Shift[];
            }),
          );
          const n_ = normalizeDB({ config: db().config, weeks: { [id]: w } });
          if (n_) db().weeks[id] = n_.weeks[id];
          saveWeek(id);
        });
        saveConfig();
        wk = ids[0];
        cur = 0;
        dataIn.value = '';
        err.textContent = '';
        savedMsg = 'Week added ✓';
        draft = null;
        view = 'schedule';
        tlScroll = null;
        render();
        window.scrollTo(0, 0);
        return;
      }
      let j: PlannerDB | null = null;
      try {
        j = normalizeDB(JSON.parse(dataIn.value.trim()));
      } catch {
        j = null;
      }
      if (!j || !j.config.people.length) {
        err.textContent = bad;
        return;
      }
      const n = Object.keys(j.weeks).length;
      if (!(await ask(`Replace everything here with the pasted data (${j.config.people.length} staff, ${n} ${n === 1 ? 'week' : 'weeks'})? What's here now will be lost.`, { ok: 'Replace', danger: true }))) return;
      replaceAll(j, Object.keys(db().weeks));
      draft = null;
      savedMsg = 'Data replaced ✓';
      err.textContent = '';
      renderSettings();
    };
    must('discard').onclick = () => {
      draft = null;
      savedMsg = 'Changes discarded.';
      renderSettings();
    };
    must('saveSettings').onclick = () => {
      const msg = validate(S);
      if (msg) {
        must('sErr').textContent = msg;
        return;
      }
      db().config.settings = clone(S);
      saveConfig();
      draft = null;
      savedMsg = 'Settings saved ✓';
      renderSettings();
    };
  }
  // Ask before leaving the Settings page with unsaved changes.
  async function leaveSettingsOk(): Promise<boolean> {
    if (view !== 'settings') return true;
    if (settingsDirty() && !(await ask('You have unsaved settings. Leave without saving?', { ok: 'Leave without saving', cancel: 'Stay' }))) return false;
    draft = null;
    return true;
  }

  /* ---------- start ---------- */
  if (keptSettings) {
    draft = keptSettings;
    keptSettings = null;
    view = 'settings';
  }
  const unConfig = io.watchConfig((c) => {
    rawConfig = c;
    onData();
  });
  const unWeeks = io.watchWeeks((w) => {
    rawWeeks = w;
    onData();
  });

  return () => {
    keptSettings = settingsDirty() ? draft : null;
    disposed = true;
    unConfig();
    unWeeks();
    ac.abort();
    clearInterval(pollId);
    timers.forEach((t) => clearTimeout(t));
    timers.clear();
    root.innerHTML = '';
  };
}
