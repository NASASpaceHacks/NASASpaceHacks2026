import { AnimatePresence, motion } from 'motion/react';
import { setTab } from '../actions';
import { useConsole } from '../store';
import type { TabId } from '../lib/types';
import { BurndownTab } from './BurndownTab';
import { ConfirmBar } from './ConfirmBar';
import { LiveTab } from './LiveTab';
import { PlanTab } from './PlanTab';
import { ReportTab } from './ReportTab';
import { cx } from './ui';

const TABS: { id: TabId; label: string; key: string }[] = [
  { id: 'plan', label: 'Plan', key: 'P' },
  { id: 'report', label: 'Report', key: 'R' },
  { id: 'burndown', label: 'Burndowns', key: 'B' },
  { id: 'live', label: 'Live', key: 'L' },
];

export function RightPanel() {
  const tab = useConsole((s) => s.tab);
  const status = useConsole((s) => s.plan?.status);
  const openReqs = useConsole((s) => s.requests.filter((r) => !r.handled).length);
  const telemLive = useConsole((s) => s.telem.length > 0 && s.sim.running);
  return (
    <aside className="flex w-[404px] shrink-0 flex-col border-l border-line bg-panel">
      <nav className="flex h-10 shrink-0 items-stretch border-b border-line px-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            title={`${t.label} (${t.key})`}
            className={cx('relative flex flex-1 items-center justify-center gap-1.5 font-display text-[11px] uppercase tracking-[0.13em] transition-colors', tab === t.id ? 'text-ink' : 'text-mute hover:text-ink-2')}
          >
            {t.label}
            {t.id === 'report' && status && <span className={cx('h-1.5 w-1.5 rounded-full', status === 'OK' ? 'bg-cyan' : 'bg-red')} />}
            {t.id === 'live' && openReqs > 0 && <span className="num rounded-full bg-amber px-1 text-[9px] text-[#16110a]">{openReqs}</span>}
            {t.id === 'live' && !openReqs && telemLive && <span className="h-1.5 w-1.5 rounded-full bg-cyan mw-pulse" />}
            {tab === t.id && <motion.span layoutId="right-tab" className="absolute inset-x-3 bottom-0 h-[2px] bg-amber" />}
          </button>
        ))}
      </nav>
      <div className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={tab} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.14, ease: 'easeOut' }}>
            {tab === 'plan' && <PlanTab />}
            {tab === 'report' && <ReportTab />}
            {tab === 'burndown' && <BurndownTab />}
            {tab === 'live' && <LiveTab />}
          </motion.div>
        </AnimatePresence>
      </div>
      <ConfirmBar />
    </aside>
  );
}
