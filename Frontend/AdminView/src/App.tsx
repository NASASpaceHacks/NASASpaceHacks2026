import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { applyPreset, boot, confirmPush, explainSafeZone, generatePlan, getMap, review, setTab, shutdown, startHazardPick } from './actions';
import { get, set, useConsole } from './store';
import { TopBar, Mark } from './components/TopBar';
import { LeftRail } from './components/LeftRail';
import { RightPanel } from './components/RightPanel';
import { MapView } from './map/MapView';
import { Button, Kbd } from './components/ui';

const SHORTCUTS: [string, string][] = [
  ['G', 'Generate plan'],
  ['S', 'Explain safe zone'],
  ['C', 'Review → confirm & push'],
  ['1–4', 'Layer presets: Plan · Safety · Science · Comms'],
  ['P R B L', 'Tabs: Plan · Report · Burndowns · Live'],
  ['H', 'Report hazard (click map)'],
  ['F', 'Fit map to AOI'],
  ['Esc', 'Cancel / close'],
];

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const s = get();
      if (!s.pack) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        if (s.showHelp) set({ showHelp: false });
        else if (s.hazardPick) startHazardPick();
        else if (s.explain.running) void explainSafeZone();
        else if (s.confirm.stage === 'review') set({ confirm: { stage: 'idle' } });
        return;
      }
      if (k === '?') return set({ showHelp: !s.showHelp });
      if (k === 'g') return void generatePlan();
      if (k === 's') return void explainSafeZone();
      if (k === 'f') return getMap()?.fit();
      if (k === 'h') return startHazardPick();
      if (k === 'c') return s.confirm.stage === 'review' ? void confirmPush() : review();
      if (['1', '2', '3', '4'].includes(k)) return applyPreset((['plan', 'safety', 'science', 'comms'] as const)[Number(k) - 1]);
      const tabs: Record<string, 'plan' | 'report' | 'burndown' | 'live'> = { p: 'plan', r: 'report', b: 'burndown', l: 'live' };
      if (tabs[k]) setTab(tabs[k]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function Boot() {
  const steps = useConsole((s) => s.bootSteps);
  const err = useConsole((s) => s.bootError);
  return (
    <div className="flex h-full items-center justify-center bg-bg">
      <div className="w-[420px]">
        <div className="flex items-center gap-3">
          <Mark size={30} />
          <div>
            <div className="font-display text-[20px] font-bold tracking-[0.26em] text-ink">MARSWALK</div>
            <div className="label !text-[9px] !tracking-[0.3em]">Habitat console</div>
          </div>
        </div>
        <div className="mt-8 flex flex-col gap-1.5">
          {steps.map((s, i) => (
            <motion.div key={i} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} className="num flex items-center gap-2 text-[11.5px] text-mute">
              <span className={i === steps.length - 1 && !err ? 'text-amber mw-pulse' : 'text-cyan'}>{i === steps.length - 1 && !err ? '›' : '✓'}</span>
              {s}
            </motion.div>
          ))}
        </div>
        {err && (
          <div className="mt-6 rounded-[3px] border border-red/50 bg-red/5 p-3 text-[12px] text-ink-2">
            <div className="font-display uppercase tracking-[0.12em] text-red">Site pack failed to load</div>
            <div className="num mt-1 text-[11px] text-mute">{err}</div>
            <div className="mt-3 flex gap-2">
              <Button onClick={() => location.reload()}>Retry</Button>
              <Button variant="ghost" onClick={() => (location.href = '?mock=1')}>Open with synthetic site</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Help() {
  const show = useConsole((s) => s.showHelp);
  return (
    <AnimatePresence>
      {show && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[2px]" onClick={() => set({ showHelp: false })}>
          <motion.div initial={{ y: 10, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 10, scale: 0.98 }} className="w-[420px] rounded-[4px] border border-line-2 bg-panel p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="rule-head label">Keyboard</div>
            <div className="mt-3 flex flex-col gap-2">
              {SHORTCUTS.map(([k, d]) => (
                <div key={k} className="flex items-center justify-between gap-4 text-[12px] text-ink-2">
                  <span>{d}</span>
                  <span className="flex gap-1">{k.split(' ').map((x) => <Kbd key={x}>{x}</Kbd>)}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 text-[11px] leading-relaxed text-dim">Drag the pressurized rover on the map to move the safe haven; the plan and safe region update immediately.</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function App() {
  const pack = useConsole((s) => s.pack);
  useShortcuts();
  useEffect(() => {
    void boot();
    window.addEventListener('beforeunload', shutdown);
  }, []);
  if (!pack) return <Boot />;
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <LeftRail />
        <MapView />
        <RightPanel />
      </div>
      <Help />
    </div>
  );
}
