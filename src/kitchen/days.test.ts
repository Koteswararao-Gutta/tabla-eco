import { describe, expect, it } from 'vitest';
import type { CateringOrder } from '@shared/data';
import { kitchenGroups } from './days';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const order = (id: string, dueAt: number, status: CateringOrder['status'] = 'open') =>
  ({ id, dueAt, status, customerName: id, phone: '', type: 'pickup', items: '', createdAt: 0, updatedAt: 0 }) as CateringOrder & { id: string };
const shape = (now: number, list: (CateringOrder & { id: string })[]) => kitchenGroups(list, now).map((g) => [g.kind, g.label, g.orders.map((o) => o.id)]);

describe('kitchenGroups', () => {
  // Thursday, Nov 19 2026, 10 AM
  const thu = at(2026, 11, 19, 10);

  it('groups today, tomorrow, the rest of the week by name, then later; soonest first', () => {
    const list = [
      order('nextWeek', at(2026, 11, 24)),
      order('sun', at(2026, 11, 22)),
      order('sat', at(2026, 11, 21)),
      order('fri', at(2026, 11, 20)),
      order('today2', at(2026, 11, 19, 18)),
      order('today1', at(2026, 11, 19, 9)),
      order('monday', at(2026, 11, 23)),
    ];
    expect(shape(thu, list)).toEqual([
      ['today', 'Today', ['today1', 'today2']],
      ['tomorrow', 'Tomorrow', ['fri']],
      ['week', 'Saturday, Nov 21', ['sat']],
      ['week', 'Sunday, Nov 22', ['sun']],
      ['later', 'Later', ['monday', 'nextWeek']],
    ]);
  });

  it('leaves out completed orders and empty groups, and keeps old open orders on top', () => {
    const list = [order('done', at(2026, 11, 19), 'completed'), order('old', at(2026, 11, 17)), order('later', at(2026, 12, 3))];
    expect(shape(thu, list)).toEqual([
      ['earlier', 'Not completed from earlier days', ['old']],
      ['later', 'Later', ['later']],
    ]);
  });

  it('on a Saturday, Sunday is Tomorrow and Monday is Later', () => {
    const sat = at(2026, 11, 21, 10);
    expect(shape(sat, [order('mon', at(2026, 11, 23)), order('sun', at(2026, 11, 22))])).toEqual([
      ['tomorrow', 'Tomorrow', ['sun']],
      ['later', 'Later', ['mon']],
    ]);
  });

  it('on a Sunday, Monday is Tomorrow and Tuesday is Later', () => {
    const sun = at(2026, 11, 22, 10);
    expect(shape(sun, [order('tue', at(2026, 11, 24)), order('mon', at(2026, 11, 23))])).toEqual([
      ['tomorrow', 'Tomorrow', ['mon']],
      ['later', 'Later', ['tue']],
    ]);
  });

  it('on a Monday, the week runs to Sunday', () => {
    const mon = at(2026, 11, 23, 10);
    expect(shape(mon, [order('wed', at(2026, 11, 25)), order('sun', at(2026, 11, 29)), order('mon2', at(2026, 11, 30))]).map((g) => g[1])).toEqual([
      'Wednesday, Nov 25',
      'Sunday, Nov 29',
      'Later',
    ]);
  });
});
