import type { Cell, LoadedSitePack, Shelter } from '@mw/shared/contracts';
import { useConsole } from '../store';

/**
 * EVA base naming. The engine labels the EVA base 'HAB' in segments and bingo (whichever shelter the
 * request is staged from); the console shows the real shelter name instead (Hab-1 or PR-1).
 */

/** "Habitat (Hab-1)" → "Hab-1", "Pressurized rover (PR-1)" → "PR-1"; otherwise the id. */
export function shortName(s: Pick<Shelter, 'id' | 'name'>): string {
  const m = /\(([^)]+)\)\s*$/.exec(s.name);
  return m ? m[1] : s.id;
}

export function shelterById(pack: LoadedSitePack, id: string | null | undefined): Shelter | undefined {
  return id ? pack.manifest.shelters.find((s) => s.id === id) : undefined;
}

/** Default EVA base: the first pressurized rover when the site has one (rover-staged EVA), else the hab. */
export function defaultBase(pack: LoadedSitePack): string {
  const m = pack.manifest;
  return (m.shelters.find((s) => s.kind === 'rover') ?? m.shelters.find((s) => s.kind === 'hab') ?? m.shelters[0]).id;
}

export interface BaseInfo {
  id: string;
  name: string;
  short: string;
  kind: Shelter['kind'];
  cell: Cell;
}

export function baseInfo(pack: LoadedSitePack, baseId: string | null, shelterCells: Record<string, Cell>): BaseInfo {
  const s = shelterById(pack, baseId) ?? pack.manifest.shelters.find((x) => x.kind === 'hab')!;
  return { id: s.id, name: s.name, short: shortName(s), kind: s.kind, cell: shelterCells[s.id] ?? s.cell };
}

/**
 * Label for a route endpoint id from the engine ('HAB' = EVA base, 'HERE' = crew position, station or
 * shelter ids). `cell` disambiguates SEP returns, which end at whichever shelter is nearest.
 */
export function endpointLabel(pack: LoadedSitePack, base: BaseInfo, id: string, shelterCells: Record<string, Cell>, cell?: Cell): string {
  if (cell !== undefined) {
    if (cell === base.cell) return base.short;
    const s = pack.manifest.shelters.find((x) => (shelterCells[x.id] ?? x.cell) === cell);
    if (s) return shortName(s);
  }
  if (id === 'HAB') return base.short;
  if (id === 'HERE') return 'EV1';
  const s = shelterById(pack, id);
  return s ? shortName(s) : stopLabel(id); // a stop: its map letter + name, never the internal id
}

/** A stop's plain name (no parenthesised code), from the science targets and the user's own stops. */
export function stopName(id: string): string {
  const s = useConsole.getState();
  const st = [...(s.pack?.manifest.stations ?? []), ...s.customStops].find((x) => x.id === id);
  return st ? st.name.replace(/\s*\([^)]*\)\s*$/, '') : id;
}

/** A stop as the directions card shows it: its map letter (B, C…) when it is a destination, then its name. */
export function stopLabel(id: string): string {
  const i = useConsole.getState().destinations.indexOf(id);
  return i >= 0 ? `${String.fromCharCode(66 + i)} ${stopName(id)}` : stopName(id);
}

/** Replace engine shelter tokens in free text: 'HAB' → the EVA base, other shelter ids → short names. */
export function relabel(pack: LoadedSitePack, base: BaseInfo, text: string): string {
  let out = text;
  // "Pressurized rover (PR-1) (ROVER1)" → "PR-1"
  for (const s of pack.manifest.shelters) out = out.split(`${s.name} (${s.id})`).join(shortName(s));
  out = out.replace(/\bHAB\b/g, base.short);
  for (const s of pack.manifest.shelters) {
    if (s.id === 'HAB') continue;
    out = out.replace(new RegExp(`\\b${s.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), shortName(s));
  }
  // Stop ids ("ST04", "P1") never reach the screen: the map letter and the name instead.
  const known = new Set([...pack.manifest.stations, ...useConsole.getState().customStops].map((x) => x.id));
  out = out.replace(/\b(?:ST\d\d|P\d+)\b/g, (id) => (known.has(id) ? stopLabel(id) : id));
  return out;
}

/** React hook: the current EVA base (selects primitives only, so renders stay stable). */
export function useBaseInfo(): BaseInfo | null {
  const pack = useConsole((s) => s.pack);
  const id = useConsole((s) => s.evaBase);
  const cells = useConsole((s) => s.shelterCells);
  return pack ? baseInfo(pack, id, cells) : null;
}
