// Manager > Staff: the Shift planner (port of reference/shift-planner.html).
// The planner renders into the div below; its data goes through @shared/data:
// config -> singleton 'staffConfig', each week -> collection 'staffWeeks' (doc id = Monday, YYYY-MM-DD),
// with each shift stored as {s, e, pos?} (no arrays directly inside arrays; see encodeWeek).
import { useEffect, useRef } from 'react';
import { saveSingleton, store } from '@shared/data';
import type { StaffConfig, StaffWeek } from '@shared/data';
import { mountPlanner, type PlannerIO } from './planner';
import { encodeWeek } from './model';
import './staff.css';

const io: PlannerIO = {
  now: () => store.now(),
  watchConfig: (cb) => store.watchDoc('singletons', 'staffConfig', (doc) => cb(doc ?? null)),
  watchWeeks: (cb) =>
    store.watchCollection('staffWeeks', (docs) => {
      const weeks: Record<string, unknown> = {};
      docs.forEach((d) => (weeks[d.id] = d));
      cb(weeks);
    }),
  saveConfig: (config) => saveSingleton('staffConfig', config as unknown as StaffConfig),
  saveWeek: (id, week) => (week ? store.setDoc('staffWeeks', id, encodeWeek(week) as unknown as StaffWeek) : store.deleteDoc('staffWeeks', id)),
};

export default function Staff() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return mountPlanner(el, io);
  }, []);
  return <div ref={ref} className="sp" data-testid="staff-planner" />;
}
