/** X4: sample 24 single-destination walks on gale-v1, run the engine, export blind evidence packets.
 *  Run: pnpm tsx Validation/v4_crosscheck/make_packets.ts */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve as presolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CREW, DEFAULT_RULES, decodeRaster, mulberry32 } from '../../Shared/src/contracts';
import type { LoadedSitePack } from '../../Shared/src/contracts/sitepack';
import type { PlanRequest, SitePackManifest } from '../../Shared/src/contracts/types';
import { plan, stageFromShelter, makeOrderEvaluator, sunAtLtst, ltstAt, restNeeded, heatAfterRest, heatAfterWork, HEAT_TAU_MIN, REST_W, TASK_W_DEFAULT, DEFAULT_LS_DEG, dijkstraSearch } from '../../Shared/src/engine';
import { resolve } from '../../Shared/src/engine/fields';
import { horizDistM } from '../../Shared/src/engine/costModel';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = presolve(HERE, '../..');
const SEED = 4242;
const base = join(ROOT, 'SitePacks/gale-v1');
const manifest = JSON.parse(readFileSync(join(base, 'manifest.json'), 'utf8')) as SitePackManifest;
const rasters: Record<string, Float32Array> = {};
for (const l of Object.values(manifest.rasters)) {
  const b = readFileSync(join(base, l.file));
  rasters[l.id] = decodeRaster(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, l);
}
const pack: LoadedSitePack = { manifest, rasters, base };
const { w, cellM, originX, originY } = manifest.grid;
const RM = 3396190, LON0 = 137.39, LAT_TS = -4.8;
const cellXY = (c: number) => { const r = Math.floor(c / w), q = c % w; return { x: originX + (q + 0.5) * cellM, y: originY - (r + 0.5) * cellM }; };
const lonlat = (c: number) => { const { x, y } = cellXY(c); return { lon: +(LON0 + (x / (RM * Math.cos(LAT_TS * Math.PI / 180))) * 180 / Math.PI).toFixed(6), lat: +((y / RM) * 180 / Math.PI).toFixed(6) }; };

const hab = manifest.shelters.find((s) => s.kind === 'hab')!;
const rawReq: PlanRequest = {
  siteId: manifest.id, hab: hab.cell, shelters: manifest.shelters.map((s) => ({ id: s.id, kind: s.kind, cell: s.cell })),
  sol: manifest.scenario.sol, startLtstMin: manifest.scenario.startLtstMin, stations: [], rules: DEFAULT_RULES, crew: DEFAULT_CREW, seed: 1,
};
const bases: Record<string, PlanRequest> = { 'PR-1': stageFromShelter(rawReq, 'ROVER1'), 'Hab-1': rawReq };
const lsKnown = manifest.conditions?.rems?.find((x) => x.sol === rawReq.sol)?.ls;
const LS = lsKnown ?? DEFAULT_LS_DEG;
const LAT = manifest.grid.centerLonLat[1];
const dist = (a: number, b: number) => Math.hypot(Math.floor(a / w) - Math.floor(b / w), (a % w) - (b % w)) * cellM;

type Trial = { base: 'PR-1' | 'Hab-1'; cell: number; label: string; dwell: number; startLtst: number };
const rnd = mulberry32(SEED);
const R0 = resolve(pack, bases['PR-1']);
const passable = (c: number) => !R0.baseGrid.blocked[c] && Number.isFinite(rasters.dem[c]);
const trials: Trial[] = [];
const starts = [580, 580, 580, 580, 480, 660, 900];
const pickStart = () => starts[Math.floor(rnd() * starts.length)];
for (const st of manifest.stations) for (const b of ['PR-1', 'Hab-1'] as const) trials.push({ base: b, cell: st.cell, label: st.id, dwell: st.dwellMin, startLtst: pickStart() });
for (let i = 0; i < 400; i++) {
  const b: 'PR-1' | 'Hab-1' = rnd() < 0.8 ? 'PR-1' : 'Hab-1';
  const bc = bases[b].hab, br = Math.floor(bc / w), bq = bc % w;
  const rad = (0.2 + rnd() * 2.3) * 1000 / cellM, th = rnd() * 2 * Math.PI;
  const r = Math.round(br + rad * Math.sin(th)), q = Math.round(bq + rad * Math.cos(th));
  if (r < 0 || q < 0 || r >= 1000 || q >= w) continue;
  const c = r * w + q;
  if (!passable(c) || dist(c, bc) > 2500) continue;
  trials.push({ base: b, cell: c, label: 'rand', dwell: [15, 20, 25, 30][Math.floor(rnd() * 4)], startLtst: pickStart() });
}

interface Row { cell: number; phase: string; cumMin: number; cumDist: number; P: number; edgeGrade: number; outLos: number; }
function buildNodes(Rr: ReturnType<typeof resolve>, out: number[], ret: number[], dwellMin: number) {
  const g = Rr.grid, model = Rr.model, ctx = Rr.ctx1, los = Rr.fields.los;
  const hp = { budgetW: 352, restW: REST_W, tauMin: HEAT_TAU_MIN };
  const nodes: Row[] = [];
  let t = 0, H = Math.min(250, hp.budgetW), D = 0, rest = 0;
  const push = (cell: number, phase: string, P: number, grade: number, outLos: number) => nodes.push({ cell, phase, cumMin: t, cumDist: D, P, edgeGrade: grade, outLos });
  const walk = (cells: number[], phase: string, first: boolean) => {
    for (let k = first ? 0 : 1; k < cells.length; k++) {
      if (k === 0) { push(cells[0], phase, 0, 0, 0); continue; }
      const u = cells[k - 1], v = cells[k];
      let dt = model.edgeCost(g, u, v, ctx) / 60;
      const dz = g.elev[v] - g.elev[u], hd = horizDistM(g, u, v);
      if (!(dt < Infinity)) dt = Math.hypot(hd, dz) / DEFAULT_CREW.v0 / 60;
      const P = model.edgePowerW!(g, u, v, ctx);
      const rn = restNeeded(H, dt, P, hp);
      let tEdge = dt;
      if (rn > 0) { H = heatAfterRest(H, rn, hp); tEdge += rn; rest += rn; }
      H = heatAfterWork(H, dt, P, hp);
      t += tEdge; D += Math.hypot(hd, dz);
      push(v, phase, P, Math.abs(Math.atan2(dz, hd)) * 180 / Math.PI, los[v] === 1 ? 0 : tEdge);
    }
  };
  walk(out, 'outbound', true);
  const dest = out[out.length - 1];
  // dwell in 1-min chunks (heat governor)
  let left = dwellMin, tD = 0;
  while (left > 1e-9) {
    const d = Math.min(1, left);
    const rn = restNeeded(H, d, TASK_W_DEFAULT, hp);
    if (rn > 0) { H = heatAfterRest(H, rn, hp); tD += rn; rest += rn; }
    H = heatAfterWork(H, d, TASK_W_DEFAULT, hp); tD += d; left -= d;
  }
  t += tD;
  push(dest, 'dwell_end', TASK_W_DEFAULT, 0, los[dest] === 1 ? 0 : tD);
  walk(ret, 'return', false);
  return { nodes, rest };
}

interface Out { id: string; trial: Trial; status: string; rule: string; deficit: number; };
const results: any[] = [];
for (const [ti, tr] of trials.entries()) {
  const req0 = bases[tr.base];
  const req: PlanRequest = { ...req0, startLtstMin: tr.startLtst, stations: [{ id: 'DEST', cell: tr.cell, value: 10, dwellMin: tr.dwell }] };
  const res = plan(pack, req);
  const R = resolve(pack, req);
  let outC: number[] | null = null, retC: number[] | null = null, src = '';
  if (res.status === 'OK') { outC = res.segments[0].cells; retC = res.segments[1].cells; src = 'engine_plan'; }
  else {
    const o = dijkstraSearch.search(R.grid, R.model, R.ctx1, req.hab, tr.cell);
    const r = dijkstraSearch.search(R.grid, R.model, R.ctx1, tr.cell, req.hab);
    if (o && r) { outC = Array.from(o.cells); retC = Array.from(r.cells); src = 'path_search'; }
  }
  if (!outC || !retC) continue;
  const ev = makeOrderEvaluator(pack, req)(['DEST'], [outC, retC]);
  const drop = res.dropped[0];
  results.push({ ti, tr, req, res, R, outC, retC, src, ev, rule: res.status === 'OK' ? 'none' : (drop?.rule ?? res.binding?.rule ?? 'unknown') });
}
console.log('trials with route:', results.length, 'GO', results.filter((x) => x.res.status === 'OK').length);
const bucket: Record<string, number> = {};
for (const x of results) { const k = `${x.res.status}/${x.rule}`; bucket[k] = (bucket[k] ?? 0) + 1; }
console.log(bucket);

// ---- selection: 12 GO + 12 NO-GO, NO-GO spread over rules round-robin; mostly PR-1
const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const goPool = shuffle(results.filter((x) => x.res.status === 'OK'));
const nogoPool = shuffle(results.filter((x) => x.res.status !== 'OK'));
const chosen: any[] = [];
let habCount = 0;
const take = (x: any) => { if (x.tr.base === 'Hab-1') { if (habCount >= 5) return false; habCount++; } chosen.push(x); return true; };
// GO: spread by distance bins
const goSorted = [...goPool].sort((a, b) => dist(a.tr.cell, a.req.hab) - dist(b.tr.cell, b.req.hab));
const goPick: any[] = [];
for (let i = 0; i < 12 && goSorted.length; i++) { const idx = Math.floor(((i + 0.5) / 12) * goSorted.length); goPick.push(goSorted[idx]); }
// prefer a few Hab-1 in GO
const habGo = goPool.filter((x) => x.tr.base === 'Hab-1');
for (const x of habGo.slice(0, 2)) if (!goPick.includes(x)) goPick[goPick.length - 1 - habGo.indexOf(x)] = x;
for (const x of new Set(goPick)) take(x);
const rules = [...new Set(nogoPool.map((x) => x.rule))];
const byRule = new Map(rules.map((r) => [r, nogoPool.filter((x) => x.rule === r)]));
let nNo = 0;
while (nNo < 12) {
  let added = false;
  for (const r of rules) {
    const list = byRule.get(r)!;
    while (list.length) { const x = list.shift()!; if (take(x)) { nNo++; added = true; break; } }
    if (nNo >= 12) break;
  }
  if (!added) break;
}
const final = shuffle(chosen);
console.log('chosen', final.length, 'GO', final.filter((x) => x.res.status === 'OK').length);

const packetsDir = join(HERE, 'packets'); mkdirSync(packetsDir, { recursive: true });
const rulesOut = DEFAULT_RULES.filter((r) => r.enabled).map((r) => ({ id: r.id, label: r.label, value: r.value, unit: r.unit, hard: r.hard }));
const verdicts: any[] = [], routeCells: Record<string, number[][]> = {};
final.forEach((x, i) => {
  const id = `W${String(i + 1).padStart(2, '0')}`;
  const { R, req, res, tr } = x;
  const f = R.fields;
  const { nodes, rest } = buildNodes(R, x.outC, x.retC, tr.dwell);
  const N = nodes.length;
  const dwellIdx = nodes.findIndex((n) => n.phase === 'dwell_end');
  const losAt = (k: number) => f.los[nodes[k].cell] === 1;
  const musts = new Set<number>([0, x.outC.length - 1, dwellIdx, N - 1]);
  const trans: number[] = [];
  for (let k = 1; k < N; k++) if (losAt(k) !== losAt(k - 1)) trans.push(k - 1, k);
  if (musts.size + trans.length <= 90) trans.forEach((k) => musts.add(k));
  const extra = 120 - musts.size;
  for (let j = 0; j < extra; j++) musts.add(Math.round((j * (N - 1)) / Math.max(1, extra - 1)));
  const idxs = [...musts].sort((a, b) => a - b).slice(0, 120);
  const rows = idxs.map((k, ri) => {
    const nxt = ri + 1 < idxs.length ? idxs[ri + 1] : k;
    let ms = 0, mg = 0, outL = 0, pw = 0;
    for (let j = k; j <= nxt; j++) { const sl = R.baseGrid.slopeDeg[nodes[j].cell]; if (Number.isFinite(sl)) ms = Math.max(ms, sl); }
    for (let j = k + 1; j <= nxt; j++) { mg = Math.max(mg, nodes[j].edgeGrade); outL += nodes[j].outLos; }
    pw = nxt > k ? nodes[k + 1].P : 0;
    const c = nodes[k].cell, tt = 30 + nodes[k].cumMin; // EVA minutes (egress/2 = 30 before surface start)
    const sun = sunAtLtst(LS, ltstAt(tr.startLtst, tt), LAT).elevDeg;
    const sunE = 0;
    return {
      i: ri, phase: nodes[k].phase, cell: c,
      cum_dist_m: +nodes[k].cumDist.toFixed(1), elev_m: +rasters.dem[c].toFixed(2), cell_slope_deg: +ms.toFixed(2),
      edge_grade_deg: +mg.toFixed(2), cum_min: +nodes[k].cumMin.toFixed(2), in_los: f.los[c] === 1,
      out_los_min_to_next_row: +outL.toFixed(2), dist_base_m: +dist(c, req.hab).toFixed(1),
      min_to_shelter: +f.shelterMin[c].toFixed(2), min_back_nominal: +(f.walkbackMin[c] * 0.5).toFixed(2),
      sun_elev_deg: +sun.toFixed(2), metabolic_W: +pw.toFixed(1),
    };
  });
  const sunEnd = sunAtLtst(LS, ltstAt(tr.startLtst, 30 + nodes[N - 1].cumMin + 30), LAT).elevDeg;
  const shelters = req.shelters.map((s) => ({ id: s.id, kind: s.kind, cell: s.cell, ...lonlat(s.cell) }));
  const packet = {
    walk: id,
    description: 'Single-destination EVA walk: egress at the base, walk to the destination, work there (dwell), walk the same kind of path back, ingress.',
    rules: rulesOut, crew: DEFAULT_CREW,
    base: { name: tr.base === 'PR-1' ? 'Pressurized rover PR-1 (EVA base)' : 'Habitat Hab-1 (EVA base)', cell: req.hab, ...lonlat(req.hab) },
    destination: { cell: tr.cell, ...lonlat(tr.cell), label: tr.label },
    shelters, radio_masts: [req.hab, ...req.shelters.filter((s) => s.kind === 'rover' && s.cell !== req.hab).map((s) => s.cell)],
    grid: { cell_size_m: cellM, rows: 1000, cols: w },
    start_ltst_min: tr.startLtst, start_ltst_hhmm: `${String(Math.floor(tr.startLtst / 60)).padStart(2, '0')}:${String(tr.startLtst % 60).padStart(2, '0')}`,
    dwell_min: tr.dwell, egress_min_before_walk: 30, ingress_min_after_walk: 30,
    time_note: `cum_min = minutes since the surface walk began (after 30 min egress), engine cost model INCLUDING suit-heat rests (${rest.toFixed(1)} min of rests total on this route) and the dwell. Walking pace 0.56 m/s nominal.`,
    columns: {
      cell_slope_deg: 'max cell slope over the block starting at this row', edge_grade_deg: 'max single-step grade over the block from this row to the next row',
      in_los: 'radio line of sight to a mast at this row (true/false)', out_los_min_to_next_row: 'minutes out of line of sight accrued between this row and the next',
      min_to_shelter: 'walking minutes (nominal pace) to nearest shelter (hab or rover)', min_back_nominal: 'walking minutes (nominal pace) to the EVA base by the best path from this cell',
      sun_elev_deg: 'sun elevation at this row', metabolic_W: 'metabolic power on the step to the next row',
    },
    sun_elev_deg_at_end_of_ingress: +sunEnd.toFixed(2),
    steps: rows,
  };
  writeFileSync(join(packetsDir, `${id}.json`), JSON.stringify(packet, null, 1));
  routeCells[id] = [x.outC, x.retC];
  verdicts.push({
    walk: id, base: tr.base, dest_label: tr.label, start_ltst_min: tr.startLtst, dwell_min: tr.dwell, route_source: x.src,
    engine_status: res.status, engine_verdict: res.status === 'OK' ? 'GO' : 'NO-GO',
    binding: res.binding, dropped: res.dropped, notes: res.notes.slice(0, 3),
    plan_totals: res.status === 'OK' ? res.totals : null, plan_margins: res.status === 'OK' ? res.margins : null,
    candidate_eval: { pass: x.ev.pass, reason: x.ev.reason ?? null, failures: x.ev.failures, durationMin: x.ev.durationMin },
    own_packet_total_min_with_rests: +nodes[N - 1].cumMin.toFixed(2), packet_rest_min: +rest.toFixed(2),
    dist_base_m: +dist(tr.cell, req.hab).toFixed(1),
  });
});
verdicts.sort((a, b) => a.walk.localeCompare(b.walk));
writeFileSync(join(HERE, 'engine_verdicts.json'), JSON.stringify(verdicts, null, 1));
writeFileSync(join(HERE, 'route_cells.json'), JSON.stringify(routeCells));
console.log(verdicts.map((v) => `${v.walk} ${v.base} ${v.dest_label} ${v.engine_verdict} ${v.binding?.rule ?? ''} drop=${v.dropped[0]?.rule ?? ''} candFail=${v.candidate_eval.failures.map((f: any) => f.rule).join(',')}`).join('\n'));
