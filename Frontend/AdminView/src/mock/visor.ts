import type { BurndownPoint, LinkMsg, LoadedSitePack, PlanResult, Telem } from '@mw/shared/contracts';
import { cellDistM, mulberry32 } from '@mw/shared/contracts';
import type { LinkCtl, LinkStatus, SimState } from '../lib/types';

/**
 * In-browser stand-in for the visor (UserView) used in mock mode. Like the real visor it walks
 * the confirmed route with dead-reckoning drift and sends TELEM; when the link drops it keeps
 * walking and the hab simply stops hearing from it. Clearly a simulator: values derive from the
 * plan's burndown with a small deterministic work-rate offset, never from real crew data.
 */
export class MockVisor {
  private pack: LoadedSitePack | null = null;
  private route: { plan: PlanResult; seq: number; id: string } | null = null;
  private pendingAck: { id: string; seq: number } | null = null;
  private sim: SimState = { running: false, speed: 60 };
  private ctl: LinkCtl = { latencyMs: 0, lossPct: 0, drop: false };
  private t = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private rnd = mulberry32(7);
  private drift = { dx: 0, dy: 0, sigma: 1.5, lastFixCell: -1 };
  private lastSentT = -1;
  private requested = false;

  constructor(
    private emit: (m: LinkMsg) => void,
    private onStatus: (s: LinkStatus) => void,
  ) {}

  setPack(p: LoadedSitePack) {
    this.pack = p;
  }

  status(): LinkStatus {
    if (this.ctl.drop) return 'down';
    if (this.ctl.latencyMs >= 1500 || this.ctl.lossPct >= 20) return 'degraded';
    return 'up';
  }

  private deliver(m: LinkMsg) {
    const s = this.status();
    if (s === 'down') return;
    if (this.rnd() * 100 < this.ctl.lossPct) return;
    const delay = this.ctl.latencyMs + 20;
    setTimeout(() => this.emit(m), delay);
  }

  pushRoute(plan: PlanResult, seq: number, id: string) {
    const fresh = !this.route;
    this.route = { plan, seq, id };
    if (fresh) this.resetWalk();
    this.pendingAck = { id, seq };
    this.tryAck();
  }

  private tryAck() {
    if (!this.pendingAck || this.status() === 'down') return;
    const { id, seq } = this.pendingAck;
    this.pendingAck = null;
    // Visor shows "NEW ROUTE v{seq} — accept"; the simulated crew accepts after ~1.2 s.
    setTimeout(() => this.deliver({ type: 'ACK', id, seq, accepted: true }), 1200);
  }

  setSim(s: SimState) {
    if (s.reset) this.resetWalk();
    this.sim = { running: s.running, speed: s.speed };
    if (this.sim.running && !this.timer) this.timer = setInterval(() => this.tick(), 200);
    if (!this.sim.running && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  setLink(ctl: LinkCtl) {
    this.ctl = ctl;
    this.onStatus(this.status());
    this.tryAck();
  }

  private resetWalk() {
    this.t = 0;
    this.lastSentT = -1;
    this.requested = false;
    this.drift = { dx: 0, dy: 0, sigma: 1.5, lastFixCell: -1 };
  }

  /** Planned cell at EVA minute t (walk legs linearly; dwell at stops; hab before/after). */
  private cellAt(plan: PlanResult, t: number): { cell: number; next: number; dwelling: boolean } {
    const segs = plan.segments;
    if (!segs.length) return { cell: -1, next: -1, dwelling: true };
    if (t <= segs[0].t0Min) return { cell: segs[0].cells[0], next: segs[0].cells[1] ?? segs[0].cells[0], dwelling: true };
    for (const s of segs) {
      if (t >= s.t0Min && t <= s.t1Min) {
        const f = (t - s.t0Min) / Math.max(1e-6, s.t1Min - s.t0Min);
        const i = Math.min(s.cells.length - 1, Math.floor(f * (s.cells.length - 1)));
        return { cell: s.cells[i], next: s.cells[Math.min(s.cells.length - 1, i + 3)], dwelling: false };
      }
    }
    for (let k = 0; k < segs.length - 1; k++) {
      if (t > segs[k].t1Min && t < segs[k + 1].t0Min) {
        const c = segs[k].cells[segs[k].cells.length - 1];
        return { cell: c, next: segs[k + 1].cells[1] ?? c, dwelling: true };
      }
    }
    const last = segs[segs.length - 1];
    return { cell: last.cells[last.cells.length - 1], next: -1, dwelling: true };
  }

  private burnAt(plan: PlanResult, t: number): BurndownPoint | null {
    const b = plan.burndown;
    if (!b.length) return null;
    let lo = b[0];
    for (const p of b) {
      if (p.tMin > t) break;
      lo = p;
    }
    return lo;
  }

  private tick() {
    if (!this.route || !this.pack) return;
    const { plan, seq } = this.route;
    const g = this.pack.manifest.grid;
    const dt = (this.sim.speed * 0.2) / 60; // EVA minutes per 200 ms tick
    this.t += dt;
    if (this.t > plan.totals.durationMin) {
      this.setSim({ running: false, speed: this.sim.speed });
      this.deliver({ type: 'ALERT', level: 'info', code: 'EVA_COMPLETE', text: 'EV1 back at the hab — ingress started', t: this.t });
      return;
    }
    const { cell, next, dwelling } = this.cellAt(plan, this.t);
    if (cell < 0) return;
    // Dead-reckoning drift grows ~2 % of distance walked; a station is a position fix.
    if (dwelling) {
      this.drift.dx *= 0.8;
      this.drift.dy *= 0.8;
      this.drift.sigma = Math.max(1.5, this.drift.sigma * 0.85);
    } else {
      const stepM = 0.56 * dt * 60;
      this.drift.sigma = Math.min(40, this.drift.sigma + 0.02 * stepM);
      this.drift.dx += (this.rnd() - 0.5) * 0.25 * stepM * 0.02 * 10;
      this.drift.dy += (this.rnd() - 0.5) * 0.25 * stepM * 0.02 * 10;
    }
    const r0 = Math.floor(cell / g.w), c0 = cell % g.w;
    const r = Math.max(0, Math.min(g.h - 1, r0 + Math.round(this.drift.dy / g.cellM)));
    const c = Math.max(0, Math.min(g.w - 1, c0 + Math.round(this.drift.dx / g.cellM)));
    const reported = r * g.w + c;
    let heading = 0;
    if (next >= 0 && next !== cell) {
      const dr = Math.floor(next / g.w) - r0, dc = (next % g.w) - c0;
      heading = ((Math.atan2(dc, -dr) * 180) / Math.PI + 360) % 360;
    }
    const bp = this.burnAt(plan, this.t);
    // Simulated crew works ~6 % harder than planned (shows plan-vs-actual divergence).
    const work = 1.06;
    const o2Planned = bp ? bp.o2Pct : 100 - (this.t / plan.totals.durationMin) * plan.totals.o2UsedPct;
    const telem: Telem = {
      t: this.t,
      cell: reported,
      sigmaM: this.drift.sigma,
      o2Pct: Math.max(0, 100 - (100 - o2Planned) * work),
      metW: (bp?.metW ?? 300) * (dwelling ? 0.7 : work) + (this.rnd() - 0.5) * 12,
      heatAvgW: (bp?.heatAvgW ?? 300) * work + (this.rnd() - 0.5) * 4,
      headingDeg: heading,
      routeSeq: seq,
    };
    if (this.t - this.lastSentT >= 0.5) {
      this.lastSentT = this.t;
      this.deliver({ type: 'TELEM', telem });
    }
    const total = plan.segments.reduce((a, s) => a + s.cells.length, 0);
    const walked = plan.segments.reduce((a, s) => a + (this.t >= s.t1Min ? s.cells.length : this.t > s.t0Min ? ((this.t - s.t0Min) / (s.t1Min - s.t0Min)) * s.cells.length : 0), 0);
    if (!this.requested && walked / total > 0.38) {
      this.requested = true;
      const hab = this.pack.manifest.shelters.find((s) => s.kind === 'hab')!;
      this.deliver({
        type: 'REQUEST',
        kind: 'HAZARD',
        cell: reported,
        note: `Soft sand ahead, ${Math.round(cellDistM(g, hab.cell, reported))} m from hab — requesting reroute`,
        t: this.t,
      });
    }
  }
}
