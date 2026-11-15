import { useEffect, useState, type ReactNode } from 'react';
import { switchSite } from '../actions';
import type { SiteInfo } from '../api';
import { useConsole } from '../store';
import { cx } from './ui';

interface Frame { file: string; lonMin: number; lonMax: number; latMin: number; latMax: number; credit?: string; source?: string }
interface Context {
  global: Frame;
  regional: Frame;
  aoi: { lonMin: number; lonMax: number; latMin: number; latMax: number; label?: string };
  labels?: { name: string; lon: number; lat: number }[];
}

const pos = (f: { lonMin: number; lonMax: number; latMin: number; latMax: number }, lon: number, lat: number) => {
  const l = lon < f.lonMin ? lon + 360 : lon > f.lonMax ? lon - 360 : lon;
  return { x: ((l - f.lonMin) / (f.lonMax - f.lonMin)) * 100, y: ((f.latMax - lat) / (f.latMax - f.latMin)) * 100 };
};

type Box = { lonMin: number; lonMax: number; latMin: number; latMax: number };

/** One fixed view: a real image with a cyan box on the next view's area (never smaller than `minPx`). */
function View({ base, frame, box, h, caption, alt, testId, minPx = 6, children }: { base: string; frame: Frame; box: Box; h: number; caption: string; alt: string; testId: string; minPx?: number; children?: ReactNode }) {
  const w = Math.round((h * (frame.lonMax - frame.lonMin)) / (frame.latMax - frame.latMin));
  const p0 = pos(frame, box.lonMin, box.latMax);
  const p1 = pos(frame, box.lonMax, box.latMin);
  const bx = ((p0.x + p1.x) / 2 / 100) * w, by = ((p0.y + p1.y) / 2 / 100) * h;
  const bw = Math.max(((p1.x - p0.x) / 100) * w, minPx), bh = Math.max(((p1.y - p0.y) / 100) * h, minPx);
  return (
    <figure data-testid={testId} className="m-0 shrink-0">
      <figcaption className="pb-1 font-display text-[11px] uppercase tracking-[0.1em] text-ink-2">{caption}</figcaption>
      <div className="relative overflow-hidden ring-1 ring-line-2" style={{ width: w, height: h }}>
        <img src={`${base}/context/${frame.file}`} alt={alt} width={w} height={h} className="block h-full w-full select-none object-fill" draggable={false} />
        <div className="absolute border-[1.5px] border-cyan" style={{ left: bx - bw / 2, top: by - bh / 2, width: bw, height: bh }} />
        {children}
      </div>
    </figure>
  );
}

const shortName = (n: string) => n.replace(/\s*[—–-]\s+.*$/, '');

/** Where a site sits on the Mars map: the middle of its study area (context.json aoi), else the pack centre. */
function sitePoint(info: SiteInfo, ctx: Context | undefined): [number, number] {
  const a = ctx?.aoi;
  return a ? [(a.lonMin + a.lonMax) / 2, (a.latMin + a.latMax) / 2] : info.centerLonLat;
}

/** One clickable marker per available site on the global Mars view. A click selects (no hover magic). */
function SiteMarkers({ frame, w, h, sites, ctxs, current }: { frame: Frame; w: number; h: number; sites: SiteInfo[]; ctxs: Record<string, Context>; current: string | null }) {
  return (
    <>
      {sites.map((st) => {
        const [lon, lat] = sitePoint(st, ctxs[st.id]);
        const p = pos(frame, lon, lat);
        const x = (p.x / 100) * w, y = (p.y / 100) * h;
        const here = st.id === current;
        const label = shortName(st.name).replace(/\s+crater$/i, ' crater');
        const left = x > w * 0.55; // keep labels inside the image
        return (
          <button
            key={st.id}
            type="button"
            data-testid={`locator-site-${st.id}`}
            data-current={here}
            aria-label={here ? `${label} (current site)` : `Switch to ${label}`}
            aria-current={here ? 'true' : undefined}
            title={here ? `${label} (current site)` : `Switch to ${label}`}
            onClick={() => { if (!here) void switchSite(st.id); }}
            className="group absolute flex h-6 items-center focus-visible:outline focus-visible:outline-1 focus-visible:outline-cyan"
            style={{ left: left ? x - 12 : x - 12, top: y - 12, width: 24, cursor: here ? 'default' : 'pointer' }}
          >
            <span aria-hidden className={cx('absolute left-1/2 top-1/2 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border', here ? 'border-cyan bg-cyan' : 'border-white bg-black group-hover:bg-cyan')} />
            <span
              aria-hidden
              className={cx('pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap bg-black/75 px-1 font-display text-[10px] uppercase tracking-[0.06em]', here ? 'text-cyan' : 'text-ink')}
              style={left ? { right: 22 } : { left: 22 }}
            >
              {label}
            </span>
          </button>
        );
      })}
    </>
  );
}

/** "Where on Mars": two fixed real-image views side by side — Mars (box on Gale) → Gale crater (box on the study area). Collapse/expand only. */
export function Locator() {
  const pack = useConsole((s) => s.pack);
  const live = useConsole((s) => s.uiMode === 'live');
  const [ctx, setCtx] = useState<Context | null>(null);
  const sites = useConsole((s) => s.sites);
  const siteId = useConsole((s) => s.siteId);
  const [open, setOpen] = useState(true);
  const [siteCtx, setSiteCtx] = useState<Record<string, Context>>({});

  useEffect(() => {
    if (!pack) return;
    let alive = true;
    fetch(`${pack.base}/context/context.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j?.global && j?.regional && j?.aoi) setCtx(j as Context); })
      .catch(() => {});
    return () => { alive = false; };
  }, [pack]);

  // Every available site's context.json (study-area position for its marker on the Mars view).
  useEffect(() => {
    let alive = true;
    for (const st of sites) {
      if (!st.available || st.id === pack?.manifest.id) continue;
      fetch(`/sitepacks/${st.id}/context/context.json`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (alive && j?.aoi) setSiteCtx((c) => ({ ...c, [st.id]: j as Context })); })
        .catch(() => {});
    }
    return () => { alive = false; };
  }, [sites, pack]);

  if (!pack || !ctx) return null;
  const H = 92;
  const credit = ctx.global.credit ?? ctx.global.source ?? '';
  const site = ctx.labels?.find((l) => new RegExp(shortName(pack.manifest.name).split(/\s+/)[0], 'i').test(l.name))?.name ?? shortName(pack.manifest.name);
  const ctxs = { ...siteCtx, [pack.manifest.id]: ctx };
  const marked = sites.filter((x) => x.available);
  const gw = Math.round((H * (ctx.global.lonMax - ctx.global.lonMin)) / (ctx.global.latMax - ctx.global.latMin));

  return (
    <div
      data-testid="locator"
      data-open={open}
      className={cx('absolute right-3 z-20 border border-line-2 bg-black', live ? 'bottom-[196px]' : 'bottom-[152px]')}
      style={{ maxWidth: 'calc(100% - 24px)' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2 px-2 py-1">
        <span className="eyebrow !text-[11px]">Where on Mars</span>
        <button aria-label={open ? 'Collapse locator' : 'Expand locator'} aria-expanded={open} data-testid="locator-toggle" onClick={() => setOpen((o) => !o)} className="num h-5 w-5 text-[12px] text-cyan">{open ? '–' : '+'}</button>
      </div>
      {open && (
        <>
          <div className="flex items-end gap-1.5 px-2">
            <View base={pack.base} frame={ctx.global} box={ctx.regional} h={H} caption="Mars" alt={`Mars global map with ${marked.length > 1 ? 'the available sites' : 'a box on the study site'}`} testId="locator-mars">
              {marked.length > 0 && <SiteMarkers frame={ctx.global} w={gw} h={H} sites={marked} ctxs={ctxs} current={siteId} />}
            </View>
            <span aria-hidden className="pb-[38px] text-[12px] text-cyan">→</span>
            <View base={pack.base} frame={ctx.regional} box={ctx.aoi} h={H} caption={site}  alt={`Regional view of ${site} with the study area`} testId="locator-gale" minPx={5} />
          </div>
          <div className="max-w-[300px] px-2 py-1 text-[9.5px] leading-snug text-dim">{credit}</div>
        </>
      )}
    </div>
  );
}
