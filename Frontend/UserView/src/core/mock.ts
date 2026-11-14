/**
 * Offline demo (`?mock=1`): builds a PlanPackage locally from the shared fixtures
 * (mockSitePack(412, 600) + goldenPlanResult + mockFields) and plays the habitat side of the link
 * in-page (MockHabLink). `&pack=<id>` loads a real site pack from /sitepacks/<id> instead.
 */
import {
  goldenPlanRequest,
  goldenPlanResult,
  loadSitePack,
  mockFields,
  mockSitePack,
  type FieldSet,
  type LinkMsg,
  type LoadedSitePack,
  type PlanPackage,
} from '@mw/shared/contracts';
import { toPlanPackage } from '../adapters/engine';
import { Hub, type Link, type LinkStatus } from '../adapters/link';

export interface MockScenario {
  pack: LoadedSitePack;
  fields: FieldSet;
  pkg: PlanPackage;
}

export async function buildMockScenario(packId: string | null): Promise<MockScenario> {
  const pack = packId ? await loadSitePack(`/sitepacks/${packId}`) : mockSitePack(412, 600);
  const req = goldenPlanRequest(pack);
  const res = goldenPlanResult(pack);
  const fields = mockFields(pack);
  const pkg = toPlanPackage(res, req, fields, pack.manifest.grid, { seq: 1, author: 'hab' });
  // Deterministic id so a reloaded visor recognises the same package (idempotent re-ACK).
  pkg.id = `${pack.manifest.id}-golden-v1`;
  return { pack, fields, pkg };
}

/** A new route version of the same plan, starting from the crew's current route index (demo "push v+1"). */
export function nextVersion(pkg: PlanPackage, fromRouteIdx: number, visited: string[]): PlanPackage {
  const seq = pkg.seq + 1;
  const keep = new Set(pkg.order.filter((id) => !visited.includes(id)));
  return {
    ...pkg,
    id: `${pkg.siteId}-golden-v${seq}`,
    parent: pkg.id,
    seq,
    createdUtc: new Date().toISOString(),
    route: pkg.route.slice(Math.max(0, Math.min(pkg.route.length - 2, fromRouteIdx))),
    stops: pkg.stops.filter((s) => keep.has(s.id)),
    order: pkg.order.filter((id) => keep.has(id)),
    bingo: pkg.bingo.filter((b) => keep.has(b.id)),
  };
}

/** In-page habitat: pushes the route, receives ACK/TELEM/REQUEST, can send ALERTs. */
export class MockHabLink implements Link {
  private msgs = new Hub<LinkMsg>();
  private stats = new Hub<LinkStatus>();
  readonly rx: LinkMsg[] = [];
  telemCount = 0;
  lastAck: { id: string; seq: number; accepted: boolean } | null = null;
  private timers: number[] = [];

  constructor(private onHabLog?: (text: string) => void) {}

  private deliver(m: LinkMsg, delayMs = 120) {
    this.timers.push(window.setTimeout(() => this.msgs.emit(m), delayMs));
  }
  pushRoute(pkg: PlanPackage, delayMs = 400) {
    this.deliver({ type: 'ROUTE_PUSH', pkg }, delayMs);
  }
  alert(level: 'info' | 'caution' | 'warning', code: string, text: string, t: number) {
    this.deliver({ type: 'ALERT', level, code, text, t });
  }
  send(m: LinkMsg) {
    if (m.type === 'HEARTBEAT') return;
    this.rx.push(m);
    if (this.rx.length > 500) this.rx.shift();
    if (m.type === 'TELEM') this.telemCount++;
    if (m.type === 'ACK') this.lastAck = { id: m.id, seq: m.seq, accepted: m.accepted };
    if (m.type === 'REQUEST') {
      const what = m.kind === 'HAZARD' ? 'HAZARD LOGGED' : m.kind === 'NEW_TARGET' ? 'REROUTE REQUEST LOGGED' : `${m.kind} LOGGED`;
      this.onHabLog?.(what);
      this.alert('info', `REQ_${m.kind}`, `HAB: ${what} — PLANNER REVIEWING`, m.t);
    }
  }
  onMessage(cb: (m: LinkMsg) => void) {
    return this.msgs.on(cb);
  }
  onStatus(cb: (s: LinkStatus) => void) {
    return this.stats.on(cb);
  }
  status(): LinkStatus {
    return 'up';
  }
  close() {
    this.timers.forEach((t) => window.clearTimeout(t));
  }
}
