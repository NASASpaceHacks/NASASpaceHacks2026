import { create } from 'zustand';
import type { SafetyState } from '../adapters/engine';
import type { LinkStatus } from '../adapters/link';
import type { HeadingCue } from '../core/cues';
import type { SimMode } from '../core/sim';

export type DisplayState = 'BOOT' | 'WAITING_FOR_ROUTE' | 'NEW_ROUTE' | 'NAV' | 'STATION' | 'RETURN_NOW' | 'COMPLETE';

export interface Toast {
  id: number;
  level: 'info' | 'ok' | 'caution' | 'warning';
  text: string;
  until: number;
}

export interface PendingInfo {
  seq: number;
  parentSeq: number | null;
  author: 'hab' | 'earth';
  stops: string[];
  distM: number;
  durMin: number;
  firstStop: string | null;
  bingo: string | null;
  sameAsCurrentGeometry: boolean;
  sig: 'checking' | 'verified' | 'unsigned' | 'unverified';
}

export interface NextInfo {
  id: string;
  name: string;
  isHome: boolean;
  distM: number;
  etaMin: number;
  arrLtstMin: number;
  bearingDeg: number;
  relDeg: number;
  steerRelDeg: number;
  index: number;
  total: number;
}

export interface StationInfo {
  id: string;
  name: string;
  description: string;
  objectives: string[];
  value: number | null;
  dwellLeftMin: number;
  dwellTotalMin: number;
  dwellCut: boolean;
  leaveByLtstMin: number | null;
  objective: { id: string; goal: string; statement: string; weight: number } | null;
  otherObjectives: string[];
  tasks: { id: string; label: string; objectiveId: string; instrument: string | null; done: boolean; active: boolean }[];
  tasksDone: number;
  citation: string | null;
  image: { url: string; credit: string; sol: number; camera: string; caption: string | null; sourceUrl: string } | null;
  index: number;
  total: number;
}

export interface ReturnInfo {
  source: 'alert' | 'safety';
  level: 'caution' | 'warning';
  code: string;
  reason: string;
  target: string;
  distM: number;
  etaMin: number;
  walkbackEtaMin: number;
  relDeg: number;
  bearingDeg: number;
  coarseReturnDeg: number | null;
}

export interface Snapshot {
  ready: boolean;
  bootStage: string;
  bootError: string | null;
  mode: 'mock' | 'live';
  display: DisplayState;
  seq: number | null;
  pending: PendingInfo | null;
  link: LinkStatus;
  localDrop: boolean;
  autonomous: boolean;
  linkDownS: number;
  outbox: number;
  t: number;
  ltstMin: number;
  sol: number | null;
  o2Pct: number;
  metW: number;
  heatAvgW: number;
  heatAdvisory: boolean;
  sigmaM: number;
  headingDeg: number;
  est: [number, number] | null;
  offRouteM: number;
  next: NextInfo | null;
  bingo: { id: string; inMin: number; ltstMin: number } | null;
  station: StationInfo | null;
  ret: ReturnInfo | null;
  cue: HeadingCue | null;
  comm: { available: boolean; inLos: boolean; changeInMin: number | null };
  safety: SafetyState | null;
  walkbackMarginMin: number | null;
  shelterMin: number | null;
  remainingMin: number;
  sim: { running: boolean; speed: number; mode: SimMode | 'NONE' };
  mirror: boolean;
  demoOpen: boolean;
  toasts: Toast[];
  versions: { route: number; zone: number; layers: number };
  impl: { safetyCore: string; toPlanPackage: string; sun: string; link: string; map: string };
  habRx: number;
  odoM: number;
  visitedCount: number;
  stopsTotal: number;
  siteName: string;
  credit: string;
  restoredInMs: number | null;
}

export const initialSnapshot: Snapshot = {
  ready: false,
  bootStage: 'POWER ON',
  bootError: null,
  mode: 'live',
  display: 'BOOT',
  seq: null,
  pending: null,
  link: 'down',
  localDrop: false,
  autonomous: false,
  linkDownS: 0,
  outbox: 0,
  t: 0,
  ltstMin: 0,
  sol: null,
  o2Pct: 100,
  metW: 0,
  heatAvgW: 0,
  heatAdvisory: false,
  sigmaM: 0,
  headingDeg: 0,
  est: null,
  offRouteM: 0,
  next: null,
  bingo: null,
  station: null,
  ret: null,
  cue: null,
  comm: { available: false, inLos: true, changeInMin: null },
  safety: null,
  walkbackMarginMin: null,
  shelterMin: null,
  remainingMin: 0,
  sim: { running: false, speed: 1, mode: 'NONE' },
  mirror: false,
  demoOpen: false,
  toasts: [],
  versions: { route: 0, zone: 0, layers: 0 },
  impl: { safetyCore: 'fallback', toPlanPackage: 'fallback', sun: 'fallback', link: 'fallback', map: 'local' },
  habRx: 0,
  odoM: 0,
  visitedCount: 0,
  stopsTotal: 0,
  siteName: '',
  credit: '',
  restoredInMs: null,
};

export const useVisor = create<{ snap: Snapshot }>(() => ({ snap: initialSnapshot }));
