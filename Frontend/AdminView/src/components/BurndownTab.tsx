import { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { BurndownPoint, Telem } from '@mw/shared/contracts';
import { generatePlan } from '../actions';
import { useConsole } from '../store';
import { Button, Empty, SectionHead } from './ui';

interface ChartDef {
  key: string;
  title: string;
  unit: string;
  plan: (b: BurndownPoint) => number;
  actual?: (t: Telem) => number | null;
  limit?: number;
  limitLabel?: string;
}

const AXIS = {
  stroke: '#858891',
  font: '10px "SF Mono", ui-monospace, Menlo, monospace',
  grid: { stroke: 'rgba(255,255,255,0.05)', width: 1 },
  ticks: { stroke: 'rgba(255,255,255,0.08)', width: 1, size: 4 },
};

function Chart({ def, plan, telem, nowT }: { def: ChartDef; plan: BurndownPoint[]; telem: Telem[]; nowT: number | null }) {
  const el = useRef<HTMLDivElement>(null);
  const u = useRef<uPlot | null>(null);
  const nowRef = useRef<number | null>(nowT);
  nowRef.current = nowT;

  const data = useMemo(() => {
    const xs = new Set<number>();
    plan.forEach((p) => xs.add(Math.round(p.tMin * 10) / 10));
    if (def.actual) telem.forEach((t) => xs.add(Math.round(t.t * 10) / 10));
    const x = [...xs].sort((a, b) => a - b);
    const pm = new Map(plan.map((p) => [Math.round(p.tMin * 10) / 10, def.plan(p)]));
    const am = new Map(def.actual ? telem.map((t) => [Math.round(t.t * 10) / 10, def.actual!(t)]) : []);
    const ys1 = x.map((v) => (pm.has(v) ? pm.get(v)! : null));
    const ys2 = x.map((v) => (am.has(v) ? am.get(v)! : null));
    const lim = x.map(() => def.limit ?? null);
    return [x, ys1, ys2, lim] as uPlot.AlignedData;
  }, [plan, telem, def]);

  useEffect(() => {
    if (!el.current) return;
    const width = el.current.clientWidth || 340;
    const opts: uPlot.Options = {
      width,
      height: 104,
      padding: [8, 6, 0, 0],
      cursor: { drag: { x: false, y: false }, points: { size: 5 } },
      legend: { show: false },
      scales: { x: { time: false } },
      axes: [
        { ...AXIS, size: 22, values: (_u, vals) => vals.map((v) => `${Math.round(v)}′`) },
        { ...AXIS, size: 50, values: (_u, vals) => vals.map((v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(2)}k` : `${v}`)) },
      ],
      series: [
        {},
        { label: 'Plan', stroke: '#F2B544', width: 1.5, spanGaps: true, points: { show: false } },
        { label: 'Actual', stroke: '#4FD1E0', width: 2, spanGaps: true, points: { show: false } },
        { label: def.limitLabel ?? 'Limit', stroke: '#FF5A4E', width: 1, dash: [4, 4], points: { show: false } },
      ],
      hooks: {
        draw: [
          (uu) => {
            const t = nowRef.current;
            if (t === null) return;
            const x = uu.valToPos(t, 'x', true);
            const ctx = uu.ctx;
            ctx.save();
            ctx.strokeStyle = 'rgba(79,209,224,0.6)';
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            ctx.moveTo(x, uu.bbox.top);
            ctx.lineTo(x, uu.bbox.top + uu.bbox.height);
            ctx.stroke();
            ctx.restore();
          },
        ],
      },
    };
    u.current = new uPlot(opts, data, el.current);
    const ro = new ResizeObserver(() => {
      if (el.current && u.current) u.current.setSize({ width: el.current.clientWidth, height: 104 });
    });
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      u.current?.destroy();
      u.current = null;
    };
    // created once per chart; data updates go through setData below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    u.current?.setData(data);
  }, [data]);

  const minPlan = plan.length ? Math.min(...plan.map(def.plan)) : null;
  const lastAct = def.actual && telem.length ? def.actual(telem[telem.length - 1]) : null;
  return (
    <div data-testid={`burndown-${def.key}`} data-actual-points={telem.length} className="rounded-[3px] border border-line bg-sunk/50 px-2.5 pb-1 pt-2">
      <div className="flex items-baseline justify-between px-0.5">
        <span className="font-display text-[10.5px] uppercase tracking-[0.12em] text-ink-2">{def.title}</span>
        <span className="num text-[10.5px] text-mute">
          {lastAct !== null && lastAct !== undefined && Number.isFinite(lastAct) && (
            <>
              <span className="text-dim">now </span>
              <span className="text-cyan">{lastAct.toFixed(1)}</span>
              <span className="mx-1.5 text-line-2">|</span>
            </>
          )}
          {minPlan !== null ? (
            <>
              <span className="text-dim">plan min </span>
              <span className="text-ink-2">{minPlan.toFixed(1)}</span> {def.unit}
            </>
          ) : (
            '—'
          )}
        </span>
      </div>
      <div ref={el} className="mt-1" />
    </div>
  );
}

export function BurndownTab() {
  const plan = useConsole((s) => s.plan);
  const telem = useConsole((s) => s.telem);
  const fields = useConsole((s) => s.fields);
  const limits = useConsole((s) => s.limits);
  const pack = useConsole((s) => s.pack);
  const heatLimit = useConsole((s) => s.rules.find((r) => r.id === 'heat_avg_max_w')?.value ?? 352);

  const defs = useMemo<ChartDef[]>(() => {
    const dem = pack?.rasters.dem;
    const wbMax = limits && Number.isFinite(limits.walkbackMax) ? limits.walkbackMax : 300;
    const shMax = limits && Number.isFinite(limits.shelterMax) ? limits.shelterMax : 30;
    const egressHalf = 30;
    return [
      {
        key: 'wb', title: 'Spare time to get home', unit: 'min', plan: (b) => b.walkbackMarginMin, limit: 0, limitLabel: 'zero margin',
        actual: fields ? (t) => (Number.isFinite(fields.walkbackMin[t.cell]) ? wbMax + egressHalf - t.t - fields.walkbackMin[t.cell] : null) : undefined,
      },
      {
        key: 'sh', title: 'Shelter limit minus minutes to shelter', unit: 'min', plan: (b) => b.shelterMarginMin, limit: 0, limitLabel: 'zero margin',
        actual: fields ? (t) => (Number.isFinite(fields.shelterMin[t.cell]) ? shMax - fields.shelterMin[t.cell] : null) : undefined,
      },
      { key: 'o2', title: 'O₂ remaining (planned)', unit: '%', plan: (b) => b.o2Pct, actual: (t) => t.o2Pct, limit: 0 },
      { key: 'el', title: 'Elevation', unit: 'm', plan: (b) => b.elevM, actual: dem ? (t) => dem[t.cell] : undefined },
      { key: 'met', title: 'Metabolic rate', unit: 'W', plan: (b) => b.metW, actual: (t) => t.metW },
      { key: 'heat', title: 'Suit heat (30-min avg)', unit: 'W', plan: (b) => b.heatAvgW, actual: (t) => t.heatAvgW, limit: heatLimit, limitLabel: 'suit budget' },
    ];
  }, [fields, limits, pack, heatLimit]);

  if (!plan || !plan.burndown.length) {
    return (
      <div className="p-4">
        <Empty title="No margins yet" action={<Button variant="primary" onClick={() => void generatePlan()}>Plan now</Button>}>
          These charts show how each margin is spent over the EVA. Live crew data overlays the actual once the route is sent.
        </Empty>
      </div>
    );
  }
  const nowT = telem.length ? telem[telem.length - 1].t : null;
  return (
    <div className="flex flex-col gap-3 px-4 pb-6 pt-4">
      <SectionHead
        right={
          <div className="flex items-center gap-3 text-[10px] text-mute">
            <span className="flex items-center gap-1.5"><span className="h-[2px] w-3.5 bg-amber" />Plan</span>
            <span className="flex items-center gap-1.5"><span className="h-[2px] w-3.5 bg-cyan" />Actual</span>
            <span className="flex items-center gap-1.5"><span className="h-0 w-3.5 border-t border-dashed border-red" />Limit</span>
          </div>
        }
      >
        Margins over time
      </SectionHead>
      {defs.map((d) => (
        <Chart key={d.key} def={d} plan={plan.burndown} telem={telem} nowT={nowT} />
      ))}
      <div className="text-[10.5px] leading-snug text-dim">
        Minutes from EVA start (technical name: burndowns). Actual margins are recomputed from the crew's position against the current safety fields{telem.length ? '' : '; no crew data yet'}.
      </div>
    </div>
  );
}
