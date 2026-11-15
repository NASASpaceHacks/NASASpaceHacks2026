import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { VisorController } from '@mw/visor/src/core/visor';
import { useVisor, type Snapshot } from '@mw/visor/src/state/store';
import { fmtCountdown, fmtDist, hdg, pad } from '@mw/visor/src/ui/format';
import { requestCompassPermission, useCamera, useCompass, useWakeLock } from './sensors';

/** Signed angle in (−180, 180]. */
const signed = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
const norm = (d: number) => ((d % 360) + 360) % 360;

type Tone = 'go' | 'warn' | 'ret';
type XY = [number, number];

function turnOf(rel: number): string {
  const a = Math.abs(rel);
  const side = rel > 0 ? 'right' : 'left';
  if (a < 12) return 'Straight ahead';
  if (a < 45) return `Bear ${side}`;
  if (a < 140) return `Turn ${side}`;
  return 'Turn around';
}

const dist = (m: number) => {
  const d = fmtDist(m);
  return `${d.v} ${d.u.toLowerCase()}`;
};

/** Phase Elapsed Time from EVA minutes → HH:MM:SS. */
function fmtPet(min: number): string {
  const s = Math.max(0, Math.floor(min * 60));
  return `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}`;
}

// ─────────────────────────── ground arrow ───────────────────────────

function useViewport(): [number, number] {
  const get = (): [number, number] => [window.innerWidth || 1, window.innerHeight || 1];
  const [v, setV] = useState(get);
  useEffect(() => {
    const on = () => setV(get());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return v;
}

/**
 * A static course ribbon painted on the ground, projected through a simple pinhole camera (eye 1.7 m above
 * the surface, horizon at ~44 % of the screen) so it runs from your feet out toward the horizon and bends
 * toward the steer direction. No animation: a suited crew member should read it at a glance.
 */
function GroundArrow({ rel }: { rel: number }) {
  const [W, H] = useViewport();
  const a = (Math.max(-75, Math.min(75, rel)) * Math.PI) / 180;
  const g = useMemo(() => {
    const EYE = 1.7, hy = H * 0.44, f = Math.max(W, H * 0.6) * 0.95, cx = W / 2;
    const proj = (x: number, z: number): XY => [cx + (f * x) / z, hy + (f * EYE) / z];
    // Ground-plane centreline (x right, z forward, metres): straight, then bending toward the course.
    const p0: XY = [0, 1.5], p1: XY = [0, 11], p2: XY = [26 * Math.sin(a), 11 + 26 * Math.cos(a)];
    const at = (t: number): XY => {
      const u = 1 - t;
      return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
    };
    const tan = (t: number): XY => {
      const dx = 2 * (1 - t) * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]);
      const dz = 2 * (1 - t) * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
      const l = Math.hypot(dx, dz) || 1;
      return [dx / l, dz / l];
    };
    const HW = 0.32, N = 60, tEnd = 0.9;
    const left: XY[] = [], right: XY[] = [];
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * tEnd;
      const [x, z] = at(t);
      const [tx, tz] = tan(t);
      left.push(proj(x - tz * HW, z + tx * HW));
      right.push(proj(x + tz * HW, z - tx * HW));
    }
    const [hx, hz] = at(tEnd);
    const [tx, tz] = tan(tEnd);
    const HHW = 0.9, HL = 2.2;
    const head = [proj(hx - tz * HHW, hz + tx * HHW), proj(hx + tx * HL, hz + tz * HL), proj(hx + tz * HHW, hz - tx * HHW)];
    const f2 = (p: XY) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    // Static chevrons painted inside the ribbon, pointing along the course.
    const chevrons: { d: string; w: number }[] = [];
    for (const t of [0.1, 0.22, 0.34, 0.46, 0.58, 0.7, 0.8]) {
      const [x, z] = at(t);
      const [ux, uz] = tan(t);
      const cw = 0.26, cl = 0.22;
      const tipW: XY = [x + ux * cl, z + uz * cl];
      const l: XY = [x - uz * cw - ux * cl, z + ux * cw - uz * cl];
      const r: XY = [x + uz * cw - ux * cl, z - ux * cw - uz * cl];
      chevrons.push({ d: `M${f2(proj(...l))} L${f2(proj(...tipW))} L${f2(proj(...r))}`, w: Math.max(1.5, Math.min(14, (f * 0.07) / z)) });
    }
    return {
      chevrons,
      body: `M${left.map(f2).join(' L')} L${right.slice().reverse().map(f2).join(' L')} Z`,
      edgeL: `M${left.map(f2).join(' L')}`,
      edgeR: `M${right.map(f2).join(' L')}`,
      head: `M${head.map(f2).join(' L')} Z`,
      hy,
    };
  }, [a, W, H]);
  return (
    <svg className="ground" viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <defs>
        <linearGradient id="fade" gradientUnits="userSpaceOnUse" x1="0" y1={g.hy} x2="0" y2={H}>
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="0.25" stopColor="#fff" stopOpacity="0.95" />
          <stop offset="0.85" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.3" />
        </linearGradient>
        <mask id="fade-mask" maskUnits="userSpaceOnUse" x="0" y="0" width={W} height={H}>
          <rect x="0" y="0" width={W} height={H} fill="url(#fade)" />
        </mask>
      </defs>
      <g mask="url(#fade-mask)">
        <path d={g.body} className="rib-fill" />
        <path d={g.edgeL} className="rib-edge" />
        <path d={g.edgeR} className="rib-edge" />
        {g.chevrons.map((c, i) => <path key={i} d={c.d} className="rib-chev" style={{ strokeWidth: c.w }} />)}
        <path d={g.head} className="rib-head" />
      </g>
    </svg>
  );
}


// ─────────────────────────── top: leg progress rail + corner readout ───────────────────────────

function LinkDot({ s }: { s: Snapshot }) {
  const cls = s.autonomous || s.link === 'down' ? 'down' : s.link === 'degraded' ? 'deg' : 'up';
  return <span className={`dot ${cls}`} />;
}

interface Target { name: string; distM: number; bearing: number; etaMin: number }
interface Leg { doneM: number; totalM: number }

/** Straight 0–100 rail across the top: how far along the current leg the crew has walked. */
function ProgressRail({ leg, target }: { leg: Leg | null; target: Target | null }) {
  if (!target) return null;
  const total = leg ? leg.totalM : target.distM;
  const done = leg ? Math.max(0, Math.min(total, leg.doneM)) : 0;
  const pct = total > 0 ? (done / total) * 100 : 0;
  return (
    <div className="rail">
      <span className="rail-lbl"><span className="num">{Math.round(done)}</span> m</span>
      <div className="rail-track">
        <div className="rail-fill" style={{ width: `${pct.toFixed(1)}%` }} />
        <span className="rail-me" style={{ left: `${pct.toFixed(1)}%` }} />
      </div>
      <span className="rail-lbl end">{dist(target.distM)} · {target.name}</span>
    </div>
  );
}

function Corner({ t, heading, target }: { t: number; heading: number; target: Target | null }) {
  return (
    <div className="corner">
      <div><span className="lbl">PET</span><span className="val">{fmtPet(t)}</span></div>
      <div><span className="lbl">HDG</span><span className="val">{hdg(heading)}°</span></div>
      {target && <div><span className="lbl">CRS</span><span className="val">{hdg(target.bearing)}°</span></div>}
    </div>
  );
}

// ─────────────────────────── minimap ───────────────────────────

/** North-up minimap: planned route dashed, the walked (actual) track solid, crew position + heading. */
function MiniMap({ ctl, est, track, heading, nextId }: { ctl: VisorController; est: XY | null; track: XY[]; heading: number; nextId: string | null }) {
  const route = ctl.route;
  if (!route || !est) return null;
  const SIZE = 100; // viewBox half-size in SVG units
  let tx = est[0], ty = est[1];
  const next = route.stops.find((st) => st.id === nextId);
  const tgt: XY = next ? [next.x, next.y] : [route.home.x, route.home.y];
  const R = Math.min(1500, Math.max(150, Math.hypot(tgt[0] - tx, tgt[1] - ty) * 1.25));
  const k = SIZE / R;
  const P = (x: number, y: number) => `${((x - tx) * k).toFixed(1)},${(-(y - ty) * k).toFixed(1)}`;
  const planned: string[] = [];
  for (let i = 0; i < route.n; i++) planned.push(P(route.xs[i], route.ys[i]));
  const actual = track.map(([x, y]) => P(x, y));
  const [hx, hy] = P(route.home.x, route.home.y).split(',').map(Number);
  return (
    <div className="minimap" aria-label="Route map">
      <svg viewBox={`${-SIZE} ${-SIZE} ${SIZE * 2} ${SIZE * 2}`}>
        <defs>
          <clipPath id="mm-clip"><circle r={SIZE - 1} /></clipPath>
        </defs>
        <circle r={SIZE - 1} className="mm-bg" />
        <g clipPath="url(#mm-clip)">
          <circle r={SIZE / 2} className="mm-ring" />
          <path d={`M${planned.join(' L')}`} className="mm-plan" />
          {actual.length > 1 && <path d={`M${actual.join(' L')}`} className="mm-actual" />}
          {route.stops.map((st) => {
            const [x, y] = P(st.x, st.y).split(',').map(Number);
            const on = st.id === nextId;
            return <circle key={st.id} cx={x} cy={y} r={on ? 6 : 4} className={on ? 'mm-wp on' : 'mm-wp'} />;
          })}
          <rect x={hx - 5} y={hy - 5} width={10} height={10} className={nextId === null || nextId === route.home.name ? 'mm-home on' : 'mm-home'} />
          <g transform={`rotate(${norm(heading).toFixed(0)})`}>
            <path d="M0,-10 L7,8 L0,4 L-7,8 Z" className="mm-me" />
          </g>
        </g>
        <text x={0} y={-SIZE + 14} className="mm-n">N</text>
        <text x={SIZE - 8} y={SIZE - 6} className="mm-scale">{dist(R / 2)}</text>
      </svg>
    </div>
  );
}

// ─────────────────────────── action cards (non-nav states) ───────────────────────────

function Card({ tone = 'go', children }: { tone?: Tone; children: ReactNode }) {
  return <div className={`card tone-${tone}`}>{children}</div>;
}

// ─────────────────────────── app ───────────────────────────

export function App({ ctl }: { ctl: VisorController }) {
  const s = useVisor((st) => st.snap);
  const [started, setStarted] = useState(false);
  const [compassOn, setCompassOn] = useState(false);
  const cam = useCamera(started);
  const compass = useCompass(compassOn);
  useWakeLock(started);

  // Actual walked track (estimated positions), reset when the route package changes.
  const track = useRef<{ seq: number | null; pts: XY[] }>({ seq: null, pts: [] });
  useEffect(() => {
    if (track.current.seq !== s.seq) track.current = { seq: s.seq, pts: [] };
    if (!s.est) return;
    const pts = track.current.pts;
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(s.est[0] - last[0], s.est[1] - last[1]) > 2) pts.push([s.est[0], s.est[1]]);
  }, [s.est, s.seq]);

  const start = async () => {
    const ok = await requestCompassPermission();
    setCompassOn(ok && /iPhone|iPad|Android/i.test(navigator.userAgent));
    setStarted(true);
  };

  // Heading: the phone's compass when on (AR on Earth), else the route simulator's walking heading.
  const heading = compass ?? s.headingDeg;
  const relTo = (absDeg: number) => signed(absDeg - heading);

  const returning = s.display === 'RETURN_NOW' && s.ret;
  const tone: Tone = returning ? 'ret' : s.autonomous || s.offRouteM > 25 ? 'warn' : 'go';

  let rel: number | null = null;
  let target: Target | null = null;
  let card: ReactNode = null;

  if (returning && s.ret) {
    const crs = s.ret.bearingDeg;
    rel = relTo(crs);
    target = { name: s.ret.target, distM: s.ret.distM, bearing: crs, etaMin: s.ret.etaMin };
  } else if (s.display === 'NAV' && s.next) {
    const n = s.next;
    const crs = norm(s.headingDeg + n.steerRelDeg);
    rel = relTo(crs);
    target = { name: n.isHome ? s.homeName : n.name, distM: n.distM, bearing: norm(n.bearingDeg), etaMin: n.etaMin };
  }

  // Current leg progress along the route (previous stop → next stop), for the 0–100 rail.
  const retStart = useRef<number | null>(null);
  if (!returning) retStart.current = null;
  else if (s.ret && (retStart.current === null || s.ret.distM > retStart.current)) retStart.current = s.ret.distM;
  let leg: Leg | null = null;
  if (returning && s.ret && retStart.current) {
    leg = { totalM: retStart.current, doneM: retStart.current - s.ret.distM };
  } else if (target && ctl.route && ctl.sim) {
    const stops = ctl.route.stops, k = ctl.sim.stopK;
    const end = stops[k] ? stops[k].s : ctl.route.length;
    const startS = k > 0 && stops[k - 1] ? stops[k - 1].s : 0;
    leg = { totalM: Math.max(1, end - startS), doneM: ctl.sim.s - startS };
  }

  if (s.display === 'BOOT') {
    card = (
      <Card>
        <div className="instr-main">MARSWALK</div>
        <div className="instr-sub">{s.bootError ?? s.bootStage}</div>
      </Card>
    );
  } else if (s.display === 'WAITING_FOR_ROUTE') {
    card = (
      <Card>
        <div className="instr-main">Waiting for route</div>
        <div className="instr-sub">
          <LinkDot s={s} /> {s.link === 'down' ? 'No hab link' : 'Hab connected'}
        </div>
      </Card>
    );
  } else if (s.display === 'NEW_ROUTE' && s.pending) {
    const p = s.pending;
    card = (
      <Card>
        <div className="instr-main">New route v{p.seq}</div>
        <div className="instr-sub wrap">
          {p.fromLabel} → {p.toLabel} · {p.stops.length} stops · {dist(p.distM)} · {Math.round(p.durMin)} min
        </div>
        {p.sig === 'unverified' && <div className="instr-sub tone-warn">Signature not verified</div>}
        <button className="btn" disabled={p.sig === 'checking'} onClick={() => void ctl.accept()}>
          {p.sig === 'checking' ? 'Checking…' : 'Accept'}
        </button>
      </Card>
    );
  } else if (s.display === 'STATION' && s.station) {
    const st = s.station;
    const task = st.tasks.find((t) => t.active);
    const allDone = st.tasksDone >= st.tasks.length;
    card = (
      <Card>
        <div className="instr-main">{st.name}</div>
        <div className="instr-sub wrap">
          {allDone ? 'All tasks done' : `${st.tasksDone + 1}/${st.tasks.length} · ${task?.label ?? ''}`} · {fmtCountdown(st.dwellLeftMin)} left
        </div>
        <button className="btn" onClick={ctl.next}>{allDone ? 'Depart' : 'Task done'}</button>
      </Card>
    );
  } else if (s.display === 'COMPLETE') {
    card = (
      <Card>
        <div className="instr-main">EVA complete</div>
        <div className="instr-sub">At {s.homeName} · {dist(s.odoM)} walked</div>
      </Card>
    );
  }

  return (
    <div className={`root tone-${tone}`}>
      <video ref={cam.ref} className={`cam ${cam.state === 'on' ? 'on' : ''}`} playsInline muted autoPlay />
      {cam.state !== 'on' && <div className="cam-fallback" />}

      <div className="safe">
        <div className="top">
          <ProgressRail leg={leg} target={target} />
          {returning && s.ret && (
            <div className="banner tone-ret">
              <div className="banner-main">RETURN NOW</div>
              <div className="banner-sub">{s.ret.reason}</div>
            </div>
          )}
          {!returning && s.autonomous && <div className="chip tone-warn">LINK LOST · AUTONOMOUS</div>}
          {!returning && !s.autonomous && s.offRouteM > 25 && s.display === 'NAV' && (
            <div className="chip tone-warn">OFF ROUTE {Math.round(s.offRouteM)} M</div>
          )}
        </div>

        {rel !== null && <GroundArrow rel={rel} />}
        <Corner t={s.t} heading={heading} target={target} />

        {card && <div className="action">{card}</div>}
      </div>

      <MiniMap ctl={ctl} est={s.est} track={track.current.pts} heading={heading} nextId={s.next?.id ?? null} />

      {started && (
        <button className={`compass-toggle ${compass !== null ? 'on' : ''}`} onClick={() => setCompassOn((v) => !v)} aria-label="Toggle compass heading">
          {compass !== null ? 'COMPASS' : 'SIM HDG'}
        </button>
      )}

      {!started && (
        <button className="start" onClick={() => void start()}>
          <span className="start-main">Start AR visor</span>
          <span className="start-sub">Uses camera and compass</span>
        </button>
      )}
    </div>
  );
}
