import { useEffect, useRef } from 'react';
import type { RoutePrefs } from '@mw/shared/contracts';
import { ROUTE_PRESETS } from '@mw/shared/contracts';
import { prefsLabel, setPrefs } from '../actions';
import { clearCompare, compareRoutes } from '../compare';
import { hm } from '../lib/plain';
import { set, useConsole } from '../store';
import { cx } from './ui';

type Key = Exclude<keyof RoutePrefs, 'preset'>;

const SLIDERS: { key: Key; label: string }[] = [
  { key: 'distance', label: 'Walking time' },
  { key: 'slope', label: 'Slope effort' },
  { key: 'rough', label: 'Terrain safety (roughness)' },
  { key: 'thermal', label: 'Firm ground (thermal inertia, THEMIS)' },
  { key: 'radio', label: 'Stay in radio contact' },
  { key: 'science', label: 'Science-rich (minerals, CRISM)' },
];

export const isDefaultPrefs = (p: RoutePrefs) => p.preset === 'default' || p.preset === undefined;

export function openRouteOptions(open = true) {
  set({ routeOptions: open });
}

/** Small "Priorities: …" line (verdict panel, crew brief). Hidden for the default profile. */
export function PrefsLine({ className }: { className?: string }) {
  const prefs = useConsole((s) => s.prefs);
  if (isDefaultPrefs(prefs)) return null;
  return <span data-testid="verdict-prefs" className={className}>Priorities: {prefsLabel(prefs)}</span>;
}

/** Small "Compare routes" link under a verdict: opens the options panel and plans one route per preset. */
export function CompareLink({ className }: { className?: string }) {
  const hasDests = useConsole((s) => s.destinations.length > 0);
  const live = useConsole((s) => s.uiMode === 'live');
  if (!hasDests || live) return null;
  return (
    <button data-testid="compare-routes-link" onClick={() => { openRouteOptions(); void compareRoutes(); }} className={cx('text-[12.5px] text-cyan hover:underline', className)}>
      Compare routes
    </button>
  );
}

const verdictInk = { GO: 'text-ok', CAUTION: 'text-ink', 'NO-GO': 'text-red' } as const;

/** Route options: priority presets and sliders (like Maps' "Options: avoid tolls"), and the route comparison. */
export function RouteOptionsPanel({ anchorSelector }: { anchorSelector: string }) {
  const open = useConsole((s) => s.routeOptions);
  const prefs = useConsole((s) => s.prefs);
  const pack = useConsole((s) => s.pack)!;
  const hasDests = useConsole((s) => s.destinations.length > 0);
  const compare = useConsole((s) => s.compare);
  const planStatus = useConsole((s) => s.planStatus);
  const ref = useRef<HTMLDivElement>(null);
  const hasCrism = !!pack.rasters.crism_sindex2;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      openRouteOptions(false);
      (document.querySelector(anchorSelector) as HTMLElement | null)?.focus();
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current?.contains(t) || t.closest?.(anchorSelector) || t.closest?.('[data-testid="compare-routes-link"]')) return;
      openRouteOptions(false);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open, anchorSelector]);
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLElement>('[data-testid^="prefs-preset-"]')?.focus();
    else clearCompare();
  }, [open]);
  if (!open) return null;

  const presets = ROUTE_PRESETS.filter((p) => p.id !== 'science' || hasCrism);
  const custom = !ROUTE_PRESETS.some((p) => p.id === prefs.preset);
  const move = (key: Key, v: number) => setPrefs({ ...prefs, [key]: v, preset: 'custom' });
  const rows = compare?.rows ?? [];

  return (
    <div ref={ref} data-testid="route-options-panel" role="dialog" aria-label="Route priorities" className={cx('absolute left-[404px] top-3 z-40 max-h-[calc(100%-96px)] overflow-y-auto border border-line-2 bg-black', 'w-[640px] max-w-[calc(100%-420px)] phone:fixed phone:inset-0 phone:left-0 phone:top-0 phone:z-[70] phone:max-h-none phone:w-auto phone:max-w-none')} onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center border-b border-line px-3 py-2">
        <span className="eyebrow !text-[11px]">Route priorities</span>
        <button aria-label="Close route options" onClick={() => openRouteOptions(false)} className="ml-auto h-7 w-7 text-[15px] text-mute hover:text-cyan phone:h-11 phone:w-11">✕</button>
      </div>

      <div className="px-3 pb-1 pt-3">
        <div className="text-[13px] text-ink-2">What should the route favour?</div>
        <div role="radiogroup" aria-label="Priorities" className="mt-2 flex flex-wrap gap-1.5">
          {[...presets.map((p) => ({ id: p.id, label: p.label, blurb: p.blurb, on: prefs.preset === p.id })), { id: 'custom', label: 'Custom', blurb: 'Your own mix of priorities', on: custom }].map((p) => (
            <button
              key={p.id}
              role="radio"
              aria-checked={p.on}
              data-testid={`prefs-preset-${p.id}`}
              title={p.blurb}
              disabled={p.id === 'custom'}
              onClick={() => { const pr = ROUTE_PRESETS.find((x) => x.id === p.id); if (pr) setPrefs(pr.prefs); }}
              className={cx('h-8 border px-2.5 text-[13.5px] focus:outline-none focus-visible:border-cyan', p.on ? 'border-cyan bg-cyan/15 text-ink' : 'border-line-2 text-ink-2 hover:border-cyan', p.id === 'custom' && !p.on && 'opacity-60')}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="mt-1.5 text-[12px] leading-snug text-mute">{custom ? 'Your own mix of priorities' : ROUTE_PRESETS.find((p) => p.id === prefs.preset)?.blurb}</div>
      </div>

      <ul className="grid grid-cols-2 gap-x-6 gap-y-2 px-3 py-3">
        {SLIDERS.map(({ key, label }) => {
          const off = key === 'science' && !hasCrism;
          const id = `prefs-${key}`;
          return (
            <li key={key}>
              <div className="flex items-baseline gap-2">
                <label htmlFor={id} className={cx('text-[13.5px]', off ? 'text-dim' : 'text-ink')}>{label}</label>
                <span data-testid={`prefs-value-${key}`} className="num ml-auto text-[12.5px] text-mute">{off ? '—' : `${Math.round(prefs[key] * 100)}%`}</span>
              </div>
              <input
                id={id}
                data-testid={`prefs-slider-${key}`}
                className={cx('mw-range', off && 'opacity-40')}
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={off ? 0 : prefs[key]}
                disabled={off}
                onChange={(e) => move(key, Number(e.target.value))}
              />
              {off && <div className="text-[12px] text-mute">No mineral map for this site</div>}
            </li>
          );
        })}
      </ul>

      <div className="border-t border-line px-3 py-2.5">
        <div className="flex items-center gap-3">
          <button data-testid="compare-routes" disabled={!hasDests || compare?.status === 'running'} onClick={() => void compareRoutes()} className="text-[13.5px] text-cyan hover:underline disabled:text-dim disabled:no-underline">
            Compare routes
          </button>
          {!hasDests && <span className="text-[12px] text-mute">Choose a destination first</span>}
          {compare?.status === 'running' && <span data-testid="compare-running" className="mw-pulse text-[12.5px] text-mute">Comparing…</span>}
          {compare?.status === 'error' && <span className="text-[12.5px] text-red">Couldn't compare routes</span>}
        </div>
        {compare?.status === 'done' && rows.length > 0 && (
          <div className="mt-2 overflow-x-auto">
            <table data-testid="compare-table" className="w-full border-collapse text-left text-[12.5px] phone:min-w-[620px]">
              <thead>
                <tr className="text-[11px] text-dim">
                  {['Route', 'Verdict', 'Stops · science', 'Time', 'Distance', 'Steepest', 'Longest radio gap', 'Spare'].map((h, i) => <th key={h} className={cx('pb-1 pr-2 font-normal', i > 1 && 'text-right')}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const cur = r.id === prefs.preset;
                  return (
                    <tr
                      key={r.id}
                      data-testid={`compare-row-${r.id}`}
                      data-current={cur ? 'true' : undefined}
                      tabIndex={0}
                      aria-label={`${r.label}${cur ? ', current' : ''}. Apply these priorities`}
                      onClick={() => { const pr = ROUTE_PRESETS.find((x) => x.id === r.id); if (pr) setPrefs(pr.prefs); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } }}
                      className={cx('cursor-pointer border-t border-line hover:bg-cyan/10 focus:bg-cyan/10 focus:outline-none', cur && 'bg-cyan/15')}
                    >
                      <td className="py-1.5 pr-2 text-ink">{r.label}{cur && <span className="ml-1.5 border border-cyan px-1 text-[10.5px] text-cyan">Current</span>}</td>
                      <td className={cx('py-1.5 pr-2', verdictInk[r.verdict])}>{r.verdict}</td>
                      <td className="num whitespace-nowrap py-1.5 pr-2 text-right text-ink-2" title="Stops kept · their summed science value">{r.stops === null ? '—' : `${r.stops} · ${Math.round(r.science ?? 0)}`}</td>
                      <td className="num whitespace-nowrap py-1.5 pr-2 text-right text-ink-2">{r.timeMin === null ? '—' : hm(r.timeMin)}</td>
                      <td className="num whitespace-nowrap py-1.5 pr-2 text-right text-ink-2">{r.distM === null ? '—' : `${(r.distM / 1000).toFixed(2)} km`}</td>
                      <td className="num whitespace-nowrap py-1.5 pr-2 text-right text-ink-2">{r.steepDeg === null ? '—' : `${r.steepDeg.toFixed(1)}°`}</td>
                      <td className="num whitespace-nowrap py-1.5 pr-2 text-right text-ink-2">{r.radioGapMin === null ? '—' : r.radioGapMin < 0.5 ? 'None' : hm(r.radioGapMin)}</td>
                      <td className="num py-1.5 text-right text-ink-2">{r.spareMin === null ? '—' : hm(r.spareMin)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-1.5 text-[12px] text-mute">Click a row to use that route.{planStatus === 'planning' ? ' Re-planning…' : ''}</div>
          </div>
        )}
      </div>

      <div className="border-t border-line px-3 py-2.5 text-[12px] leading-snug text-mute">
        Priorities only choose among safe routes. Safety limits are in Details → Rules.
      </div>
    </div>
  );
}
