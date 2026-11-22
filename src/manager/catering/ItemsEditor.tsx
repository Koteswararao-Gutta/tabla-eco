// The order form's items: one row per dish, with quantity, unit and an optional note.
// Typing a dish shows matching dishes from the Toast menu; a dish that isn't on the menu is saved as typed.
import { useEffect, useRef, useState } from 'react';
import { deviceValue, setDeviceValue } from '@shared/data';
import { norm, searchDishes, UNITS, type Dish } from './lines';
import { blankLine, parseQty, type LineDraft } from './orders';
import { missingExtras, withExtras } from './extras';

/** Remembered on this device: the unit picked last, for the next new row. */
const UNIT_KEY = 'cateringUnit';
export const lastUnit = () => deviceValue(UNIT_KEY) ?? '';

type Props = {
  lines: LineDraft[];
  dishes: Dish[];
  onChange: (lines: LineDraft[]) => void;
  invalid?: boolean;
};

export function ItemsEditor({ lines, dishes, onChange, invalid }: Props) {
  const rows = useRef(new Map<number, HTMLDivElement>());
  // Which row's dish box is open for suggestions, and the highlighted suggestion.
  const [open, setOpen] = useState<number | null>(null);
  const [hi, setHi] = useState(0);
  // Auto extras (raita with biryani, ...) taken off by hand, so they aren't added back. An order opened
  // without an extra it would get (taken off before, or saved before extras existed) counts as taken off.
  const off = useRef<Set<string> | null>(null);
  if (!off.current) off.current = new Set(missingExtras(lines));
  /** Every change goes out with the extras brought up to date. */
  const commit = (next: LineDraft[]) => onChange(withExtras(next, off.current!));
  // Rows filled from outside (a scan or a paste) get their extras too.
  useEffect(() => {
    const next = withExtras(lines, off.current!);
    if (JSON.stringify(next) !== JSON.stringify(lines)) onChange(next);
  }, [lines, onChange]);

  const focus = (i: number, field: 'dish' | 'qty') =>
    requestAnimationFrame(() => rows.current.get(i)?.querySelector<HTMLElement>(`[data-field="${field}"]`)?.focus());

  /** A change to one row. Any change means the row has been looked at: its typed text and check mark go.
   *  An extra whose amount or name is changed keeps that change from then on. */
  const edit = (i: number, patch: Partial<LineDraft>) => {
    const next = lines.map((l, j) => {
      if (j !== i) return l;
      const { text: _typed, check: _check, ...rest } = l;
      const changed = l.extra && ['qty', 'unit', 'name'].some((k) => k in patch && patch[k as keyof LineDraft] !== l[k as keyof LineDraft]);
      return { ...rest, ...patch, ...(changed ? { extraEdited: true } : {}) };
    });
    commit(next);
  };

  const typeDish = (i: number, name: string) => {
    const exact = dishes.find((d) => norm(d.name) === norm(name));
    edit(i, { name, dishId: exact ? exact.id : null });
    setOpen(i);
    setHi(0);
  };
  const pick = (i: number, d: Dish) => {
    edit(i, { name: d.name, dishId: d.id });
    setOpen(null);
    focus(i, 'qty');
  };
  const add = () => {
    // A new dish row goes after the other dishes, before the extras.
    commit([...lines, blankLine(lastUnit())]);
    focus(lines.filter((l) => !l.extra).length, 'dish');
  };
  const remove = (i: number) => {
    const gone = lines[i];
    if (gone?.extra) off.current!.add(gone.extra);
    const rest = lines.filter((_, j) => j !== i);
    commit(rest.some((l) => !l.extra) ? rest : [blankLine(lastUnit()), ...rest]);
    setOpen(null);
  };
  const firstExtra = lines.findIndex((l) => l.extra);

  const noneFilled = lines.every((l) => !l.name.trim());
  return (
    <div className="c-lines" data-testid="items-editor">
      {lines.map((l, i) => {
        const n = i + 1;
        const picked = !!l.dishId;
        const matches = open === i && !picked && !l.extra && l.name.trim() ? searchDishes(l.name, dishes) : [];
        const listId = `c-dish-list-${i}`;
        const label = l.extra ? `Extra ${l.extra}` : `Item ${n}`;
        return (
          <div key={i} className="c-line-wrap">
          {i === firstExtra && <div className="c-extras-head">Extras, added for the dishes above</div>}
          <div
            className={'c-line' + (l.check ? ' check' : '') + (l.extra ? ' extra' : '')}
            data-testid={l.extra ? 'extra-row' : 'item-row'}
            ref={(el) => {
              if (el) rows.current.set(i, el);
              else rows.current.delete(i);
            }}
          >
            <div className="c-line-top">
              {l.extra && <span className="t-badge accent c-extra-badge">Extra</span>}
              <input
                className="t-input c-dish"
                data-field="dish"
                aria-label={`${label} dish`}
                placeholder="Dish, e.g. chicken biryani"
                value={l.name}
                autoComplete="off"
                role="combobox"
                aria-expanded={matches.length > 0}
                aria-controls={listId}
                aria-invalid={!!invalid && !l.name.trim() && ((noneFilled && i === 0) || !!l.qty.trim() || !!l.note.trim())}
                onChange={(e) => typeDish(i, e.target.value)}
                onFocus={() => setOpen(i)}
                onBlur={() => {
                  // Typed a menu name exactly ("chicken 65"): show it as the menu has it.
                  const d = l.dishId ? dishes.find((x) => x.id === l.dishId) : null;
                  if (d && d.name !== l.name) edit(i, { name: d.name });
                  setTimeout(() => setOpen((o) => (o === i ? null : o)), 150);
                }}
                onKeyDown={(e) => {
                  if (!matches.length) return;
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setHi((h) => Math.min(matches.length - 1, h + 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setHi((h) => Math.max(0, h - 1));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    pick(i, matches[Math.min(hi, matches.length - 1)]);
                  } else if (e.key === 'Escape') {
                    e.stopPropagation();
                    setOpen(null);
                  }
                }}
              />
              <button type="button" className="t-btn ghost c-line-x" aria-label={`Remove ${label.charAt(0).toLowerCase()}${label.slice(1)}`} title="Remove" onClick={() => remove(i)}>
                ✕
              </button>
            </div>
            {matches.length > 0 && (
              <ul
                className="c-dish-list"
                id={listId}
                role="listbox"
                aria-label="Dishes on the menu"
                // Keep the suggestions in view above the Save bar (on a phone the keyboard takes half the screen).
                ref={(el) => el?.scrollIntoView({ block: 'nearest' })}
              >
                {matches.map((d, k) => (
                  <li key={d.id} role="option" aria-selected={k === hi}>
                    <button
                      type="button"
                      className={'c-dish-opt' + (k === hi ? ' hi' : '')}
                      // Pick on press, before the dish box loses focus and closes the list.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(i, d)}
                    >
                      <span className="c-dish-name">{d.name}</span>
                      {d.group && <span className="c-dish-group">{d.group}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="c-line-qty">
              <input
                className="t-input c-qty"
                data-field="qty"
                aria-label={`${label} quantity`}
                placeholder="Qty"
                inputMode="decimal"
                autoComplete="off"
                value={l.qty}
                aria-invalid={!!invalid && !!l.qty.trim() && Number.isNaN(parseQty(l.qty))}
                onChange={(e) => edit(i, { qty: e.target.value })}
              />
              <select
                className="t-select c-unit"
                aria-label={`${label} unit`}
                value={l.unit}
                onChange={(e) => {
                  // Remembered for the next dish row (an extra's ounces aren't).
                  if (!l.extra) setDeviceValue(UNIT_KEY, e.target.value);
                  edit(i, { unit: e.target.value });
                }}
              >
                <option value="">No unit</option>
                {UNITS.map((u) => (
                  <option key={u.label} value={u.label}>
                    {u.label}
                  </option>
                ))}
                {l.unit && !UNITS.some((u) => u.label === l.unit) && <option value={l.unit}>{l.unit}</option>}
              </select>
              <input
                className="t-input c-line-note"
                aria-label={`${label} note`}
                placeholder="Note"
                autoComplete="off"
                value={l.note}
                onChange={(e) => edit(i, { note: e.target.value })}
                onKeyDown={(e) => {
                  // Enter in the last dish's note starts the next item, so a long order is typed without reaching for the mouse.
                  if (e.key === 'Enter' && !l.extra && i === (firstExtra < 0 ? lines.length : firstExtra) - 1 && l.name.trim()) {
                    e.preventDefault();
                    add();
                  }
                }}
              />
            </div>
            {l.check ? (
              <small className="c-check">Please check this item{l.text ? `: it was typed as “${l.text}”` : ''}.</small>
            ) : (
              l.extra ? (
                <small className="c-hint">
                  {l.extraEdited ? 'Changed by hand: stays as it is.' : !l.qty.trim() ? 'Please add the amount.' : 'Changes with the dishes. Edit or remove it if needed.'}
                </small>
              ) : (
                l.name.trim() && !picked && open !== i && dishes.length > 0 && <small className="c-hint">Not on the menu: saved as typed.</small>
              )
            )}
          </div>
          </div>
        );
      })}
      <button type="button" className="t-btn block c-line-add" onClick={add}>
        + Add item
      </button>
    </div>
  );
}
