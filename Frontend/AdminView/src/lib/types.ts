import type { Cell, FieldSet, LinkMsg, PlanPackage, PlanResult, Telem } from '@mw/shared/contracts';
import type { LinkStatus } from './engine';

export type { LinkStatus };

export type OverlayId = 'safezone' | 'shelter' | 'walkback' | 'los' | 'slope' | 'ti';
export type VectorId = 'contours' | 'keepouts' | 'traverse' | 'stations' | 'route' | 'shelters' | 'imagery';
export type PresetId = 'plan' | 'safety' | 'science' | 'comms';
export type TabId = 'plan' | 'report' | 'burndown' | 'live';

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

export interface ServerState {
  route: PlanPackage | null;
  routeAcked: boolean;
  visorLink: LinkStatus;
  lastTelem: Telem | null;
  events: ServerEvent[];
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
