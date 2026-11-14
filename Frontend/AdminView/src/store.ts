import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Cell, FieldSet, LoadedSitePack, PlanEvent, PlanRequest, PlanResult, Rule, Telem } from '@mw/shared/contracts';
import { DEFAULT_RULES } from '@mw/shared/contracts';
import type { SafeZoneInputs, SafeZoneLimits } from '@mw/shared/map';
import type {
  FieldsSource,
  LinkCtl,
  LinkStatus,
  LogEntry,
  LogLevel,
  OverlayId,
  PresetId,
  RequestMsg,
  TabId,
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
  preset: PresetId;
  overlays: OverlayId[];
  opacity: Record<OverlayId, number>;
  vectors: Record<VectorId, boolean>;
  tab: TabId;
  leftSection: 'layers' | 'sources';
  explain: ExplainState;
  hazardPick: boolean;
  selectedStation: string | null;
  hoverStation: { id: string; x: number; y: number } | null;
  showHelp: boolean;

  // Confirm / link / live
  confirm: { stage: ConfirmStage; seq?: number; id?: string; bytes?: number; estimated?: boolean; error?: string };
  route: { seq: number; id: string; acked: boolean; bytes: number; estimated?: boolean; reqHash: string } | null;
  link: LinkStatus;
  linkCtl: LinkCtl;
  telem: Telem[];
  log: LogEntry[];
  requests: RequestMsg[];
  sim: { running: boolean; speed: number };
  busyEvent: string | null;
}

export const OVERLAY_LIMIT = 3;

export const PRESETS: Record<PresetId, { label: string; overlays: OverlayId[]; vectors: Partial<Record<VectorId, boolean>>; hint: string }> = {
  plan: { label: 'Plan', overlays: ['safezone'], vectors: { contours: true, route: true, stations: true, keepouts: true, traverse: false }, hint: 'Safe region, route and stations' },
  safety: { label: 'Safety', overlays: ['shelter', 'slope'], vectors: { contours: true, route: true, stations: true, keepouts: true, traverse: false }, hint: 'Time to shelter and slope hazards' },
  science: { label: 'Science', overlays: ['ti'], vectors: { contours: false, route: true, stations: true, keepouts: false, traverse: true }, hint: 'Stations, thermal inertia and Curiosity traverse' },
  comms: { label: 'Comms', overlays: ['los'], vectors: { contours: false, route: true, stations: true, keepouts: false, traverse: false }, hint: 'Comm line of sight (hab mast ∪ rover relay) and comm shadow' },
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

    preset: 'plan',
    overlays: ['safezone'],
    opacity: { safezone: 1, shelter: 0.9, walkback: 0.85, los: 0.9, slope: 0.7, ti: 0.6 },
    vectors: { contours: true, keepouts: true, traverse: false, stations: true, route: true, shelters: true, imagery: true },
    tab: 'plan',
    leftSection: 'layers',
    explain: { running: false, step: 0, caption: '', detail: '', areaFrom: 0, areaTo: 0 },
    hazardPick: false,
    selectedStation: null,
    hoverStation: null,
    showHelp: false,

    confirm: { stage: 'idle' },
    route: null,
    link: 'up',
    linkCtl: { latencyMs: 0, lossPct: 0, drop: false },
    telem: [],
    log: [],
    requests: [],
    sim: { running: false, speed: 60 },
    busyEvent: null,
  }) as ConsoleState),
);

export const get = () => useConsole.getState();
export const set = (p: Partial<ConsoleState> | ((s: ConsoleState) => Partial<ConsoleState>)) => useConsole.setState(p);

export function log(text: string, level: LogLevel = 'info', source: LogEntry['source'] = 'hab', tMin?: number) {
  const e: LogEntry = { id: logId++, utcMs: Date.now(), text, level, source, tMin };
  set((s) => ({ log: [e, ...s.log].slice(0, 300) }));
}

