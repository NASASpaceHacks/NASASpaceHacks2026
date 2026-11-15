import { useMemo } from 'react';
import { CRISM_RAMP, LOS_RAMP, ROUGH_RAMP, SLOPE_RAMP, TIME_RAMP, TI_RAMP, elevationRamp, type Ramp } from '@mw/shared/map';
import type { Provenance } from '@mw/shared/contracts';
import { toggleOverlay, toggleVector } from '../actions';
import { OVERLAY_LIMIT, set, useConsole } from '../store';
import { roverWxFor } from '../lib/weather';
import { sourceRows, type SourceRow } from '../lib/science';
import { demRange } from '../lib/layers';
import { fmtLtst, sunAtLtst } from '../lib/marsclock';
import type { OverlayId, VectorId } from '../lib/types';
import { Badge, SectionHead, Switch, cx } from './ui';

interface LegendSpec {
  ramp: Ramp;
  min: number;
  max: number;
  ticks: [number, string][];
  /** A highlighted threshold drawn under the ramp (e.g. the 20° slope limit). */
  mark?: { at: number; label: string };
}

interface LayerRow {
  key: string;
  name: string;
  what: string;
  source: string;
  unit?: string;
  on: boolean;
  toggle: () => void;
  legend?: LegendSpec;
  badge?: string;
  /** Raster overlay (counts toward the limit). */
  overlay?: boolean;
}

function provLine(p: Provenance[] | Provenance | undefined): string {
  const a = Array.isArray(p) ? p[0] : p;
  if (!a) return '';
  const inst = a.instrument.split(/\s*[,(]/)[0];
  const mission = a.mission.replace('Mars Reconnaissance Orbiter', 'MRO').replace(/ \+ .*$/, ' + others');
  return `${mission} · ${inst}${a.resolutionM ? ` · ${a.resolutionM} m` : ''}`;
}

/** Legend gradient: the map ramp's colours, made more opaque so they read on the black panel. */
function legendCss(r: Ramp, vmin: number, vmax: number): string {
  const span = vmax - vmin || 1;
  const inside = r.stops.filter(([v]) => v >= vmin && v <= vmax);
  const parts = (inside.length > 1 ? inside : r.stops).map(([v, [cr, cg, cb, a]]) => `rgba(${cr},${cg},${cb},${Math.min(1, a * 1.7).toFixed(2)}) ${Math.max(0, Math.min(100, ((v - vmin) / span) * 100)).toFixed(1)}%`);
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

function Legend({ l }: { l: LegendSpec }) {
  const pct = (v: number) => `${((v - l.min) / (l.max - l.min || 1)) * 100}%`;
  return (
    <div className="mt-1.5" data-testid="layer-legend">
      <div className="relative h-2.5 ring-1 ring-line-2" style={{ backgroundImage: legendCss(l.ramp, l.min, l.max), backgroundColor: '#000' }}>
        {l.mark && <span className="absolute -top-0.5 h-3.5 w-[2px] bg-red" style={{ left: pct(l.mark.at) }} />}
      </div>
      <div className="num relative mt-1 h-3 text-[10px] text-mute">
        {l.ticks.map(([v, t], i) => (
          <span key={t} className={cx('absolute whitespace-nowrap', i === 0 ? '' : i === l.ticks.length - 1 ? '-translate-x-full' : '-translate-x-1/2', l.mark && v === l.mark.at && 'text-red')} style={{ left: pct(v) }}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function Row({ r }: { r: LayerRow }) {
  return (
    <div data-testid={`layer-${r.key}`} data-on={r.on} className="py-2">
      <div className="flex items-start gap-2.5">
        <span className="mt-[3px]"><Switch on={r.on} onChange={r.toggle} label={r.name} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <button onClick={r.toggle} className={cx('text-left text-[13.5px] leading-tight', r.on ? 'text-ink' : 'text-ink-2 hover:text-ink')}>{r.name}</button>
            {r.unit && <span className="num text-[10.5px] text-dim">{r.unit}</span>}
            {r.badge && <Badge className="ml-auto">{r.badge}</Badge>}
          </div>
          <div className="mt-0.5 text-[11.5px] leading-snug text-mute">{r.what}</div>
          <div className="mt-0.5 truncate text-[10.5px] text-dim" title={r.source}>{r.source}</div>
          {r.on && r.legend && <Legend l={r.legend} />}
        </div>
      </div>
    </div>
  );
}

function Group({ title, sub, rows }: { title: string; sub?: string; rows: LayerRow[] }) {
  if (!rows.length) return null;
  return (
    <div className="border-t border-line px-4 pb-1 pt-2.5">
      <div className="eyebrow !text-[11px]">{title}{sub && <span className="ml-2 normal-case tracking-normal text-dim">{sub}</span>}</div>
      {rows.map((r) => <Row key={r.key} r={r} />)}
    </div>
  );
}

/** Layers panel: real data layers in groups, each with what it shows, its source, units and (when on) its legend. */
export function LayersPanel() {
  const overlays = useConsole((s) => s.overlays);
  const vectors = useConsole((s) => s.vectors);
  const limits = useConsole((s) => s.limits);
  const pack = useConsole((s) => s.pack);
  const start = useConsole((s) => s.startLtstMin);
  const ls = useConsole((s) => s.lsDeg);
  const evaBase = useConsole((s) => s.evaBase);
  if (!pack) return null;
  const m = pack.manifest;
  const R = m.rasters;
  const lim = {
    shelter: limits && Number.isFinite(limits.shelterMax) ? limits.shelterMax : 30,
    walkback: limits && Number.isFinite(limits.walkbackMax) ? Math.round(limits.walkbackMax) : 300,
    los: limits && Number.isFinite(limits.losGapMax) ? limits.losGapMax : 10,
    slope: limits && Number.isFinite(limits.slopeMax) ? limits.slopeMax : 20,
  };
  const [lo, hi] = demRange(pack);
  const sun = sunAtLtst(ls, start, m.grid.centerLonLat[1]);
  const base = m.shelters.find((s) => s.id === evaBase);
  const baseName = base ? (/\(([^)]+)\)\s*$/.exec(base.name)?.[1] ?? base.id) : 'the base';
  const ov = (id: OverlayId) => ({ on: overlays.includes(id), toggle: () => toggleOverlay(id), overlay: true });
  const vec = (id: VectorId) => ({ on: vectors[id], toggle: () => toggleVector(id) });
  const engine = 'Marswalk engine · from the DTM and the flight rules';

  const mars: LayerRow[] = [
    ...(m.imagery.length ? [{ key: 'imagery', name: 'Colour imagery', what: 'True-colour photo of the ground (base map).', source: provLine(m.imagery[0].provenance), ...vec('imagery') }] : []),
    { key: 'relief', name: 'Lighting at EVA start', what: `Sun direction/elevation at the planned start time (${fmtLtst(start)}: from ${Math.round(sun.azDeg)}°, ${Math.round(sun.elevDeg)}° up), shaded from the DTM normals.`, source: provLine(R.normals?.provenance ?? R.dem?.provenance), ...vec('relief') },
    { key: 'elevation', name: 'Elevation', unit: 'm', what: 'Height above the Mars datum: dark blue = low, white = high.', source: provLine(R.dem?.provenance), legend: { ramp: elevationRamp(lo, hi), min: lo, max: hi, ticks: [[lo, `${lo} m`], [(lo + hi) / 2, `${Math.round((lo + hi) / 2)}`], [hi, `${hi} m`]] }, ...ov('elevation') },
    { key: 'slope', name: 'Slope', unit: '°', what: `How steep the ground is. Red = ${lim.slope}° and steeper (NASA suited-walking limit).`, source: provLine(R.slope?.provenance), legend: { ramp: SLOPE_RAMP, min: 0, max: 35, ticks: [[0, '0°'], [10, '10°'], [lim.slope, `${lim.slope}°`], [35, '35°']], mark: { at: lim.slope, label: `${lim.slope}°` } }, ...ov('slope') },
    ...(R.rough ? [{ key: 'rough', name: 'Surface roughness', unit: 'm', what: 'Metre-scale bumpiness (rocks, ridges) inside each 5 m cell, from the 1 m DTM. White = rough.', source: provLine(R.rough.provenance), legend: { ramp: ROUGH_RAMP, min: 0, max: 0.5, ticks: [[0, '0 m'], [0.2, '0.2'], [0.5, '0.5 m']] as [number, string][] }, ...ov('rough') }] : []),
    ...(R.ti ? [{ key: 'ti', name: 'Thermal inertia', unit: 'J m⁻² K⁻¹ s⁻½', what: 'Loose sand (low) ↔ rock (high): sand makes walking slower and costlier.', source: provLine(R.ti.provenance), badge: R.ti.indicative ? 'Indicative' : undefined, legend: { ramp: TI_RAMP, min: 50, max: 700, ticks: [[50, 'sand 50'], [400, '400'], [700, '700 rock']] as [number, string][] }, ...ov('ti') }] : []),
    ...(R.crism_sindex2 ? [{ key: 'crism', name: 'Minerals (CRISM)', unit: 'sulfate signal', what: 'Where the orbiter sees a hydrated-sulfate spectral signature. Brighter violet = stronger signal. It marks a signature, not how much mineral is there.', source: `${provLine(R.crism_sindex2.provenance)} · ${(Array.isArray(R.crism_sindex2.provenance) ? R.crism_sindex2.provenance[0] : R.crism_sindex2.provenance).product.split(' ')[0].replace(/\.img$/, '')}`, badge: 'Indicative', legend: { ramp: CRISM_RAMP, min: 0.003, max: 0.0105, ticks: [[0.003, 'weak'], [0.0105, 'strong']] as [number, string][] }, ...ov('crism') }] : []),
  ];
  const safety: LayerRow[] = [
    { key: 'outline', name: 'Safe walking area', what: 'Outline of ground that meets every hard flight rule at once.', source: engine, ...vec('outline') },
    { key: 'walkback', name: 'Walk-back time', unit: 'min', what: `Time out plus a slow (half-pace) walk back to ${baseName}; hidden beyond ${lim.walkback} min.`, source: engine, legend: { ramp: { id: 'wb', stops: TIME_RAMP.stops.map(([v, c]) => [v * (lim.walkback / 30), c]) }, min: 0, max: lim.walkback, ticks: [[0, '0'], [lim.walkback / 2, `${Math.round(lim.walkback / 2)}`], [lim.walkback, `${lim.walkback} min`]] }, ...ov('walkback') },
    { key: 'shelter', name: 'Time to shelter', unit: 'min', what: `Walking minutes to the nearest hab or pressurized rover; hidden beyond the ${lim.shelter}-min limit.`, source: engine, legend: { ramp: TIME_RAMP, min: 0, max: lim.shelter, ticks: [[0, '0'], [lim.shelter / 2, `${lim.shelter / 2}`], [lim.shelter, `${lim.shelter} min`]] }, ...ov('shelter') },
    { key: 'los', name: 'Radio shadow', unit: 'min', what: 'Radio shadow: no line of sight to Hab-1 or PR-1. Clear = in contact; red-violet = out of contact, deeper = longer round trip.', source: `${engine} (terrain viewshed)`, legend: { ramp: LOS_RAMP, min: 0, max: 30, ticks: [[0, 'in contact'], [lim.los, `${lim.los} min`], [30, '30 min']], mark: { at: lim.los, label: `${lim.los} min limit` } }, ...ov('los') },
  ];
  const features: LayerRow[] = [
    { key: 'stations', name: 'Science targets', what: `${m.stations.length} real Curiosity sites, ranked by science priority.`, source: 'MSL (Curiosity) mission sites', ...vec('stations') },
    ...(m.traverse ? [{ key: 'traverse', name: 'Curiosity traverse', what: "The rover's real drive path (dotted line).", source: provLine(m.traverse.provenance as Provenance | Provenance[]), ...vec('traverse') }] : []),
    { key: 'keepouts', name: 'Keep-out zones', what: 'Red hatch: landing-plume and hazard zones a route may not enter.', source: 'Scenario (mission rules)', ...vec('keepouts') },
    { key: 'shelters', name: 'Habitat & rover', what: 'Square = Hab-1 · diamond = pressurized rover PR-1 (drag to move).', source: 'Scenario placements', ...vec('shelters') },
  ];
  const nOn = overlays.filter((o) => o !== 'safezone').length;

  return (
    <div data-testid="layers-panel" className="flex max-h-[min(680px,calc(100vh-180px))] w-[380px] flex-col phone:max-h-[70dvh] phone:w-full">
      <div className="flex items-baseline justify-between px-4 py-2.5">
        <span className="eyebrow !text-[12px]">Layers</span>
        <span className={cx('num text-[11px]', nOn >= OVERLAY_LIMIT ? 'text-ink' : 'text-dim')} data-testid="layers-limit">{nOn}/{OVERLAY_LIMIT} colour layers</span>
        <button aria-label="Close layers" data-testid="layers-close" onClick={() => set({ layersOpen: false })} className="hidden h-11 w-11 items-center justify-center self-center text-[15px] text-mute phone:flex">✕</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        <Group title="Mars data" rows={mars} />
        <Group title="Safety analysis" sub="computed by Marswalk" rows={safety} />
        <Group title="Mission features" rows={features} />
      </div>
    </div>
  );
}


const KIND_ORDER = ['optical', 'topographic', 'thermal', 'spectral', 'atmospheric', 'radiation', 'space weather', 'traverse', 'imagery'];

/** Every data layer with mission, instrument, resolution and citation (Details → Sources). */
export function SourcesSection() {
  const pack = useConsole((s) => s.pack);
  const fieldsSource = useConsole((s) => s.fieldsSource);
  const rows = useMemo(() => (pack ? sourceRows(pack.manifest) : []), [pack]);
  const rv = pack ? roverWxFor(pack.manifest) : { rover: 'Curiosity', instrument: 'REMS' };
  const groups = useMemo(() => {
    const g = new Map<string, SourceRow[]>();
    for (const r of rows) g.set(r.kind, [...(g.get(r.kind) ?? []), r]);
    return [...g.entries()].sort((a, b) => KIND_ORDER.indexOf(a[0]) - KIND_ORDER.indexOf(b[0]));
  }, [rows]);
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-2 text-[11.5px] leading-relaxed text-mute" data-testid="real-vs-scenario">
        <div className="border border-line-2 p-2.5"><span className="label !text-ok">Real NASA data</span><div className="mt-1 text-ink-2">Terrain (USGS/HiRISE DEM), imagery (HiRISE), thermal inertia (THEMIS), mineral signatures (CRISM), {rv.rover} traverse and photos, science targets (real {rv.rover} sites), {rv.instrument} weather, DONKI space weather.</div></div>
        <div className="border border-line-2 p-2.5"><span className="label !text-ink">Scenario</span><div className="mt-1 text-ink-2">Habitat, rover and landing-pad placements, the sol number, and crew parameters.</div></div>
      </div>
      <p className="text-[11.5px] leading-relaxed text-mute">
        Every layer on this map, with the mission, instrument, native resolution and citation it comes from. All layers share one Mars 2000 equidistant-cylindrical grid.
      </p>
      {groups.map(([kind, list]) => (
        <div key={kind}>
          <SectionHead>{kind}</SectionHead>
          <div className="mt-2 flex flex-col gap-2">
            {list.map((r, i) => (
              <div key={i} className="rounded-[3px] border border-line bg-sunk/60 p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[12px] font-medium text-ink">{r.layer}</span>
                  <span className="flex shrink-0 gap-1.5">
                    {r.indicative && <Badge tone="ochre">Indicative</Badge>}
                    <Badge tone={/synthetic|scenario|mock/i.test(`${r.prov.mission} ${r.prov.product}`) ? 'ochre' : 'cyan'}>{/synthetic|scenario|mock/i.test(`${r.prov.mission} ${r.prov.product}`) ? 'Scenario' : 'NASA data'}</Badge>
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-mute">{r.prov.mission} · {r.prov.instrument}</div>
                <div className="num mt-1 text-[10.5px] text-mute">
                  {r.prov.product}
                  {r.prov.resolutionM ? ` · ${r.prov.resolutionM} m/px` : ''}
                </div>
                {r.prov.accuracy && <div className="mt-1 text-[10.5px] text-dim">{r.prov.accuracy}</div>}
                <div className="mt-1.5 text-[10.5px] leading-snug text-ink-2/80">{r.prov.citation}</div>
                <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px]">
                  <span className="truncate text-dim">{r.prov.license}</span>
                  {/^https?:/.test(r.prov.url) && (
                    <a className="shrink-0 text-ok hover:underline" href={r.prov.url} target="_blank" rel="noreferrer">Source ↗</a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div>
        <SectionHead>Derived</SectionHead>
        <div className="mt-2 rounded-[3px] border border-line bg-sunk/60 p-2.5 text-[11px] leading-relaxed text-mute">
          Safe region, shelter time, walkback and line of sight are computed by the Marswalk engine from the DEM and the flight rules ({fieldsSource === 'server' ? 'hab server' : fieldsSource === 'engine' ? 'in-browser engine' : 'distance estimate while the engine is offline'}). Each rule cites its NASA source under Rules.
        </div>
      </div>
    </div>
  );
}

