import { useEffect, useMemo, useRef, useState } from 'react';
import { MapView, polyline, type DrawCtx, type RasterLayer } from '../shared/MapView';
import { LineChart } from '../shared/LineChart';
import { cellPt, distM, fmtDur, fmtLonLat, idx, type Area, type RoverStop } from '../shared/data';
import { LAYERS, renderRaster, type LayerId } from '../shared/layers';
import { hazardMask, optimizeOrder, plan, PRESETS, scienceField, timeTo } from '../shared/router';
import { link } from '../shared/link';
import { fmtHours, lightTimeMin, marsTime } from '../shared/mars';
import type { CrewPin, Mission, NoGo, Params, Pt, Route, Stop, Telemetry, Weights } from '../shared/types';
import { DEFAULT_PARAMS, DEFAULT_WEIGHTS, initialStops, newId, TASK_RADIUS } from '../shared/demo';

type Tool = 'select' | 'stop' | 'base' | 'nogo';
type Tab = 'plan' | 'routes' | 'monitor' | 'data';

const ROUTE_COLORS: Record<string, string> = { shortest: '#ffd166', safest: '#3ccf7a', science: '#c792ea', custom: '#4cc3ff' };

export function App({ area }: { area: Area }) {
  const [stops, setStops] = useState<Stop[]>(() => initialStops(area));
  const [nogo, setNogo] = useState<NoGo[]>([]);
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [layers, setLayers] = useState<Record<LayerId, { on: boolean; op: number }>>({
    optical: { on: true, op: 1 }, hillshade: { on: false, op: 0.5 }, elevation: { on: false, op: 0.45 },
    slope: { on: false, op: 0.55 }, rough: { on: false, op: 0.55 }, excluded: { on: true, op: 0.7 },
    thermal: { on: false, op: 0.5 }, crism: { on: false, op: 1 }, science: { on: false, op: 0.6 }, rover: { on: true, op: 1 },
  });
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selRoute, setSelRoute] = useState<string>('custom');
  const [tool, setTool] = useState<Tool>('select');
  const [tab, setTab] = useState<Tab>('plan');
  const [draft, setDraft] = useState<Pt[]>([]);
  const [selStop, setSelStop] = useState<string | null>(null);
  const [rover, setRover] = useState<(RoverStop & Pt) | null>(null);
  const [busy, setBusy] = useState(false);
  const [deployed, setDeployed] = useState<Mission | null>(() => link.mission());
  const [ack, setAck] = useState<{ version: number; t: number } | null>(null);
  const [tel, setTel] = useState<Telemetry | null>(() => link.telemetry());
  const [trail, setTrail] = useState<Pt[]>([]);
  const [pins, setPins] = useState<CrewPin[]>(() => link.pins());
  const [log, setLog] = useState<{ t: number; text: string; level: string }[]>([]);
  const [hoverK, setHoverK] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [stale, setStale] = useState(false);
  const dragId = useRef<string | null>(null);

  const addLog = (text: string, level = 'info') => setLog((l) => [{ t: Date.now(), text, level }, ...l].slice(0, 80));

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  // Inputs changed since the last calculation -> routes are stale.
  useEffect(() => { if (routes.length) setStale(true); }, [stops, nogo, params, weights]); // eslint-disable-line

  useEffect(() => link.on((m) => {
    if (m.type === 'ack') { setAck({ version: m.version, t: m.t }); addLog(`HUD acknowledged mission v${m.version}`, 'good'); }
    if (m.type === 'telemetry') {
      setTel(m.tel);
      setTrail((tr) => (tr.length && distM(area, tr[tr.length - 1], m.tel.est) < 1 ? tr : [...tr, m.tel.est].slice(-3000)));
    }
    if (m.type === 'alert') addLog(`HUD: ${m.text}`, m.sev);
    if (m.type === 'pin') { setPins((p) => [...p, m.pin]); addLog(`Crew dropped ${m.pin.kind} pin: ${m.pin.note}`, 'warn'); }
  }), [area]);

  const mask = useMemo(() => hazardMask(area, params, nogo), [area, params, nogo]);
  const sciencePts = useMemo(() => [...stops.filter((s) => s.kind === 'science'), ...pins.filter((p) => p.kind === 'science').map((p) => p.at)], [stops, pins]);
  const sciField = useMemo(() => (layers.science.on ? scienceField(area, sciencePts) : undefined), [area, sciencePts, layers.science.on]);

  const rasterCache = useRef(new Map<string, CanvasImageSource>());
  const raster = (id: LayerId, key: string) => {
    const k = id + key;
    if (!rasterCache.current.has(k)) {
      const r = renderRaster(area, id, { maxSlope: params.maxSlope, maxRough: params.maxRough, blocked: mask.blocked, science: sciField });
      if (r) rasterCache.current.set(k, r);
    }
    return rasterCache.current.get(k);
  };
  const rasters: RasterLayer[] = [];
  for (const L of LAYERS) {
    const st = layers[L.id];
    if (!st.on || L.id === 'crism' || L.id === 'rover') continue;
    const key = L.id === 'slope' ? String(params.maxSlope) : L.id === 'rough' ? String(params.maxRough)
      : L.id === 'excluded' ? JSON.stringify([params.maxSlope, params.maxRough, params.bufferM, nogo.map((z) => z.id)])
      : L.id === 'science' ? JSON.stringify(sciencePts.map((p) => [p.x | 0, p.y | 0])) : '';
    const src = raster(L.id, key);
    if (src) rasters.push({ key: L.id, src, opacity: st.op, smooth: L.id === 'thermal' || L.id === 'optical' || L.id === 'hillshade' });
  }

  const calculate = () => {
    setBusy(true);
    setTimeout(() => {
      const base = stops[0];
      const ttb = timeTo(area, mask.blocked, idx(area, base.x, base.y), params.speed);
      const order = stops.slice(1).map((_, k) => k + 1);
      const all = [...PRESETS, { id: 'custom', label: 'Custom', weights }].map((pr) =>
        plan({ area, stops, order, params, weights: pr.weights, nogo, sciencePts, ttb, id: pr.id, label: pr.label }));
      setRoutes(all);
      setStale(false);
      setBusy(false);
      setTab('routes');
      const ok = all.filter((r) => !r.error).length;
      addLog(`Computed ${ok}/${all.length} candidate routes`, ok ? 'info' : 'warn');
    }, 30);
  };

  const optimize = () => {
    setBusy(true);
    setTimeout(() => {
      const order = optimizeOrder(area, stops, mask.blocked, params.speed);
      setStops([stops[0], ...order.map((i) => stops[i])]);
      setBusy(false);
      addLog('Stop order optimized for minimum walking time');
    }, 30);
  };

  const route = routes.find((r) => r.id === selRoute);

  const deploy = () => {
    if (!route || route.error) return;
    const m: Mission = {
      id: deployed?.id ?? newId('m'), version: (deployed?.version ?? 0) + 1,
      name: 'EVA-1 Jezero crater floor', deployedAt: new Date().toISOString(),
      stops, route, nogo, params, weights: route.weights,
    };
    link.send({ type: 'deploy', mission: m });
    setDeployed(m);
    setAck(null);
    setTrail([]);
    addLog(`Deployed mission v${m.version} (${route.label}) to suit HUD`, 'good');
    setTab('monitor');
  };

  // --- map interaction
  const nearestStop = (p: Pt, maxM = 8) => {
    let best: Stop | null = null, bd = maxM;
    for (const s of stops) { const d = distM(area, s, p); if (d < bd) { bd = d; best = s; } }
    return best;
  };
  const onClick = (p: Pt) => {
    if (tool === 'stop') {
      const s: Stop = { id: newId('s'), name: `Science stop ${stops.length}`, kind: 'science', x: p.x, y: p.y, task: 'observe', dwellMin: 5, arrivalM: 5 };
      setStops([...stops, s]); setSelStop(s.id);
    } else if (tool === 'base') {
      setStops([{ ...stops[0], x: p.x, y: p.y }, ...stops.slice(1)]); setTool('select');
    } else if (tool === 'nogo') {
      setDraft([...draft, p]);
    } else {
      const s = nearestStop(p);
      setSelStop(s?.id ?? null);
      if (!s && layers.rover.on) {
        let best: (RoverStop & Pt) | null = null, bd = 10;
        for (const r of area.rover.stops) { const d = distM(area, r, p); if (d < bd) { bd = d; best = r; } }
        setRover(best);
      }
    }
  };
  const closeDraft = () => {
    if (draft.length >= 3) {
      setNogo([...nogo, { id: newId('z'), pts: draft, reason: 'Admin no-go zone', source: 'admin' }]);
      addLog(`No-go zone added (${draft.length} vertices)`);
    }
    setDraft([]);
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'Enter' && tool === 'nogo') closeDraft();
      if (e.key === 'Escape') { setDraft([]); setTool('select'); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const draw = (d: DrawCtx) => {
    const { g, toS, scale } = d;
    const mPx = scale / area.dyM;
    if (layers.crism.on) {
      g.save(); g.strokeStyle = 'rgba(199,146,234,.9)'; g.lineWidth = 1.5; g.setLineDash([6, 4]);
      area.crism.forEach((c) => c.pts.forEach((ring) => { g.beginPath(); ring.forEach((q, k) => { const [x, y] = toS(q); if (k) g.lineTo(x, y); else g.moveTo(x, y); }); g.closePath(); g.stroke(); }));
      g.restore();
    }
    if (layers.rover.on) {
      area.rover.traverse.forEach((t) => polyline(d, t.pts, 'rgba(255,255,255,.55)', 1.5, [3, 3]));
      area.rover.stops.forEach((s) => {
        const [x, y] = toS(s); g.fillStyle = s.pov ? '#fff' : '#999'; g.beginPath(); g.arc(x, y, 2.5, 0, 7); g.fill();
      });
    }
    for (const z of nogo) {
      g.save(); g.beginPath(); z.pts.forEach((q, k) => { const [x, y] = toS(q); if (k) g.lineTo(x, y); else g.moveTo(x, y); }); g.closePath();
      g.fillStyle = z.source === 'crew' ? 'rgba(245,184,61,.25)' : 'rgba(255,77,77,.22)'; g.fill();
      g.strokeStyle = z.source === 'crew' ? '#f5b83d' : '#ff4d4d'; g.lineWidth = 2; g.stroke(); g.restore();
    }
    if (draft.length) {
      polyline(d, draft, '#ff4d4d', 2, [5, 4]);
      draft.forEach((q) => { const [x, y] = toS(q); g.fillStyle = '#ff4d4d'; g.fillRect(x - 3, y - 3, 6, 6); });
    }
    for (const r of routes) {
      if (r.error || r.id === selRoute) continue;
      polyline(d, r.cells.map((c) => cellPt(area, c)), ROUTE_COLORS[r.id] + '99', 2);
    }
    if (route && !route.error) {
      const pts = route.cells.map((c) => cellPt(area, c));
      polyline(d, pts, 'rgba(0,0,0,.6)', 6);
      polyline(d, pts, ROUTE_COLORS[route.id], 3);
      if (hoverK !== null && pts[hoverK]) { const [x, y] = toS(pts[hoverK]); g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); }
    }
    if (deployed && trail.length) polyline(d, trail, '#3ccf7a', 2.5);
    stops.forEach((s, k) => {
      const [x, y] = toS(s);
      g.save();
      g.strokeStyle = 'rgba(255,255,255,.6)'; g.setLineDash([2, 3]); g.beginPath(); g.arc(x, y, Math.max(3, s.arrivalM * mPx), 0, 7); g.stroke();
      g.setLineDash([]);
      g.fillStyle = s.id === selStop ? '#ff8a3d' : s.kind === 'base' ? '#4cc3ff' : '#fff';
      g.strokeStyle = '#000'; g.lineWidth = 2;
      if (s.kind === 'base') { g.fillRect(x - 8, y - 8, 16, 16); g.strokeRect(x - 8, y - 8, 16, 16); }
      else { g.beginPath(); g.arc(x, y, 9, 0, 7); g.fill(); g.stroke(); }
      g.fillStyle = '#000'; g.font = 'bold 11px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(s.kind === 'base' ? 'H' : String(k), x, y + 0.5);
      g.restore();
    });
    pins.forEach((p) => {
      const [x, y] = toS(p.at);
      g.fillStyle = p.kind === 'hazard' ? '#f5b83d' : '#3ccf7a'; g.strokeStyle = '#000'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x, y - 11); g.lineTo(x + 8, y + 4); g.lineTo(x - 8, y + 4); g.closePath(); g.fill(); g.stroke();
    });
    if (tel && deployed) {
      const [x, y] = toS(tel.est);
      g.save();
      g.fillStyle = 'rgba(60,207,122,.15)'; g.strokeStyle = 'rgba(60,207,122,.7)';
      g.beginPath(); g.arc(x, y, Math.max(4, tel.sigmaM * 2 * mPx), 0, 7); g.fill(); g.stroke();
      g.translate(x, y); g.rotate((tel.heading * Math.PI) / 180);
      g.fillStyle = tel.status === 'nominal' ? '#3ccf7a' : tel.status === 'caution' ? '#f5b83d' : '#ff4d4d';
      g.strokeStyle = '#000'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, -11); g.lineTo(7, 8); g.lineTo(0, 4); g.lineTo(-7, 8); g.closePath(); g.fill(); g.stroke();
      g.restore();
    }
  };

  const sel = stops.find((s) => s.id === selStop);
  const updStop = (id: string, patch: Partial<Stop>) => setStops(stops.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const mt = marsTime(now, (area.meta.bounds.west + area.meta.bounds.east) / 2, (area.meta.bounds.south + area.meta.bounds.north) / 2);
  const lt = lightTimeMin(now);
  const telAge = tel ? (now - tel.t) / 1000 : Infinity;

  return (
    <div className="admin">
      <header>
        <div className="brand"><b>MARS EVA</b> · Habitat Mission Control</div>
        <div className="site">{area.meta.site}</div>
        <div className="clocks">
          <span title="Mars sol date and local mean solar time at the site (Mars24 algorithm)">Sol {mt.sol} · LMST {fmtHours(mt.lmst)}</span>
          <span title="Sun elevation above a flat horizon">Sun {mt.sunElev.toFixed(0)}°</span>
          <span title="One-way light time to Earth (approximate ephemeris). Earth cannot supervise in real time.">Earth delay {lt.toFixed(1)} min one-way</span>
          <span className={telAge < 5 ? 'ok' : 'dim'}>Suit link {telAge < 5 ? 'LIVE' : deployed ? 'no telemetry' : 'idle'}</span>
        </div>
      </header>
      <div className="body">
        <div className="mapwrap">
          <MapView area={area} rasters={rasters} draw={draw} showReadout onClick={onClick} onDblClick={() => tool === 'nogo' && closeDraft()}
            cursor={tool === 'select' ? 'grab' : 'crosshair'}
            onDragStart={(p) => { if (tool !== 'select') return false; const s = nearestStop(p); dragId.current = s?.id ?? null; return !!s; }}
            onDrag={(p, done) => { if (dragId.current) updStop(dragId.current, { x: p.x, y: p.y }); if (done) dragId.current = null; }} />
          <div className="toolbar">
            {([['select', 'Select / move'], ['base', 'Set habitat (A)'], ['stop', 'Add science stop'], ['nogo', 'Draw no-go zone']] as [Tool, string][]).map(([t, l]) => (
              <button key={t} className={tool === t ? 'on' : ''} onClick={() => { setTool(t); setDraft([]); }}>{l}</button>
            ))}
            {tool === 'nogo' && <span className="hint">click vertices · double-click / Enter to close · Esc cancel</span>}
          </div>
          <LayerPanel layers={layers} setLayers={setLayers} />
          {rover && (
            <div className="pov">
              <button className="x" onClick={() => setRover(null)}>×</button>
              <div className="h">Perseverance sol {rover.sol} · {rover.rmc}</div>
              {rover.pov ? <img src={area.base + rover.pov.file} alt={`Perseverance ${rover.pov.camera} sol ${rover.sol}`} /> : <div className="dim">No POV image</div>}
              <div className="dim">{rover.pov?.camera} · {rover.note} · {fmtLonLat(area, rover)}</div>
              <button onClick={() => { const s: Stop = { id: newId('s'), name: `Sol ${rover.sol} site`, kind: 'science', x: rover.x, y: rover.y, task: 'photo', dwellMin: 5, arrivalM: 5, note: 'Rover-documented site' }; setStops([...stops, s]); setRover(null); }}>Add as science stop</button>
            </div>
          )}
        </div>
        <aside>
          <nav>
            {(['plan', 'routes', 'monitor', 'data'] as Tab[]).map((t) => (
              <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                {t === 'plan' ? '1 Plan' : t === 'routes' ? '2 Compare' : t === 'monitor' ? '3 Monitor' : 'Data'}
              </button>
            ))}
          </nav>
          <div className="scroll">
            {tab === 'plan' && (
              <>
                <section>
                  <h3>Stops <span className="dim">(visit order, closed loop back to habitat)</span></h3>
                  <ol className="stops">
                    {stops.map((s, k) => (
                      <li key={s.id} className={s.id === selStop ? 'sel' : ''} onClick={() => setSelStop(s.id)}>
                        <span className={'badge ' + s.kind}>{s.kind === 'base' ? 'H' : k}</span>
                        <span className="nm">{s.name}</span>
                        <span className="dim">{s.kind === 'base' ? '' : `${s.task} · ${s.dwellMin}m`}</span>
                        {mask.blocked[idx(area, s.x, s.y)] ? <span className="bad" title="On excluded terrain">!</span> : null}
                      </li>
                    ))}
                  </ol>
                  {sel && (
                    <div className="editor">
                      <label>Name<input value={sel.name} onChange={(e) => updStop(sel.id, { name: e.target.value })} /></label>
                      {sel.kind !== 'base' && (
                        <>
                          <div className="row">
                            <label>Task<select value={sel.task} onChange={(e) => { const task = e.target.value as Stop['task']; updStop(sel.id, { task, arrivalM: TASK_RADIUS[task] }); }}>
                              <option value="observe">Observe</option><option value="photo">Photo doc</option><option value="sample">Sample (3 m)</option><option value="instrument">Instrument (0.5 m)</option>
                            </select></label>
                            <label>Dwell min<input type="number" min={0} value={sel.dwellMin} onChange={(e) => updStop(sel.id, { dwellMin: +e.target.value })} /></label>
                            <label>Arrive ±m<input type="number" min={0.5} step={0.5} value={sel.arrivalM} onChange={(e) => updStop(sel.id, { arrivalM: +e.target.value })} /></label>
                          </div>
                          <div className="row">
                            <button onClick={() => { const k = stops.indexOf(sel); if (k > 1) { const s = [...stops]; [s[k - 1], s[k]] = [s[k], s[k - 1]]; setStops(s); } }}>↑</button>
                            <button onClick={() => { const k = stops.indexOf(sel); if (k < stops.length - 1) { const s = [...stops]; [s[k + 1], s[k]] = [s[k], s[k + 1]]; setStops(s); } }}>↓</button>
                            <button className="danger" onClick={() => { setStops(stops.filter((s) => s.id !== sel.id)); setSelStop(null); }}>Remove</button>
                          </div>
                        </>
                      )}
                      <div className="dim">{fmtLonLat(area, sel)} · slope {area.slope[idx(area, sel.x, sel.y)].toFixed(1)}°</div>
                    </div>
                  )}
                  <div className="row"><button onClick={optimize} disabled={busy || stops.length < 3}>Optimize order</button></div>
                </section>
                {nogo.length > 0 && (
                  <section>
                    <h3>No-go zones</h3>
                    {nogo.map((z) => (
                      <div key={z.id} className="row between"><span>{z.reason} <span className="dim">({z.source})</span></span><button className="danger" onClick={() => setNogo(nogo.filter((q) => q.id !== z.id))}>Remove</button></div>
                    ))}
                  </section>
                )}
                <section>
                  <h3>Priorities <span className="dim">(custom route weights)</span></h3>
                  {([['distance', 'Distance / time'], ['slope', 'Slope effort'], ['rough', 'Terrain safety (roughness)'], ['thermal', 'Firm ground (thermal inertia)'], ['science', 'Scientific value']] as [keyof Weights, string][]).map(([k, l]) => (
                    <label key={k} className="slider"><span>{l}</span>
                      <input type="range" min={0} max={1} step={0.05} value={weights[k]} onChange={(e) => setWeights({ ...weights, [k]: +e.target.value })} />
                      <b>{weights[k].toFixed(2)}</b></label>
                  ))}
                </section>
                <section>
                  <h3>Hard limits & budget <span className="dim">(assumptions, E)</span></h3>
                  <div className="grid2">
                    {([['maxSlope', 'Max slope °', 1], ['maxRough', 'Max roughness cm', 1], ['bufferM', 'No-go buffer m', 1], ['speed', 'Flat speed m/s', 0.05], ['budgetMin', 'EVA budget min', 5], ['reserveMin', 'Return reserve min', 5]] as [keyof Params, string, number][]).map(([k, l, st]) => (
                      <label key={k}>{l}<input type="number" step={st} value={params[k]} onChange={(e) => setParams({ ...params, [k]: +e.target.value })} /></label>
                    ))}
                  </div>
                  <p className="dim small">Slope/speed values are demonstration assumptions from the research prototype, not suit-certified limits. Excluded cells fail closed.</p>
                </section>
                <button className="primary wide" onClick={calculate} disabled={busy}>{busy ? 'Computing…' : 'Calculate & compare routes'}</button>
              </>
            )}

            {tab === 'routes' && (
              <>
                {stale && <div className="banner warn">Inputs changed — recalculate before deploying. <button onClick={calculate}>Recalculate</button></div>}
                {!routes.length && <p className="dim">No routes yet. Plan stops and press Calculate.</p>}
                {routes.length > 0 && (
                  <table className="cmp">
                    <thead><tr><th>Route</th><th>Dist</th><th>Total</th><th>Max°</th><th>Hazard</th><th>Sci</th><th>Margin</th></tr></thead>
                    <tbody>
                      {routes.map((r) => (
                        <tr key={r.id} className={r.id === selRoute ? 'sel' : ''} onClick={() => setSelRoute(r.id)}>
                          <td><i style={{ background: ROUTE_COLORS[r.id] }} />{r.label}</td>
                          {r.error ? <td colSpan={6} className="bad">{r.error}</td> : (
                            <>
                              <td>{(r.metrics.lengthM / 1000).toFixed(2)} km</td>
                              <td>{fmtDur(r.metrics.totalS)}</td>
                              <td>{r.metrics.maxSlope.toFixed(1)}</td>
                              <td>{r.metrics.hazardPct.toFixed(0)}%</td>
                              <td>{r.metrics.scienceScore.toFixed(0)}</td>
                              <td className={r.metrics.feasible ? 'good' : 'bad'}>{r.metrics.feasible ? '✓ ' : '✗ '}{fmtDur(r.metrics.minMarginS)}</td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {route && !route.error && (
                  <>
                    <p className="dim small">{PRESETS.find((p) => p.id === route.id)?.blurb ?? 'Your priority weights'}. Gain {route.metrics.gainM.toFixed(1)} m / loss {route.metrics.lossM.toFixed(1)} m. Margin = budget − (elapsed + walk-back time + reserve), minimum along the route.</p>
                    <LineChart title="Elevation profile (m)" xs={route.elapsedS.map((_, k) => k)} ys={route.cells.map((c) => area.elev[c])}
                      xFmt={(k) => fmtDur(route.elapsedS[Math.round(k)] ?? 0)} yFmt={(y) => y.toFixed(1)} onHover={setHoverK}
                      marks={route.legEnds.slice(0, -1).map((k, i) => ({ x: k, label: String(i + 1) }))} />
                    <LineChart title="Return margin — time to spare if turning back now" color="#3ccf7a"
                      xs={route.elapsedS.map((_, k) => k)} xFmt={(k) => fmtDur(route.elapsedS[Math.round(k)] ?? 0)} onHover={setHoverK}
                      ys={route.returnS.map((r, k) => params.budgetMin * 60 - params.reserveMin * 60 - route.elapsedS[k] - r)}
                      yFmt={(y) => fmtDur(y)} ref0={{ y: 0, label: 'turn-back limit' }}
                      marks={route.legEnds.slice(0, -1).map((k, i) => ({ x: k, label: String(i + 1) }))} />
                    <button className="primary wide" onClick={deploy} disabled={!route.metrics.feasible || stale}>
                      {route.metrics.feasible ? `Deploy "${route.label}" to astronaut HUD` : 'Route violates return reserve'}
                    </button>
                  </>
                )}
              </>
            )}

            {tab === 'monitor' && (
              <Monitor area={area} deployed={deployed} ack={ack} tel={tel} telAge={telAge} log={log} pins={pins}
                onNote={(text) => { link.send({ type: 'note', text, t: Date.now() }); addLog(`Note sent to crew: ${text}`); }}
                onAbort={() => { link.send({ type: 'abort', reason: 'Habitat-directed return', t: Date.now() }); addLog('ABORT: crew directed to return to habitat', 'warning'); }}
                onPinToNogo={(p) => {
                  const r = 4 / area.dyM;
                  setNogo([...nogo, { id: newId('z'), source: 'crew', reason: `Crew hazard: ${p.note}`, pts: [0, 1, 2, 3, 4, 5].map((k) => ({ x: p.at.x + r * Math.cos(k * 1.047), y: p.at.y + r * Math.sin(k * 1.047) })) }]);
                  setPins(pins.filter((q) => q.id !== p.id));
                }} />
            )}

            {tab === 'data' && <DataTab area={area} lt={lt} mt={mt} />}
          </div>
        </aside>
      </div>
    </div>
  );
}

function LayerPanel({ layers, setLayers }: { layers: Record<LayerId, { on: boolean; op: number }>; setLayers: (l: Record<LayerId, { on: boolean; op: number }>) => void }) {
  const [open, setOpen] = useState(true);
  const groups = [...new Set(LAYERS.map((l) => l.group))];
  return (
    <div className={'layers' + (open ? '' : ' closed')}>
      <button className="lh" onClick={() => setOpen(!open)}>Layers {open ? '▾' : '▸'}</button>
      {open && groups.map((g) => (
        <div key={g} className="lg">
          <div className="lgt">{g}</div>
          {LAYERS.filter((l) => l.group === g).map((l) => (
            <div key={l.id} className="lr">
              <label title={l.mission}><input type="checkbox" checked={layers[l.id].on} onChange={(e) => setLayers({ ...layers, [l.id]: { ...layers[l.id], on: e.target.checked } })} />{l.label} <span className={'ev ' + l.evidence}>{l.evidence}</span></label>
              {layers[l.id].on && l.id !== 'crism' && l.id !== 'rover' && (
                <input type="range" min={0} max={1} step={0.05} value={layers[l.id].op} onChange={(e) => setLayers({ ...layers, [l.id]: { ...layers[l.id], op: +e.target.value } })} />
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Monitor(p: {
  area: Area; deployed: Mission | null; ack: { version: number; t: number } | null; tel: Telemetry | null; telAge: number;
  log: { t: number; text: string; level: string }[]; pins: CrewPin[];
  onNote: (t: string) => void; onAbort: () => void; onPinToNogo: (p: CrewPin) => void;
}) {
  const [note, setNote] = useState('');
  const { deployed: m, tel } = p;
  if (!m) return <p className="dim">No mission deployed yet.</p>;
  const next = tel ? m.stops[tel.legIndex] : null;
  return (
    <>
      <section>
        <h3>{m.name} <span className="dim">v{m.version} · {m.route.label}</span></h3>
        <div className={'banner ' + (p.ack?.version === m.version ? 'good' : 'warn')}>
          {p.ack?.version === m.version ? `HUD loaded v${m.version}` : 'Waiting for HUD acknowledgement — open the Astronaut HUD'}
        </div>
      </section>
      {tel && (
        <section>
          <div className="kpis">
            <div><span>Status</span><b className={tel.status}>{tel.status.toUpperCase()}</b></div>
            <div><span>PET</span><b>{fmtDur(tel.pet)}</b></div>
            <div><span>Next</span><b>{next?.name.split(' (')[0] ?? 'Habitat'}</b></div>
            <div><span>Return margin</span><b className={tel.marginS < 0 ? 'warning' : ''}>{fmtDur(tel.marginS)}</b></div>
            <div><span>Off-route</span><b className={tel.crossTrackM > 10 ? 'caution' : ''}>{tel.crossTrackM.toFixed(1)} m</b></div>
            <div><span>Position ±1σ</span><b>{tel.sigmaM.toFixed(1)} m</b></div>
            <div><span>O₂ (sim)</span><b>{tel.o2.toFixed(0)}%</b></div>
            <div><span>Battery (sim)</span><b>{tel.battery.toFixed(0)}%</b></div>
          </div>
          <div className="dim small">Stops done: {tel.completed.length}/{m.stops.length - 1} · telemetry {p.telAge < 5 ? 'live' : `${p.telAge.toFixed(0)} s old`}</div>
        </section>
      )}
      {p.pins.length > 0 && (
        <section>
          <h3>Crew pins</h3>
          {p.pins.map((q) => (
            <div key={q.id} className="row between"><span>{q.kind === 'hazard' ? '⚠' : '★'} {q.note}</span>
              {q.kind === 'hazard' && <button onClick={() => p.onPinToNogo(q)}>Make no-go</button>}</div>
          ))}
        </section>
      )}
      <section>
        <h3>Message crew</h3>
        <div className="row"><input value={note} placeholder="Short text to HUD" onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && note) { p.onNote(note); setNote(''); } }} />
          <button onClick={() => { if (note) { p.onNote(note); setNote(''); } }}>Send</button></div>
        <button className="danger wide" onClick={p.onAbort}>Direct return to habitat</button>
      </section>
      <section>
        <h3>Event log</h3>
        <ul className="log">{p.log.map((l, k) => <li key={k} className={l.level}><span>{new Date(l.t).toLocaleTimeString()}</span>{l.text}</li>)}</ul>
      </section>
    </>
  );
}

function DataTab({ area, lt, mt }: { area: Area; lt: number; mt: ReturnType<typeof marsTime> }) {
  const m = area.meta;
  return (
    <>
      <section>
        <h3>Data provenance</h3>
        <p className="dim small">Evidence classes: <b>M</b> measured by a NASA mission instrument · <b>D</b> derived from M · <b>E</b> engineering assumption. All layers are bundled locally for offline use (generated {m.generated_utc.slice(0, 10)}).</p>
        {m.sources.map((s) => (
          <div key={s.layer} className="src">
            <div><span className={'ev ' + s.evidence}>{s.evidence}</span> <b>{s.layer}</b> — {s.mission}</div>
            <div className="dim small">{s.note}</div>
            {s.url && <a href={s.url} target="_blank" rel="noreferrer" className="small">source</a>}
          </div>
        ))}
        <p className="dim small">Area {m.size_m} m × {m.size_m} m, routing grid {area.n}² at {area.cellM} m. Rover-reported elevations match the DTM (median Δ {m.rover_dtm_minus_geoid_m.median.toFixed(2)} m), confirming co-registration.</p>
      </section>
      <section>
        <h3>Environment context</h3>
        <ul className="small">
          <li>Ls {mt.ls.toFixed(1)}° · LTST {fmtHours(mt.ltst)} · Sun elevation {mt.sunElev.toFixed(1)}° (flat horizon, Mars24)</li>
          <li>Earth one-way light time {lt.toFixed(1)} min: Earth MCC cannot give real-time guidance, so habitat + HUD plan locally.</li>
          <li>Radiation reference: 0.64 mSv/day dose-equivalent measured by MSL RAD at Gale (Hassler et al. 2014). Not a Jezero map.</li>
          <li>Not modelled: dust storms, live weather (MEDA), suit thermal state, metabolic O₂ use.</li>
        </ul>
      </section>
    </>
  );
}

