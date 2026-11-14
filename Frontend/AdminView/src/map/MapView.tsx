import { useEffect, useRef } from 'react';
import type { CursorReadout } from '@mw/shared/map';
import type { StationState } from '@mw/shared/map';
import { attachMap, handleMapClick, moveShelter } from '../actions';
import { get, set, useConsole } from '../store';
import { sunAtLtst } from '../lib/marsclock';
import { MapController } from './MapController';
import { MapHud } from '../components/MapHud';

function stationStateFn(): (id: string) => { state: StationState; order?: number } {
  const s = get();
  const plan = s.plan;
  const lastT = s.telem.length ? s.telem[s.telem.length - 1].t : -1;
  return (id: string) => {
    if (!s.stationOn[id]) return { state: 'disabled' };
    const idx = plan?.order.indexOf(id) ?? -1;
    if (idx >= 0) {
      const stop = plan!.stops.find((x) => x.id === id);
      return { state: stop && lastT >= stop.departMin ? 'visited' : 'planned', order: idx + 1 };
    }
    if (plan?.dropped.some((d) => d.id === id)) return { state: 'dropped' };
    return { state: 'idle' };
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
    ctrl.setPlan(s0.plan, stationStateFn());
    ctrl.setHazards(s0.hazards);

    const subs = [
      useConsole.subscribe((s) => [s.startLtstMin, s.lsDeg] as const, applySun, { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] }),
      useConsole.subscribe((s) => [s.overlays, s.opacity] as const, ([o, op]) => ctrl.setOverlays(o, op), { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] }),
      useConsole.subscribe((s) => s.vectors, (v) => ctrl.setVectors(v)),
      useConsole.subscribe((s) => s.plan, () => ctrl.setPlan(get().plan, stationStateFn())),
      useConsole.subscribe((s) => s.stationOn, () => ctrl.refreshStations(stationStateFn())),
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
      <MapHud readoutRef={readoutRef} scaleRef={scaleRef} />
    </div>
  );
}
