// The order form's items: one row per dish, with quantity, unit and an optional note.
// Typing a dish shows matching dishes from the Toast menu; a dish that isn't on the menu is saved as typed.
import { useRef, useState } from 'react';
import { deviceValue, setDeviceValue } from '@shared/data';
import { norm, searchDishes, UNITS, type Dish } from './lines';
import { blankLine, parseQty, type LineDraft } from './orders';

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

  const focus = (i: number, field: 'dish' | 'qty') =>
    requestAnimationFrame(() => rows.current.get(i)?.querySelector<HTMLElement>(`[data-field="${field}"]`)?.focus());

  /** A change to one row. Any change means the row has been looked at: its typed text and check mark go. */
  const edit = (i: number, patch: Partial<LineDraft>) => {
    const next = lines.map((l, j) => {
      if (j !== i) return l;
      const { text: _typed, check: _check, ...rest } = l;
      return { ...rest, ...patch };
    });
    onChange(next);
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
    onChange([...lines, blankLine(lastUnit())]);
    focus(lines.length, 'dish');
  };
  const remove = (i: number) => {
    onChange(lines.length > 1 ? lines.filter((_, j) => j !== i) : [blankLine(lastUnit())]);
    setOpen(null);
  };

  const noneFilled = lines.every((l) => !l.name.trim());
  return (
    <div className="c-lines" data-testid="items-editor">
      {lines.map((l, i) => {
        const n = i + 1;
        const picked = !!l.dishId;
        const matches = open === i && !picked && l.name.trim() ? searchDishes(l.name, dishes) : [];
        const listId = `c-dish-list-${i}`;
        return (
          <div
            key={i}
            className={'c-line' + (l.check ? ' check' : '')}
            data-testid="item-row"
            ref={(el) => {
              if (el) rows.current.set(i, el);
              else rows.current.delete(i);
            }}
          >
            <div className="c-line-top">
              <input
                className="t-input c-dish"
                data-field="dish"
                aria-label={`Item ${n} dish`}
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
              <button type="button" className="t-btn ghost c-line-x" aria-label={`Remove item ${n}`} title="Remove" onClick={() => remove(i)}>
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
                aria-label={`Item ${n} quantity`}
                placeholder="Qty"
                inputMode="decimal"
                autoComplete="off"
                value={l.qty}
                aria-invalid={!!invalid && !!l.qty.trim() && Number.isNaN(parseQty(l.qty))}
                onChange={(e) => edit(i, { qty: e.target.value })}
              />
              <select
                className="t-select c-unit"
                aria-label={`Item ${n} unit`}
                value={l.unit}
                onChange={(e) => {
                  setDeviceValue(UNIT_KEY, e.target.value);
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
                aria-label={`Item ${n} note`}
                placeholder="Note"
                autoComplete="off"
                value={l.note}
                onChange={(e) => edit(i, { note: e.target.value })}
                onKeyDown={(e) => {
                  // Enter in the last note starts the next item, so a long order is typed without reaching for the mouse.
                  if (e.key === 'Enter' && i === lines.length - 1 && l.name.trim()) {
                    e.preventDefault();
                    add();
                  }
                }}
              />
            </div>
            {l.check ? (
              <small className="c-check">Please check this item{l.text ? `: it was typed as “${l.text}”` : ''}.</small>
            ) : (
              l.name.trim() && !picked && open !== i && dishes.length > 0 && <small className="c-hint">Not on the menu: saved as typed.</small>
            )}
          </div>
        );
      })}
      <button type="button" className="t-btn block c-line-add" onClick={add}>
        + Add item
      </button>
    </div>
  );
}
