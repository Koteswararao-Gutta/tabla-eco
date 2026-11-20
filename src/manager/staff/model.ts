// Shift planner data: shapes, starting data and the data checks.
// Ported from reference/shift-planner.html (defaults(), normalizeDB() and the small helpers).

export type Pos = 'prep' | 'runner';
/** [start, end] in minutes from midnight, plus an optional position. */
export type Shift = [number, number, Pos?];
export interface Person { id: string; name: string; active: boolean }
export interface DayHours { open: number; close: number; brk: [number, number] | null }
export interface Settings { prepStart: number; secondAt: number; minStaff: number; days: DayHours[] }
export type SpecialDay = { closed: true } | { closed?: undefined; open: number; close: number; brk?: number[] };
export interface Config { people: Person[]; settings: Settings; special: Record<string, SpecialDay> }
/** shifts[day 0..6][personId] = list of shifts */
export interface Week { locked: boolean; shifts: Record<string, Shift[]>[] }
export interface PlannerDB { config: Config; weeks: Record<string, Week> }

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const STEP = 15;
export const POS: Record<Pos, string> = { prep: 'Food prep', runner: 'Food runner' };
export const POSSHORT: Record<Pos, string> = { prep: 'Prep', runner: 'Runner' };

export const pad = (n: number): string => String(n).padStart(2, '0');
export const iso = (dt: Date): string => dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
export const parse = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (dt: Date, n: number): Date => {
  const x = new Date(dt);
  x.setDate(x.getDate() + n);
  return x;
};
export const mondayOf = (dt: Date): Date => addDays(new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()), -((dt.getDay() + 6) % 7));
export const shiftWeek = (id: string, n: number): string => iso(addDays(parse(id), 7 * n));
export const dshort = (dt: Date): string => MON[dt.getMonth()] + ' ' + dt.getDate();
export const wrange = (id: string): string => {
  const m = parse(id), s = addDays(m, 6);
  return dshort(m) + ' – ' + (m.getMonth() === s.getMonth() ? s.getDate() : dshort(s));
};
export const toHM = (t: number): string => pad(Math.floor(t / 60)) + ':' + pad(t % 60);
export const fromHM = (s: string): number | null => {
  if (!s) return null;
  const [a, b] = s.split(':').map(Number);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.min(Math.round((a * 60 + b) / 15) * 15, 24 * 60 - 15);
};
export function fmt(t: number): string {
  const H = Math.floor(t / 60) % 24, m = t % 60;
  const ap = H >= 12 ? 'pm' : 'am';
  return (H % 12 || 12) + (m ? ':' + pad(m) : '') + ap;
}
export const rng = (s: number, e: number): string => fmt(s) + '–' + fmt(e);
export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
export const esc = (s: unknown): string =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
export const newPersonId = (): string => 'p' + Math.random().toString(36).slice(2, 12);
export const sorted = (l: Shift[] | undefined): Shift[] => (l || []).slice().sort((a, b) => a[0] - b[0]);
export const hoursOf = (l: Shift[]): number => l.reduce((a, [s, e]) => a + (e - s) / 60, 0);
export const hstr = (x: number): string => Math.round(x * 100) / 100 + 'h';
export const posTxt = (r: Pos | undefined): string => (r && POS[r] ? ' ' + POSSHORT[r] : '');
export const shiftTxt = ([s, e, r]: Shift): string => rng(s, e) + posTxt(r);
export const key = (l: Shift[] | undefined): string => sorted(l).map((x) => x.join('-')).join(',');
export const short = (t: number): string => fmt(t).replace(/:00/, '').replace('am', 'a').replace('pm', 'p');

/* ---------- starting data ---------- */
const C = 'c';
type RawShift = [number, number | typeof C];
const RAW: Record<string, Record<number, RawShift[]>> = {
  Tarun: { 0: [[10, 14], [17, C]], 1: [[10, 14], [17, C]], 2: [[10, 14], [17, C]], 4: [[10, 14]] },
  'Tharun (Nau)': { 3: [[10, 14], [17, C]], 4: [[10, 13], [17, C]], 5: [[10, 14], [17, C]], 6: [[10, 14], [17, C]] },
  Saharika: { 0: [[10.75, 14]], 1: [[10.75, 14]], 2: [[10.75, 14]], 3: [[17, C]], 4: [[13, 17], [18, 21]], 5: [[14, 19]] },
  Akhila: { 3: [[11, 14], [17, C]], 4: [[11, 14], [17, 21]], 5: [[11, 14], [16, 21]], 6: [[11, 15], [17, C]] },
  Siri: { 0: [[17, C]], 2: [[17, C]], 3: [[17, C]], 4: [[12, 16], [18, C]], 5: [[12, 16], [18, C]], 6: [[12, 16], [18, C]] },
  Sravya: { 0: [[17, C]], 1: [[17, C]], 2: [[11, 14], [17, C]], 4: [[13, 17], [18, C]], 5: [[13, 17], [18, C]], 6: [[13, 17], [18, C]] },
  Srilekha: { 0: [[11, 14], [17, 21]], 1: [[11, 14], [17, 21]], 2: [[11, 14]], 6: [[14, 19]] },
};
export const SEED_WEEK = '2026-09-21';

export function emptyWeek(): Week {
  return { locked: false, shifts: [{}, {}, {}, {}, {}, {}, {}] };
}
export function defaults(): PlannerDB {
  const wd: DayHours = { open: 660, close: 1260, brk: [840, 1020] }, we: DayHours = { open: 660, close: 1320, brk: null };
  const people: Person[] = Object.keys(RAW).map((n, i) => ({ id: 'p' + (i + 1), name: n, active: true }));
  const days = [wd, wd, wd, wd, we, we, we].map(clone);
  const w = emptyWeek();
  people.forEach((p) => {
    for (let d = 0; d < 7; d++) {
      const l: Shift[] = (RAW[p.name][d] || []).map(([s, e]) => [Math.round(s * 60), e === C ? days[d].close : Math.round(e * 60)]);
      if (l.length) w.shifts[d][p.id] = l;
    }
  });
  return { config: { people, settings: { prepStart: 600, secondAt: 645, minStaff: 2, days }, special: {} }, weeks: { [SEED_WEEK]: w } };
}

/* ---------- stored form ---------- */
// The stored week writes each shift as {s, e, pos?} instead of [s, e, pos]: the shared store
// (Firestore later) can't hold an array directly inside an array. normalizeDB reads both forms.
export interface StoredShift { s: number; e: number; pos?: Pos }
export interface StoredWeek { locked: boolean; shifts: Record<string, StoredShift[]>[] }
export function encodeWeek(w: Week): StoredWeek {
  return {
    locked: !!w.locked,
    shifts: w.shifts.map((day) => {
      const out: Record<string, StoredShift[]> = {};
      Object.entries(day).forEach(([pid, l]) => {
        out[pid] = l.map(([s, e, pos]) => (pos ? { s, e, pos } : { s, e }));
      });
      return out;
    }),
  };
}

/* ---------- data checks ---------- */
// Cleans up data from storage, another window or a paste. Returns null if it isn't planner data at all.
// The input is untrusted, so it is read as `any` here and every field is checked before use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
export function normalizeDB(input: unknown): PlannerDB | null {
  const j = input as Loose;
  const num = (x: unknown): x is number => typeof x === 'number' && isFinite(x);
  if (!j || typeof j !== 'object' || !j.config || typeof j.config !== 'object' || !Array.isArray(j.config.people)) return null;
  const d0 = defaults().config.settings;
  const s0: Loose = j.config.settings && typeof j.config.settings === 'object' ? j.config.settings : {};
  const days: DayHours[] =
    Array.isArray(s0.days) && s0.days.length === 7
      ? s0.days.map((h: Loose, i: number): DayHours => {
          const b = d0.days[i];
          if (!h || !num(h.open) || !num(h.close) || h.close <= h.open) return clone(b);
          const brk: [number, number] | null =
            Array.isArray(h.brk) && num(h.brk[0]) && num(h.brk[1]) && h.brk[0] > h.open && h.brk[1] > h.brk[0] && h.brk[1] < h.close
              ? [h.brk[0], h.brk[1]]
              : null;
          return { open: h.open, close: h.close, brk };
        })
      : clone(d0.days);
  const settings: Settings = {
    prepStart: num(s0.prepStart) ? s0.prepStart : d0.prepStart,
    secondAt: num(s0.secondAt) ? s0.secondAt : d0.secondAt,
    minStaff: num(s0.minStaff) && s0.minStaff >= 1 ? Math.round(s0.minStaff) : d0.minStaff,
    days,
  };
  if (settings.secondAt < settings.prepStart) settings.secondAt = settings.prepStart;
  const seen = new Set<string>();
  const people: Person[] = (j.config.people as Loose[])
    .filter((p) => p && typeof p.id === 'string' && p.id && !seen.has(p.id) && seen.add(p.id))
    .map((p) => ({ id: p.id as string, name: String(p.name || '').trim() || 'Unnamed', active: p.active !== false }));
  const special: Record<string, SpecialDay> = {};
  if (j.config.special && typeof j.config.special === 'object')
    Object.entries(j.config.special as Record<string, Loose>).forEach(([k, v]) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !v) return;
      if (v.closed) special[k] = { closed: true };
      else if (num(v.open) && num(v.close) && v.close > v.open) {
        const s: SpecialDay = { open: v.open, close: v.close };
        if (Array.isArray(v.brk)) s.brk = v.brk.slice(0, 2);
        special[k] = s;
      }
    });
  const weeks: Record<string, Week> = {}, ids = new Set(people.map((p) => p.id));
  if (j.weeks && typeof j.weeks === 'object')
    Object.entries(j.weeks as Record<string, Loose>).forEach(([id, w]) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(id) || !w || typeof w !== 'object') return;
      const out = emptyWeek();
      out.locked = !!w.locked;
      for (let d = 0; d < 7; d++) {
        const day: Record<string, Loose> = Array.isArray(w.shifts) && w.shifts[d] && typeof w.shifts[d] === 'object' ? w.shifts[d] : {};
        Object.entries(day).forEach(([pid, l]) => {
          if (!ids.has(pid) || !Array.isArray(l)) return;
          const clean: Shift[] = (l as Loose[])
            .map((x) => (x && typeof x === 'object' && !Array.isArray(x) ? [x.s, x.e, x.pos] : x))
            .filter((x) => Array.isArray(x) && num(x[0]) && num(x[1]) && x[1] > x[0])
            .map((x): Shift => (x[2] === 'prep' || x[2] === 'runner' ? [x[0], x[1], x[2]] : [x[0], x[1]]))
            .sort((a, b) => a[0] - b[0])
            .filter((x, i, a) => i === 0 || x[0] >= a[i - 1][1]);
          if (clean.length) out.shifts[d][pid] = clean;
        });
      }
      weeks[id] = out;
    });
  return { config: { people, settings, special }, weeks };
}

/* ---------- merging with changes made on another phone ---------- */
// The planner holds back updates from the store while something is being edited (a sheet is open,
// Settings has unsaved changes). Saving then must not write back the old copy over what another phone
// saved meanwhile. So each save merges three versions: what this phone last loaded (base), what it has
// now (local) and what the store has now (latest). Whatever this phone changed wins; the rest comes from latest.

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** A week with this phone's changes (by day and person) put on top of the stored one. */
export function mergeWeek(base: Week | undefined, local: Week, latest: Week | undefined): Week {
  if (!latest) return clone(local);
  const b = base ?? emptyWeek();
  const out: Week = { locked: local.locked !== b.locked ? local.locked : latest.locked, shifts: [] };
  for (let d = 0; d < 7; d++) {
    const day: Record<string, Shift[]> = {};
    const ids = new Set([...Object.keys(local.shifts[d] || {}), ...Object.keys(latest.shifts[d] || {}), ...Object.keys(b.shifts[d] || {})]);
    ids.forEach((pid) => {
      const mine = local.shifts[d]?.[pid], theirs = latest.shifts[d]?.[pid];
      const pick = same(mine, b.shifts[d]?.[pid]) ? theirs : mine;
      if (pick && pick.length) day[pid] = clone(pick);
    });
    out.shifts.push(day);
  }
  return out;
}

/** The staff list, settings and special days with this phone's changes put on top of the stored ones. */
export function mergeConfig(base: Config, local: Config, latest: Config): Config {
  const byId = (l: Person[]) => new Map(l.map((p) => [p.id, p]));
  const B = byId(base.people), Lc = byId(local.people), Lt = byId(latest.people);
  const people: Person[] = [];
  latest.people.forEach((p) => {
    const mine = Lc.get(p.id);
    if (!mine) {
      if (!B.has(p.id)) people.push(clone(p)); // added on the other phone
      return; // removed here
    }
    people.push(clone(same(mine, B.get(p.id)) ? p : mine));
  });
  // Added here (not in base, not yet stored).
  local.people.forEach((p) => {
    if (!Lt.has(p.id) && !B.has(p.id)) people.push(clone(p));
  });
  // Reordered here: keep this phone's order for the people it has.
  const order = (l: Person[]) => l.map((p) => p.id).filter((id) => B.has(id) && Lc.has(id));
  if (!same(order(local.people), order(base.people))) {
    const at = new Map(local.people.map((p, i) => [p.id, i]));
    people.sort((a, b) => (at.get(a.id) ?? Infinity) - (at.get(b.id) ?? Infinity));
  }
  const special: Record<string, SpecialDay> = {};
  new Set([...Object.keys(local.special), ...Object.keys(latest.special), ...Object.keys(base.special)]).forEach((k) => {
    const pick = same(local.special[k], base.special[k]) ? latest.special[k] : local.special[k];
    if (pick) special[k] = clone(pick);
  });
  return { people, settings: clone(same(local.settings, base.settings) ? latest.settings : local.settings), special };
}
