import { useMemo, useState } from 'react';
import { addDestination, addPlace, clearDestinations, removeDestination, setEvaBase, suggestStops } from '../actions';
import { shortName } from '../lib/base';
import { dropReason } from '../lib/plain';
import { landmarksIn } from '../lib/places';
import { whyItMatters } from '../lib/science';
import { useConsole } from '../store';
import { cx } from './ui';

const clean = (n: string) => n.replace(/\s*\([^)]*\)\s*$/, '');

interface Hit {
  key: string;
  title: string;
  sub: string;
  kind: 'target' | 'landmark' | 'base';
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
  const shelters = pack.manifest.shelters.filter((s) => s.kind === 'hab' || s.kind === 'rover');
  const landmarks = useMemo(() => landmarksIn(pack), [pack]);
  const all = useMemo(() => [...pack.manifest.stations, ...customs], [pack, customs]);
  const showInput = !live && (dests.length === 0 || adding);

  const hits = useMemo<Hit[]>(() => {
    const done = () => { setQ(''); setFocus(false); setAdding(false); };
    const targets: Hit[] = [...pack.manifest.stations]
      .filter((s) => !dests.includes(s.id))
      .sort((a, b) => b.value - a.value)
      .map((s) => ({ key: s.id, kind: 'target' as const, title: clean(s.name), sub: `${s.id} · science value ${Math.round(s.value)} · ${whyItMatters(s as never)}`, pick: () => { addDestination(s.id); done(); } }));
    const marks: Hit[] = landmarks.map((l) => ({ key: `L-${l.name}`, kind: 'landmark' as const, title: l.name, sub: `Landmark · ${l.note}`, pick: () => { addPlace(l.cell, l.name); done(); } }));
    const bases: Hit[] = shelters
      .filter((s) => s.id !== evaBase)
      .map((s) => ({ key: `B-${s.id}`, kind: 'base' as const, title: shortName(s), sub: s.kind === 'rover' ? 'Rover' : 'Habitat', pick: () => { addPlace(shelterCells[s.id] ?? s.cell, shortName(s)); done(); } }));
    const needle = q.trim().toLowerCase();
    const list = [...targets, ...marks, ...bases];
    return (needle ? list.filter((h) => `${h.title} ${h.sub}`.toLowerCase().includes(needle)) : list).slice(0, 9);
  }, [q, pack, dests, landmarks, shelters, evaBase, shelterCells]);

  const rows = dests.map((id) => all.find((x) => x.id === id)).filter((x): x is NonNullable<typeof x> => !!x);
  return (
    <div data-testid="directions" className="absolute left-3 top-3 z-30 w-[380px] max-w-[min(380px,calc(100%-32px))] max-h-[calc(100%-96px)] overflow-y-auto overflow-x-hidden border border-line-2 bg-black" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="num flex h-[22px] w-[22px] items-center justify-center border border-cyan text-[11px] text-cyan">A</span>
        <span className="eyebrow !text-[11px]">From</span>
        <select
          data-testid="from-select"
          value={evaBase ?? ""}
          disabled={live}
          onChange={(e) => setEvaBase(e.target.value)}
          className="h-8 flex-1 border border-line-2 bg-black px-2 text-[15px] text-ink focus:border-cyan focus:outline-none"
        >
          {shelters.map((s) => <option key={s.id} value={s.id}>{shortName(s)} · {s.kind === 'rover' ? 'Rover' : 'Habitat'}</option>)}
        </select>
      </div>

      {rows.map((st, i) => {
        const dropped = plan?.dropped.find((d) => d.id === st.id);
        const reason = dropped ? dropReason(dropped, rules) : plan && status === 'ready' && !plan.order.includes(st.id) ? 'not reachable in this walk' : null;
        return (
          <div key={st.id} data-testid={`dest-${st.id}`} className="flex items-start gap-2 border-b border-line px-3 py-2">
            <span className={cx('num mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center border text-[11px]', reason ? 'border-red text-red' : 'border-cyan text-cyan')}>{reason ? '✕' : String.fromCharCode(66 + i)}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] leading-tight text-ink">{clean(st.name)}</div>
              <div className={cx('text-[12.5px] leading-tight', reason ? 'text-red' : 'text-mute')} data-testid={reason ? `dest-reason-${st.id}` : undefined}>
                {reason ? `Can't go here safely: ${reason}` : st.id.startsWith('ST') ? `${st.id} · science value ${Math.round(st.value)}` : 'Your stop'}
              </div>
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
              data-testid="to-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onFocus={() => setFocus(true)}
              onBlur={() => setTimeout(() => setFocus(false), 150)}
              placeholder="Search a place or tap the map"
              className="h-8 min-w-0 flex-1 border border-line-2 bg-black px-2 text-[15px] text-ink placeholder:text-dim focus:border-cyan focus:outline-none"
            />
          </div>
          {focus && hits.length > 0 && (
            <ul data-testid="to-results" className="mt-2 max-h-[240px] overflow-y-auto border border-line-2 bg-black">
              {hits.map((h) => (
                <li key={h.key}>
                  <button onMouseDown={(e) => e.preventDefault()} onClick={h.pick} className="flex w-full items-start gap-2 border-b border-line px-2.5 py-1.5 text-left hover:bg-cyan/10">
                    <span className={cx('mt-1 h-2.5 w-2.5 shrink-0 border', h.kind === 'target' ? 'border-cyan' : h.kind === 'base' ? 'border-ok' : 'border-ink-2')} />
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] leading-tight text-ink">{h.title}</span>
                      <span className="line-clamp-1 block text-[12px] leading-tight text-mute">{h.sub}</span>
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
          {dests.length > 0 && !adding && dests.length < 8 && <button data-testid="add-stop" onClick={() => setAdding(true)} className="text-cyan hover:underline">+ Add stop</button>}
          <button data-testid="suggest-stops" onClick={() => void suggestStops()} className="text-cyan hover:underline">Suggest best stops</button>
          {dests.length > 0 && <button onClick={() => { clearDestinations(); setAdding(false); }} className="ml-auto text-mute hover:text-ink">Clear</button>}
        </div>
      )}
      {dests.length > 1 && <div className="border-t border-line px-3 py-1.5 text-[12.5px] leading-snug text-mute">Stops are reordered for the fastest safe loop · round trip back to the start</div>}
    </div>
  );
}
