import type { Cell, FieldSet, LinkMsg, PlanPackage, PlanResult, Telem } from '@mw/shared/contracts';
import type { LinkStatus } from './engine';

export type { LinkStatus };

export type OverlayId = 'safezone' | 'shelter' | 'walkback' | 'los' | 'slope' | 'ti';
/** Vector map features. `outline` = the single clean safe-area outline; `stationDetail` = value labels + left-out marks. */
export type VectorId = 'outline' | 'contours' | 'keepouts' | 'traverse' | 'stations' | 'stationDetail' | 'route' | 'shelters' | 'imagery';
/** Map presets: `calm` is the default (imagery, route, stops, base/rover, crew, safe-area outline). */
export type PresetId = 'calm' | 'safety' | 'science' | 'radio' | 'terrain';
/** The console's three modes (top stepper): ① Plan → ② Send → ③ EVA live. */
export type UiMode = 'plan' | 'send' | 'live';
/** Details drawer sections (expert depth, on demand). */
export type DetailsTab = 'report' | 'rules' | 'margins' | 'weather' | 'science' | 'sources' | 'log';
/** Guided responses in EVA live (action dock → sheet → Send to crew). */
export type ActionKind = 'sep' | 'hazard' | 'cut' | 'recall';

export interface ConsoleAlert {
  id: number;
  utcMs: number;
  level: 'info' | 'caution' | 'warning';
  title: string;
  text?: string;
  /** EVA minutes when known. */
  tMin?: number;
  /** Visor request this alert came from (hazard requests offer "Block area & re-plan"). */
  requestId?: number;
  acked: boolean;
}

export type FieldsSource = 'server' | 'engine' | 'estimate';

export interface PlanBundle {
  result: PlanResult;
  fields: FieldSet;
  fieldsSource: FieldsSource;
  plannerLabel: string;
}

export interface ConfirmResult {
  id: string;
  seq: number;
  bytes: number;
  /** True when bytes are an estimate (engine codec unavailable). */
  estimated?: boolean;
}

/** Loose shape of server event-log rows (B4 defines them; render defensively). */
export interface ServerEvent {
  t?: number | string;
  ts?: number | string;
  utc?: string;
  type?: string;
  kind?: string;
  text?: string;
  msg?: string;
  [k: string]: unknown;
}

/** Hab server Earth relay (GET /api/state → earth): light time computed from JPL approximate positions. */
export interface EarthView {
  oneWayLightMin: number;
  distanceAu: number;
  computedUtc: string;
  method: string;
  source: string;
}

export interface ServerState {
  route: PlanPackage | null;
  routeAcked: boolean;
  visorLink: LinkStatus;
  lastTelem: Telem | null;
  events: ServerEvent[];
  earth?: EarthView;
}

export type ConsoleEvent =
  | { type: 'SEP_NOWCAST'; leadMin: number }
  | { type: 'EVA_CUT'; min: number }
  | { type: 'HAZARD'; cells: Cell[] };

export interface SimState {
  running: boolean;
  speed: number;
  reset?: boolean;
}

export interface LinkCtl {
  latencyMs: number;
  lossPct: number;
  drop: boolean;
}

export type LogLevel = 'info' | 'ok' | 'caution' | 'warning';
export interface LogEntry {
  id: number;
  utcMs: number;
  /** EVA minutes when known. */
  tMin?: number;
  source: 'hab' | 'visor' | 'server' | 'earth' | 'system';
  level: LogLevel;
  text: string;
}

export type RequestMsg = Extract<LinkMsg, { type: 'REQUEST' }> & { id: number; handled: boolean; utcMs: number };

export interface LinkHandlers {
  onMsg(m: LinkMsg): void;
  onStatus(s: LinkStatus): void;
}
