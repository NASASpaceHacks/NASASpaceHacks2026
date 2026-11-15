import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Cell, FieldSet, Station, LoadedSitePack, PlanEvent, PlanRequest, PlanResult, Rule, Telem } from '@mw/shared/contracts';
import { DEFAULT_RULES } from '@mw/shared/contracts';
import type { SafeZoneInputs, SafeZoneLimits } from '@mw/shared/map';
import type { SiteInfo } from './api';
import type { AttemptView } from './lib/failure';
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

/** "Way forward" for a destination that can't be included: closest safe point, or a rover parking spot. */
export interface FixState {
  destId: string;
  kind: 'closest' | 'rover';
  status: 'searching' | 'found' | 'none';
  cell?: Cell;
  /** closest: metres short of the original destination · rover: metres from the rover's current spot. */
  distM?: number;
  /** Plain reason when nothing was found. */
  note?: string;
}

/** Full check of a dropped pin (same rules and request as the plan): verdict + the attempted walk. */
export interface PinCheck {
  cell: Cell;
  destId: string;
  status: 'checking' | 'done';
  verdict?: 'GO' | 'NO-GO';
  /** Rule behind a NO-GO. */
  rule?: string;
  /** Plain text after the verdict word. */
  text?: string;
  walkMin?: number;
  spareMin?: number;
}

export interface ConsoleState {
  mode: 'boot' | 'live' | 'mock';
  bootSteps: string[];
  bootError: string | null;
  sourceLabel: string;
  sourceReason: string;
  pack: LoadedSitePack | null;
  /** The site on screen (= pack.manifest.id once loaded) and every site the hab server offers. */
  siteId: string | null;
  sites: SiteInfo[];
  /** A site switch is loading (id of the target). */
  switchingTo: string | null;

  // Planning inputs
  rules: Rule[];
  stationOn: Record<string, boolean>;
  /** Route builder: chosen destinations (B, C…) in the order added (station ids and custom stops). */
  destinations: string[];
  /** Custom stops the officer dropped on the map (WP1, WP2…). */
  customStops: Station[];
  /** Small map popover for a clicked target or empty terrain (px = map pixel). */
  mapPopover: { kind: 'station' | 'terrain'; id?: string; cell: Cell; px: [number, number] } | null;
  /** "Choose on map" (picked from the To dropdown): the next map click sets that field. */
  pickOnMap: boolean;
  /** Right-click context menu on the map (px = map pixel). */
  ctxMenu: { cell: Cell; px: [number, number]; stationId?: string | null } | null;
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
  /** The attempted walk of a NO-GO plan (where it breaks the rule), and of a dropped pin that would be a NO-GO. */
  attemptPlan: AttemptView | null;
  attemptPin: AttemptView | null;
  pinCheck: PinCheck | null;
  /** NO-GO way forward (search in progress / suggestion shown on the map). */
  fix: FixState | null;
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

let logId = 1;

export const useConsole = create<ConsoleState>()(
  subscribeWithSelector(() => ({
    mode: 'boot',
    bootSteps: [],
    bootError: null,
    sourceLabel: '',
    sourceReason: '',
    pack: null,
    siteId: null,
    sites: [],
    switchingTo: null,

    rules: DEFAULT_RULES.map((r) => ({ ...r })),
    stationOn: {},
    destinations: [],
    customStops: [],
    mapPopover: null,
    pickOnMap: false,
    ctxMenu: null,
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
    fix: null,
    attemptPlan: null,
    attemptPin: null,
    pinCheck: null,
    overlays: [],
    opacity: { safezone: 1, elevation: 0.8, slope: 0.85, rough: 0.85, ti: 0.75, crism: 0.8, shelter: 0.9, walkback: 0.85, los: 0.9 },
    // Calm default: imagery (+ lighting), route, science targets, base and rover, safe-area outline.
    vectors: { outline: true, contours: false, keepouts: false, traverse: false, stations: true, stationDetail: false, route: true, shelters: true, imagery: true, relief: true },
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

