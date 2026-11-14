import { useEffect, useRef } from 'react';
import type { CursorReadout } from '@mw/shared/map';
import type { StationState } from '@mw/shared/map';
import { addDestination, addPlace, goHere, attachMap, handleMapClick, moveShelter, removeDestination } from '../actions';
import { STM, whyItMatters } from '../lib/science';
import { get, set, useConsole } from '../store';
import { sunAtLtst } from '../lib/marsclock';
import { MapController } from './MapController';
import { MapHud } from '../components/MapHud';
import { DirectionsCard } from '../components/Directions';
import { previewCell } from '../lib/places';
import { cellToXY } from '@mw/shared/contracts';

function stationStateFn(): (id: string) => { state: StationState; order?: number } {
  const s = get();
  const plan = s.plan;
  const lastT = s.telem.length ? s.telem[s.telem.length - 1].t : -1;
  return (id: string) => {
    if (!s.stationOn[id]) return { state: s.uiMode === 'plan' ? 'choice' : 'idle' };
    const idx = plan?.order.indexOf(id) ?? -1;
    if (idx >= 0) {
      const stop = plan!.stops.find((x) => x.id === id);
      return { state: stop && lastT >= stop.departMin ? 'visited' : 'planned', order: idx + 1 };
    }
    if (plan?.dropped.some((d) => d.id === id)) return { state: 'dropped' };
    const di = s.destinations.indexOf(id);
    return di >= 0 ? { state: 'planned', order: di + 1 } : { state: 'idle' };
  };
}

/** OpenLayers map, created once per site pack and driven by store subscriptions (no React re-renders). */
export function MapView() {
  const el = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef<HTMLDivElement>(null);
  const pack = useConsole((s) => s.pack);

  useEffect(() => {
    if (!pack || !el.current) return;
    const writeReadout = (r: CursorReadout | null) => {
      const node = readoutRef.current;
      if (!node) return;
      const [a, b, c, d] = node.querySelectorAll<HTMLElement>('[data-v]');
      if (!r) {
        a.textContent = '—';
        b.textContent = '—';
        c.textContent = '—';
        d.textContent = '—';
        return;
      }
      a.textContent = `${Math.abs(r.lat).toFixed(5)}°${r.lat < 0 ? 'S' : 'N'}`;
      b.textContent = `${r.lon.toFixed(5)}°E`;
      c.textContent = Number.isFinite(r.elevM) ? `${r.elevM.toFixed(1)} m` : '—';
      d.textContent = Number.isFinite(r.slopeDeg) ? `${r.slopeDeg.toFixed(1)}°` : '—';
      d.style.color = r.slopeDeg > 20 ? '#ff3b30' : r.slopeDeg > 16.7 ? '#e9edf2' : '';
    };
    const ctrl = new MapController(el.current, pack, {
      onShelterMoved: moveShelter,
      onClick: handleMapClick,
      onReadout: writeReadout,
      onHoverStation: (id, px) => set({ hoverStation: id && px ? { id, x: px[0], y: px[1] } : null }),
    });
    attachMap(ctrl);
    if (scaleRef.current) ctrl.attachScale(scaleRef.current);
    requestAnimationFrame(() => ctrl.fit(0));

    const lat = pack.manifest.grid.centerLonLat[1];
    const applySun = () => {
      const s = get();
      const sun = sunAtLtst(s.lsDeg, s.startLtstMin, lat);
      ctrl.setSun(sun.azDeg, sun.elevDeg);
    };
    applySun();
    const s0 = get();
    ctrl.setOverlays(s0.overlays, s0.opacity);
    ctrl.setVectors(s0.vectors);
    if (s0.zone && s0.limits) ctrl.setZone(s0.zone, s0.limits, false);
    ctrl.setExtraStations(s0.customStops);
    ctrl.setBaseA(s0.evaBase);
    ctrl.setPlan(s0.plan, stationStateFn());
    ctrl.map.on('movestart', () => set({ mapPopover: null }));
    ctrl.setHazards(s0.hazards);

    const subs = [
      useConsole.subscribe((s) => [s.startLtstMin, s.lsDeg] as const, applySun, { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] }),
      useConsole.subscribe((s) => [s.overlays, s.opacity] as const, ([o, op]) => ctrl.setOverlays(o, op), { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] }),
      useConsole.subscribe((s) => s.vectors, (v) => ctrl.setVectors(v)),
      useConsole.subscribe((s) => s.plan, () => ctrl.setPlan(get().plan, stationStateFn())),
      useConsole.subscribe((s) => [s.stationOn, s.destinations, s.customStops, s.uiMode, s.mapPopover] as const, () => {
        const sx = get();
        const pin = sx.mapPopover?.kind === 'terrain' ? cellToXY(sx.pack!.manifest.grid, sx.mapPopover.cell) : null;
        ctrl.setExtraStations([...sx.customStops, ...(pin ? [{ id: 'PIN', name: 'Dropped pin', x: pin[0], y: pin[1], value: 0 }] : [])]);
        ctrl.refreshStations(stationStateFn());
      }),
      useConsole.subscribe((s) => s.evaBase, (id) => ctrl.setBaseA(id)),
      useConsole.subscribe((s) => s.hazards, (h) => ctrl.setHazards(h)),
      useConsole.subscribe((s) => s.shelterCells, (cells) => Object.entries(cells).forEach(([id, c]) => ctrl.setShelter(id, c))),
      useConsole.subscribe(
        (s) => s.telem,
        (t) => {
          ctrl.setTelemetry(t);
          ctrl.refreshStations(stationStateFn());
          const s = get();
          const last = t[t.length - 1];
          if (last && s.uiMode === 'live' && s.follow && !s.explain.running) ctrl.followCrew(last.cell);
        },
      ),
    ];
    const ro = new ResizeObserver(() => ctrl.map.updateSize());
    ro.observe(el.current);
    return () => {
      subs.forEach((u) => u());
      ro.disconnect();
      attachMap(null);
      ctrl.dispose();
    };
  }, [pack]);

  return (
    <div className="absolute inset-0">
      <div ref={el} className="mw-map absolute inset-0" />
      <DirectionsHost />
      <MapPopover />
      <MapHud readoutRef={readoutRef} scaleRef={scaleRef} />
    </div>
  );
}

function DirectionsHost() {
  const uiMode = useConsole((s) => s.uiMode);
  return uiMode === 'plan' ? <DirectionsCard /> : null;
}

function MapPopover() {
  const pop = useConsole((s) => s.mapPopover);
  const pack = useConsole((s) => s.pack);
  const dests = useConsole((s) => s.destinations);
  const customs = useConsole((s) => s.customStops);
  if (!pop || !pack) return null;
  const st = pop.kind === 'station' ? [...pack.manifest.stations, ...customs].find((x) => x.id === pop.id) : null;
  const added = !!st && dests.includes(st.id);
  const left = Math.max(8, pop.px[0] - 130);
  const top = pop.px[1] + 16;
  return (
    <div style={{ left, top }} className="absolute z-20 w-[300px] border border-line-2 bg-black p-3.5" data-testid="map-popover" onClick={(e) => e.stopPropagation()}>
      <button aria-label="Close" onClick={() => set({ mapPopover: null })} className="absolute right-2 top-1.5 h-7 w-7 rounded-md text-mute hover:text-ink">✕</button>
      {st ? (
        <>
          <div className="pr-6 text-[14.5px] font-semibold leading-tight text-ink">{st.name.replace(/\s*\([^)]*\)\s*$/, '')}</div>
          <div className="mt-1 text-[12px] text-mute">Science value {Math.round(st.value)} of 100 · {st.dwellMin} min at the stop</div>
          <div className="mt-2 line-clamp-4 text-[13px] leading-snug text-ink-2">{whyItMatters(st as never)}</div>
          {(() => {
            const obj = STM.objectives.find((o) => o.stations?.includes(st.id));
            return obj ? (
              <div className="mt-2 border-t border-line pt-2 text-[12.5px] leading-snug text-ink-2" data-testid="popover-objective">
                <span className="label !text-[11px]">Science objective </span>
                <span className="num text-[11px] text-mute">{obj.id}</span>
                <div className="line-clamp-4">{obj.statement}</div>
              </div>
            ) : null;
          })()}
          <button
            data-testid="popover-toggle"
            onClick={() => (added ? removeDestination(st.id) : addDestination(st.id))}
            className={`mt-3 h-11 w-full text-[16px] font-bold uppercase tracking-[0.14em] ${added ? 'border border-cyan bg-black text-cyan' : 'bg-cyan text-black hover:bg-white'}`}
          >
            {added ? 'Remove from walk' : 'Add to walk'}
          </button>
        </>
      ) : (
        <PinCard cell={pop.cell} />
      )}
    </div>
  );
}

function PinCard({ cell }: { cell: number }) {
  const pv = previewCell(get(), cell);
  const base = useConsole((s) => s.evaBase);
  if (!pv) return null;
  const sh = get().pack!.manifest.shelters.find((x) => x.id === base);
  const from = sh ? sh.name.replace(/^.*\(([^)]+)\)\s*$/, '$1') : 'start';
  return (
    <div data-testid="pin-card">
      <div className="pr-6 text-[17px] font-semibold leading-tight text-ink">Dropped pin</div>
      <div className="num mt-1 text-[12px] leading-snug text-ink-2">
        {pv.lon.toFixed(4)}°E {pv.lat.toFixed(4)}°N · elev {Number.isFinite(pv.elevM) ? Math.round(pv.elevM) : '—'} m · slope {Number.isFinite(pv.slopeDeg) ? Math.round(pv.slopeDeg) : '—'}°
      </div>
      <div data-testid="pin-safety" className={`mt-2 text-[14px] leading-snug ${pv.ok ? 'text-ok' : 'text-red'}`}>
        {pv.ok ? `${pv.minutes !== null ? `~${Math.round(pv.minutes)} min walk from ${from} · ` : ''}safe to stand` : `Can't go here safely: ${pv.reason}`}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button data-testid="pin-go" onClick={() => goHere(cell)} className="h-10 bg-cyan text-[15px] font-bold uppercase tracking-[0.14em] text-black hover:bg-white">Go here</button>
        <button data-testid="pin-add" onClick={() => addPlace(cell)} className="h-10 border border-cyan bg-black text-[15px] font-bold uppercase tracking-[0.1em] text-cyan hover:bg-cyan/10">Add as stop</button>
      </div>
    </div>
  );
}
