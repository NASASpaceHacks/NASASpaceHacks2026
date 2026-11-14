import { useEffect, useRef, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { set, useConsole } from '../store';
import { EvidenceLegend, LimitationsList } from './Evidence';
import { Kbd, cx } from './ui';
// Committed evidence, read at build time (never fetched): Validation/, Research/bench, qa/ e2e timings.
import numbersJson from '../../../../Validation/numbers.json';
import benchJson from '../../../../Research/bench/results/latest/summary.json';
import timingsJson from '../../../../qa/screens/timings.json';
import v1Figure from '../../../../Validation/v1_shielding/v1_predicted_vs_measured.png';
import v2Figure from '../../../../Validation/v2_metabolic/v2_model_vs_data.png';

/* Loose views of the committed JSON, so a regenerated file with extra/missing keys never breaks the build. */
type Num = number | undefined;
interface V1Site { site: string; measured_drop_pct?: number; predicted_two_term_pct?: number }
const V1 = (numbersJson as { v1?: Record<string, unknown> }).v1 ?? {};
const V2 = (numbersJson as { v2?: Record<string, unknown> }).v2 ?? {};
const v1Sites = ((V1.sites as V1Site[] | undefined) ?? []).filter((s) => s.site !== 'Murray Buttes' && s.measured_drop_pct !== undefined);
const v1Mb = V1.murray_buttes as { measured_pct?: number; predicted_pct?: number } | undefined;
const v1Rmse = V1.rmse_dose_pp_detail as Record<string, number> | undefined;
interface BenchRow { planner: string; costModel: string; star?: boolean; static: { meanGapPct: number; msP50: number; violations: number; n: number }; hazard: { violations: number; n: number } }
const BENCH = benchJson as { meta: { site: string; scenarios: number; createdUtc: string }; summary: BenchRow[] };
const T = timingsJson as Record<string, number | string | undefined>;

/** Curiosity's daily uplink volume used as the route-package yardstick (design doc §13 V3). */
const CURIOSITY_UPLINK_B = 28_000;

const f = (v: Num, d = 1) => (v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d));

function Big({ value, unit, label, sub, tone = 'ink' }: { value: ReactNode; unit?: string; label: string; sub?: ReactNode; tone?: 'ink' | 'cyan' | 'amber' }) {
  return (
    <div className="min-w-0">
      <div className={cx('num text-[26px] leading-none', tone === 'cyan' ? 'text-cyan' : tone === 'amber' ? 'text-amber' : 'text-ink')}>
        {value}
        {unit && <span className="ml-1 text-[12px] text-mute">{unit}</span>}
      </div>
      <div className="mt-1.5 text-[11px] leading-snug text-ink-2">{label}</div>
      {sub && <div className="mt-0.5 text-[10.5px] leading-snug text-dim">{sub}</div>}
    </div>
  );
}

function Card({ id, tag, title, verb, children, className, source }: { id: string; tag: string; title: string; verb: string; children: ReactNode; className?: string; source: ReactNode }) {
  return (
    <section data-testid={`evidence-${id}`} className={cx('flex min-w-0 flex-col rounded-[4px] border border-line bg-panel p-4', className)}>
      <div className="flex items-center gap-2">
        <span className="num rounded-[2px] border border-amber/50 bg-amber/10 px-1.5 text-[10.5px] text-amber">{tag}</span>
        <span className="font-display text-[12px] uppercase tracking-[0.14em] text-ink">{title}</span>
        <span className="ml-auto font-display text-[9.5px] uppercase tracking-[0.14em] text-cyan">{verb}</span>
      </div>
      <div className="mt-3 flex min-h-0 flex-1 flex-col">{children}</div>
      <div className="mt-3 border-t border-line/70 pt-2 text-[10px] leading-snug text-dim">{source}</div>
    </section>
  );
}

/** Matplotlib figures are white; show them as a paper plate rather than fighting the dark theme. */
function Plate({ src, alt, caption }: { src: string; alt: string; caption: string }) {
  return (
    <figure className="m-0">
      <a href={src} target="_blank" rel="noreferrer" title="Open full size" className="block overflow-hidden rounded-[3px] bg-white p-1.5 ring-1 ring-line transition-shadow hover:ring-amber/60">
        <img src={src} alt={alt} className="block h-auto w-full" />
      </a>
      <figcaption className="mt-1.5 text-[10px] leading-snug text-dim">{caption}</figcaption>
    </figure>
  );
}

function V1Card() {
  return (
    <Card
      id="v1"
      tag="V1"
      title="Terrain shielding · Curiosity RAD"
      verb="Reproduces"
      source={
        <>
          Guo et al. 2026, JGR Planets, doi:10.1029/2026JE009704 (Table 1) · USGS Gale 1 m DEM at MSL waypoint positions · Validation/v1_shielding. The sky-ratio
          definition was chosen after the fact from 3 readings. 8 events, one rover, one GCR model: indicative only.
        </>
      }
    >
      <div className="grid grid-cols-[250px_1fr] gap-5">
        <div className="flex flex-col gap-4">
          <Big value={f(V1.mae_pp as Num)} unit="pp" tone="cyan" label="Obstructed-sky ratio, mean absolute error" sub={`r = ${f(V1.ros_pearson_r as Num, 2)} · n = ${f(V1.n_obstructed_sky_comparisons as Num, 0)} periods`} />
          <Big value={f(V1.rmse_dose_pp as Num)} unit="pp" label="RAD dose drop, RMSE" sub={`n = ${v1Sites.length} parkings · ${f(v1Rmse?.two_term_paperROS)} pp with the paper's sky ratios · no-shielding null ${f(v1Rmse?.null_zero)} pp`} />
          {v1Mb && <div className="text-[10.5px] leading-snug text-mute">Held out: Murray Buttes, predicted {f(v1Mb.predicted_pct)} % vs measured {f(v1Mb.measured_pct)} %.</div>}
        </div>
        <Plate src={v1Figure} alt="V1: obstructed-sky ratio and dose drop, predicted vs measured" caption="Left: our DEM sky ratios vs Guo et al. 2026 Table 1. Centre: predicted vs measured RAD dose drop. Right: model error alone (paper's sky ratios as input)." />
      </div>
    </Card>
  );
}

function V2Card() {
  return (
    <Card
      id="v2"
      tag="V2"
      title="Suited metabolic rate"
      verb="Calibrated"
      source={<>Pandolf–Santee × gravity ratio vs NASA IST-2 Mark III suited data (Norcross et al. 2010, NASA/TP-2010-216125, Fig. 36, digitized; 6 astronauts) · Validation/v2_metabolic</>}
    >
      <div className="grid grid-cols-2 gap-4">
        <Big value={f(V2.mape_pct_0_22_to_0_32g as Num)} unit="%" tone="cyan" label="MAPE at 0.22–0.32 g" sub={`${f(V2.mape_pct_0_12_to_0_17g as Num, 0)} % at 0.12–0.17 g · ${f(V2.conditions as Num, 0)} conditions`} />
        <Big value="0.38" unit="g" tone="amber" label="Mars: extrapolated" sub="beyond the 0.32 g maximum; no suited data" />
      </div>
      <div className="mt-3">
        <Plate src={v2Figure} alt="V2: model vs NASA IST-2 suited metabolic data" caption="Solid: NASA IST-2 data. Dashed: our model. The model underpredicts at low gravity, where measured cost has a floor." />
      </div>
    </Card>
  );
}

function V7Card() {
  const rows = BENCH.summary;
  const unsafe = rows.filter((r) => r.costModel !== 'pandolf-santee-mars').map((r) => r.static.violations + r.hazard.violations);
  const astar = rows.find((r) => r.planner === 'astar' && r.costModel === 'pandolf-santee-mars');
  return (
    <Card
      id="v7"
      tag="V7"
      title="Planner benchmark"
      verb="Measured"
      source={<>Research/bench on {BENCH.meta.site}: {BENCH.meta.scenarios} static + {BENCH.meta.scenarios} hidden-hazard scenarios, judged by one cost model against an independent Dijkstra oracle. Unsafe step = a 5 m path step on a blocked cell or slope &gt; 20°.</>}
    >
      <div className="grid grid-cols-2 gap-4">
        <Big value={astar ? f(astar.static.meanGapPct, 3) : '—'} unit="%" tone="cyan" label="A* optimality gap" sub={astar ? `${astar.static.violations + astar.hazard.violations} unsafe steps · p50 ${f(astar.static.msP50, 0)} ms` : undefined} />
        <Big value={unsafe.length ? `${Math.min(...unsafe)}–${Math.max(...unsafe)}` : '—'} tone="amber" label="Unsafe steps, slope-only model" sub="the naive cost model plans through rules our planners never break" />
      </div>
      <table className="mt-3 w-full border-collapse text-left">
        <thead>
          <tr className="label !text-[9px]">
            <th className="pb-1 font-normal">Planner</th>
            <th className="pb-1 font-normal">Cost model</th>
            <th className="pb-1 text-right font-normal">Gap %</th>
            <th className="pb-1 text-right font-normal">p50 ms</th>
            <th className="pb-1 text-right font-normal">Unsafe</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const v = r.static.violations + r.hazard.violations;
            return (
              <tr key={`${r.planner}-${r.costModel}`} className="border-t border-line/60 text-[11px]">
                <td className="py-1 text-ink-2">{r.planner}{r.star ? <span className="ml-1 text-amber">★</span> : null}</td>
                <td className="py-1 text-mute">{r.costModel === 'ref-slope' ? 'slope only' : r.costModel}</td>
                <td className="num py-1 text-right text-ink-2">{f(r.static.meanGapPct, 2)}</td>
                <td className="num py-1 text-right text-ink-2">{f(r.static.msP50, 0)}</td>
                <td className={cx('num py-1 text-right', v ? 'text-red' : 'text-cyan')}>{v}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-1.5 text-[10px] leading-snug text-dim">A negative gap means cheaper than the safe optimum only by stepping on unsafe cells.</div>
    </Card>
  );
}

function Meter({ label, value, max, text, sub, tone = 'cyan' }: { label: string; value: number; max: number; text: string; sub?: string; tone?: 'cyan' | 'amber' }) {
  const frac = Math.max(0.02, Math.min(1, value / max));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] text-ink-2">{label}</span>
        <span className="num text-[12px] text-ink">{text}</span>
      </div>
      <div className="mt-1 h-[5px] overflow-hidden rounded-[1px] bg-sunk ring-1 ring-line">
        <div className={cx('h-full', tone === 'amber' ? 'bg-amber' : 'bg-cyan')} style={{ width: `${frac * 100}%` }} />
      </div>
      {sub && <div className="mt-0.5 text-[10px] text-dim">{sub}</div>}
    </div>
  );
}

function LiveCard() {
  const n = (k: string) => (typeof T[k] === 'number' ? (T[k] as number) : undefined);
  const bytes = n('packageBytes');
  const run = typeof T.runUtc === 'string' ? T.runUtc.slice(0, 16).replace('T', ' ') + ' UTC' : 'not yet run';
  return (
    <Card
      id="live"
      tag="V3 · V5"
      title="Live system"
      verb="Measured"
      source={<>Playwright end-to-end run on gale-v1 with the real engine (qa/e2e/demo-flow.spec.ts) · {run} · qa/screens/timings.json</>}
    >
      <div className="flex flex-col gap-3.5">
        {bytes !== undefined && (
          <Meter label="Signed route package" value={bytes} max={CURIOSITY_UPLINK_B} text={`${(bytes / 1000).toFixed(1)} KB of 28 KB`} sub="vs Curiosity's daily uplink; Ed25519-signed, CBOR + deflate" />
        )}
        {n('sepReplanWallMs') !== undefined && (
          <Meter label="SEP nowcast → new route on the console" value={n('sepReplanWallMs')!} max={1000} text={`${n('sepReplanWallMs')} ms`} sub={`target < 1 s · engine solve ${n('sepReplanSolveMs') ?? '—'} ms`} />
        )}
        {n('dropToAutonomousMs') !== undefined && (
          <Meter label="Link drop → visor AUTONOMOUS" value={n('dropToAutonomousMs')!} max={4500} text={`${(n('dropToAutonomousMs')! / 1000).toFixed(1)} s`} sub="3 missed 1 Hz heartbeats, then onboard guidance" tone="amber" />
        )}
        <div className="grid grid-cols-3 gap-3 border-t border-line/60 pt-3">
          <Big value={n('confirmToAckMs') !== undefined ? (n('confirmToAckMs')! / 1000).toFixed(1) : '—'} unit="s" label="Confirm → ACK" />
          <Big value={n('restoreToResyncMs') !== undefined ? (n('restoreToResyncMs')! / 1000).toFixed(1) : '—'} unit="s" label="Link back → resync" />
          <Big value={n('visorRestoreMs') ?? '—'} unit="ms" label="Visor crash restore" />
        </div>
      </div>
    </Card>
  );
}

/** Validity: what we reproduce, calibrate and measure, and what we assume. Key E. */
export function EvidencePanel() {
  const mode = useConsole((s) => s.evidence);
  const limRef = useRef<HTMLDivElement>(null);
  const open = mode !== 'closed';
  useEffect(() => {
    if (mode === 'limitations') setTimeout(() => limRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 180);
  }, [mode]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="evidence"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-6 backdrop-blur-[2px]"
          onClick={() => set({ evidence: 'closed' })}
        >
          <motion.div
            role="dialog"
            aria-label="Evidence"
            data-testid="evidence-panel"
            initial={{ y: 12, scale: 0.99 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 12, scale: 0.99 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="flex max-h-full w-[min(1280px,100%)] flex-col overflow-hidden rounded-[5px] border border-line-2 bg-bg shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex shrink-0 items-center gap-4 border-b border-line bg-panel px-5 py-3">
              <div>
                <div className="font-display text-[15px] font-bold uppercase tracking-[0.2em] text-ink">Evidence</div>
                <div className="mt-0.5 text-[11px] text-mute">What we reproduce, calibrate and measure, and what we assume. Every number below is read from a committed result file.</div>
              </div>
              <div className="ml-auto flex items-center gap-3">
                <span className="hidden text-[10.5px] text-dim xl:inline">A research prototype: these checks reproduce and calibrate; they do not qualify it for flight.</span>
                <button onClick={() => set({ evidence: 'closed' })} className="flex h-7 items-center gap-1.5 rounded-[3px] border border-line-2 px-2 text-[11px] text-mute hover:text-ink" aria-label="Close evidence">
                  <Kbd>Esc</Kbd> Close
                </button>
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="grid grid-cols-1 gap-4">
                <V1Card />
                <div className="grid grid-cols-3 gap-4">
                  <V2Card />
                  <V7Card />
                  <LiveCard />
                </div>
                <div ref={limRef} className="scroll-mt-4">
                  <section data-testid="evidence-limitations" className="rounded-[4px] border border-ochre/40 bg-panel p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-display text-[12px] uppercase tracking-[0.14em] text-ochre">Limitations &amp; assumptions</span>
                      <span className="ml-auto"><EvidenceLegend compact /></span>
                    </div>
                    <div className="mt-3.5">
                      <LimitationsList columns={2} />
                    </div>
                  </section>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
