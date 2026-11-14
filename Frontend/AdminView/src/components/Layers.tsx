import { useMemo, useState, type JSX } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { LOS_RAMP, SLOPE_RAMP, TIME_RAMP, TI_RAMP, rampCss, type Ramp } from '@mw/shared/map';
import type { Provenance } from '@mw/shared/contracts';
import { applyPreset, setOpacity, toggleOverlay, toggleVector } from '../actions';
import { OVERLAY_LIMIT, PRESETS, useConsole } from '../store';
import { sourceRows, type SourceRow } from '../lib/science';
import type { OverlayId, PresetId, VectorId } from '../lib/types';
import { Badge, Kbd, SectionHead, Switch, cx } from './ui';

interface OverlayMeta {
  id: OverlayId;
  label: string;
  what: string;
  ramp?: Ramp;
  min?: number;
  max?: number;
  ticks?: [number, string][];
  raster?: string;
}

function overlayMeta(limits: { shelter: number; walkback: number; los: number; slope: number }): OverlayMeta[] {
  return [
    { id: 'safezone', label: 'Safe area shading', what: 'Darkens ground outside the safe area (every hard flight rule met at once).' },
    { id: 'shelter', label: 'Minutes to shelter', what: `Minutes to the nearest hab or pressurized rover; hidden beyond ${limits.shelter} min.`, ramp: TIME_RAMP, min: 0, max: Math.min(60, limits.shelter), ticks: [[0, '0'], [limits.shelter / 2, `${limits.shelter / 2}`], [limits.shelter, `${limits.shelter} min`]] },
    { id: 'walkback', label: 'Walk-back time', what: `Time out plus a slow (half-pace) walk back to the base; hidden beyond ${Math.round(limits.walkback)} min.`, ramp: { id: 'wb', stops: TIME_RAMP.stops.map(([v, c]) => [v * (limits.walkback / 30), c]) }, min: 0, max: limits.walkback, ticks: [[0, '0'], [limits.walkback, `${Math.round(limits.walkback)} min`]] },
    { id: 'los', label: 'Radio contact', what: 'Cyan = radio line of sight to the hab mast or the pressurized-rover relay. Shadow deepens with the round trip spent out of contact, timed on the terrain.', ramp: LOS_RAMP, min: 0, max: 30, ticks: [[0, 'LOS'], [limits.los, `${limits.los} min`], [30, '30']] },
    { id: 'slope', label: 'Slope', what: 'Amber from the 16.7° metabolic-data edge; red above the 20° suited-crew limit.', ramp: SLOPE_RAMP, min: 0, max: 35, ticks: [[0, '0°'], [16.7, '16.7'], [20, '20°'], [35, '35°']], raster: 'slope' },
    { id: 'ti', label: 'Thermal inertia', what: 'Low values suggest loose sand (slower, costlier walking). Indicative.', ramp: TI_RAMP, min: 50, max: 700, ticks: [[50, 'sand'], [400, '400'], [700, 'rock']], raster: 'ti' },
  ];
}

const VECTORS: { id: VectorId; label: string; legend: string }[] = [
  { id: 'outline', label: 'Safe-area outline', legend: 'Cyan line around ground that meets every hard rule (small steep patches inside are left out).' },
  { id: 'route', label: 'Route', legend: 'Amber line with arrows, in walking order.' },
  { id: 'stations', label: 'Stops', legend: 'Numbered = in the plan · hollow = left out.' },
  { id: 'stationDetail', label: 'Station values & left-out marks', legend: 'Science value next to each stop; red × = left out by a rule.' },
  { id: 'contours', label: 'Minutes-to-shelter lines', legend: 'Dashed lines every 10 min; amber = the shelter limit.' },
  { id: 'keepouts', label: 'Keep-out zones', legend: 'Red hatch: plume or hazard zones the route may not enter.' },
  { id: 'traverse', label: 'Curiosity traverse', legend: 'Dotted line: the rover\'s real drive path.' },
  { id: 'shelters', label: 'Hab + rover', legend: 'Cyan square = Hab-1 · diamond = pressurized rover (drag to move).' },
];

function Legend({ meta }: { meta: OverlayMeta }) {
  if (meta.id === 'safezone') {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-mute">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-3.5 rounded-[1px] border border-cyan bg-cyan/20" />Safe</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-3.5 rounded-[1px] bg-[#0a0b0e] ring-1 ring-line-2" />Excluded</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-3.5 rounded-[1px] bg-amber/60" />Rule being applied</span>
      </div>
    );
  }
  if (!meta.ramp) return null;
  const { min = 0, max = 1 } = meta;
  return (
    <div>
      <div className="h-2 rounded-[1px] ring-1 ring-line" style={{ background: rampCss(meta.ramp, min, max) }} />
      <div className="num relative mt-1 h-3 text-[9.5px] text-dim">
        {meta.ticks?.map(([v, t]) => (
          <span key={t} className="absolute -translate-x-1/2 whitespace-nowrap first:translate-x-0 last:-translate-x-full" style={{ left: `${((v - min) / (max - min)) * 100}%` }}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function provLine(p: Provenance[] | undefined): string {
  if (!p?.length) return '';
  const a = p[0];
  return `${a.mission} · ${a.instrument}${a.resolutionM ? ` · ${a.resolutionM} m` : ''}`;
}

function SymbolLegend() {
  const rows: [JSX.Element, string][] = [
    [<rect key="h" x="2.5" y="2.5" width="11" height="11" fill="#4FD1E0" stroke="#0b0d10" strokeWidth="1.5" />, 'Hab (primary shelter)'],
    [<rect key="r" x="3.5" y="3.5" width="9" height="9" transform="rotate(45 8 8)" fill="#E9E4D8" stroke="#0b0d10" strokeWidth="1.5" />, 'Pressurized rover · drag to move'],
    [<g key="p"><circle cx="8" cy="8" r="6" fill="#F2B544" stroke="#0b0d10" strokeWidth="1.5" /><text x="8" y="11" textAnchor="middle" fontSize="8" fill="#0b0d10" fontFamily="var(--font-mono)">1</text></g>, 'Station in plan (stop order)'],
    [<g key="d"><circle cx="8" cy="8" r="5.5" fill="#0b0d10" stroke="#FF5A4E" strokeWidth="1.5" /><text x="8" y="11" textAnchor="middle" fontSize="9" fill="#FF5A4E">×</text></g>, 'Station dropped by a rule'],
    [<path key="rt" d="M1 12 L15 4" stroke="#F2B544" strokeWidth="2.5" strokeLinecap="round" />, 'Route with direction arrows'],
    [<path key="iso" d="M1 10 C5 4, 11 14, 15 6" stroke="#4FD1E0" strokeWidth="1.2" strokeDasharray="2 2" fill="none" />, 'Minutes to shelter (amber = limit)'],
    [<g key="ko"><rect x="2" y="2" width="12" height="12" fill="none" stroke="#FF5A4E" strokeDasharray="3 2" /><path d="M2 10 L6 14 M2 6 L10 14 M2 2 L14 14 M6 2 L14 10 M10 2 L14 6" stroke="#FF5A4E" strokeOpacity="0.6" /></g>, 'Keep-out zone'],
    [<g key="ev"><circle cx="8" cy="8" r="6.5" fill="rgba(79,209,224,0.12)" stroke="#4FD1E0" strokeDasharray="2 2" /><circle cx="8" cy="8" r="3" fill="#4FD1E0" /></g>, 'EV1 position · 2σ uncertainty'],
  ];
  return (
    <div className="mt-2.5 grid grid-cols-1 gap-1.5">
      {rows.map(([icon, label]) => (
        <div key={label} className="flex items-center gap-2.5 text-[11px] text-mute">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="shrink-0">{icon}</svg>
          {label}
        </div>
      ))}
    </div>
  );
}

/** Layers popover content: presets (each with a one-line legend), then every layer on demand. */
export function LayersPanel() {
  const preset = useConsole((s) => s.preset);
  const overlays = useConsole((s) => s.overlays);
  const opacity = useConsole((s) => s.opacity);
  const vectors = useConsole((s) => s.vectors);
  const limits = useConsole((s) => s.limits);
  const fieldsSource = useConsole((s) => s.fieldsSource);
  const pack = useConsole((s) => s.pack);
  const [all, setAll] = useState(false);
  const lim = {
    shelter: limits && Number.isFinite(limits.shelterMax) ? limits.shelterMax : 30,
    walkback: limits && Number.isFinite(limits.walkbackMax) ? limits.walkbackMax : 300,
    los: limits && Number.isFinite(limits.losGapMax) ? limits.losGapMax : 10,
    slope: limits && Number.isFinite(limits.slopeMax) ? limits.slopeMax : 20,
  };
  const metas = overlayMeta(lim).filter((m) => !m.raster || pack?.rasters[m.raster]);
  const engineCredit = fieldsSource === 'server' ? 'Marswalk engine (hab server)' : fieldsSource === 'engine' ? 'Marswalk engine (in-browser)' : 'Distance estimate (engine offline)';
  const presetIds = Object.keys(PRESETS) as PresetId[];

  return (
    <div className="flex max-h-[min(640px,calc(100vh-200px))] w-[340px] flex-col">
      <div className="p-3">
        <div className="eyebrow px-1 pb-2">Map view</div>
        <div className="grid grid-cols-5 gap-1" role="radiogroup" aria-label="Map view">
          {presetIds.map((p, i) => (
            <button
              key={p}
              role="radio"
              aria-checked={preset === p}
              data-testid={`preset-${p}`}
              onClick={() => applyPreset(p)}
              title={`${PRESETS[p].hint} (${i})`}
              className={cx('flex h-11 flex-col items-center justify-center rounded-[6px] font-display text-[11px] uppercase tracking-[0.1em] transition-colors', preset === p ? 'bg-amber/15 text-amber' : 'text-ink-2 hover:bg-raised hover:text-ink')}
            >
              {PRESETS[p].label}
              <span className="num text-[9px] opacity-50">{i}</span>
            </button>
          ))}
        </div>
        <div data-testid="preset-legend" className="mt-2.5 rounded-[6px] bg-sunk/70 px-3 py-2 text-[12px] leading-snug text-ink-2">
          <span className="text-ink">{PRESETS[preset].hint}.</span> {PRESETS[preset].legend}
        </div>
      </div>
      <button onClick={() => setAll((v) => !v)} className="flex items-center justify-between px-4 py-2.5 text-left text-[12px] text-mute hover:text-ink" aria-expanded={all}>
        <span>All layers</span>
        <span className="num">{all ? '−' : '+'}</span>
      </button>
      {all && (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <div className="eyebrow pb-1 pt-1">Overlays <span className="num normal-case tracking-normal text-dim">· up to {OVERLAY_LIMIT}</span></div>
          {metas.map((m) => {
            const on = overlays.includes(m.id);
            const prov = m.raster ? pack?.manifest.rasters[m.raster]?.provenance : undefined;
            const indicative = m.raster ? pack?.manifest.rasters[m.raster]?.indicative : false;
            return (
              <div key={m.id} className="py-2">
                <div className="flex items-center gap-2.5">
                  <Switch on={on} onChange={() => toggleOverlay(m.id)} label={m.label} tone={m.id === 'safezone' || m.id === 'los' ? 'cyan' : 'amber'} />
                  <span className={cx('text-[12.5px]', on ? 'text-ink' : 'text-ink-2')}>{m.label}</span>
                  {indicative && <Badge tone="ochre">Indicative</Badge>}
                </div>
                <AnimatePresence initial={false}>
                  {on && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.16 }} className="overflow-hidden">
                      <div className="flex flex-col gap-2 pl-[38px] pt-2">
                        <div className="text-[11px] leading-snug text-mute">{m.what}</div>
                        <Legend meta={m} />
                        <div className="flex items-center gap-2">
                          <span className="label !text-[9px] w-12">Opacity</span>
                          <input className="mw-range" type="range" min={0.1} max={1} step={0.05} value={opacity[m.id]} onChange={(e) => setOpacity(m.id, Number(e.target.value))} aria-label={`${m.label} opacity`} />
                          <span className="num w-8 text-right text-[10px] text-mute">{Math.round(opacity[m.id] * 100)}</span>
                        </div>
                        <div className="text-[10.5px] text-dim">{prov ? provLine(prov) : engineCredit}</div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
          <div className="eyebrow pb-1 pt-3">Map features</div>
          {VECTORS.filter((v) => v.id !== 'traverse' || pack?.manifest.traverse).map((v) => (
            <div key={v.id} className="py-1.5">
              <label className="flex cursor-pointer items-center gap-2.5 text-[12.5px] text-ink-2 hover:text-ink">
                <Switch size="sm" on={vectors[v.id]} onChange={() => toggleVector(v.id)} label={v.label} />
                {v.label}
              </label>
              {vectors[v.id] && <div className="pl-[34px] pt-0.5 text-[11px] leading-snug text-dim">{v.legend}</div>}
            </div>
          ))}
          {!!pack?.manifest.imagery.length && (
            <label className="flex cursor-pointer items-center gap-2.5 py-1.5 text-[12.5px] text-ink-2 hover:text-ink">
              <Switch size="sm" on={vectors.imagery} onChange={() => toggleVector('imagery')} label="Orthoimage" />
              {pack.manifest.imagery[0].label}
            </label>
          )}
          <div className="eyebrow pb-1 pt-3">Map key</div>
          <SymbolLegend />
          <div className="mt-3 flex items-center gap-2 text-[10.5px] text-dim"><Kbd>0</Kbd>–<Kbd>4</Kbd> map views</div>
        </div>
      )}
    </div>
  );
}

const KIND_ORDER = ['optical', 'topographic', 'thermal', 'atmospheric', 'radiation', 'space weather', 'traverse', 'imagery'];

/** Every data layer with mission, instrument, resolution and citation (Details → Sources). */
export function SourcesSection() {
  const pack = useConsole((s) => s.pack);
  const fieldsSource = useConsole((s) => s.fieldsSource);
  const rows = useMemo(() => (pack ? sourceRows(pack.manifest) : []), [pack]);
  const groups = useMemo(() => {
    const g = new Map<string, SourceRow[]>();
    for (const r of rows) g.set(r.kind, [...(g.get(r.kind) ?? []), r]);
    return [...g.entries()].sort((a, b) => KIND_ORDER.indexOf(a[0]) - KIND_ORDER.indexOf(b[0]));
  }, [rows]);
  return (
    <div className="flex flex-col gap-5">
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
                  {r.indicative && <Badge tone="ochre">Indicative</Badge>}
                </div>
                <div className="mt-1 text-[11px] text-ochre">{r.prov.mission} · {r.prov.instrument}</div>
                <div className="num mt-1 text-[10.5px] text-mute">
                  {r.prov.product}
                  {r.prov.resolutionM ? ` · ${r.prov.resolutionM} m/px` : ''}
                </div>
                {r.prov.accuracy && <div className="mt-1 text-[10.5px] text-dim">{r.prov.accuracy}</div>}
                <div className="mt-1.5 text-[10.5px] leading-snug text-ink-2/80">{r.prov.citation}</div>
                <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px]">
                  <span className="truncate text-dim">{r.prov.license}</span>
                  {/^https?:/.test(r.prov.url) && (
                    <a className="shrink-0 text-cyan hover:underline" href={r.prov.url} target="_blank" rel="noreferrer">Source ↗</a>
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

