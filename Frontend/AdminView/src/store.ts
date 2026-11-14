import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Cell, FieldSet, Station, LoadedSitePack, PlanEvent, PlanRequest, PlanResult, Rule, Telem } from '@mw/shared/contracts';
import { DEFAULT_RULES } from '@mw/shared/contracts';
import type { SafeZoneInputs, SafeZoneLimits } from '@mw/shared/map';
import type {
  ActionKind,
  ConsoleAlert,
  DetailsTab,
  EarthView,
  FieldsSource,
  LinkCtl,
  LinkStatus,
  LogEntry,
  LogLevel,
  OverlayId,
  PresetId,
  RequestMsg,
  UiMode,
  VectorId,
} from './lib/types';

export type ConfirmStage = 'idle' | 'review' | 'pushing' | 'awaitingAck' | 'acked' | 'rejected' | 'error';

export interface ExplainState {
  running: boolean;
  step: number; // 1..6, 0 = idle, 7 = route drawing
  caption: string;
  detail: string;
  areaFrom: number;
  areaTo: number;
}

export interface ConsoleState {
  mode: 'boot' | 'live' | 'mock';
  bootSteps: string[];
  bootError: string | null;
  sourceLabel: string;
  sourceReason: string;
  pack: LoadedSitePack | null;

  // Planning inputs
  rules: Rule[];
  stationOn: Record<string, boolean>;
  /** Route builder: chosen destinations (B, C…) in the order added (station ids and custom stops). */
  destinations: string[];
  /** Custom stops the officer dropped on the map (WP1, WP2…). */
  customStops: Station[];
  /** Small map popover for a clicked target or empty terrain (px = map pixel). */
  mapPopover: { kind: 'station' | 'terrain'; id?: string; cell: Cell; px: [number, number] } | null;
  /** "Must visit" pins: the planner gives these stations priority (still dropped, with the reason, if unsafe). */
  mustVisit: Record<string, boolean>;
  startLtstMin: number;
  lsDeg: number;
  shelterCells: Record<string, Cell>;
  /** EVA base shelter id: the request is staged from this shelter (Hab-1, or PR-1 = rover-staged). */
  evaBase: string | null;
  events: PlanEvent[];
  hazards: Cell[];

  // Planning outputs
  planStatus: 'idle' | 'planning' | 'ready' | 'error';
  planError: string | null;
  plan: PlanResult | null;
  planReq: PlanRequest | null;
  fields: FieldSet | null;
  fieldsSource: FieldsSource | null;
  plannerLabel: string;
  zone: SafeZoneInputs | null;
  limits: SafeZoneLimits | null;
  zoneAreaKm2: number | null;
  /** Comm LOS behind the zone: 'engine' = engine LOS field + engine travel time for gaps. */
  losSource: 'engine' | 'estimate' | null;
  planVersion: number;
  dirty: boolean;

  // Display
  /** Top stepper: ① Plan → ② Send → ③ EVA live. */
  uiMode: UiMode;
  preset: PresetId;
  overlays: OverlayId[];
  opacity: Record<OverlayId, number>;
  vectors: Record<VectorId, boolean>;
  /** Details drawer (expert depth): closed, or open on a section. */
  details: { open: boolean; tab: DetailsTab };
  layersOpen: boolean;
  simOpen: boolean;
  /** EVA live: guided response sheet (action → engine's new plan as a change → Send to crew). */
  sheet: { kind: ActionKind; cutMin?: number; before?: { order: string[]; durationMin: number; endT: number } } | null;
  /** EVA live: the map keeps the crew in view. */
  follow: boolean;
  alerts: ConsoleAlert[];
  explain: ExplainState;
  hazardPick: boolean;
  selectedStation: string | null;
  hoverStation: { id: string; x: number; y: number } | null;
  hoverShelter: { id: string; x: number; y: number } | null;
  showHelp: boolean;
  /** Evidence panel (Validity): closed, open, or open scrolled to the limitations list. */
  evidence: 'closed' | 'open' | 'limitations';

  // Confirm / link / live
  confirm: { stage: ConfirmStage; seq?: number; id?: string; bytes?: number; estimated?: boolean; error?: string; ackUtcMs?: number };
  route: { seq: number; id: string; acked: boolean; bytes: number; estimated?: boolean; reqHash: string } | null;
  /** The plan behind the route the crew has (EVA live shows this; a drafted change lives in `plan`). */
  sentPlan: PlanResult | null;
  link: LinkStatus;
  linkCtl: LinkCtl;
  telem: Telem[];
  log: LogEntry[];
  requests: RequestMsg[];
  sim: { running: boolean; speed: number };
  busyEvent: string | null;
  /** Earth relay view from the hab server (light time); null in mock mode / before the first poll. */
  earth: EarthView | null;
}

export const OVERLAY_LIMIT = 3;

/** Calm default: imagery, route, numbered stops, base/rover, crew and one safe-area outline. */
const CALM_VECTORS: Partial<Record<VectorId, boolean>> = { outline: true, contours: false, keepouts: false, traverse: false, stationDetail: false, route: true, stations: true, shelters: true };

/** Map presets behind the Layers button. Each brings its own one-line legend. */
export const PRESETS: Record<PresetId, { label: string; overlays: OverlayId[]; vectors: Partial<Record<VectorId, boolean>>; hint: string; legend: string }> = {
  calm: { label: 'Calm', overlays: [], vectors: CALM_VECTORS, hint: 'Route, stops, base, crew and the safe area', legend: 'Cyan outline = safe area (every hard rule met). Small steep patches inside it are left out of the outline.' },
  safety: { label: 'Safety', overlays: ['safezone', 'shelter'], vectors: { ...CALM_VECTORS, contours: true, keepouts: true }, hint: 'Safe area, minutes to shelter, keep-out zones', legend: 'Dark = outside the safe area · blue = minutes to shelter (lines every 10 min, red = limit) · red hatch = keep-out.' },
  science: { label: 'Science', overlays: ['ti'], vectors: { ...CALM_VECTORS, traverse: true, stationDetail: true }, hint: 'Station values, left-out stops, Curiosity traverse', legend: 'Number next to a stop = science value · red × = left out · dotted line = Curiosity traverse · colour = loose sand → rock.' },
  radio: { label: 'Radio', overlays: ['los'], vectors: CALM_VECTORS, hint: 'Where the crew can talk to Hab-1 or the rover', legend: 'Cyan = in radio contact with the hab mast or the rover relay · darker = longer out of contact.' },
  terrain: { label: 'Terrain', overlays: ['slope'], vectors: CALM_VECTORS, hint: 'Slope: where walking gets hard or unsafe', legend: 'Amber from 16.7° (walking gets costly) · red above 20° (too steep for suited crew).' },
};

let logId = 1;

export const useConsole = create<ConsoleState>()(
  subscribeWithSelector(() => ({
    mode: 'boot',
    bootSteps: [],
    bootError: null,
    sourceLabel: '',
    sourceReason: '',
    pack: null,

    rules: DEFAULT_RULES.map((r) => ({ ...r })),
    stationOn: {},
    destinations: [],
    customStops: [],
    mapPopover: null,
    mustVisit: {},
    startLtstMin: 9 * 60 + 40,
    lsDeg: 150,
    shelterCells: {},
    evaBase: null,
    events: [],
    hazards: [],

    planStatus: 'idle',
    planError: null,
    plan: null,
    planReq: null,
    fields: null,
    fieldsSource: null,
    plannerLabel: '',
    zone: null,
    limits: null,
    zoneAreaKm2: null,
    losSource: null,
    planVersion: 0,
    dirty: false,

    uiMode: 'plan',
    preset: 'calm',
    overlays: [],
    opacity: { safezone: 1, shelter: 0.9, walkback: 0.85, los: 0.9, slope: 0.7, ti: 0.6 },
    vectors: { outline: true, contours: false, keepouts: false, traverse: false, stations: true, stationDetail: false, route: true, shelters: true, imagery: true },
    details: { open: false, tab: 'report' },
    layersOpen: false,
    simOpen: false,
    sheet: null,
    follow: true,
    alerts: [],
    explain: { running: false, step: 0, caption: '', detail: '', areaFrom: 0, areaTo: 0 },
    hazardPick: false,
    selectedStation: null,
    hoverStation: null,
    hoverShelter: null,
    showHelp: false,
    evidence: 'closed',

    confirm: { stage: 'idle' },
    route: null,
    sentPlan: null,
    link: 'up',
    linkCtl: { latencyMs: 0, lossPct: 0, drop: false },
    telem: [],
    log: [],
    requests: [],
    sim: { running: false, speed: 60 },
    busyEvent: null,
    earth: null,
  }) as ConsoleState),
);

export const get = () => useConsole.getState();
export const set = (p: Partial<ConsoleState> | ((s: ConsoleState) => Partial<ConsoleState>)) => useConsole.setState(p);

let alertId = 1;

/** Push an alert onto the banner queue (newest first). */
export function pushAlert(a: Omit<ConsoleAlert, 'id' | 'utcMs' | 'acked'>) {
  const e: ConsoleAlert = { ...a, id: alertId++, utcMs: Date.now(), acked: false };
  set((s) => ({ alerts: [e, ...s.alerts].slice(0, 40) }));
  return e.id;
}

export function log(text: string, level: LogLevel = 'info', source: LogEntry['source'] = 'hab', tMin?: number) {
  const e: LogEntry = { id: logId++, utcMs: Date.now(), text, level, source, tMin };
  set((s) => ({ log: [e, ...s.log].slice(0, 300) }));
}

