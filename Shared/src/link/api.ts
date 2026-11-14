import { z } from 'zod';
import type { DtnBundle, PlanPackage, Telem } from '../contracts/types';
import type { LinkConditions, LinkStatus } from './core';

/**
 * Hab server HTTP API — request schemas and response types (docs/AGENTS.md "Hab server HTTP API").
 * The Backend implements these; AdminView/UserView can import the types from '@mw/shared/link'.
 */

const num = z.number().finite();

export const ConfirmRequestSchema = z.object({ reqHash: z.string().min(1) });
export type ConfirmRequest = z.infer<typeof ConfirmRequestSchema>;

export interface ConfirmResponse {
  id: string;
  seq: number;
  parent?: string;
  /** encodePackage(pkg).byteLength (canonical CBOR + deflate-raw). Budget ≤ 25,000 B. */
  bytes: number;
  withinBudget: boolean;
  /** Ed25519 signature (hex); verify with GET /api/pubkey. */
  sig: string;
  /** Visor connections the ROUTE_PUSH went to (0 = held until a visor connects / link returns). */
  pushedTo: number;
  notes: string[];
}

export const HabEventRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('SEP_NOWCAST'), leadMin: num.positive() }),
  z.object({ type: z.literal('EVA_CUT'), min: num.positive() }),
  z.object({ type: z.literal('HAZARD'), cells: z.array(z.number().int().nonnegative()).min(1), note: z.string().optional() }),
]);
export type HabEventRequest = z.infer<typeof HabEventRequestSchema>;

export const SimRequestSchema = z.object({
  running: z.boolean(),
  speed: num.min(0).max(1000),
  reset: z.boolean().optional(),
});
export type SimRequest = z.infer<typeof SimRequestSchema>;

/** Desired astronaut-simulator state; the VISOR polls GET /api/sim and runs the simulator. */
export interface SimState {
  running: boolean;
  speed: number;
  /** True on the revision where a reset was requested; compare `rev` to detect it. */
  reset: boolean;
  rev: number;
  updatedUtc: string;
}

export const LinkConditionsPatchSchema = z.object({
  latencyMs: num.min(0).max(120_000).optional(),
  lossPct: num.min(0).max(100).optional(),
  drop: z.boolean().optional(),
});
export type LinkConditionsPatch = z.infer<typeof LinkConditionsPatchSchema>;

export const EarthBundleRequestSchema = z.object({
  kind: z.enum(['PLAN', 'LOG', 'STM_DELTA', 'SPACEWX', 'NOTE']),
  body: z.unknown(),
  /** 'hab' = hab → Earth (default), 'earth' = Earth → hab. */
  src: z.enum(['hab', 'earth']).optional(),
  /** Demo time compression: delivery delay = light time / timeScale (default 1 = real). */
  timeScale: num.min(1).max(1e6).optional(),
});
export type EarthBundleRequest = z.infer<typeof EarthBundleRequestSchema>;

export type EarthBundleView = DtnBundle & { timeScale: number; status: 'in_flight' | 'delivered' };

export interface EarthState {
  /** One-way light time Earth↔Mars now (min). */
  oneWayLightMin: number;
  distanceAu: number;
  computedUtc: string;
  method: string;
  source: string;
  bundles: EarthBundleView[];
}

export type EventLogType =
  | 'boot'
  | 'plan'
  | 'confirm'
  | 'push'
  | 'ack'
  | 'request'
  | 'alert'
  | 'event'
  | 'link'
  | 'link_status'
  | 'sim'
  | 'telem'
  | 'earth';

/** One line of Backend/var/events.jsonl. */
export interface EventLogEntry {
  /** Monotonic index across restarts. */
  i: number;
  ts: string;
  type: EventLogType;
  data: Record<string, unknown>;
}

export interface HabState {
  route: PlanPackage | null;
  routeAcked: boolean;
  routeAck: { id: string; seq: number; accepted: boolean; ts: string } | null;
  /** Highest route seq issued so far. */
  seq: number;
  visorLink: LinkStatus;
  lastTelem: Telem | null;
  /** Event-log tail (newest last; TELEM samples excluded). */
  events: EventLogEntry[];
  link: LinkConditions;
  sim: SimState;
  earth: EarthState;
  clients: { visors: number; consoles: number };
  lastPlan: { reqHash: string; status: 'OK' | 'STAY_IN'; engine: 'real' | 'fallback' } | null;
}

export interface HealthResponse {
  ok: true;
  siteId: string;
  uptimeS: number;
  sitePack: { id: string; source: 'disk' | 'mock'; requested: string; reason?: string; warnings: string[] };
  engine: { plan: boolean; computeFields: boolean; toPlanPackage: boolean; encodePackage: boolean; error?: string };
  planner: { mode: 'worker' | 'inline'; pathSearch?: string; costModel?: string };
  pubKeyHex: string;
}

export type FieldName = 'walkbackMin' | 'shelterMin' | 'outboundMin' | 'los' | 'blocked';
export const FIELD_NAMES: FieldName[] = ['walkbackMin', 'shelterMin', 'outboundMin', 'los', 'blocked'];
