import type { FieldSet, LoadedSitePack, PlanEvent, PlanRequest, PlanResult, Rule, RuleId, Telem } from '@mw/shared/contracts';
import { cellDistM } from '@mw/shared/contracts';
import { evaLtst, evaMinAt, fmtLtst, marsTime, sunAtLtst } from './marsclock';
import { enlilRuns, forecastCheck, mergeDuplicates, nextLtstUtcMs, FORECAST_WINDOW_H } from './spaceweather';
import { relabel, type BaseInfo } from './base';

/**
 * Plain-language layer for the main path (console UX spec §3.4): what the officer reads instead of
 * engine jargon. Every number here is derived from the PlanResult, the flight rules or telemetry.
 */

export type Tone = 'ok' | 'watch' | 'act';

/** Hours and minutes: 117 → "1 h 57 min", 42 → "42 min". */
export function hm(min: number): string {
  if (!Number.isFinite(min)) return '—';
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  return h ? `${h} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
}

/** Elapsed time since the start of the EVA, the way spacewalk timelines read: 61 → "+1:01". */
export function pet(min: number): string {
  if (!Number.isFinite(min)) return '—';
  const m = Math.max(0, Math.round(min));
  return `+${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** Unit a rule's margin is stated in. */
const MARGIN_UNIT: Partial<Record<RuleId, string>> = {
  shelter_time_max_min: 'min', walk_radius_max_m: 'm', heat_avg_max_w: 'W', slope_max_deg: '°', slope_soft_deg: '°',
  eva_duration_max_min: 'min', los_gap_max_min: 'min', daylight_min_sun_elev_deg: '°', contingency_o2_min: 'min', egress_ingress_min: 'min', plume_keepout_m: 'm',
  walkback_speed_factor: 'min',
};
const marginText = (id: RuleId, v: number) => (MARGIN_UNIT[id] === 'min' ? hm(v) : `${v < 10 ? v.toFixed(1) : Math.round(v)} ${MARGIN_UNIT[id] ?? ''}`.trim());

/** Short form for tight places: "1 h 57", "42 min". */
export function hmShort(min: number): string {
  if (!Number.isFinite(min)) return '—';
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  return h ? `${h} h ${String(m % 60).padStart(2, '0')}` : `${m} min`;
}

/** A rule's name for the screen: spells out SEP once. */
export const ruleLabel = (label: string) => label.replace('(SEP)', '(radiation storm, SEP)');

const rule = (rules: Rule[], id: RuleId) => rules.find((r) => r.id === id);
const ruleVal = (rules: Rule[], id: RuleId, d: number) => {
  const r = rule(rules, id);
  return r && r.enabled ? r.value : d;
};

/** What a rule is about, in words an EVA officer would say. */
export const RULE_PLAIN: Record<RuleId, string> = {
  slope_max_deg: 'steep ground',
  slope_soft_deg: 'tiring slopes',
  eva_duration_max_min: 'EVA length',
  egress_ingress_min: 'airlock time',
  contingency_o2_min: 'reserve oxygen',
  walkback_speed_factor: 'walk-back time',
  shelter_time_max_min: 'distance to shelter',
  los_gap_max_min: 'radio contact',
  daylight_min_sun_elev_deg: 'daylight',
  heat_avg_max_w: 'suit heat',
  walk_radius_max_m: 'distance from base',
  plume_keepout_m: 'keep-out zone',
};

/** Where a dropped stop is, so a distance or slope rule can be stated in its own unit. */
export interface DropCtx { pack: LoadedSitePack; baseCell: number; stopCell: number; baseName?: string }

const kmText = (m: number) => `${(m / 1000).toFixed(1)} km`;

/**
 * One-line reason a station was left out ("too steep to reach", "45 min from shelter (limit 30)").
 * Each rule is stated in its own unit: shelter in minutes, walking range in km, steepness in degrees.
 */
export function dropReason(d: { rule: RuleId; deficitMin: number; text: string }, rules: Rule[], ctx?: DropCtx): string {
  const n = Math.max(1, Math.ceil(d.deficitMin));
  const by = d.deficitMin > 0;
  if (/15 highest-value/.test(d.text)) return 'only the 15 most valuable stops are planned';
  if (/SEP nowcast/i.test(d.text)) return 'radiation spike: returning to shelter';
  switch (d.rule) {
    case 'slope_max_deg': {
      const lim = ruleVal(rules, 'slope_max_deg', 20);
      const at = ctx ? ctx.pack.rasters.slope?.[ctx.stopCell] : undefined;
      if (at === undefined) return 'too steep to reach';
      return Number.isFinite(at) && at > lim ? `the spot is on ${Math.round(at)}° ground (limit ${lim}°, ${Math.max(1, Math.round(at - lim))}° over)` : `every way there crosses ground steeper than ${lim}°`;
    }
    case 'walk_radius_max_m': {
      if (!ctx) return 'beyond walking range of the base';
      const dist = cellDistM(ctx.pack.manifest.grid, ctx.baseCell, ctx.stopCell);
      return `${kmText(dist)} from ${ctx.baseName ?? 'the base'} (limit ${kmText(ruleVal(rules, 'walk_radius_max_m', 2000))})`;
    }
    case 'shelter_time_max_min': {
      const lim = ruleVal(rules, 'shelter_time_max_min', 30);
      return by ? `${Math.round(d.deficitMin + lim)} min from the nearest shelter (limit ${lim} min)` : 'too far from shelter';
    }
    case 'los_gap_max_min': return by ? `out of radio contact ${n} min too long` : 'out of radio contact too long';
    case 'eva_duration_max_min': return by ? `doesn't fit the EVA time (+${n} min)` : "doesn't fit the EVA time";
    case 'walkback_speed_factor': return by ? `+${n} min past the walk-back deadline` : 'past the walk-back deadline';
    case 'heat_avg_max_w': return by ? `suit would overheat (+${n} min of rests needed)` : 'suit would overheat';
    case 'daylight_min_sun_elev_deg': return by ? `would end after dark (+${n} min)` : 'would end after dark';
    case 'contingency_o2_min': return 'not enough reserve oxygen';
    case 'egress_ingress_min': return "doesn't fit with airlock time";
    default: return RULE_PLAIN[d.rule] ?? d.rule;
  }
}

/** "What limits this walk", from the engine's binding constraint. */
export function limitLine(p: PlanResult, pack: LoadedSitePack, base: BaseInfo): { head: string; detail: string } | null {
  const b = p.binding;
  if (!b) return null;
  const text = relabel(pack, base, b.text);
  const at = /\bat (.+?)(?: \(|$)/.exec(text)?.[1];
  const short = /\(−(\d+) min\)/.exec(text)?.[1];
  const gain = /would add (\d+) science value/.exec(text)?.[1];
  const what = RULE_PLAIN[b.rule] ?? b.rule;
  const leg = at ? /^(.+?)→(.+)$/.exec(at) : null;
  const head = `${what[0].toUpperCase()}${what.slice(1)}${leg ? (leg[2].trim() === base.short ? ` on the way back from ${leg[1].trim()}` : leg[1].trim() === base.short ? ` on the way to ${leg[2].trim()}` : ` on the walk from ${leg[1].trim()} to ${leg[2].trim()}`) : at ? ` at ${at}` : ''}`;
  let detail = '';
  if (short && at) detail = `${at} would need ${short} more min; it is left out.`;
  else if (gain) detail = `10 % more ${what} would add ${gain} science points.`;
  else {
    const m = p.margins[b.rule];
    if (m) detail = `Closest to the limit at +${Math.round(m.atMin)} min.`;
  }
  return { head, detail };
}

/** Sunset for the EVA: the first time after `fromMin` the sun drops below the daylight rule. */
export function daylightEnd(lsDeg: number, latDeg: number, minEl: number, fromMin: number): number | null {
  for (let t = Math.max(fromMin, 12 * 60); t <= 24 * 60; t += 2) if (sunAtLtst(lsDeg, t, latDeg).elevDeg < minEl) return t;
  return null;
}

/** Space weather in one line: the three tiers (forecast · alert · nowcast) summarised for the verdict. */
export function spaceWeatherLine(pack: LoadedSitePack, startLtstMin: number, events: PlanEvent[], lightMin: number | undefined, nowMs = Date.now()): { tone: Tone; text: string; sub: string } {
  if (events.some((e) => e.t === 'SEP_NOWCAST')) {
    return { tone: 'act', text: 'Radiation spike on board: crew returning to shelter', sub: 'Onboard dose rate +25 % (nowcast). This is the only space-weather tier that orders a return.' };
  }
  const m = pack.manifest;
  const runs = mergeDuplicates(enlilRuns(m.conditions.spaceWeather));
  const lon = m.grid.centerLonLat[0];
  const evaMs = nextLtstUtcMs(nowMs, marsTime(nowMs, lon).ltstH, startLtstMin);
  const chk = forecastCheck(runs, evaMs);
  const delay = lightMin !== undefined ? ` Earth alerts reach the hab ${lightMin.toFixed(0)} min late.` : '';
  if (chk.status === 'NO_DATA') return { tone: 'watch', text: 'No space-weather forecast loaded', sub: `The site pack has no NASA CCMC forecast runs.${delay}` };
  if (chk.status === 'CAUTION') {
    return { tone: 'watch', text: `Possible solar storm within ${FORECAST_WINDOW_H} h of the walk`, sub: `${chk.hits.length} NASA forecast run${chk.hits.length > 1 ? 's' : ''} predict a Mars arrival near the EVA start. Consider a shorter, rover-staged walk.${delay}` };
  }
  return { tone: 'ok', text: 'Space weather clear', sub: `No solar storm forecast within ${FORECAST_WINDOW_H} h of the EVA start (NASA CCMC).${delay}` };
}

export interface VerdictLine {
  key: string;
  tone: Tone;
  text: string;
  sub?: string;
  /** Informational only: shown grey, never a problem. */
  neutral?: boolean;
}

export interface Verdict {
  status: 'GO' | 'CAUTION' | 'NO-GO';
  headline: string;
  /** Where the headline's time goes: airlock, walking, stops (same total). */
  breakdown?: string;
  lines: VerdictLine[];
  spareMin: number;
  deadlineLtst: number | null;
}

/** Latest time the crew may be back at the base (engine bingo 'HAB'), in EVA minutes. */
export function deadlineT(p: PlanResult): number | null {
  const b = p.bingo.find((x) => x.id === 'HAB');
  return b ? b.tMin : null;
}

/** When the crew is back at the base (end of the last walk), EVA minutes. */
export const returnT = (p: PlanResult) => p.segments[p.segments.length - 1]?.t1Min ?? 0;

export function restsOf(p: PlanResult): { count: number; min: number } {
  const legs = p.segments.filter((s) => s.restMin > 0.05);
  return { count: legs.length, min: legs.reduce((a, s) => a + s.restMin, 0) };
}

/** Plan verdict: GO / CAUTION / NO-GO and the 5–6 checklist lines. */
export function verdictOf(args: {
  plan: PlanResult; pack: LoadedSitePack; base: BaseInfo; rules: Rule[]; events: PlanEvent[]; startLtstMin: number; lsDeg: number; lightMin?: number;
}): Verdict {
  const { plan: p, pack, base, rules, events, startLtstMin, lsDeg } = args;
  const lat = pack.manifest.grid.centerLonLat[1];
  const lines: VerdictLine[] = [];
  const back = returnT(p);
  const dl = deadlineT(p);
  const spare = dl !== null ? dl - back : (p.margins.eva_duration_max_min?.min ?? NaN);
  const ret = p.order.length === 0 && p.segments.length > 0;
  const lastSeg = p.segments[p.segments.length - 1];
  const roundTrip = !!lastSeg && (lastSeg.to === 'HAB' || lastSeg.to === base.id);
  const headline = ret
    ? `Return to ${p.segments[p.segments.length - 1] ? endName(p, base) : base.short} · ${hm(back - (p.segments[0]?.t0Min ?? 0))}`
    : `${p.order.length} stop${p.order.length === 1 ? '' : 's'} · ${hm(p.totals.durationMin)} · ${(p.totals.distM / 1000).toFixed(1)} km${roundTrip ? ' round trip' : ''}`;

  let breakdown: string | undefined;
  if (!ret && p.segments.length) {
    // Whole minutes that add up exactly to the headline duration: airlock out + walking + at stops + airlock in.
    const total = Math.round(p.totals.durationMin);
    const out = Math.round(p.segments[0].t0Min);
    const inn = Math.round(p.totals.durationMin - back);
    const stops = Math.round(p.stops.reduce((a, st) => a + (st.departMin - st.arriveMin), 0));
    const walking = Math.max(0, total - out - inn - stops);
    breakdown = `Airlock out ${hm(out)} · walking ${hm(walking)} · at stops ${hm(stops)} · airlock in ${hm(inn)}`;
  }

  if (p.status !== 'OK' && !ret) return { status: 'NO-GO', headline: `No safe walk from ${base.short}`, lines, spareMin: NaN, deadlineLtst: null };

  if (Number.isFinite(spare)) {
    const backR = Math.round(back);
    const latestR = dl !== null ? Math.round(dl) : null;
    const spareR = latestR !== null ? latestR - backR : spare;
    lines.push({
      key: 'spare', tone: spare < 15 ? 'act' : spare < 30 ? 'watch' : 'ok',
      text: latestR !== null ? `Back at the airlock at ${pet(backR)} · latest safe return ${pet(latestR)} · ${hm(spareR).replace(/ /g, '\u00a0')}\u00a0spare` : `Back ${hm(spare)} before the EVA time limit`,
      sub: `Times are elapsed from the start of the EVA (+h:mm, Earth time). ${pet(latestR ?? backR)} minus ${pet(backR)} is ${hm(spareR)}. Mars local time: back at the airlock ${fmtLtst(evaLtst(startLtstMin, back))}${dl !== null ? `, latest safe return ${fmtLtst(evaLtst(startLtstMin, dl))}` : ''}. The latest safe return is when the crew must reach the airlock door.`,
    });
  }
  const sw = spaceWeatherLine(pack, startLtstMin, events, args.lightMin);
  lines.push({ key: 'weather', tone: sw.tone, text: sw.text, sub: sw.sub });

  const minEl = ruleVal(rules, 'daylight_min_sun_elev_deg', 5);
  const dusk = daylightEnd(lsDeg, lat, minEl, startLtstMin);
  const endLtst = evaLtst(startLtstMin, p.totals.durationMin);
  if (dusk !== null) {
    const left = dusk - endLtst;
    lines.push({ key: 'daylight', tone: left < 0 ? 'act' : left < 30 ? 'watch' : 'ok', text: `Daylight until ${fmtLtst(dusk)} Mars local (${pet(evaMinAt(startLtstMin, dusk))})`, sub: `Sun above ${minEl}° until ${fmtLtst(dusk)} Mars local; the crew is back in by ${fmtLtst(endLtst)} (${pet(p.totals.durationMin)}).` });
  }

  const heat = ruleVal(rules, 'heat_avg_max_w', 352);
  const rests = restsOf(p);
  lines.push({
    key: 'heat', tone: 'ok',
    text: rests.count ? `Suit heat: ${rests.count} short rest${rests.count > 1 ? 's' : ''} built in` : 'Suit heat: no rests needed',
    sub: rests.count ? `${Math.round(rests.min) || '<1'} min of rest in all keeps the suit under its ${heat} W cooling limit.` : `Stays under the suit's ${heat} W cooling limit.`,
  });

  const lim = limitLine(p, pack, base);
  if (lim && !ret) {
    const bm = p.margins[p.binding!.rule];
    const tight = rests.count > 0 || spare < 30 || /\(−\d+ min\)/.test(p.binding!.text) || (!!bm && bm.min <= 1);
    const what = `${lim.head[0].toLowerCase()}${lim.head.slice(1)}`;
    lines.push(tight
      ? { key: 'limit', tone: 'watch', text: `Limits: ${what}`, sub: lim.detail }
      : { key: 'limit', tone: 'ok', neutral: true, text: `Tightest margin: ${what}, ${bm ? `${marginText(p.binding!.rule, bm.min)} to spare ` : ''}(plenty of room)`, sub: lim.detail });
  }

  const worst = lines.some((l) => l.tone === 'act') || lines.some((l) => l.key !== 'limit' && l.tone === 'watch');
  return { status: worst ? 'CAUTION' : 'GO', headline, breakdown, lines, spareMin: spare, deadlineLtst: dl !== null ? evaLtst(startLtstMin, dl) : null };
}

function endName(p: PlanResult, base: BaseInfo): string {
  const last = p.segments[p.segments.length - 1];
  return last && last.to !== 'HAB' && last.to !== base.id ? last.to : base.short;
}

/** Where along the plan a time falls: a stop, or the walk between two places. */
export function whereAt(p: PlanResult, tMin: number, label: (id: string) => string): string {
  const stop = p.stops.find((s) => tMin >= s.arriveMin - 0.5 && tMin <= s.departMin + 0.5);
  if (stop) return `at ${label(stop.id)}`;
  const seg = p.segments.find((s) => tMin >= s.t0Min - 0.5 && tMin <= s.t1Min + 0.5);
  return seg ? `on ${label(seg.from)} → ${label(seg.to)}` : '';
}

/** The three things to watch on this walk, from the tightest margins (crew brief). */
export function thingsToWatch(p: PlanResult, rules: Rule[], label: (id: string) => string): string[] {
  const out: { score: number; text: string }[] = [];
  const m = p.margins;
  const heat = rule(rules, 'heat_avg_max_w');
  if (m.heat_avg_max_w && heat) {
    const where = whereAt(p, m.heat_avg_max_w.atMin, label);
    out.push({ score: m.heat_avg_max_w.min / heat.value, text: m.heat_avg_max_w.min < 1 ? `Suit heat reaches its ${heat.value} W limit ${where}: rests are built in, keep the pace.` : `Suit heat stays ${Math.round(m.heat_avg_max_w.min)} W under its limit (tightest ${where}).` });
  }
  const los = rule(rules, 'los_gap_max_min');
  if (m.los_gap_max_min && los) {
    out.push({ score: m.los_gap_max_min.min / los.value, text: `Radio: ${m.los_gap_max_min.min < 1 ? 'under a minute' : `${Math.round(m.los_gap_max_min.min)} min`} to spare out of contact ${whereAt(p, m.los_gap_max_min.atMin, label)}.` });
  }
  const sh = rule(rules, 'shelter_time_max_min');
  if (m.shelter_time_max_min && sh) {
    out.push({ score: m.shelter_time_max_min.min / sh.value, text: `Shelter: furthest point is ${whereAt(p, m.shelter_time_max_min.atMin, label)}, ${Math.round(sh.value - m.shelter_time_max_min.min)} min from shelter (limit ${sh.value}).` });
  }
  const sl = rule(rules, 'slope_max_deg');
  if (m.slope_max_deg && sl) {
    out.push({ score: m.slope_max_deg.min / sl.value, text: `Steepest ground ${(sl.value - m.slope_max_deg.min).toFixed(0)}° ${whereAt(p, m.slope_max_deg.atMin, label)} (limit ${sl.value}°).` });
  }
  const first = [...p.bingo].filter((b) => b.id !== 'HAB').sort((a, b) => a.tMin - b.tMin)[0];
  if (first) out.push({ score: 0.5, text: `Leave-by times are hard: first one is ${label(first.id)} at ${pet(first.tMin)} (${fmtLtst(first.ltstMin)} Mars local).` });
  return out.sort((a, b) => a.score - b.score).slice(0, 3).map((x) => x.text);
}

// ───────────────────────────── EVA live ─────────────────────────────

export interface LiveValue {
  key: string;
  label: string;
  value: string;
  unit?: string;
  tone: Tone;
  hint: string;
}

/** Ahead (+) / behind (−) the plan in minutes, from where the crew is along the route. */
export function scheduleDelta(p: PlanResult, telem: Telem[], g: { w: number; cellM: number }): { deltaMin: number; offRouteM: number } | null {
  const last = telem[telem.length - 1];
  if (!last || !p.segments.length) return null;
  const t = last.t;
  // Planned time at each route cell, then the nearest cell to the crew within ±40 min of plan time
  // (out-and-back routes reuse paths, so the window keeps the match on the right leg).
  let best: { d: number; tp: number } | null = null;
  const lr = Math.floor(last.cell / g.w), lc = last.cell % g.w;
  for (const s of p.segments) {
    if (s.t1Min < t - 40 || s.t0Min > t + 40) continue;
    const n = s.cells.length;
    for (let i = 0; i < n; i++) {
      const tp = s.t0Min + ((s.t1Min - s.t0Min) * i) / Math.max(1, n - 1);
      if (Math.abs(tp - t) > 40) continue;
      const c = s.cells[i];
      const d = Math.hypot(Math.floor(c / g.w) - lr, (c % g.w) - lc) * g.cellM;
      if (!best || d < best.d - 0.01 || (Math.abs(d - best.d) <= 0.01 && Math.abs(tp - t) < Math.abs(best.tp - t))) best = { d, tp };
    }
  }
  if (!best) return null;
  // At a stop: on plan while dwelling between arrival and planned departure.
  const stop = p.stops.find((s) => Math.abs(best!.tp - s.arriveMin) < 0.6 || Math.abs(best!.tp - s.departMin) < 0.6);
  if (stop && best.d < 15) {
    if (t < stop.arriveMin) return { deltaMin: stop.arriveMin - t, offRouteM: best.d };
    if (t <= stop.departMin) return { deltaMin: 0, offRouteM: best.d };
    return { deltaMin: stop.departMin - t, offRouteM: best.d };
  }
  return { deltaMin: best.tp - t, offRouteM: best.d };
}

export function liveValues(args: {
  last: Telem; plan: PlanResult; req: PlanRequest | null; fields: FieldSet | null; rules: Rule[]; link: 'up' | 'degraded' | 'down'; events: PlanEvent[];
}): LiveValue[] {
  const { last, plan: p, fields, rules, link, events } = args;
  const out: LiveValue[] = [];
  const evaMax = ruleVal(rules, 'eva_duration_max_min', 360);
  const egress = ruleVal(rules, 'egress_ingress_min', 60);
  const cut = events.reduce((a, e) => (e.t === 'EVA_CUT' ? a + e.min : a), 0);
  const dl = deadlineT(p) ?? evaMax - cut - egress / 2;
  // Spare time to get home: latest safe return minus now minus the contingency walk back from here.
  const wb = fields ? fields.walkbackMin[last.cell] : NaN;
  if (Number.isFinite(wb)) {
    const spare = dl - last.t - wb;
    out.push({ key: 'spare', label: 'Spare time to get home', value: hmShort(spare), tone: spare < 10 ? 'act' : spare < 30 ? 'watch' : 'ok', hint: `Latest safe return ${hm(dl - last.t)} from now; walking back slowly from here takes ${hm(wb)}.` });
  }
  const shMax = Math.min(ruleVal(rules, 'shelter_time_max_min', 30), ...events.filter((e) => e.t === 'SEP_NOWCAST').map((e) => (e.t === 'SEP_NOWCAST' ? e.leadMin : Infinity)));
  const sh = fields ? fields.shelterMin[last.cell] : NaN;
  if (Number.isFinite(sh)) {
    out.push({ key: 'shelter', label: 'Minutes to shelter', value: sh.toFixed(0), unit: 'min', tone: sh > shMax ? 'act' : sh > shMax * 0.8 ? 'watch' : 'ok', hint: `Walk to the nearest hab or pressurized rover. Limit ${shMax} min.` });
  }
  out.push({ key: 'o2', label: 'Oxygen (planned)', value: last.o2Pct.toFixed(0), unit: '%', tone: last.o2Pct < 15 ? 'act' : last.o2Pct < 30 ? 'watch' : 'ok', hint: 'Planned oxygen left for the walk, reserve not counted.' });
  const heat = ruleVal(rules, 'heat_avg_max_w', 352);
  out.push({ key: 'heat', label: 'Suit heat', value: `${Math.round(last.heatAvgW)}`, unit: `/ ${heat} W`, tone: last.heatAvgW > heat + 1 ? 'act' : last.heatAvgW > heat * 0.92 ? 'watch' : 'ok', hint: '30-minute average of the crew member\'s heat output against the suit\'s cooling limit.' });
  out.push({
    key: 'link', label: 'Crew link', value: link === 'up' ? 'OK' : link === 'degraded' ? 'Weak' : 'Lost', tone: link === 'up' ? 'ok' : link === 'degraded' ? 'watch' : 'act',
    hint: link === 'down' ? 'The visor keeps guiding on board on the last accepted route; data here is stale.' : 'Surface radio link to the visor.',
  });
  return out;
}

/** Distance from the EVA base, for the crew card. */
export const distFromBase = (g: Parameters<typeof cellDistM>[0], base: BaseInfo, cell: number) => cellDistM(g, base.cell, cell);
