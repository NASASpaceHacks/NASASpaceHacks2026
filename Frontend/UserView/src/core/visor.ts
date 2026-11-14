/**
 * VisorController: the visor's flight software outside React.
 * Owns the surface link, the route state machine, the astronaut simulator, the onboard safety core,
 * store-and-forward telemetry and crash-safe checkpoints; publishes a Snapshot to the store at 10 Hz.
 *
 * States: WAITING_FOR_ROUTE → NEW_ROUTE (A accepts, ACK) → NAV ⇄ STATION (≤15 m; N departs) → COMPLETE,
 * with RETURN_NOW (safety core or hab ALERT) and AUTONOMOUS (link 'down' ≥3 s) layered on top.
 */
import {
  cellToXY,
  decodeRaster,
  mockSitePack,
  xyToCell,
  type GridSpec,
  type Landmark,
  type LinkMsg,
  type PlanPackage,
  type RoverImage,
  type SitePackManifest,
  type Station,
} from '@mw/shared/contracts';
import { etaFromThermalInertia, formatLtst } from '@mw/shared/engine';
import { bearingDeg, coarseAt, createSafetyCore, defaultLs, engineImpl, ltstAt, norm360, type SafetyCore, type SafetyState } from '../adapters/engine';
import { connectVisorLink, linkImpl, verifyRoute, withLocalDrop, type DroppableLink, type LinkStatus } from '../adapters/link';
import { mapImpl } from '../adapters/map';
import { initialSnapshot, useVisor, type DisplayState, type NextInfo, type PendingInfo, type ReturnInfo, type Snapshot, type StationInfo, type Toast } from '../state/store';
import {
  AUTONOMOUS_AFTER_MS,
  HEAT_BUDGET_W,
  HEAT_PACE_FACTOR,
  MOCK_DEFAULT_SPEED,
  OUTBOX_MAX,
  SHELTER_MAX_MIN,
  SIM_POLL_MS,
  SIM_TICK_MS,
  SPEED_STEPS,
  SURFACE_MIN,
  TELEM_PERIOD_MS,
  V0,
  WALKBACK_FACTOR,
} from './constants';
import { isobands, downsample, demContours, type Iso } from './contours';
import { headingCue, pickLandmark } from './cues';
import { buildMockScenario, MockHabLink, nextVersion } from './mock';
import { Checkpoint, type DynState } from './persist';
import { crewTasks, galeStation, objectivesFor, type CrewTask } from './science';
import { RouteModel, shelterAt, shelterLabel } from './route';
import { departNow, estimatedXY, newSim, rebaseSim, simTick, type SimState } from './sim';

export interface MapLayers {
  grid: GridSpec;
  demIso: Iso[];
  shadowIso: Iso[];
  keepouts: SitePackManifest['keepouts'];
  stations: Station[];
  shelters: SitePackManifest['shelters'];
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

export class VisorController {
  readonly mode: 'mock' | 'live';
  private readonly packId: string | null;
  private readonly params: URLSearchParams;
  private readonly ck: Checkpoint;

  manifest: SitePackManifest | null = null;
  grid: GridSpec | null = null;
  packBase = '';
  dem: Float32Array | null = null;
  /** Pandolf terrain factor per cell from THEMIS TI (engine etaFromThermalInertia); null → 1.0. */
  eta: Float32Array | null = null;
  los: Uint8Array | null = null;
  layers: MapLayers | null = null;

  link: DroppableLink | null = null;
  mockHab: MockHabLink | null = null;
  private mockFirstPkg: PlanPackage | null = null;

  pkg: PlanPackage | null = null;
  route: RouteModel | null = null;
  private core: SafetyCore | null = null;
  pending: PlanPackage | null = null;
  private pendingSig: 'checking' | 'verified' | 'unsigned' | 'unverified' = 'unsigned';
  private habPubKey: string | null = null;
  sim: SimState | null = null;
  safety: SafetyState | null = null;
  private outbox: LinkMsg[] = [];
  private alert: DynState['alert'] = null;
  private safetyLatched = false;
  private linkStatus: LinkStatus = 'down';
  private linkDownSince: number | null = performance.now();
  /** Last frame heard from the hab (heartbeats included). AUTONOMOUS = 3 s of silence. */
  private lastHeard = performance.now();
  private wasAutonomous = false;
  private everUp = false;
  private mirror = false;
  private demoOpen = false;
  private toasts: Toast[] = [];
  private toastId = 0;
  private versions = { route: 0, zone: 0, layers: 0 };
  zone: Iso[] = [];
  private zoneLevel = NaN;
  private lastResetSeen: unknown = undefined;
  private lsDeg = 0;
  private landmark: Landmark | null = null;
  private restoredInMs: number | null = null;
  private ready = false;
  private bootStage = 'POWER ON';
  private bootError: string | null = null;
  private desired = { running: true, speed: 1 };
  private timers: number[] = [];
  private lastTick = performance.now();
  private pollBusy = false;
  private seed = 412;

  constructor(search: string) {
    this.params = new URLSearchParams(search);
    this.mode = this.params.get('mock') === '1' ? 'mock' : 'live';
    this.packId = this.params.get('pack');
    this.ck = new Checkpoint(`mw.visor.${this.mode}${this.packId ? '.' + this.packId : ''}`);
    if (this.params.get('reset') === '1') {
      // Cold start requested: clear the checkpoint once, then drop the flag so a crash-reload restores.
      this.ck.clear();
      const u = new URL(location.href);
      u.searchParams.delete('reset');
      history.replaceState(null, '', u.toString());
    }
    if (this.mode === 'mock') {
      this.desired = {
        running: this.params.get('run') !== '0',
        speed: Number(this.params.get('speed')) || MOCK_DEFAULT_SPEED,
      };
    }
  }

  // ───────────────────────────── boot ─────────────────────────────

  async init(): Promise<void> {
    const t0 = performance.now();
    this.boot('READING CHECKPOINT');
    const saved = this.ck.load();
    this.outbox = saved.outbox;
    if (saved.dyn) {
      this.mirror = saved.dyn.mirror;
      this.alert = saved.dyn.alert;
      this.safetyLatched = saved.dyn.safetyLatched;
      this.lastResetSeen = saved.dyn.lastResetSeen;
    }
    try {
      if (this.mode === 'mock') {
        this.boot(this.packId ? `LOADING SITE PACK ${this.packId.toUpperCase()}` : 'GENERATING MOCK SITE PACK');
        await nextFrame();
        const sc = await buildMockScenario(this.packId);
        this.mockFirstPkg = sc.pkg;
        this.los = sc.fields.los;
        this.setPack(sc.pack.manifest, sc.pack.base.startsWith('mock') ? '' : sc.pack.base, sc.pack.rasters.dem ?? null);
        this.mockHab = new MockHabLink();
        this.link = withLocalDrop(this.mockHab);
      } else {
        this.boot('CONTACTING HAB');
        this.link = withLocalDrop(connectVisorLink());
        const siteId = saved.pkg?.siteId ?? saved.dyn?.siteId ?? (await this.health());
        if (siteId) await this.loadSite(siteId).catch((e) => this.toast('caution', `SITE PACK ${siteId} UNAVAILABLE`, e));
      }
    } catch (e) {
      this.bootError = String((e as Error)?.message ?? e);
      this.publish();
      return;
    }

    this.boot('RESTORING STATE');
    if (saved.pkg && this.manifest && saved.pkg.siteId === this.manifest.id) {
      this.installRoute(saved.pkg, false);
      if (saved.dyn?.sim) this.sim = saved.dyn.sim;
      this.restoredInMs = performance.now() - t0;
      this.toast('ok', `WARM RESTART · STATE RESTORED IN ${(this.restoredInMs / 1000).toFixed(1)} S`);
    }
    if (saved.pending && (!this.pkg || saved.pending.seq > this.pkg.seq)) {
      this.pending = saved.pending;
      this.checkSignature(saved.pending);
    }
    if (this.sim) this.desired = { running: this.sim.running, speed: this.sim.speed };

    const link = this.link!;
    link.onMessage((m) => this.onMsg(m));
    link.onStatus((s) => this.onLinkStatus(s));
    if (saved.dyn?.localDrop) link.setDropped(true);
    this.onLinkStatus(link.status());

    if (this.mode === 'mock' && this.mockHab && this.mockFirstPkg && !this.pkg && !this.pending) {
      this.mockHab.pushRoute(this.mockFirstPkg, 1600);
    }

    this.timers.push(window.setInterval(() => this.tick(), SIM_TICK_MS));
    this.timers.push(window.setInterval(() => this.telem(), TELEM_PERIOD_MS));
    if (this.mode === 'live') this.timers.push(window.setInterval(() => void this.pollSim(), SIM_POLL_MS));
    this.ready = true;
    this.publish();
  }

  dispose() {
    this.timers.forEach((t) => window.clearInterval(t));
    this.link?.close();
  }

  private boot(stage: string) {
    this.bootStage = stage;
    this.publish();
  }

  private async health(): Promise<string | null> {
    try {
      const r = await fetch('/api/health', { signal: AbortSignal.timeout(2500) });
      if (!r.ok) return null;
      const j = (await r.json()) as { siteId?: string; pubKeyHex?: string };
      if (j.pubKeyHex) this.habPubKey = j.pubKeyHex;
      return j.siteId ?? null;
    } catch {
      return null;
    }
  }

  private async loadSite(siteId: string): Promise<void> {
    if (this.manifest?.id === siteId) return;
    try {
      const r = await fetch(`/sitepacks/${siteId}/manifest.json`);
      if (!r.ok) throw new Error(`manifest ${r.status}`);
      const manifest = (await r.json()) as SitePackManifest;
      this.setPack(manifest, `/sitepacks/${siteId}`, null);
      void this.loadDem(manifest);
    } catch (e) {
      const m = /^mock-(\d+)$/.exec(siteId);
      if (!m) throw e;
      // Hab is running on the in-memory mock pack: regenerate the identical synthetic pack locally.
      const p = mockSitePack(Number(m[1]), 600);
      this.setPack(p.manifest, '', p.rasters.dem);
    }
  }

  private async loadDem(manifest: SitePackManifest) {
    const layer = manifest.rasters.dem;
    if (!layer) return;
    try {
      const r = await fetch(`${this.packBase}/${layer.file}`);
      if (!r.ok) return;
      const dem = decodeRaster(await r.arrayBuffer(), layer);
      if (dem.length !== manifest.grid.w * manifest.grid.h || this.manifest?.id !== manifest.id) return;
      this.dem = dem;
      await this.loadEta(manifest);
      this.applyTerrain();
      this.buildLayers();
    } catch {
      /* terrain contours are optional on the visor */
    }
  }

  /** THEMIS TI → engine terrain factor η, so the simulator's metabolic power matches the planner's. */
  private async loadEta(manifest: SitePackManifest) {
    const layer = manifest.rasters.ti;
    if (!layer) return;
    try {
      const r = await fetch(`${this.packBase}/${layer.file}`);
      if (!r.ok) return;
      const ti = decodeRaster(await r.arrayBuffer(), layer);
      if (ti.length !== manifest.grid.w * manifest.grid.h || this.manifest?.id !== manifest.id) return;
      const eta = new Float32Array(ti.length);
      for (let i = 0; i < ti.length; i++) eta[i] = etaFromThermalInertia(ti[i]);
      this.eta = eta;
    } catch {
      /* η defaults to 1.0, as in the engine without TI */
    }
  }

  /** Time/cost the current route with the engine cost model once the DEM is on board. */
  private applyTerrain() {
    if (this.route && this.dem && !this.route.terrain) this.route.setTerrain({ elev: this.dem, eta: this.eta });
  }

  private setPack(manifest: SitePackManifest, base: string, dem: Float32Array | null) {
    this.manifest = manifest;
    this.grid = manifest.grid;
    this.packBase = base;
    this.dem = dem;
    this.eta = null;
    this.landmark = pickLandmark(manifest.landmarks);
    this.updateLs();
    this.buildLayers();
  }

  private updateLs() {
    const sol = this.pkg?.sol ?? this.manifest?.scenario.sol;
    const rems = this.manifest?.conditions.rems?.find((r) => r.sol === sol);
    this.lsDeg = rems?.ls ?? defaultLs();
  }

  private buildLayers() {
    const m = this.manifest, g = this.grid;
    if (!m || !g) return;
    let shadowIso: Iso[] = [];
    const cl = this.pkg?.coarse;
    if (this.los) {
      const f = Math.max(1, Math.round(20 / g.cellM));
      const inv = new Float32Array(this.los.length);
      for (let i = 0; i < inv.length; i++) inv[i] = this.los[i] ? 0 : 1;
      const { vals, frame } = downsample(inv, g, f);
      shadowIso = isobands(vals, frame, [0.5]);
    } else if (cl?.los && cl.los.length === cl.w * cl.h) {
      // Live: comm shadow from the route package's 50 m engine LOS grid (hab mast ∪ rover relay).
      const vals = new Float32Array(cl.los.length);
      for (let i = 0; i < vals.length; i++) vals[i] = cl.los[i] ? 0 : 1;
      shadowIso = isobands(vals, { w: cl.w, h: cl.h, cellM: cl.cellM, originX: g.originX, originY: g.originY }, [0.5]);
    }
    this.layers = {
      grid: g,
      demIso: this.dem ? demContours(this.dem, g, 20, 10) : [],
      shadowIso,
      keepouts: m.keepouts,
      stations: m.stations,
      shelters: m.shelters,
    };
    this.versions.layers++;
    this.publish();
  }

  // ───────────────────────────── link ─────────────────────────────

  private onLinkStatus(s: LinkStatus) {
    const prev = this.linkStatus;
    this.linkStatus = s;
    if (s === 'down') {
      if (prev !== 'down' || this.linkDownSince === null) this.linkDownSince = performance.now();
    } else {
      this.linkDownSince = null;
      if (s === 'up') this.lastHeard = performance.now();
      if (!this.everUp) this.everUp = true;
      if (this.wasAutonomous) {
        const n = this.outbox.length;
        this.toast('ok', `LINK RESTORED · RESYNC ${n} MSG${n === 1 ? '' : 'S'}`);
        this.wasAutonomous = false;
      }
      this.flush();
    }
    this.publish();
  }

  private onMsg(m: LinkMsg) {
    this.lastHeard = performance.now();
    if (m.type === 'ROUTE_PUSH') this.onRoutePush(m.pkg);
    else if (m.type === 'ALERT') this.onAlert(m);
    this.publish();
  }

  private onRoutePush(pkg: PlanPackage) {
    const cur = this.pkg;
    if (cur && pkg.id === cur.id) {
      this.send({ type: 'ACK', id: pkg.id, seq: pkg.seq, accepted: true }); // idempotent resync
      return;
    }
    if (this.pending && pkg.id === this.pending.id) return;
    const floor = Math.max(cur?.seq ?? 0, this.pending?.seq ?? 0);
    if (pkg.seq <= floor) {
      this.send({ type: 'ACK', id: pkg.id, seq: pkg.seq, accepted: false });
      this.toast('caution', `STALE ROUTE v${pkg.seq} REJECTED · HAVE v${floor}`);
      return;
    }
    this.pending = pkg;
    this.ck.savePending(pkg);
    this.checkSignature(pkg);
    if (this.manifest?.id !== pkg.siteId) void this.loadSite(pkg.siteId).catch(() => this.toast('warning', `SITE PACK ${pkg.siteId} UNAVAILABLE`));
  }

  /** Ed25519 route signature (hab public key from /api/health). A forged route is NACKed and dropped. */
  private checkSignature(pkg: PlanPackage) {
    if (!pkg.sig) {
      this.pendingSig = 'unsigned';
      return;
    }
    const key = this.habPubKey;
    if (!key) {
      this.pendingSig = 'unverified';
      void this.health().then(() => this.habPubKey && this.pending?.id === pkg.id && this.checkSignature(pkg));
      return;
    }
    this.pendingSig = 'checking';
    void verifyRoute(pkg, key).then((ok) => {
      if (this.pending?.id !== pkg.id) return;
      if (ok) this.pendingSig = 'verified';
      else {
        this.pending = null;
        this.ck.savePending(null);
        this.send({ type: 'ACK', id: pkg.id, seq: pkg.seq, accepted: false });
        this.toast('warning', `ROUTE v${pkg.seq} REJECTED · BAD SIGNATURE`);
      }
      this.publish();
    });
  }

  private onAlert(m: Extract<LinkMsg, { type: 'ALERT' }>) {
    if (/CLEAR/i.test(m.code)) {
      if (this.alert) this.toast('ok', `ALL CLEAR · ${m.text}`);
      this.alert = null;
      return;
    }
    if (m.level === 'warning') {
      this.alert = { level: m.level, code: m.code, text: m.text, t: m.t };
    } else this.toast(m.level === 'caution' ? 'caution' : 'info', m.text);
  }

  private send(m: LinkMsg) {
    if (this.link && this.linkStatus !== 'down') {
      this.flush();
      this.link.send(m);
      return;
    }
    this.outbox.push(m);
    if (this.outbox.length > OUTBOX_MAX) this.outbox.splice(0, this.outbox.length - OUTBOX_MAX);
    this.ck.saveOutbox(this.outbox);
  }

  private flush() {
    if (!this.link || this.linkStatus === 'down' || !this.outbox.length) return;
    const q = this.outbox;
    this.outbox = [];
    for (const m of q) this.link.send(m);
    this.ck.saveOutbox(this.outbox);
  }

  private async pollSim() {
    if (this.pollBusy || this.linkStatus === 'down') return;
    this.pollBusy = true;
    try {
      const r = await fetch('/api/sim', { signal: AbortSignal.timeout(900) });
      if (!r.ok) return;
      const j = (await r.json()) as { running?: boolean; speed?: number; reset?: boolean; resetSeq?: number; rev?: number };
      if (typeof j.running === 'boolean') this.desired.running = j.running;
      if (typeof j.speed === 'number' && j.speed > 0) this.desired.speed = j.speed;
      if (this.sim) {
        this.sim.running = this.desired.running;
        this.sim.speed = this.desired.speed;
      }
      const marker = j.resetSeq ?? j.rev ?? j.reset ?? null;
      if (j.reset && marker !== this.lastResetSeen) this.resetSim();
      this.lastResetSeen = marker;
    } catch {
      /* hab unreachable: keep the last desired state */
    } finally {
      this.pollBusy = false;
    }
  }

  private postSim() {
    if (this.mode !== 'live' || this.linkStatus === 'down') return;
    void fetch('/api/sim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ running: this.desired.running, speed: this.desired.speed }),
    }).catch(() => undefined);
  }

  // ───────────────────────────── route ─────────────────────────────

  private installRoute(pkg: PlanPackage, fresh: boolean) {
    const g = this.grid!;
    const old = this.route;
    this.pkg = pkg;
    this.route = new RouteModel(pkg, g, this.manifest);
    const stopCells: Record<string, number> = {};
    for (const st of this.route.stops) stopCells[st.id] = st.station?.cell ?? st.cell;
    this.core = createSafetyCore(pkg, g, { stopCells }, { engine: this.mode === 'live' || this.params.get('core') === 'engine' });
    this.applyTerrain();
    if (fresh) {
      if (!this.sim || this.sim.mode === 'DONE') this.sim = newSim(this.seed + pkg.seq, this.desired.running, this.desired.speed);
      else rebaseSim(this.sim, old, this.route);
      // A science route supersedes any return order. A return-only route (no stops, e.g. the SEP
      // replan) IS the return: keep the hab's alert so the visor stays in RETURN guidance.
      if (pkg.stops.length > 0 || !this.alert) {
        this.alert = null;
        this.safetyLatched = false;
      }
    }
    this.ck.savePkg(pkg);
    this.ck.savePending(null);
    this.updateLs();
    this.versions.route++;
    this.zoneLevel = NaN;
    if (!this.los && pkg.coarse.los) this.buildLayers();
  }

  accept = async () => {
    const p = this.pending;
    if (!p) return;
    if (this.pendingSig === 'checking') return;
    if (this.manifest?.id !== p.siteId) {
      try {
        await this.loadSite(p.siteId);
      } catch {
        this.toast('warning', `CANNOT ACCEPT v${p.seq}: SITE PACK MISSING`);
        return;
      }
    }
    this.pending = null;
    this.installRoute(p, true);
    this.send({ type: 'ACK', id: p.id, seq: p.seq, accepted: true });
    this.toast('ok', `ROUTE v${p.seq} ACCEPTED · ACK ${this.linkStatus === 'down' ? 'QUEUED' : 'SENT'}`);
    this.saveDyn();
    this.publish();
  };

  /** N: tick the active crew task; once every task is ticked, depart the station. */
  next = () => {
    const sim = this.sim, route = this.route;
    if (sim?.mode !== 'DWELL' || !route) return;
    const st = route.stops[sim.stopK];
    const n = this.stationTasks(this.objectiveIdsOf(sim.stopK), st?.name ?? '').length;
    if (sim.tasksDone < n) {
      sim.tasksDone++;
    } else {
      departNow(sim);
      this.toast('info', `DEPARTING ${st?.id ?? 'STATION'}`);
    }
    this.saveDyn();
    this.publish();
  };

  private isGale(): boolean {
    return /^gale/i.test(this.manifest?.id ?? '');
  }

  private objectiveIdsOf(k: number): string[] {
    const st = this.route?.stops[k];
    if (!st) return [];
    if (st.station?.objectiveIds?.length) return st.station.objectiveIds;
    return (this.isGale() ? galeStation(st.id)?.objectiveIds : null) ?? [];
  }

  private stationTasks(objIds: string[], name: string): CrewTask[] {
    const tasks = crewTasks(objIds);
    return tasks.length ? tasks : [{ id: 'CTX', label: `Context imaging and field notes at ${name}`, objectiveId: '—', instrument: null }];
  }

  request = (kind: 'HAZARD' | 'NEW_TARGET') => {
    const cell = this.estCell();
    this.send({
      type: 'REQUEST',
      kind,
      cell: cell ?? undefined,
      note: kind === 'HAZARD' ? 'Hazard reported at crew position (visor)' : 'Crew requests reroute / new target (visor)',
      t: this.sim?.t ?? 0,
    });
    const what = kind === 'HAZARD' ? 'HAZARD REPORTED HERE' : 'REROUTE REQUESTED';
    this.toast(kind === 'HAZARD' ? 'caution' : 'info', `${what} · ${this.linkStatus === 'down' ? 'QUEUED (LINK DOWN)' : 'SENT TO HAB'}`);
    this.publish();
  };

  toggleMirror = () => {
    this.mirror = !this.mirror;
    this.saveDyn();
    this.publish();
  };

  toggleDemo = () => {
    this.demoOpen = !this.demoOpen;
    this.publish();
  };

  // ───────────────────────────── demo panel ─────────────────────────────

  toggleRun = () => {
    this.desired.running = !this.desired.running;
    if (this.sim) this.sim.running = this.desired.running;
    this.postSim();
    this.publish();
  };

  stepSpeed = (dir: 1 | -1) => {
    const cur = this.desired.speed;
    let i = SPEED_STEPS.findIndex((s) => s >= cur);
    if (i < 0) i = SPEED_STEPS.length - 1;
    if (SPEED_STEPS[i] !== cur && dir < 0) i = Math.max(0, i - 1);
    else i = Math.max(0, Math.min(SPEED_STEPS.length - 1, i + dir));
    this.desired.speed = SPEED_STEPS[i];
    if (this.sim) this.sim.speed = this.desired.speed;
    this.postSim();
    this.publish();
  };

  toggleDrop = () => {
    if (!this.link) return;
    const d = !this.link.dropped();
    this.link.setDropped(d);
    this.toast(d ? 'caution' : 'info', d ? 'DEMO: SURFACE LINK DROPPED LOCALLY' : 'DEMO: LOCAL LINK DROP CLEARED');
    this.saveDyn();
    this.publish();
  };

  simulateSep = () => {
    if (this.mode === 'mock') {
      this.mockHab?.alert('warning', 'SEP_NOWCAST', 'SEP NOWCAST — REACH SHELTER WITHIN 30 MIN', this.sim?.t ?? 0);
    } else {
      void fetch('/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'SEP_NOWCAST', leadMin: SHELTER_MAX_MIN }),
      }).catch(() => this.toast('caution', 'HAB UNREACHABLE'));
    }
  };

  pushNextVersion = () => {
    if (this.mode !== 'mock' || !this.mockHab || !this.pkg || !this.route || !this.sim) return;
    const [i] = this.route.locate(this.sim.s);
    const cell = this.route.cells[i];
    const raw = this.pkg.route.indexOf(cell, Math.max(0, i - 3));
    this.mockHab.pushRoute(nextVersion(this.pkg, raw < 0 ? i : raw, this.sim.visited), 300);
  };

  clearAlert = () => {
    this.alert = null;
    this.safetyLatched = false;
    this.saveDyn();
    this.publish();
  };

  crash = () => {
    this.saveDyn();
    location.reload();
  };

  wipe = () => {
    this.dispose();
    this.ck.clear();
    const u = new URL(location.href);
    u.searchParams.delete('reset');
    location.replace(u.toString());
  };

  private resetSim() {
    if (!this.route || !this.pkg) return;
    this.sim = newSim(this.seed + this.pkg.seq, this.desired.running, this.desired.speed);
    this.alert = null;
    this.safetyLatched = false;
    this.toast('info', 'SIMULATOR RESET TO ROUTE START');
  }

  // ───────────────────────────── loops ─────────────────────────────

  private returnActive(): boolean {
    return (this.alert?.level === 'warning' || this.safetyLatched) && this.sim?.mode !== 'DONE';
  }

  private elevAt = (x: number, y: number): number => {
    if (!this.dem || !this.grid) return NaN;
    const c = xyToCell(this.grid, x, y);
    return c < 0 ? NaN : this.dem[c];
  };

  private estCell(): number | null {
    if (!this.sim || !this.route || !this.grid) return null;
    const [x, y] = estimatedXY(this.sim, this.route);
    const c = xyToCell(this.grid, x, y);
    return c >= 0 ? c : this.route.cells[this.route.locate(this.sim.s)[0]];
  }

  private tick() {
    const now = performance.now();
    const dt = Math.min(1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    const sim = this.sim, route = this.route;
    if (sim && route && this.core) {
      const heatAdvisory = sim.heatAvgW > HEAT_BUDGET_W;
      const events = simTick(sim, route, dt, { elevAt: this.dem ? this.elevAt : undefined, heatAdvisory, returning: this.returnActive() });
      for (const e of events) {
        if (e.e === 'ARRIVED') this.toast('ok', `ARRIVED ${e.id} · POSITION FIX`);
        else if (e.e === 'DEPARTED') this.toast('info', `DEPARTED ${e.id}`);
        else if (e.e === 'DONE') {
          this.toast('ok', `AT ${route.home.name} · INGRESS`);
          this.alert = null;
          this.safetyLatched = false;
        }
      }
      if (sim.mode === 'DWELL' && sim.dwellStart !== null && sim.dwellUntil !== null) {
        // The simulated crew works through the checklist as the dwell elapses (manual N ticks run ahead).
        const n = this.stationTasks(this.objectiveIdsOf(sim.stopK), '').length;
        const prog = (sim.t - sim.dwellStart) / Math.max(0.1, sim.dwellUntil - sim.dwellStart);
        sim.tasksDone = Math.max(sim.tasksDone, Math.min(n, Math.floor(prog * n + 0.15)));
      }
      const cell = this.estCell();
      if (cell !== null) {
        this.safety = { ...this.core.update(cell, sim.t, sim.o2Pct) };
        if (this.safety.status === 'RETURN_NOW' && sim.mode !== 'DONE' && !this.safetyLatched) {
          this.safetyLatched = true;
          this.toast('warning', 'SAFETY CORE: RETURN NOW');
        }
      }
      this.updateZone();
      this.saveDyn();
    }
    const autonomous = this.isAutonomous();
    if (autonomous && !this.wasAutonomous) this.wasAutonomous = true;
    const t = performance.now();
    if (this.toasts.length && this.toasts[0].until < t) this.toasts = this.toasts.filter((x) => x.until >= t);
    this.publish();
  }

  /** AUTONOMOUS once the hab has been silent ≥ 3 s (the shared link reports 'down' after 3 missed heartbeats). */
  private isAutonomous(): boolean {
    return this.linkStatus === 'down' && performance.now() - this.lastHeard >= AUTONOMOUS_AFTER_MS;
  }

  /** Planned surface minutes left (= walkback deadline − t), from planned O₂ (engine timeline convention). */
  private remainingMin(): number {
    return ((this.sim?.o2Pct ?? 100) / 100) * SURFACE_MIN;
  }

  /** Comm line of sight at a cell: dense field (mock) or the route package's 50 m engine LOS grid (live). */
  private losAt(cell: number): boolean | null {
    if (this.los) return this.los[cell] === 1;
    const c = this.pkg?.coarse, g = this.grid;
    if (!c?.los || !g || cell < 0) return null;
    const f = c.cellM / g.cellM;
    const r = Math.min(c.h - 1, Math.floor(Math.floor(cell / g.w) / f));
    const col = Math.min(c.w - 1, Math.floor((cell % g.w) / f));
    return c.los[r * c.w + col] === 1;
  }

  /** Safe zone = cells where walkback ≤ remaining time AND time-to-shelter ≤ the shelter rule (coarse 50 m grid). */
  private updateZone() {
    const pkg = this.pkg, g = this.grid;
    if (!pkg || !g) return;
    const level = this.remainingMin();
    if (Math.abs(level - this.zoneLevel) < 1) return;
    this.zoneLevel = level;
    const c = pkg.coarse;
    const vals = new Float32Array(c.w * c.h);
    for (let i = 0; i < vals.length; i++) {
      const wb = c.walkbackMin[i], sh = c.shelterMin[i];
      const r = wb === 65535 || sh === 65535 ? 1e6 : Math.max(wb / Math.max(1, level), sh / SHELTER_MAX_MIN);
      vals[i] = -r;
    }
    this.zone = isobands(vals, { w: c.w, h: c.h, cellM: c.cellM, originX: g.originX, originY: g.originY }, [-1]);
    this.versions.zone++;
  }

  private telem() {
    const sim = this.sim, route = this.route, pkg = this.pkg;
    if (!sim || !route || !pkg || sim.mode === 'IDLE') return;
    const cell = this.estCell();
    if (cell === null) return;
    this.send({
      type: 'TELEM',
      telem: {
        t: Math.round(sim.t * 100) / 100,
        cell,
        sigmaM: Math.round(sim.sigmaM * 10) / 10,
        o2Pct: Math.round(sim.o2Pct * 10) / 10,
        metW: Math.round(sim.metW),
        heatAvgW: Math.round(sim.heatAvgW),
        headingDeg: Math.round(norm360(sim.headingDeg)),
        routeSeq: pkg.seq,
      },
    });
  }

  private saveDyn() {
    this.ck.saveDyn({
      v: 1,
      savedAt: Date.now(),
      siteId: this.manifest?.id ?? null,
      sim: this.sim,
      alert: this.alert,
      safetyLatched: this.safetyLatched,
      mirror: this.mirror,
      lastResetSeen: this.lastResetSeen,
      localDrop: this.link?.dropped() ?? false,
    });
  }

  toast(level: Toast['level'], text: string, err?: unknown) {
    if (err) console.warn('[visor]', text, err);
    const until = performance.now() + (level === 'warning' ? 7000 : 4500);
    this.toasts = [...this.toasts.filter((t) => t.text !== text), { id: ++this.toastId, level, text, until }].slice(-4);
    this.publish();
  }

  getMapLayers(): MapLayers | null {
    return this.layers;
  }

  // ───────────────────────────── snapshot ─────────────────────────────

  private pendingInfo(): PendingInfo | null {
    const p = this.pending;
    if (!p) return null;
    let distM = 0;
    if (this.grid) {
      const g = this.grid;
      for (let i = 1; i < p.route.length; i++) {
        const a = p.route[i - 1], b = p.route[i];
        distM += Math.hypot(Math.floor(a / g.w) - Math.floor(b / g.w), (a % g.w) - (b % g.w)) * g.cellM;
      }
    }
    const last = p.stops[p.stops.length - 1];
    const first = p.stops[0];
    const firstBingo = p.bingo.find((b) => b.id === first?.id);
    const g = this.grid;
    const endSh = g && p.route.length ? shelterAt(this.manifest, g, p.route[p.route.length - 1]) : null;
    const startSh = g && p.route.length ? shelterAt(this.manifest, g, p.route[0]) : null;
    const toLabel = endSh ? shelterLabel(endSh) : 'HAB';
    // A mid-EVA replan starts where the crew is ('HERE'); a fresh route starts at a shelter.
    const [sx, sy] = g && p.route.length ? cellToXY(g, p.route[0]) : [NaN, NaN];
    const outAndBack = p.route.length > 1 && p.route[0] === p.route[p.route.length - 1];
    const fromLabel = outAndBack ? toLabel : startSh && Math.hypot(startSh.x - sx, startSh.y - sy) < 25 ? shelterLabel(startSh) : 'HERE';
    return {
      fromLabel,
      toLabel,
      seq: p.seq,
      parentSeq: this.pkg && p.parent === this.pkg.id ? this.pkg.seq : null,
      author: p.author,
      stops: p.order,
      distM,
      durMin: last ? last.departMin - (first?.arriveMin ?? 0) + distM / V0 / 60 / Math.max(1, p.stops.length + 1) : distM / V0 / 60,
      firstStop: first?.id ?? null,
      bingo: firstBingo ? `LEAVE ${firstBingo.id} BY ${formatLtst(firstBingo.ltstMin)} LTST` : null,
      sameAsCurrentGeometry: false,
      sig: this.pendingSig,
    };
  }

  private pickImage(st: Station | null): StationInfo['image'] {
    const m = this.manifest;
    if (!st || !m || !m.images?.length) return null;
    let img: RoverImage | undefined;
    for (const id of st.imageIds ?? []) {
      img = m.images.find((i) => i.id === id);
      if (img) break;
    }
    if (!img) {
      let bd = 40;
      for (const i of m.images) {
        const d = Math.hypot(i.x - st.x, i.y - st.y);
        if (d < bd) { bd = d; img = i; }
      }
    }
    if (!img || !this.packBase) return null;
    return {
      url: `${this.packBase}/${img.file.replace(/^\.?\//, '')}`,
      credit: img.credit,
      sol: img.sol,
      camera: img.camera,
      caption: img.caption ?? null,
      sourceUrl: img.sourceUrl,
    };
  }

  private publish() {
    const sim = this.sim, route = this.route, pkg = this.pkg, g = this.grid, m = this.manifest;
    const t = sim?.t ?? 0;
    const startLtst = pkg?.startLtstMin ?? m?.scenario.startLtstMin ?? 0;
    const ltstMin = ltstAt(startLtst, t);
    const heading = sim?.headingDeg ?? 0;
    const returning = this.returnActive();
    const autonomous = this.isAutonomous();
    const heatAdvisory = !!sim && sim.heatAvgW > HEAT_BUDGET_W;
    const pace = V0 * (heatAdvisory ? HEAT_PACE_FACTOR : 1);

    let est: [number, number] | null = null;
    let offRouteM = 0;
    let next: NextInfo | null = null;
    let station: StationInfo | null = null;
    let ret: ReturnInfo | null = null;
    let bingo: Snapshot['bingo'] = null;
    let comm: Snapshot['comm'] = { available: false, inLos: true, changeInMin: null };

    if (sim && route && g) {
      est = estimatedXY(sim, route);
      offRouteM = route.nearest(est[0], est[1], sim.s, 120).d;
      const st = route.stops[sim.stopK];
      const habBingo = pkg?.bingo.find((b) => b.id === 'HAB');
      if (st?.bingo) bingo = { id: st.id, inMin: st.bingo.tMin - t, ltstMin: ltstAt(startLtst, st.bingo.tMin) };
      else if (!st && habBingo) bingo = { id: 'HAB', inMin: habBingo.tMin - t, ltstMin: ltstAt(startLtst, habBingo.tMin) };

      if (sim.mode !== 'RETURN' && sim.mode !== 'DONE') {
        const tx = st ? st.x : route.home.x, ty = st ? st.y : route.home.y;
        const ts = st ? st.s : route.length;
        const along = Math.max(0, ts - sim.s);
        const distM = along + offRouteM;
        const b = bearingDeg(est[0], est[1], tx, ty);
        const [cx, cy] = route.pointAt(sim.s + Math.min(40, along));
        const steer = along > 1 ? bearingDeg(est[0], est[1], cx, cy) : b;
        const etaMin = distM / pace / 60;
        next = {
          id: st ? st.id : route.home.name,
          name: st ? st.name : route.home.full,
          isHome: !st,
          distM,
          etaMin,
          arrLtstMin: ltstAt(startLtst, t + etaMin),
          bearingDeg: b,
          relDeg: norm360(b - heading),
          steerRelDeg: norm360(steer - heading),
          index: Math.min(sim.stopK + 1, route.stops.length + 1),
          total: route.stops.length + 1,
        };
      }

      if (sim.mode === 'DWELL' && st) {
        const total = Math.max(0.1, (sim.dwellUntil ?? t) - (sim.dwellStart ?? t));
        const left = Math.max(0, (sim.dwellUntil ?? t) - t);
        const s = st.station;
        const gale = this.isGale() ? galeStation(st.id) : null;
        const objIds = s?.objectiveIds?.length ? s.objectiveIds : (gale?.objectiveIds ?? []);
        const objs = objectivesFor(objIds);
        const tasks = this.stationTasks(objIds, st.name);
        const done = Math.min(tasks.length, sim.tasksDone);
        station = {
          id: st.id,
          name: st.name,
          description: s?.description || gale?.description || '',
          objectives: objIds,
          value: s?.value ?? null,
          dwellLeftMin: left,
          dwellTotalMin: total,
          dwellCut: sim.dwellCut,
          leaveByLtstMin: st.bingo ? ltstAt(startLtst, st.bingo.tMin) : null,
          objective: objs[0] ? { id: objs[0].id, goal: objs[0].goal, statement: objs[0].statement, weight: objs[0].weight } : null,
          otherObjectives: objs.slice(1).map((o) => o.id),
          tasks: tasks.map((tk, i) => ({ ...tk, done: i < done, active: i === done })),
          tasksDone: done,
          citation: s?.citation ?? gale?.citation ?? null,
          image: this.pickImage(s),
          index: sim.stopK + 1,
          total: route.stops.length,
        };
      }

      if (returning) {
        const startIsHome = Math.hypot(route.start.x - route.home.x, route.start.y - route.home.y) < 25;
        const dir = sim.mode === 'RETURN' ? sim.returnDir : startIsHome && sim.s < route.length - sim.s ? -1 : 1;
        const along = dir > 0 ? route.length - sim.s : sim.s;
        const [cx, cy] = route.pointAt(sim.s + dir * Math.min(40, along));
        const b = along > 1 ? bearingDeg(est[0], est[1], cx, cy) : bearingDeg(est[0], est[1], route.home.x, route.home.y);
        const sf = this.safety;
        const reason = this.alert
          ? this.alert.text
          : sf && sf.walkbackMarginMin <= 0
            ? 'WALKBACK MARGIN EXHAUSTED'
            : sf && sf.bingoInMin !== null && sf.bingoInMin < 0
              ? `BINGO ${sf.nextStopId ?? ''} PASSED`.replace('  ', ' ')
              : 'ONBOARD SAFETY CORE: RETURN NOW';
        ret = {
          source: this.alert ? 'alert' : 'safety',
          level: 'warning',
          code: this.alert?.code ?? 'SAFETY_CORE',
          reason,
          target: route.home.name,
          distM: along + offRouteM,
          etaMin: (along + offRouteM) / pace / 60,
          walkbackEtaMin: (along + offRouteM) / (V0 * WALKBACK_FACTOR) / 60,
          relDeg: norm360(b - heading),
          bearingDeg: b,
          coarseReturnDeg: sf ? sf.returnBearingDeg : null,
        };
      }

      const c0 = xyToCell(g, est[0], est[1]);
      const here = this.losAt(c0);
      if (here !== null) {
        const inLos = here;
        let changeInMin: number | null = null;
        const dir = sim.mode === 'RETURN' ? sim.returnDir : 1;
        for (let d = 10; d <= pace * 60 * 20; d += 10) {
          const s1 = sim.s + dir * d;
          if (s1 < 0 || s1 > route.length) break;
          const [x, y] = route.pointAt(s1);
          const c = xyToCell(g, x, y);
          if (c < 0) break;
          if (this.losAt(c) !== inLos) {
            changeInMin = d / pace / 60;
            break;
          }
        }
        comm = { available: true, inLos, changeInMin };
      }
    }

    let display: DisplayState;
    if (!this.ready) display = 'BOOT';
    else if (this.pending) display = 'NEW_ROUTE';
    else if (!pkg) display = 'WAITING_FOR_ROUTE';
    else if (sim?.mode === 'DONE') display = 'COMPLETE';
    else if (returning) display = 'RETURN_NOW';
    else if (sim?.mode === 'DWELL') display = 'STATION';
    else display = 'NAV';

    const sf = this.safety;
    const prov = m?.rasters.dem?.provenance?.[0];
    const credit = !m
      ? ''
      : prov?.mission === 'Synthetic'
        ? 'TERRAIN: SYNTHETIC — NOT REAL MARS DATA'
        : prov
          ? `TERRAIN: ${prov.mission} ${prov.instrument} · ${prov.resolutionM} M`.toUpperCase()
          : '';

    const snap: Snapshot = {
      ...initialSnapshot,
      ready: this.ready,
      bootStage: this.bootStage,
      bootError: this.bootError,
      mode: this.mode,
      display,
      seq: pkg?.seq ?? null,
      pending: this.pendingInfo(),
      link: this.linkStatus,
      localDrop: this.link?.dropped() ?? false,
      autonomous,
      linkDownS: this.linkDownSince === null ? 0 : (performance.now() - this.linkDownSince) / 1000,
      outbox: this.outbox.length,
      t,
      ltstMin,
      sol: pkg?.sol ?? m?.scenario.sol ?? null,
      o2Pct: sim?.o2Pct ?? 100,
      metW: sim?.metW ?? 0,
      heatAvgW: sim?.heatAvgW ?? 0,
      heatAdvisory,
      heatRest: sim?.resting ? { active: true, leftMin: (sim.restLeftS ?? 0) / 60 } : null,
      homeName: route?.home.name ?? (m ? shelterLabel(m.shelters.find((x) => x.kind === 'hab') ?? { id: 'HAB', name: 'HAB' }) : 'HAB'),
      sigmaM: sim?.sigmaM ?? 0,
      headingDeg: heading,
      est,
      offRouteM,
      next,
      bingo,
      station,
      ret,
      cue: sim && est && m ? headingCue(ltstMin, heading, this.lsDeg, m.grid.centerLonLat[1], est, this.landmark) : null,
      comm,
      safety: sf,
      walkbackMarginMin: sf ? sf.walkbackMarginMin : null,
      shelterMin: sf ? SHELTER_MAX_MIN - sf.shelterMarginMin : g && pkg && sim && est ? coarseAt(g, pkg.coarse, 'shelterMin', xyToCell(g, est[0], est[1])) : null,
      remainingMin: this.remainingMin(),
      sim: { running: this.desired.running, speed: this.desired.speed, mode: sim?.mode ?? 'NONE' },
      mirror: this.mirror,
      demoOpen: this.demoOpen,
      toasts: this.toasts,
      versions: { ...this.versions },
      impl: { safetyCore: engineImpl.safetyCore, toPlanPackage: engineImpl.toPlanPackage, sun: engineImpl.sun, link: this.mode === 'mock' ? 'mock-hab' : linkImpl.ws, map: mapImpl.proj },
      habRx: this.mockHab?.telemCount ?? 0,
      odoM: sim?.odoM ?? 0,
      visitedCount: sim?.visited.length ?? 0,
      stopsTotal: route?.stops.length ?? 0,
      siteName: m?.name ?? '',
      credit,
      restoredInMs: this.restoredInMs,
    };
    useVisor.setState({ snap });
  }
}
