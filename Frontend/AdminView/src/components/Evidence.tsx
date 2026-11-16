import type { Rule } from '@mw/shared/contracts';
import { set } from '../store';
import { Tip, cx } from './ui';

export type EvidenceClass = NonNullable<Rule['evidence']>;

/**
 * Evidence classes (scheme adopted from the team's research, Research/README.md): how much a number is
 * worth. Shown on every flight rule so a reviewer can see at a glance what is measured and what is ours.
 */
export const EVIDENCE: Record<EvidenceClass, { name: string; long: string; chip: string }> = {
  M: { name: 'Measured', long: 'Measured: flight or laboratory data.', chip: 'border-ok/70 bg-ok/15 text-ok' },
  A: { name: 'Analog', long: 'Analog or flight experience (Apollo, ISS, field analog campaigns).', chip: 'border-ok/40 text-ok/90' },
  D: { name: 'NASA requirement', long: 'NASA design requirement, or derived from NASA documents.', chip: 'border-ink-2/50 text-ink' },
  S: { name: 'Simulated', long: 'Simulated: model output, not measured.', chip: 'border-dashed border-mute/70 text-mute' },
  E: { name: 'Team assumption', long: 'Team engineering assumption: a design parameter we chose.', chip: 'border-mute/60 bg-mute/10 text-mute' },
};

export const EVIDENCE_ORDER: EvidenceClass[] = ['M', 'A', 'D', 'S', 'E'];

export function EvidenceChip({ cls, className }: { cls: EvidenceClass; className?: string }) {
  return (
    <span
      data-evidence={cls}
      aria-label={`Evidence: ${EVIDENCE[cls].name}`}
      className={cx('num inline-flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[2px] border text-[9.5px] font-semibold leading-none', EVIDENCE[cls].chip, className)}
    >
      {cls}
    </span>
  );
}

/** Rule evidence chip with the class and the rule's citation in the tooltip. */
export function RuleEvidence({ r }: { r: Rule }) {
  if (!r.evidence) return null;
  const e = EVIDENCE[r.evidence];
  return (
    <Tip
      side="left"
      width={330}
      content={
        <>
          <div className="flex items-center gap-2">
            <EvidenceChip cls={r.evidence} />
            <span className="text-ink">{e.name}</span>
          </div>
          <div className="mt-1 text-[11px] text-mute">{e.long}</div>
          <div className="mt-2 border-t border-line pt-2">{r.citation}</div>
        </>
      }
    >
      <span tabIndex={0} className="inline-flex cursor-help">
        <EvidenceChip cls={r.evidence} />
      </span>
    </Tip>
  );
}

export function EvidenceLegend({ compact = false }: { compact?: boolean }) {
  return (
    <div data-testid="evidence-legend" className={cx('flex flex-wrap items-center', compact ? 'gap-x-2.5 gap-y-1' : 'gap-x-4 gap-y-1.5')}>
      {EVIDENCE_ORDER.map((k) => (
        <span key={k} className="inline-flex items-center gap-1 text-[10px] text-mute" title={EVIDENCE[k].long}>
          <EvidenceChip cls={k} />
          {EVIDENCE[k].name}
        </span>
      ))}
    </div>
  );
}

/**
 * What this tool is not, and the assumptions a reviewer should know about. Every line is a
 * documented model choice (engine comments, Validation/*, Content/), stated plainly.
 */
export const LIMITATIONS: { title: string; body: string; cls?: EvidenceClass }[] = [
  { title: 'Not operational EVA guidance', body: 'A research prototype for planning studies and demonstration. No route or margin here should be used to fly a real EVA.' },
  { title: 'Metabolic model calibrated at 0.22–0.32 g', body: 'Pandolf–Santee × gravity ratio: MAPE 10.6 % against NASA IST-2 suited data at 0.22–0.32 g. Mars gravity (0.38 g) is an extrapolation beyond the 0.32 g maximum; there are no suited data there.', cls: 'M' },
  { title: 'Suit heat budget: 30 min window, 250 W rest', body: 'Rolling 30-minute average of metabolic heat against the suit budget. Rest power 250 W and station task power 250 W are team assumptions.', cls: 'E' },
  { title: 'Rover comm relay assumed', body: 'Comm line of sight is the union of the hab mast and a relay mast on the pressurized rover. The relay radio and the 3 m mast heights are team assumptions; only geometric line of sight is modelled, not an RF link budget.', cls: 'E' },
  { title: 'Thermal inertia and shielding are indicative', body: 'THEMIS thermal inertia (100 m/px) only nudges walking cost. The terrain-shielding model reproduces RAD trends at 8 parkings; it is not a dose forecast. Terrain is never treated as a shelter: shelters are the hab and the pressurized rover only.', cls: 'S' },
  { title: 'Station values are a team heuristic', body: 'Science value per station comes from a draft Science Traceability Matrix weighted by the team. It is transparent and editable, not a calibrated model.', cls: 'E' },
  { title: 'Unknown terrain is never treated as safe', body: 'Cells with missing elevation or slope are blocked, and any cell the engine cannot time back to shelter is outside the safe region (fail closed). Hazards the DEM cannot see are handled by replanning when the crew reports them.' },
];

export function LimitationsList({ columns = 1 }: { columns?: 1 | 2 }) {
  return (
    <ol data-testid="limitations" className={cx('grid gap-x-6 gap-y-3', columns === 2 ? 'grid-cols-2' : 'grid-cols-1')}>
      {LIMITATIONS.map((l, i) => (
        <li key={l.title} className="flex gap-2.5">
          <span className="num mt-[1px] text-[10.5px] text-dim">{String(i + 1).padStart(2, '0')}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
              {l.title}
              {l.cls && <EvidenceChip cls={l.cls} />}
            </div>
            <div className="mt-0.5 text-[11px] leading-snug text-mute">{l.body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export const openEvidence = (focus: 'open' | 'limitations' = 'open') => set({ evidence: focus });
