import { AnimatePresence, motion } from 'motion/react';
import { closeDetails, explainSafeZone, openDetails } from '../actions';
import { set, useConsole } from '../store';
import type { DetailsTab } from '../lib/types';
import { BurndownTab } from './BurndownTab';
import { EventLog, EventsSection, Requests } from './LiveParts';
import { RulesSection, SciencePanel } from './PlanParts';
import { ReportTab } from './ReportTab';
import { SourcesSection } from './Layers';
import { SpaceWeatherPanel } from './SpaceWeather';
import { openEvidence } from './Evidence';
import { Kbd, SectionHead, cx } from './ui';

const TABS: { id: DetailsTab; label: string }[] = [
  { id: 'report', label: 'Report' },
  { id: 'rules', label: 'Rules' },
  { id: 'margins', label: 'Margins over time' },
  { id: 'weather', label: 'Space weather' },
  { id: 'science', label: 'Science' },
  { id: 'sources', label: 'Sources' },
  { id: 'log', label: 'Log' },
];

/** Expert depth on demand: everything the old console showed at once, one section at a time. */
export function Details() {
  const open = useConsole((s) => s.details.open);
  const tab = useConsole((s) => s.details.tab);
  const mode = useConsole((s) => s.mode);
  const sourceReason = useConsole((s) => s.sourceReason);
  const hasZone = useConsole((s) => !!s.zone);
  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="details"
          role="dialog"
          aria-label="Details"
          data-testid="details"
          initial={{ x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 40, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="absolute inset-y-0 right-0 z-50 flex w-[min(560px,100%)] flex-col bg-panel shadow-[-24px_0_60px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.05]"
        >
          <header className="shrink-0 px-5 pt-4">
            <div className="flex items-center gap-3">
              <div>
                <div className="font-display text-[17px] font-semibold uppercase tracking-[0.14em] text-ink">Details</div>
                <div className="text-[11.5px] text-mute">Rules, margins, sources and evidence behind the plan.</div>
              </div>
              <button onClick={closeDetails} className="ml-auto flex h-9 items-center gap-1.5 rounded-[6px] px-3 text-[12px] text-mute hover:bg-raised hover:text-ink" aria-label="Close details">
                Close <Kbd>Esc</Kbd>
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button data-testid="open-evidence" onClick={() => openEvidence('open')} className="flex h-9 items-center gap-2 rounded-[7px] bg-cyan/10 px-3 text-[12.5px] text-cyan hover:bg-cyan/18">
                Evidence: what we measure and assume <Kbd>E</Kbd>
              </button>
              <button onClick={() => { closeDetails(); void explainSafeZone(); }} disabled={!hasZone} className="flex h-9 items-center gap-2 rounded-[7px] bg-raised px-3 text-[12.5px] text-ink-2 hover:text-ink disabled:opacity-40">
                Why this area? <Kbd>S</Kbd>
              </button>
              <button onClick={() => set({ showHelp: true })} className="flex h-9 items-center gap-2 rounded-[7px] px-3 text-[12.5px] text-mute hover:bg-raised hover:text-ink">
                Keyboard <Kbd>?</Kbd>
              </button>
            </div>
            <nav className="mt-3 flex gap-1 overflow-x-auto pb-px" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  data-testid={`details-tab-${t.id}`}
                  onClick={() => openDetails(t.id)}
                  className={cx('relative h-9 shrink-0 whitespace-nowrap rounded-t-[6px] px-2.5 text-[12.5px] transition-colors', tab === t.id ? 'text-ink' : 'text-mute hover:text-ink-2')}
                >
                  {t.label}
                  {tab === t.id && <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-amber" />}
                </button>
              ))}
            </nav>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto border-t border-line">
            {tab === 'report' && <ReportTab />}
            {tab === 'rules' && <div className="px-4 pb-6 pt-4"><RulesSection /></div>}
            {tab === 'margins' && <BurndownTab />}
            {tab === 'weather' && <div className="px-4 pb-6 pt-4"><SectionHead right={<span className="text-[10px] text-dim">forecast · alert · nowcast</span>}>Space weather</SectionHead><div className="mt-3"><SpaceWeatherPanel /></div></div>}
            {tab === 'science' && <div className="px-4 pb-6 pt-4"><SectionHead>Science coverage</SectionHead><div className="mt-3"><SciencePanel /></div></div>}
            {tab === 'sources' && (
              <div className="px-4 pb-6 pt-4">
                <div className="mb-4 rounded-[6px] bg-sunk/70 px-3 py-2 text-[11.5px] text-mute">Data source: <span className="text-ink-2">{mode === 'mock' ? 'in-browser synthetic site (mock)' : 'hab server (live)'}</span>{sourceReason ? ` · ${sourceReason}` : ''}</div>
                <SourcesSection />
              </div>
            )}
            {tab === 'log' && (
              <div className="flex flex-col gap-6 px-4 pb-6 pt-4">
                <section><SectionHead>Requests from EV1</SectionHead><div className="mt-2.5"><Requests /></div></section>
                <section><SectionHead>Events this EVA</SectionHead><div className="mt-2.5"><EventsSection /></div></section>
                <section><SectionHead>Event log</SectionHead><div className="mt-2.5"><EventLog /></div></section>
              </div>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
