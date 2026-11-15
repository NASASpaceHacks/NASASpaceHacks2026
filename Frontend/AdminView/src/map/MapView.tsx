import { useEffect, useRef } from 'react';
import type { CursorReadout } from '@mw/shared/map';
import type { StationState } from '@mw/shared/map';
import { attachMap, handleMapClick, moveDestination, moveShelter, openContextMenu } from '../actions';
import { get, set, useConsole } from '../store';
import { sunAtLtst } from '../lib/marsclock';
import { MapController } from './MapController';
import { Locator } from '../components/Locator';
import { MapHud } from '../components/MapHud';
import { DirectionsCard } from '../components/Directions';
import { PlaceCard, MapContextMenu } from '../components/PlaceCard';
import { cellToXY, xyToCell as xyToCellSafe } from '@mw/shared/contracts';
import type { DestMarker } from './MapController';

function stationStateFn(): (id: string) => { state: StationState; order?: number } {
  const s = get();
  const plan = s.plan;
  const lastT = s.telem.length ? s.telem[s.telem.length - 1].t : -1;
  return (id: string) => {
    if (!s.stationOn[id]) return { state: s.uiMode === 'plan' ? 'choice' : 'idle' };
    // Plan mode: route stops are drawn as lettered markers (B, C…) on their own layer.
    if (s.uiMode === 'plan' && s.destinations.includes(id)) return { state: 'idle' };
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
/** Route stops as lettered markers (plan mode) + the temporary dropped pin. */
function destMarkers(): { list: DestMarker[]; pin: [number, number] | null } {
  const s = get();
  const pack = s.pack!;
  const g = pack.manifest.grid;
  const all = [...pack.manifest.stations, ...s.customStops];
  const plan = s.planStatus === 'ready' ? s.plan : null;
  const list: DestMarker[] =
    s.uiMode !== 'plan'
      ? []
      : s.destinations.flatMap((id, i) => {
          const st = all.find((x) => x.id === id);
          if (!st) return [];
          const name = st.name.replace(/\s*\([^)]*\)\s*$/, '');
          return [{ id, letter: String.fromCharCode(66 + i), name, x: st.x, y: st.y, bad: !!plan && !plan.order.includes(id) }];
        });
  const pop = s.mapPopover;
  const pin = pop?.kind === 'terrain' && !pop.id ? cellToXY(g, pop.cell) : null;
  return { list, pin };
}

export function MapView() {
  const rootRef = useRef<HTMLDivElement>(null);
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
      onDestMoved: moveDestination,
      onContext: openContextMenu,
      onReadout: writeReadout,
      onHoverShelter: (id, px) => set({ hoverShelter: id && px ? { id, x: px[0], y: px[1] } : null }),
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
    const syncDest = () => {
      const d = destMarkers();
      ctrl.setDestinations(d.list, d.pin);
    };
    syncDest();
    ctrl.setPickMode(s0.pickOnMap);
    ctrl.map.on('movestart', () => get().ctxMenu && set({ ctxMenu: null }));
    // The place card follows its spot while the map pans or zooms.
    ctrl.map.on('postrender', () => {
      const p = get().mapPopover;
      if (!p) return;
      const st = p.kind === 'station' && p.id ? pack.manifest.stations.find((x) => x.id === p.id) : null;
      const xy = st ? [st.x, st.y] : cellToXY(pack.manifest.grid, p.cell);
      const px = ctrl.map.getPixelFromCoordinate(xy);
      if (px && (Math.abs(px[0] - p.px[0]) > 0.5 || Math.abs(px[1] - p.px[1]) > 0.5)) set({ mapPopover: { ...p, px: [px[0], px[1]] } });
    });
    ctrl.setHazards(s0.hazards);
    // Way-forward suggestion (closest safe point / rover parking spot) on the map.
    const syncFix = () => {
      const f = get().fix;
      if (!f || f.status !== 'found' || f.cell === undefined) return ctrl.setSuggestion(null);
      const s = get();
      const g0 = pack.manifest.grid;
      const xy = cellToXY(g0, f.cell) as [number, number];
      const st = [...pack.manifest.stations, ...s.customStops].find((x) => x.id === f.destId);
      const m = (f.distM ?? 0) >= 1000 ? `${((f.distM ?? 0) / 1000).toFixed(1)} km` : `${f.distM} m`;
      ctrl.setSuggestion(
        f.kind === 'closest'
          ? { kind: 'closest', xy, from: st ? [st.x, st.y] : undefined, label: `Closest safe point · ${m} short of ${f.destId.startsWith('P') ? 'your pin' : 'the target'}` }
          : { kind: 'rover', xy, label: 'Suggested rover position (drive route not planned)' },
      );
      ctrl.reveal([xy, ...(st ? [[st.x, st.y] as [number, number]] : [])]);
    };

    const subs = [
      useConsole.subscribe((s) => [s.startLtstMin, s.lsDeg] as const, applySun, { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] }),
      useConsole.subscribe((s) => [s.overlays, s.opacity] as const, ([o, op]) => ctrl.setOverlays(o, op), { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] }),
      useConsole.subscribe((s) => s.vectors, (v) => ctrl.setVectors(v)),
      useConsole.subscribe((s) => s.plan, () => ctrl.setPlan(get().plan, stationStateFn())),
      useConsole.subscribe((s) => [s.stationOn, s.destinations, s.customStops, s.uiMode] as const, () => {
        ctrl.setExtraStations(get().customStops);
        ctrl.refreshStations(stationStateFn());
      }, { equalityFn: (a, b) => a.every((v, i) => v === b[i]) }),
      useConsole.subscribe((s) => [s.destinations, s.customStops, s.uiMode, s.plan, s.planStatus, s.mapPopover?.kind, s.mapPopover?.cell, s.mapPopover?.id] as const, syncDest, {
        equalityFn: (a, b) => a.every((v, i) => v === b[i]),
      }),
      useConsole.subscribe((s) => s.pickOnMap, (on) => ctrl.setPickMode(on)),
      useConsole.subscribe((s) => s.fix, syncFix),
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
    // Read-only geometry hook for the real-input interaction tests (qa/e2e/interactions.spec.ts): where
    // things are on screen, in client pixels. Tests then drive the map with real mouse/keyboard events.
    const g = pack.manifest.grid;
    const toClient = (xy: number[]): [number, number] | null => {
      const px = ctrl.map.getPixelFromCoordinate(xy);
      const r = ctrl.map.getViewport()?.getBoundingClientRect();
      return px && r ? [Math.round(r.left + px[0]), Math.round(r.top + px[1])] : null;
    };
    (window as unknown as { __mwTest: unknown }).__mwTest = {
      station: (id: string) => {
        const st = pack.manifest.stations.find((x) => x.id === id);
        return st ? toClient([st.x, st.y]) : null;
      },
      shelter: (id: string) => {
        const sh = pack.manifest.shelters.find((x) => x.id === id);
        return sh ? toClient(cellToXY(g, get().shelterCells[id] ?? sh.cell)) : null;
      },
      suggestion: () => {
        const xy = ctrl.suggestionXY();
        return xy ? toClient(xy) : null;
      },
      dest: (letter: string) => {
        const d = destMarkers().list.find((x) => x.letter === letter);
        return d ? toClient([d.x, d.y]) : null;
      },
      /** A visible, feature-free spot: 'steep' (> 24°) or 'flat' (< 6°), optionally within `withinPx` of a client point. */
      find: (kind: 'steep' | 'flat', near?: [number, number], withinPx = 200) => {
        const r = ctrl.map.getViewport()?.getBoundingClientRect();
        if (!r) return null;
        let best: [number, number] | null = null;
        let bd = Infinity;
        for (let y = r.top + 60; y < r.bottom - 70; y += 6) {
          for (let x = r.left + 420; x < r.right - 260; x += 6) {
            const px = [x - r.left, y - r.top];
            const c = ctrl.map.getCoordinateFromPixel(px);
            if (!c) continue;
            let ok = true;
            // The whole 5×5-cell neighbourhood must match, so a few pixels of jitter can't change the answer.
            for (let dy = -2; dy <= 2 && ok; dy++) for (let dx = -2; dx <= 2 && ok; dx++) {
              const cell = xyToCellSafe(g, c[0] + dx * g.cellM, c[1] + dy * g.cellM);
              const sl = cell >= 0 ? pack.rasters.slope[cell] : NaN;
              ok = kind === 'steep' ? sl > 24 : sl < 6;
            }
            if (!ok || ctrl.map.getFeaturesAtPixel(px, { hitTolerance: 16 }).length) continue;
            const d = near ? Math.hypot(x - near[0], y - near[1]) : 0;
            if (near && d > withinPx) continue;
            if (d < bd) {
              bd = d;
              best = [Math.round(x), Math.round(y)];
              if (!near) return best;
            }
          }
        }
        return best;
      },
    };

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
    <div ref={rootRef} className="absolute inset-0">
      <div ref={el} className="mw-map absolute inset-0" />
      <DirectionsHost />
      <PlaceCard root={rootRef} />
      <MapContextMenu root={rootRef} />
      <MapHud readoutRef={readoutRef} scaleRef={scaleRef} />
      <Locator />
    </div>
  );
}

function DirectionsHost() {
  const uiMode = useConsole((s) => s.uiMode);
  return uiMode === 'plan' ? <DirectionsCard /> : null;
}
