import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { addStopAt, directionsTo, removeDestination } from '../actions';
import { baseInfo } from '../lib/base';
import { previewCell } from '../lib/places';
import { mineralSignalAt, stationImage, whyItMatters } from '../lib/science';
import { get, set, useConsole } from '../store';
import { fixFromPin } from '../check';
import { hm } from '../lib/plain';

const clean = (n: string) => n.replace(/\s*\([^)]*\)\s*$/, '');
const lat = (v: number) => `${Math.abs(v).toFixed(4)}°${v < 0 ? 'S' : 'N'}`;
const lon = (v: number) => `${Math.abs(v).toFixed(4)}°${v < 0 ? 'W' : 'E'}`;

/** Keep a floating box inside the map: below the anchor in the top half, above it in the bottom half. */
function useAnchor(root: RefObject<HTMLElement | null>, px: [number, number], w: number, gap: { below: number; above: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -9999, top: -9999 });
  useLayoutEffect(() => {
    const W = root.current?.clientWidth ?? 1000;
    const H = root.current?.clientHeight ?? 700;
    const h = box.current?.offsetHeight ?? 160;
    const left = Math.max(8, Math.min(W - w - 8, px[0] - w / 2));
    const below = px[1] + gap.below;
    const above = px[1] - gap.above - h;
    const top = below + h <= H - 8 || above < 8 ? Math.min(below, Math.max(8, H - h - 8)) : above;
    setPos({ left, top });
  }, [root, px[0], px[1], w, gap.below, gap.above]);
  return { box, pos };
}

function Btn({ children, primary, onClick, testId }: { children: ReactNode; primary?: boolean; onClick: () => void; testId: string }) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      className={primary ? 'h-10 bg-cyan px-3 text-[14px] font-bold uppercase tracking-[0.12em] text-black hover:bg-white' : 'h-10 border border-cyan bg-black px-3 text-[14px] font-bold uppercase tracking-[0.1em] text-cyan hover:bg-cyan/10'}
    >
      {children}
    </button>
  );
}


export function MineralLine({ x, y, testid = 'place-mineral' }: { x: number; y: number; testid?: string }) {
  const pack = useConsole((s) => s.pack);
  const sig = pack ? mineralSignalAt(pack, x, y) : null;
  if (!sig) return null;
  return (
    <div className="mt-1.5 text-[12px] leading-snug text-ink-2" data-testid={testid} data-tier={sig.tier}>
      Hydrated sulfate signal: <span className="font-medium text-ink">{sig.tier}</span>
      {sig.hydrated ? ' · water-bearing band present' : ''}
      <span className="text-mute"> for this area (CRISM, 18 m)</span>
    </div>
  );
}
/** Google-style place card for a clicked spot or science target: what it is, is it safe, Directions / Add stop. */
export function PlaceCard({ root }: { root: RefObject<HTMLElement | null> }) {
  const pop = useConsole((s) => s.mapPopover);
  if (!pop) return null;
  return <PlaceCardInner root={root} pop={pop} />;
}

function PlaceCardInner({ root, pop }: { root: RefObject<HTMLElement | null>; pop: NonNullable<ReturnType<typeof get>['mapPopover']> }) {
  const pack = useConsole((s) => s.pack)!;
  const dests = useConsole((s) => s.destinations);
  const customs = useConsole((s) => s.customStops);
  const evaBase = useConsole((s) => s.evaBase);
  const shelterCells = useConsole((s) => s.shelterCells);
  useConsole((s) => s.fields); // the safety line uses the latest fields
  const station = pop.kind === 'station' && pop.id ? pack.manifest.stations.find((x) => x.id === pop.id) ?? null : null;
  const custom = pop.kind === 'terrain' && pop.id ? customs.find((c) => c.id === pop.id) ?? null : null;
  const { box, pos } = useAnchor(root, pop.px, 316, station || custom ? { below: 18, above: 18 } : { below: 14, above: 44 });
  const pv = previewCell(get(), pop.cell);
  const from = baseInfo(pack, evaBase, shelterCells).short;
  const id = station?.id ?? custom?.id ?? null;
  const included = !!id && dests.includes(id);
  const hasRoute = dests.length > 0;
  const target = station ? { stationId: station.id } : { cell: pop.cell };
  const img = station ? stationImage(pack.manifest, station) : null;
  const pin = useConsole((s) => s.pinCheck);
  const isPin = !station && !custom;
  const stand = pv && Number.isFinite(pv.slopeDeg) ? ` (slope ${Math.round(pv.slopeDeg)}°)` : '';
  // A dropped pin: "standing here" is only the ground under the pin. GO / NO-GO is the full walk check below.
  const safety = pv
    ? isPin
      ? pv.ok ? `Safe to stand here${stand}` : `Can't go here: ${pv.reason}`
      : pv.ok
        ? `${pv.minutes !== null ? `~${Math.round(pv.minutes)} min walk from ${from} · ` : ''}safe to stand`
        : `Can't go here: ${pv.reason}`
    : null;
  const mine = isPin && pin && pin.cell === pop.cell ? pin : null;

  return (
    <div
      ref={box}
      role="dialog"
      aria-label={station ? clean(station.name) : custom ? custom.name : 'Dropped pin'}
      data-testid="place-card"
      data-kind={station ? 'station' : 'terrain'}
      style={{ left: pos.left, top: pos.top, width: 316 }}
      className="absolute z-[35] border border-line-2 bg-black p-3.5 shadow-[0_8px_24px_rgba(0,0,0,0.6)]"
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button aria-label="Close" data-testid="place-close" onClick={() => set({ mapPopover: null })} className="absolute right-1.5 top-1.5 h-7 w-7 text-mute hover:text-ink">✕</button>
      {station ? (
        <div className="flex gap-3 pr-5">
          <div className="min-w-0 flex-1">
            <div className="eyebrow !text-[10.5px]" data-testid="place-kind">Science target</div>
            <div className="mt-0.5 text-[15px] font-semibold leading-tight text-ink" data-testid="place-title">{clean(station.name)}</div>
            <div className="mt-1 text-[12.5px] text-mute" data-testid="place-value">Science value {Math.round(station.value)} of 100 · {station.dwellMin} min stop</div>
          </div>
          {img && <img src={`${pack.base}/${img.file}`} alt="" data-testid="place-photo" className="h-14 w-14 shrink-0 object-cover ring-1 ring-line" />}
        </div>
      ) : (
        <>
          <div className="pr-6 text-[16px] font-semibold leading-tight text-ink" data-testid="place-title">{custom ? custom.name : 'Dropped pin'}</div>
          {pv && (
            <div className="num mt-1 text-[12px] leading-snug text-ink-2" data-testid="place-coords">
              {lat(pv.lat)} {lon(pv.lon)} · elev {Number.isFinite(pv.elevM) ? Math.round(pv.elevM) : '—'} m · slope {Number.isFinite(pv.slopeDeg) ? Math.round(pv.slopeDeg) : '—'}°
            </div>
          )}
        </>
      )}
      {station && <div className="mt-2 line-clamp-2 text-[13px] leading-snug text-ink-2" data-testid="place-why">{whyItMatters(station as never)}</div>}
      {station && <MineralLine x={station.x} y={station.y} />}
      {isPin && (
        <div
          data-testid="place-verdict"
          data-verdict={!mine || mine.status === 'checking' ? 'checking' : mine.verdict}
          className={`mt-2 text-[14.5px] font-semibold leading-snug ${!mine || mine.status === 'checking' ? 'mw-pulse text-mute' : mine.verdict === 'GO' ? 'text-ok' : 'text-red'}`}
        >
          {!mine || mine.status === 'checking'
            ? 'Checking…'
            : mine.verdict === 'GO'
              ? `GO · ${mine.walkMin !== undefined ? `~${Math.round(mine.walkMin)} min walk each way` : 'walk there and back'}${mine.spareMin !== undefined ? ` · back with ${hm(mine.spareMin)} spare` : ''}`
              : `NO-GO · ${mine.text}`}
        </div>
      )}
      {safety && (
        <div data-testid="place-safety" data-ok={pv!.ok ? '1' : '0'} className={`mt-2 text-[13.5px] leading-snug ${pv!.ok ? 'text-ok' : 'text-red'}`}>
          {safety}
        </div>
      )}
      {mine?.verdict === 'NO-GO' && (
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[13.5px]">
          <button data-testid="place-fix-closest" onClick={() => void fixFromPin('closest')} className="text-cyan hover:underline">Closest safe point</button>
          {mine.rule !== 'slope_max_deg' && <button data-testid="place-fix-rover" onClick={() => void fixFromPin('rover')} className="text-cyan hover:underline">Move rover closer</button>}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        {included ? (
          <Btn testId="place-remove" onClick={() => removeDestination(id!)}>Remove stop</Btn>
        ) : (
          <>
            <Btn testId="place-directions" primary onClick={() => directionsTo(target)}>
              <span className="inline-flex items-center gap-1.5">
                <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden><path d="M8 0.8 15.2 8 8 15.2 0.8 8Z" fill="currentColor" /><path d="M6 11V8.2h4M8.4 6.4 10.2 8.2 8.4 10" fill="none" stroke="#00e5ff" strokeWidth="1.5" /></svg>
                Directions
              </span>
            </Btn>
            {hasRoute && <Btn testId="place-add-stop" onClick={() => addStopAt(target)}>+ Add stop</Btn>}
          </>
        )}
      </div>
    </div>
  );
}

/** Right-click menu on the map. */
export function MapContextMenu({ root }: { root: RefObject<HTMLElement | null> }) {
  const ctx = useConsole((s) => s.ctxMenu);
  if (!ctx) return null;
  return <ContextMenuInner root={root} ctx={ctx} />;
}

function ContextMenuInner({ root, ctx }: { root: RefObject<HTMLElement | null>; ctx: NonNullable<ReturnType<typeof get>['ctxMenu']> }) {
  const W = root.current?.clientWidth ?? 1000;
  const H = root.current?.clientHeight ?? 700;
  const left = Math.min(ctx.px[0] + 2, W - 210);
  const top = Math.min(ctx.px[1] + 2, H - 140);
  const pack = get().pack!;
  // A right-click on a science target acts on that target.
  const st = ctx.stationId ? pack.manifest.stations.find((x) => x.id === ctx.stationId) ?? null : null;
  const target = st ? { stationId: st.id } : { cell: ctx.cell };
  const item = 'flex h-9 w-full items-center px-3 text-left text-[14px] text-ink hover:bg-cyan/15 hover:text-cyan';
  return (
    <div
      role="menu"
      data-testid="map-context-menu"
      style={{ left, top }}
      className="absolute z-[36] w-[200px] border border-line-2 bg-black py-1 shadow-[0_8px_24px_rgba(0,0,0,0.6)]"
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button role="menuitem" className={item} data-testid="ctx-directions" onClick={() => directionsTo(target)}>Directions to here</button>
      <button role="menuitem" className={item} data-testid="ctx-add-stop" onClick={() => { set({ ctxMenu: null }); addStopAt(target); }}>Add as stop</button>
      <button
        role="menuitem"
        className={item}
        data-testid="ctx-whats-here"
        onClick={() => set({ ctxMenu: null, mapPopover: st ? { kind: 'station', id: st.id, cell: st.cell, px: ctx.px } : { kind: 'terrain', cell: ctx.cell, px: ctx.px } })}
      >
        What's here?
      </button>
    </div>
  );
}
