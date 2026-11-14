import { useEffect, useRef } from 'react';
import type { CursorReadout } from '@mw/shared/map';
import type { StationState } from '@mw/shared/map';
import { addCustomStop, addDestination, attachMap, handleMapClick, moveShelter, removeDestination } from '../actions';
import { whyItMatters } from '../lib/science';
import { get, set, useConsole } from '../store';
import { sunAtLtst } from '../lib/marsclock';
import { MapController } from './MapController';
import { MapHud } from '../components/MapHud';

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
      d.style.color = r.slopeDeg > 20 ? '#FF5A4E' : r.slopeDeg > 16.7 ? '#F2B544' : '';
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
      useConsole.subscribe((s) => [s.stationOn, s.destinations, s.customStops, s.uiMode] as const, () => {
        ctrl.setExtraStations(get().customStops);
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
      <RouteHint />
      <MapPopover />
      <MapHud readoutRef={readoutRef} scaleRef={scaleRef} />
    </div>
  );
}

function RouteHint() {
  const empty = useConsole((s) => s.destinations.length === 0 && s.uiMode === 'plan');
  if (!empty) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-5 z-10 w-[min(560px,80%)] -translate-x-1/2 rounded-[12px] bg-panel/90 px-5 py-3.5 text-center text-[15px] leading-snug text-ink shadow-xl ring-1 ring-white/[0.08] backdrop-blur" data-testid="route-hint">
      Choose where to start, then click targets to add them to today&rsquo;s walk &mdash; or let the planner suggest the best stops.
    </div>
  );
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
    <div style={{ left, top }} className="absolute z-20 w-[260px] rounded-[12px] bg-panel p-3.5 shadow-2xl ring-1 ring-white/[0.1]" data-testid="map-popover" onClick={(e) => e.stopPropagation()}>
      <button aria-label="Close" onClick={() => set({ mapPopover: null })} className="absolute right-2 top-1.5 h-7 w-7 rounded-md text-mute hover:text-ink">✕</button>
      {st ? (
        <>
          <div className="pr-6 text-[14.5px] font-semibold leading-tight text-ink">{st.name.replace(/\s*\([^)]*\)\s*$/, '')}</div>
          <div className="mt-1 text-[12px] text-mute">Science value {Math.round(st.value)} of 100 · {st.dwellMin} min at the stop</div>
          <div className="mt-2 line-clamp-4 text-[12.5px] leading-snug text-ink-2">{whyItMatters(st as never)}</div>
          <button
            data-testid="popover-toggle"
            onClick={() => (added ? removeDestination(st.id) : addDestination(st.id))}
            className={`mt-3 h-11 w-full rounded-[8px] text-[14px] font-semibold ${added ? 'bg-raised text-ink ring-1 ring-line-2' : 'bg-amber text-[#16110a] hover:bg-[#ffc65c]'}`}
          >
            {added ? 'Remove from walk' : 'Add to walk'}
          </button>
        </>
      ) : (
        <>
          <div className="pr-6 text-[13.5px] text-ink">Nothing here yet.</div>
          <button data-testid="add-custom-stop" onClick={() => { const c = pop.cell; set({ mapPopover: null }); addCustomStop(c); }} className="mt-2.5 h-11 w-full rounded-[8px] bg-amber text-[14px] font-semibold text-[#16110a] hover:bg-[#ffc65c]">
            Add custom stop here
          </button>
        </>
      )}
    </div>
  );
}
