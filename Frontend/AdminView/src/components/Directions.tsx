import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { addDestination, addPlace, cancelPickOnMap, clearDestinations, removeDestination, setEvaBase, startPickOnMap, suggestStops } from '../actions';
import { shortName } from '../lib/base';
import { dropReason } from '../lib/plain';
import { landmarksIn } from '../lib/places';
import { whyItMatters } from '../lib/science';
import { useConsole } from '../store';
import { cx } from './ui';
import { WayForward } from './WayForward';

const clean = (n: string) => n.replace(/\s*\([^)]*\)\s*$/, '');

interface Hit {
  key: string;
  title: string;
  sub: string;
  kind: 'target' | 'landmark' | 'base' | 'map';
  pick: () => void;
}

/** Floating "directions" card at the top-left of the map: From / To fields, search, add stops. */
export function DirectionsCard() {
  const pack = useConsole((s) => s.pack)!;
  const live = useConsole((s) => s.uiMode === 'live');
  const evaBase = useConsole((s) => s.evaBase);
  const dests = useConsole((s) => s.destinations);
  const customs = useConsole((s) => s.customStops);
  const plan = useConsole((s) => s.plan);
  const rules = useConsole((s) => s.rules);
  const shelterCells = useConsole((s) => s.shelterCells);
  const status = useConsole((s) => s.planStatus);
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState(false);
  const [adding, setAdding] = useState(false);
  const [act, setActS] = useState(0);
  const actRef = useRef(0);
  const setAct = (v: number | ((a: number) => number)) => {
    actRef.current = typeof v === 'function' ? v(actRef.current) : v;
    setActS(actRef.current);
  };
  const picking = useConsole((s) => s.pickOnMap);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusInput = useRef(false);
  // A new stop closes the extra "To" field; "+ Add stop" opens it with the caret in it.
  useEffect(() => setAdding(false), [dests.length]);
  useEffect(() => {
    if (focusInput.current && inputRef.current) {
      focusInput.current = false;
      inputRef.current.focus();
    }
  });
  const shelters = pack.manifest.shelters.filter((s) => s.kind === 'hab' || s.kind === 'rover');
  const landmarks = useMemo(() => landmarksIn(pack), [pack]);
  const all = useMemo(() => [...pack.manifest.stations, ...customs], [pack, customs]);
  const showInput = !live && (dests.length === 0 || adding);

  const hits = useMemo<Hit[]>(() => {
    const done = () => { setQ(''); setFocus(false); setAdding(false); };
    const targets: Hit[] = [...pack.manifest.stations]
      .filter((s) => !dests.includes(s.id))
      .sort((a, b) => b.value - a.value)
      .map((s) => ({ key: s.id, kind: 'target' as const, title: clean(s.name), sub: `Science target · value ${Math.round(s.value)} · ${s.dwellMin} min on site · ${whyItMatters(s as never)}`, pick: () => { addDestination(s.id); done(); } }));
    const marks: Hit[] = landmarks.map((l) => ({ key: `L-${l.name}`, kind: 'landmark' as const, title: l.name, sub: `Landmark · ${l.note}`, pick: () => { addPlace(l.cell, l.name); done(); } }));
    const bases: Hit[] = shelters
      .filter((s) => s.id !== evaBase)
      .map((s) => ({ key: `B-${s.id}`, kind: 'base' as const, title: shortName(s), sub: s.kind === 'rover' ? 'Rover' : 'Habitat', pick: () => { addPlace(shelterCells[s.id] ?? s.cell, shortName(s)); done(); } }));
    const needle = q.trim().toLowerCase();
    const list = [...targets, ...marks, ...bases];
    const choose: Hit = { key: 'MAP', kind: 'map', title: 'Choose on map', sub: '', pick: () => { setQ(''); setFocus(false); inputRef.current?.blur(); startPickOnMap(); } };
    return [choose, ...(needle ? list.filter((h) => `${h.title} ${h.sub}`.toLowerCase().includes(needle)) : list).slice(0, 8)];
  }, [q, pack, dests, landmarks, shelters, evaBase, shelterCells]);
  // Typing highlights the first match (Enter picks it); an empty field highlights "Choose on map".
  useEffect(() => setAct(q.trim() && hits.length > 1 ? 1 : 0), [q, hits.length]);
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocus(true);
      setAct((a) => Math.min(hits.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAct((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      hits[actRef.current]?.pick();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (picking) cancelPickOnMap();
      setFocus(false);
      setQ('');
      if (adding && rows.length) setAdding(false);
      inputRef.current?.blur();
    }
  };

  const rows = dests.map((id) => all.find((x) => x.id === id)).filter((x): x is NonNullable<typeof x> => !!x);
  return (
    <div data-testid="directions" className="absolute left-3 top-3 z-30 w-[380px] max-w-[min(380px,calc(100%-32px))] max-h-[calc(100%-96px)] overflow-y-auto overflow-x-hidden border border-line-2 bg-black" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="num flex h-[22px] w-[22px] items-center justify-center border border-cyan text-[11px] text-cyan">A</span>
        <span className="eyebrow !text-[11px]">From</span>
        <FromField shelters={shelters} value={evaBase} disabled={live} onPick={setEvaBase} />
      </div>

      {rows.map((st, i) => {
        const dropped = plan?.dropped.find((d) => d.id === st.id);
        const reason = dropped ? dropReason(dropped, rules) : plan && status === 'ready' && !plan.order.includes(st.id) ? 'not reachable in this walk' : null;
        return (
          <div key={st.id} data-testid={`dest-${st.id}`} className="flex items-start gap-2 border-b border-line px-3 py-2">
            <span className={cx('num mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center border text-[11px]', reason ? 'border-red text-red' : 'border-magenta text-magenta')}>{String.fromCharCode(66 + i)}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] leading-tight text-ink">{clean(st.name)}</div>
              <div className={cx('text-[12.5px] leading-tight', reason ? 'text-red' : 'text-mute')} data-testid={reason ? `dest-reason-${st.id}` : undefined}>
                {reason ? `Can't go here safely: ${reason}` : st.id.startsWith('ST') ? `Science target · value ${Math.round(st.value)} · ${st.dwellMin} min on site` : 'Your stop'}
              </div>
              {reason && !live && <WayForward destId={st.id} where="row" className="mt-1.5" />}
            </div>
            {!live && <button aria-label={`Remove ${st.id}`} data-testid={`dest-remove-${st.id}`} onClick={() => removeDestination(st.id)} className="h-7 w-7 shrink-0 text-[15px] text-mute hover:text-cyan">✕</button>}
          </div>
        );
      })}

      {showInput && (
        <div className="px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="num flex h-[22px] w-[22px] shrink-0 items-center justify-center border border-line-2 text-[11px] text-mute">{String.fromCharCode(66 + rows.length)}</span>
            <span className="eyebrow !text-[11px]">To</span>
            <input
              ref={inputRef}
              data-testid="to-input"
              role="combobox"
              aria-expanded={focus}
              aria-controls="to-results"
              aria-activedescendant={focus ? `to-opt-${act}` : undefined}
              aria-label={rows.length ? 'Add a stop' : 'Choose destination'}
              value={q}
              onChange={(e) => { setQ(e.target.value); setAct(e.target.value.trim() ? 1 : 0); setFocus(true); if (picking) cancelPickOnMap(); }}
              onFocus={() => setFocus(true)}
              onClick={() => setFocus(true)}
              onBlur={() => setTimeout(() => setFocus(false), 150)}
              onKeyDown={onKey}
              placeholder={picking ? 'Click a spot on the map' : rows.length ? 'Add a stop' : 'Choose destination'}
              className={cx('h-8 min-w-0 flex-1 border bg-black px-2 text-[15px] text-ink focus:border-cyan focus:outline-none', picking ? 'border-cyan placeholder:text-cyan' : 'border-line-2 placeholder:text-dim')}
            />
          </div>
          {focus && hits.length > 0 && (
            <ul id="to-results" role="listbox" data-testid="to-results" className="mt-2 max-h-[260px] overflow-y-auto border border-line-2 bg-black">
              {hits.map((h, i) => (
                <li key={h.key} id={`to-opt-${i}`} role="option" aria-selected={i === act}>
                  <button
                    data-testid={h.kind === 'map' ? 'choose-on-map' : `to-hit-${h.key}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseMove={() => { if (actRef.current !== i) setAct(i); }}
                    onClick={h.pick}
                    className={cx('flex w-full items-start gap-2 border-b border-line px-2.5 py-1.5 text-left', i === act ? 'bg-cyan/15' : '')}
                  >
                    {h.kind === 'map' ? (
                      <svg className="mt-0.5 shrink-0 text-cyan" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><circle cx="8" cy="8" r="5" /><path d="M8 0.5v4M8 11.5v4M0.5 8h4M11.5 8h4" /></svg>
                    ) : (
                      <span className={cx('mt-1 h-2.5 w-2.5 shrink-0 border', h.kind === 'target' ? 'border-cyan' : h.kind === 'base' ? 'border-ok' : 'border-ink-2')} />
                    )}
                    <span className="min-w-0">
                      <span className={cx('block truncate text-[15px] leading-tight', h.kind === 'map' ? 'text-cyan' : 'text-ink')}>{h.title}</span>
                      {h.sub && <span className="line-clamp-1 block text-[12px] leading-tight text-mute">{h.sub}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!live && (
        <div className="flex items-center gap-3 px-3 py-2 text-[13.5px]">
          {dests.length > 0 && !adding && dests.length < 8 && <button data-testid="add-stop" onClick={() => { focusInput.current = true; setAdding(true); }} className="text-cyan hover:underline">+ Add stop</button>}
          <button data-testid="suggest-stops" onClick={() => void suggestStops()} className="text-cyan hover:underline">Suggest best stops</button>
          {dests.length > 0 && <button onClick={() => { clearDestinations(); setAdding(false); }} className="ml-auto text-mute hover:text-ink">Clear</button>}
        </div>
      )}
    </div>
  );
}

type ShelterOpt = { id: string; name: string; kind: string };

/** "From": a field-like dropdown of the bases (an EVA must start at a shelter). Click or ↓ opens it; ↑/↓/Enter/Esc work. */
function FromField({ shelters, value, disabled, onPick }: { shelters: ShelterOpt[]; value: string | null; disabled: boolean; onPick: (id: string) => void }) {
  const [open, setOpenS] = useState(false);
  const [act, setActS] = useState(0);
  // Refs mirror the state so fast key sequences (↓ ↓ Enter) never read a stale render.
  const openRef = useRef(false);
  const actRef = useRef(0);
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => {
    openRef.current = typeof v === 'function' ? v(openRef.current) : v;
    setOpenS(openRef.current);
  };
  const setAct = (v: number | ((a: number) => number)) => {
    actRef.current = typeof v === 'function' ? v(actRef.current) : v;
    setActS(actRef.current);
  };
  const btn = useRef<HTMLButtonElement>(null);
  const cur = shelters.find((s) => s.id === value) ?? shelters[0];
  const label = (s: ShelterOpt) => `${shortName(s)} · ${s.kind === 'rover' ? 'Rover' : 'Habitat'}`;
  const pick = (id: string) => {
    setOpen(false);
    onPick(id);
    btn.current?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!openRef.current) {
        setOpen(true);
        setAct(Math.max(0, shelters.findIndex((s) => s.id === value)));
      } else setAct((a) => Math.max(0, Math.min(shelters.length - 1, a + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter' && openRef.current) {
      e.preventDefault();
      e.stopPropagation();
      pick(shelters[actRef.current].id);
    } else if (e.key === 'Escape' && openRef.current) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };
  return (
    <div className="relative flex-1">
      <button
        ref={btn}
        type="button"
        data-testid="from-select"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="From"
        disabled={disabled}
        onClick={() => { setOpen((o) => !o); setAct(Math.max(0, shelters.findIndex((s) => s.id === value))); }}
        onKeyDown={onKey}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="flex h-8 w-full items-center border border-line-2 bg-black px-2 text-left text-[15px] text-ink hover:border-cyan focus:border-cyan focus:outline-none disabled:opacity-60"
      >
        <span className="flex-1 truncate">{cur ? label(cur) : 'Choose a base'}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="text-mute"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>
      {open && (
        <ul role="listbox" aria-label="Bases" data-testid="from-options" className="absolute left-0 right-0 top-[34px] z-40 border border-line-2 bg-black">
          {shelters.map((s, i) => (
            <li key={s.id} role="option" aria-selected={s.id === value}>
              <button
                type="button"
                data-testid={`from-opt-${s.id}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => { if (actRef.current !== i) setAct(i); }}
                onClick={() => pick(s.id)}
                className={cx('flex h-9 w-full items-center gap-2 px-2.5 text-left text-[15px]', i === act ? 'bg-cyan/15 text-ink' : 'text-ink-2')}
              >
                <span className={cx('h-2.5 w-2.5 shrink-0', s.kind === 'hab' ? 'bg-ok' : 'bg-ink')} />
                {label(s)}
                {s.id === value && <span className="ml-auto text-cyan">✓</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
