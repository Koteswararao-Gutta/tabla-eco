// More > Catering prices: the full-tray price for each kind of dish, any dish's own price, and tax.
// Estimates (Catering > Estimates) price every tray from here: a half tray is half the full-tray price.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { saveSingleton, store, useDoc, useSingleton, type CateringPrices } from '@shared/data';
import { Field, PageHeader } from '@shared/ui';
import { amountInput, parseAmount } from '../catering/orders';
import { menuDishes, norm, searchDishes } from '../catering/lines';
import { kindOf, KINDS, priceList, type Kind } from '../catering/prices';
import '../catering/catering.css';
import '../catering/estimates.css';

type Draft = { defaults: Record<Kind, string>; trays: Record<string, string>; tax: string };

const toDraft = (p: CateringPrices): Draft => ({
  defaults: { veg: amountInput(p.defaults.veg), chicken: amountInput(p.defaults.chicken), meat: amountInput(p.defaults.meat) },
  trays: Object.fromEntries(Object.entries(p.trays).map(([k, v]) => [k, amountInput(v)])),
  tax: p.taxPercent ? String(p.taxPercent) : '',
});

const bad = (t: string) => Number.isNaN(parseAmount(t));

export default function Prices() {
  const saved = useSingleton('cateringPrices');
  const menu = useDoc('toastMenu', 'current');
  const dishes = menuDishes(menu);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [start, setStart] = useState('');
  const [query, setQuery] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  // Waits for the saved list (undefined while loading); none saved yet starts from the built-in prices.
  useEffect(() => {
    if (saved === undefined || draft) return;
    const d = toDraft(priceList(saved));
    setDraft(d);
    setStart(JSON.stringify(d));
  }, [saved, draft]);

  const shown = useMemo(() => (query.trim() ? searchDishes(query, dishes, 40) : dishes), [query, dishes]);
  if (!draft) {
    return (
      <main className="t-page">
        <Link className="mo-back" to="/manager/more">‹ More</Link>
        <PageHeader title="Catering prices" />
        <p className="t-sub">Loading…</p>
      </main>
    );
  }

  const dirty = JSON.stringify(draft) !== start;
  const taxBad = draft.tax.trim() !== '' && (bad(draft.tax) || (parseAmount(draft.tax) ?? 0) > 50);
  const anyBad = KINDS.some((k) => bad(draft.defaults[k.value]) || !draft.defaults[k.value].trim()) || Object.values(draft.trays).some(bad) || taxBad;
  const edit = (patch: Partial<Draft>) => {
    setDraft({ ...draft, ...patch });
    setState('idle');
  };
  const setTray = (key: string, v: string) => {
    const trays = { ...draft.trays, [key]: v };
    if (!v.trim()) delete trays[key];
    edit({ trays });
  };

  const save = async () => {
    if (anyBad) return;
    setState('saving');
    const num = (t: string) => parseAmount(t) ?? 0;
    const value: CateringPrices = {
      defaults: { veg: num(draft.defaults.veg), chicken: num(draft.defaults.chicken), meat: num(draft.defaults.meat) },
      trays: Object.fromEntries(Object.entries(draft.trays).filter(([, v]) => v.trim()).map(([k, v]) => [k, num(v)])),
      taxPercent: num(draft.tax),
      updatedAt: store.now(),
    };
    try {
      await saveSingleton('cateringPrices', value);
      setStart(JSON.stringify(draft));
      setState('saved');
    } catch {
      setState('failed');
    }
  };

  // Menu groups, in menu order, for the dish list.
  const groups: { name: string; items: typeof shown }[] = [];
  for (const d of shown) {
    const g = query.trim() ? 'Matching dishes' : d.group || 'Other';
    const last = groups[groups.length - 1];
    if (last && last.name === g) last.items.push(d);
    else groups.push({ name: g, items: [d] });
  }

  return (
    <main className="t-page" data-testid="prices-page">
      <Link className="mo-back" to="/manager/more">‹ More</Link>
      <PageHeader title="Catering prices" sub="Used for estimates. A half tray is half the full-tray price." />

      <div className="t-stack">
        <h2 className="mo-h2">Full tray, by kind of dish</h2>
        {KINDS.map((k) => (
          <Field key={k.value} label={`${k.label} $`}>
            <input
              className="t-input"
              inputMode="decimal"
              value={draft.defaults[k.value]}
              aria-invalid={bad(draft.defaults[k.value]) || !draft.defaults[k.value].trim()}
              onChange={(e) => edit({ defaults: { ...draft.defaults, [k.value]: e.target.value } })}
              data-testid={`default-${k.value}`}
            />
          </Field>
        ))}
        <Field label="Sales tax % (leave empty for no tax)">
          <input className="t-input" inputMode="decimal" placeholder="0" value={draft.tax} aria-invalid={taxBad} onChange={(e) => edit({ tax: e.target.value })} />
        </Field>

        <h2 className="mo-h2">Dish prices</h2>
        <p className="mo-note">A dish with its own full-tray price uses it. Empty means it uses its kind's price. Pieces (samosa, kebab, tikki) are priced on each estimate for now.</p>
        <input className="t-input e-search" type="search" placeholder="Find a dish" aria-label="Find a dish" value={query} onChange={(e) => setQuery(e.target.value)} />
        {dishes.length === 0 && <p className="mo-note">The menu hasn't loaded from Toast yet.</p>}
        {groups.map((g) => (
          <section key={g.name}>
            <h3 className="e-list-group">{g.name}</h3>
            <ul className="e-prices">
              {g.items.map((d) => {
                const key = norm(d.name);
                const kind = kindOf(d.name);
                const value = draft.trays[key] ?? '';
                return (
                  <li key={d.id} className="e-price-row" data-testid="dish-price">
                    <span className="e-price-name">
                      {d.name}
                      <small>{value.trim() ? 'Own price' : `${KINDS.find((k) => k.value === kind)!.label}: $${draft.defaults[kind] || '?'}`}</small>
                    </span>
                    <span className="e-price-box">
                      <span aria-hidden="true">$</span>
                      <input
                        className="t-input"
                        inputMode="decimal"
                        aria-label={`Full tray price of ${d.name}`}
                        placeholder={draft.defaults[kind]}
                        value={value}
                        aria-invalid={bad(value)}
                        onChange={(e) => setTray(key, e.target.value)}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        <div className="c-form-foot">
          {anyBad && <p className="c-err c-err-summary">Please fix the prices marked in red.</p>}
          {state === 'failed' && (
            <p className="c-err c-err-summary" role="alert">
              Could not save. Please try again.
            </p>
          )}
          <button className="t-btn primary block" disabled={state === 'saving' || anyBad || !dirty} onClick={save} data-testid="save-prices">
            {state === 'saving' ? 'Saving…' : state === 'saved' && !dirty ? '✓ Saved' : 'Save prices'}
          </button>
        </div>
      </div>
    </main>
  );
}
