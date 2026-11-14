import { useEffect, useMemo, useRef, useState } from 'react';
import { distM, fmtDur, idx, type Area } from '../shared/data';
import { link } from '../shared/link';
import { fmtHours, lightTimeMin, marsTime } from '../shared/mars';
import { demoMission, newId } from '../shared/demo';
import type { Mission, Telemetry } from '../shared/types';
import { MiniMap } from './MiniMap';
import {
  alerts as computeAlerts, clock, completeTask, fix, guidance, initState, makeCtx, nearestLandmark, planReturn,
  replanLeg, step, type Ctx, type SimState,
} from './sim';

type Page = 'nav' | 'map' | 'science' | 'systems';
const PAGES: Page[] = ['nav', 'map', 'science', 'systems'];
const wrap180 = (d: number) => ((d + 540) % 360) - 180;

export function Hud({ area }: { area: Area }) {
  const [mission, setMission] = useState<Mission | null>(() => link.mission());
  const ctxRef = useRef<Ctx | null>(null);
  const [s, setS] = useState<SimState | null>(null);
  const [page, setPage] = useState<Page>('nav');
  const [declutter, setDeclutter] = useState(0);
  const [auto, setAuto] = useState(true);
  const [paused, setPaused] = useState(true);
  const [scale, setScale] = useState(5);
  const [mono, setMono] = useState(false);
  const [headingUp, setHeadingUp] = useState(true);
  const [help, setHelp] = useState(false);
  const [toast, setToast] = useState<{ text: string; t: number } | null>(null);
  const [notes, setNotes] = useState<{ text: string; t: number }[]>([]);
  const [returnArm, setReturnArm] = useState(0);
  const keys = useRef({ forward: false, left: false, right: false });
  const sRef = useRef<SimState | null>(null);
  sRef.current = s;

  const say = (text: string) => setToast({ text, t: Date.now() });

  // Load / reload the mission package; acknowledge to the habitat.
  useEffect(() => {
    if (!mission) { ctxRef.current = null; setS(null); return; }
    ctxRef.current = makeCtx(area, mission);
    setS(initState(ctxRef.current));
    setPaused(true);
    link.send({ type: 'ack', missionId: mission.id, version: mission.version, t: Date.now() });
  }, [mission, area]);

  useEffect(() => link.on((m) => {
    if (m.type === 'deploy') { setMission(m.mission); say(`Mission v${m.mission.version} received from habitat`); }
    if (m.type === 'note') setNotes((n) => [{ text: m.text, t: m.t }, ...n].slice(0, 4));
    if (m.type === 'abort') triggerReturn(`Habitat: ${m.reason}`);
  }), []); // eslint-disable-line

  const triggerReturn = (why: string) => {
    const ctx = ctxRef.current, cur = sRef.current;
    if (!ctx || !cur) return;
    const path = planReturn(ctx, cur);
    if (!path) { say('NO SAFE RETURN PATH FOUND — hold position, call habitat'); return; }
    setS({ ...cur, mode: 'return', returnLeg: path, phase: 'enroute' });
    setPaused(false);
    say(`EMERGENCY RETURN — ${why}`);
  };

  // Simulation loop (10 Hz).
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => {
      const ctx = ctxRef.current;
      setS((cur) => (ctx && cur && cur.phase !== 'done' ? step(ctx, cur, 0.1 * scale, { ...keys.current, auto }) : cur));
    }, 100);
    return () => clearInterval(t);
  }, [paused, scale, auto]);

  const ctx = ctxRef.current;
  const g = useMemo(() => (ctx && s ? guidance(ctx, s) : null), [ctx, s]);
  const al = useMemo(() => (ctx && s && g ? computeAlerts(ctx, s, g) : []), [ctx, s, g]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  // Telemetry to the habitat at 1 Hz.
  useEffect(() => {
    const cur = sRef.current;
    if (!ctx || !cur || !g || !mission) return;
    const worst = al.some((a) => a.sev === 'warning') ? 'warning' : al.some((a) => a.sev === 'caution') ? 'caution' : 'nominal';
    const tel: Telemetry = {
      t: Date.now(), missionId: mission.id, version: mission.version, est: g.est, sigmaM: cur.sigma, heading: cur.heading,
      legIndex: cur.mode === 'return' ? 0 : mission.stops.indexOf(g.target), crossTrackM: g.crossTrack, pet: cur.pet,
      o2: cur.o2, battery: cur.battery, marginS: g.marginS, status: cur.mode === 'return' ? 'emergency' : worst,
      completed: cur.completed, alerts: [],
    };
    link.send({ type: 'telemetry', tel });
  }, [now]); // eslint-disable-line

  // Push new alert texts to the habitat log once.
  const sentAlerts = useRef(new Set<string>());
  useEffect(() => {
    if (!mission || !g || !s) return;
    const fresh = al.filter((a) => a.sev !== 'info' && !sentAlerts.current.has(a.id + a.text.replace(/\d+/g, '#')));
    if (!fresh.length) return;
    fresh.forEach((a) => sentAlerts.current.add(a.id + a.text.replace(/\d+/g, '#')));
    fresh.forEach((a) => link.send({ type: 'alert', text: a.text, sev: a.sev === 'warning' ? 'warning' : 'caution', t: Date.now() }));
  }, [al]); // eslint-disable-line

  // Joint AR-style controls: a dial (Q/E) and two buttons (Space = select, Tab = declutter), plus shortcuts.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key;
      if (k === 'ArrowUp') keys.current.forward = true;
      if (k === 'ArrowLeft') keys.current.left = true;
      if (k === 'ArrowRight') keys.current.right = true;
      if (k.startsWith('Arrow')) { setAuto(false); e.preventDefault(); }
      if (k === 'q' || k === '[') setPage((p) => PAGES[(PAGES.indexOf(p) + 3) % 4]);
      if (k === 'e' || k === ']') setPage((p) => PAGES[(PAGES.indexOf(p) + 1) % 4]);
      if (k === 'Tab') { e.preventDefault(); setDeclutter((d) => (d + 1) % 3); }
      if (k === ' ') { e.preventDefault(); onSelect(); }
      if (k === 'm') setAuto((a) => !a);
      if (k === 'p') onPin(e.shiftKey ? 'science' : 'hazard');
      if (k === 'P') onPin('science');
      if (k === 'f') onFix();
      if (k === 'g') onReplan();
      if (k === 'r') onReturn();
      if (k === 'c') setMono((m) => !m);
      if (k === 'h' || k === '?') setHelp((h) => !h);
      if (k === 'n') setHeadingUp((h) => !h);
      if (k === 'Enter') setPaused((p) => !p);
      if (k === '1') setScale(1);
      if (k === '2') setScale(5);
      if (k === '3') setScale(20);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') keys.current.forward = false;
      if (e.key === 'ArrowLeft') keys.current.left = false;
      if (e.key === 'ArrowRight') keys.current.right = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  });

  const onSelect = () => {
    const cur = sRef.current;
    if (!ctx || !cur) return;
    if (paused) { setPaused(false); say('EVA started — PET running'); return; }
    if (cur.phase === 'task') { setS(completeTask(ctx, cur)); say('Task complete — next waypoint'); }
  };
  const onFix = () => {
    const cur = sRef.current;
    if (!ctx || !cur || !g) return;
    const lm = nearestLandmark(ctx, g.est, 12);
    const atStop = g.distTarget <= g.target.arrivalM + 2;
    if (lm || atStop) { setS(fix(cur)); say(`Position fix on ${lm ? `Perseverance sol ${lm.stop.sol} landmark` : g.target.name} — ±0.5 m`); }
    else say('No surveyed landmark within 12 m — fix unavailable');
  };
  const onPin = (kind: 'hazard' | 'science') => {
    if (!g || !s) return;
    const note = kind === 'hazard' ? `Hazard reported at PET ${fmtDur(s.pet)}` : `Science target at PET ${fmtDur(s.pet)}`;
    link.send({ type: 'pin', pin: { id: newId('p'), t: Date.now(), at: g.est, kind, note } });
    say(`${kind === 'hazard' ? 'Hazard' : 'Science'} pin dropped and sent to habitat`);
  };
  const onReplan = () => {
    const cur = sRef.current;
    if (!ctx || !cur || cur.mode !== 'mission') return;
    const path = replanLeg(ctx, cur);
    if (!path) { say('No permitted path from here — back-track to route'); return; }
    ctx.legs[cur.target] = path;
    setS({ ...cur });
    say('Leg re-planned from current position');
  };
  const onReturn = () => {
    if (Date.now() - returnArm < 3000) { triggerReturn('crew initiated'); setReturnArm(0); }
    else { setReturnArm(Date.now()); say('Press R again within 3 s to confirm EMERGENCY RETURN'); }
  };

  if (!mission || !ctx || !s || !g) {
    return (
      <div className="hud boot">
        <div className="bootbox">
          <div className="t">EVA HUD · STANDBY</div>
          <p>No mission package loaded. Plan and deploy one from Mission Control, or load the local demo route.</p>
          <button onClick={() => { const m = demoMission(area); link.send({ type: 'deploy', mission: m }); setMission(m); }}>Load demo mission</button>
        </div>
      </div>
    );
  }

  const fg = '#5dff9e';
  const warn = mono ? '#5dff9e' : '#ffb84d';
  const dim = 'rgba(93,255,158,0.45)';
  const rel = wrap180(g.steer - s.heading);
  const relTarget = wrap180(g.bearingTarget - s.heading);
  const mt = marsTime(now, (area.meta.bounds.west + area.meta.bounds.east) / 2, (area.meta.bounds.south + area.meta.bounds.north) / 2);
  const lm = nearestLandmark(ctx, g.est);
  const backdrop = [...area.rover.stops].filter((r) => r.pov).sort((x, y) => distM(area, x, g.est) - distM(area, y, g.est))[0];
  const legProgress = g.legLen ? Math.max(0, Math.min(1, 1 - g.distAlong / g.legLen)) : 1;
  const stopNo = s.mode === 'return' ? 'H' : g.target.kind === 'base' ? 'H' : String(s.target + 1);
  const hereI = idx(area, Math.min(area.n - 1, Math.max(0, g.est.x)), Math.min(area.n - 1, Math.max(0, g.est.y)));
  const recentNotes = notes.filter((n) => now - n.t < 30000);

  return (
    <div className={'hud' + (mono ? ' mono' : '') + ` dc${declutter}`}>
      {backdrop?.pov && <div className="world" style={{ backgroundImage: `url(${area.base + backdrop.pov.file})` }} />}
      <div className="worldtag">Backdrop: Perseverance {backdrop?.pov?.camera.replace('_', ' ')} · sol {backdrop?.sol} (nearest real view)</div>

      <HeadingTape heading={s.heading} steer={g.steer} target={g.bearingTarget} />

      <div className="tl panel">
        <div className="lbl">{s.mode === 'return' ? 'EMERGENCY RETURN' : s.phase === 'task' ? 'AT WAYPOINT' : 'NEXT'}</div>
        <div className="wp"><span className="num">{stopNo}</span>{g.target.name.split(' (')[0].toUpperCase()}</div>
        {s.phase === 'task' ? (
          <div className="task">
            <div className="big">{g.target.task.toUpperCase()}</div>
            <div>Dwell {fmtDur(s.taskLeft)} · ±{g.target.arrivalM} m</div>
            <div className="hint">SPACE = task complete</div>
          </div>
        ) : (
          <>
            <div className="big">{g.distAlong < 1000 ? `${g.distAlong.toFixed(0)} m` : `${(g.distAlong / 1000).toFixed(2)} km`}</div>
            <div className="bar"><div style={{ width: `${legProgress * 100}%` }} /></div>
            <div className="sub">ETA {fmtDur(g.etaS)} · direct {g.distTarget.toFixed(0)} m · EVA left {(g.distTotal / 1000).toFixed(2)} km</div>
            {declutter < 2 && g.target.kind !== 'base' && <div className="sub">Task {g.target.task} ±{g.target.arrivalM} m· {g.target.dwellMin} min</div>}
          </>
        )}
      </div>

      {s.phase === 'enroute' && page === 'nav' && (
        <div className="center">
          <svg viewBox="-60 -60 120 120" className="arrow" style={{ transform: `rotate(${rel}deg)` }}>
            <path d="M0,-50 L26,10 L8,2 L8,40 L-8,40 L-8,2 L-26,10 Z" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
          </svg>
          <div className="steer">{Math.abs(rel) < 12 ? 'ON COURSE' : `${rel < 0 ? '◀ LEFT' : 'RIGHT ▶'} ${Math.abs(rel).toFixed(0)}°`}</div>
          {declutter === 0 && Math.abs(wrap180(relTarget - rel)) > 15 && (
            <div className="sub">Path bends around terrain; waypoint direct at {clock(relTarget)} o'clock</div>
          )}
        </div>
      )}
      {s.phase === 'done' && <div className="center done">EVA COMPLETE<div className="sub">PET {fmtDur(s.pet)} · stops {s.completed.length}/{ctx.targets.length - 1}</div></div>}

      <div className="tr">
        {al.map((a) => <div key={a.id} className={'alert ' + a.sev}>{a.sev === 'warning' ? '▲ ' : a.sev === 'caution' ? '△ ' : ''}{a.text}</div>)}
        {recentNotes.map((n) => <div key={n.t} className="alert info">HAB: {n.text}</div>)}
        {toast && now - toast.t < 4000 && <div className="alert info">{toast.text}</div>}
        {declutter === 0 && lm && <div className="alert info dimmed">Landmark: Perseverance sol {lm.stop.sol} stop · {lm.d.toFixed(0)} m at {clock(distBearing(area, g.est, lm.stop) - s.heading)} o'clock</div>}
      </div>

      {declutter < 2 && (
        <div className="bl panel sys">
          <Gauge label="O₂ (sim)" v={s.o2} warn={30} />
          <Gauge label="BATT (sim)" v={s.battery} warn={25} />
          <div className="kv"><span>EVA TIME LEFT</span><b>{fmtDur(mission.params.budgetMin * 60 - s.pet)}</b></div>
          <div className={'kv' + (g.marginS < 300 ? ' hot' : '')}><span>RETURN MARGIN</span><b>{fmtDur(g.marginS)}</b></div>
          <div className="kv"><span>WALK-BACK</span><b>{fmtDur(g.timeToBaseS)}</b></div>
          <div className="kv"><span>POS ±1σ</span><b>{s.sigma.toFixed(1)} m</b></div>
          {declutter === 0 && <>
            <div className="kv"><span>PET</span><b>{fmtDur(s.pet)}{paused ? ' ⏸' : ''}</b></div>
            <div className="kv"><span>LMST · SUN</span><b>{fmtHours(mt.lmst)} · {mt.sunElev.toFixed(0)}°</b></div>
            <div className="kv"><span>HDG · SLOPE</span><b>{s.heading.toFixed(0)}° · {area.slope[hereI].toFixed(0)}°</b></div>
          </>}
        </div>
      )}

      <div className="br">
        {page !== 'map' && <MiniMap ctx={ctx} s={s} g={g} size={230} headingUp={headingUp} fg={fg} warn={warn} dim={dim} />}
      </div>

      {page === 'map' && (
        <div className="page mappage">
          <MiniMap ctx={ctx} s={s} g={g} size={Math.min(window.innerHeight - 220, 560)} headingUp={headingUp} fg={fg} warn={warn} dim={dim} terrain rangeM={200} />
          <div className="sub">MAP · 200 m · {headingUp ? 'heading-up' : 'north-up'} (N toggles) · ◇ Perseverance landmarks · dashed planned · solid walked</div>
        </div>
      )}
      {page === 'science' && (
        <div className="page sci">
          <div className="lbl">SCIENCE · {g.target.name.toUpperCase()}</div>
          <div>Task: {g.target.task} ±{g.target.arrivalM} m · dwell {g.target.dwellMin} min</div>
          {g.target.note && <div className="sub">{g.target.note}</div>}
          {(() => {
            const r = nearestLandmark(ctx, g.target, 15);
            return r?.stop.pov ? (<><img src={area.base + r.stop.pov.file} alt="Expected view at the waypoint" /><div className="sub">Expected view: Perseverance {r.stop.pov.camera} at sol {r.stop.sol}</div></>) : <div className="sub">No prior surface image within 15 m</div>;
          })()}
          <div className="sub">Objectives {s.completed.length}/{ctx.targets.length - 1} complete · P drop hazard pin · ⇧P science pin</div>
        </div>
      )}
      {page === 'systems' && (
        <div className="page sys2">
          <div className="lbl">SYSTEMS & ENVIRONMENT</div>
          <div className="kv"><span>Habitat link</span><b>LOCAL · LIVE</b></div>
          <div className="kv"><span>Earth relay</span><b>+{lightTimeMin(now).toFixed(1)} min one-way</b></div>
          <div className="kv"><span>Dose this EVA (RAD Gale ref.)</span><b>{(s.doseMsv * 1000).toFixed(1)} µSv</b></div>
          <div className="kv"><span>Ls · LTST</span><b>{mt.ls.toFixed(0)}° · {fmtHours(mt.ltst)}</b></div>
          <div className="kv"><span>Nav source</span><b>VO dead-reckoning + landmark fixes</b></div>
          <div className="kv"><span>Route</span><b>{mission.route.label} · v{mission.version}</b></div>
          <div className="sub">O₂/battery are simulated. Drift {`2%`} of distance since last fix (assumption). Dose uses the Gale RAD average, not a Jezero measurement.</div>
        </div>
      )}

      <div className="bc">
        <div className="dots">
          <span className="dot done">H</span>
          {ctx.targets.map((t, i) => (
            <span key={t.id} className={'dot' + (s.completed.includes(t.id) ? ' done' : '') + (t.id === g.target.id ? ' next' : '')}>{t.kind === 'base' ? 'H' : i + 1}</span>
          ))}
        </div>
        <div className="pages">{PAGES.map((p) => <span key={p} className={p === page ? 'on' : ''}>{p.toUpperCase()}</span>)}</div>
      </div>

      {paused && s.phase !== 'done' && <div className="start">Press SPACE to start EVA · H for controls</div>}
      <div className="footer">
        {auto ? 'AUTO-WALK' : 'MANUAL ↑←→'} · {scale}× · {mono ? 'MONO' : 'ALERT COLOUR'} · H help
      </div>
      {help && (
        <div className="help">
          <b>Controls</b> (forearm controller = dial + 2 buttons)
          <div>Q / E — dial: NAV · MAP · SCIENCE · SYSTEMS</div>
          <div>SPACE — select: start EVA / task complete</div>
          <div>TAB — declutter (full · nav · minimal)</div>
          <div>F — position fix at landmark or waypoint</div>
          <div>G — re-plan leg from here · R R — emergency return</div>
          <div>P — hazard pin · ⇧P — science pin</div>
          <div>N — heading-up / north-up · C — mono / alert colour</div>
          <div>Sim: M auto-walk · arrows manual · 1/2/3 time 1×/5×/20× · Enter pause</div>
        </div>
      )}
    </div>
  );
}

function distBearing(a: Area, p: { x: number; y: number }, q: { x: number; y: number }) {
  return (Math.atan2((q.x - p.x) * a.dxM, -(q.y - p.y) * a.dyM) * 180) / Math.PI;
}

function Gauge({ label, v, warn }: { label: string; v: number; warn: number }) {
  return (
    <div className={'kv gauge' + (v < warn ? ' hot' : '')}>
      <span>{label}</span>
      <div className="g"><div style={{ width: `${v}%` }} /></div>
      <b>{v.toFixed(0)}%</b>
    </div>
  );
}

function HeadingTape({ heading, steer, target }: { heading: number; steer: number; target: number }) {
  const W = 520, span = 120, px = W / span;
  const ticks = [];
  for (let d = Math.floor((heading - span / 2) / 5) * 5; d <= heading + span / 2; d += 5) {
    const x = W / 2 + wrap180(d - heading) * px;
    const dd = ((d % 360) + 360) % 360;
    const lab = dd % 90 === 0 ? 'NESW'[dd / 90] : dd % 15 === 0 ? String(dd) : '';
    ticks.push(
      <g key={d}>
        <line x1={x} x2={x} y1={dd % 15 === 0 ? 18 : 24} y2={30} stroke="currentColor" strokeWidth={dd % 90 === 0 ? 2 : 1} />
        {lab && <text x={x} y={13} textAnchor="middle" className={dd % 90 === 0 ? 'card' : ''}>{lab}</text>}
      </g>,
    );
  }
  const caret = (b: number, filled: boolean) => {
    const r = wrap180(b - heading);
    const x = W / 2 + Math.max(-span / 2, Math.min(span / 2, r)) * px;
    return <path d={`M${x - 7},44 L${x},34 L${x + 7},44 Z`} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.5} />;
  };
  return (
    <div className="tape">
      <svg viewBox={`0 0 ${W} 48`} width={W} height={48}>
        {ticks}
        {caret(target, false)}
        {caret(steer, true)}
        <path d={`M${W / 2},31 L${W / 2 - 6},22 M${W / 2},31 L${W / 2 + 6},22`} stroke="currentColor" strokeWidth={2} />
      </svg>
      <div className="hdg">{String(Math.round(heading) % 360).padStart(3, '0')}°</div>
    </div>
  );
}
