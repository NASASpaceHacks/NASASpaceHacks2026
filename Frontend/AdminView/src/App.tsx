import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { boot, closeDetails, closeSheet, dismissMapUi, explainSafeZone, generatePlan, getMap, openDetails, openSheet, primaryAction, setMode, shutdown, startHazardPick } from './actions';
import { get, set, useConsole } from './store';
import { TopBar, Mark } from './components/TopBar';
import { MapView } from './map/MapView';
import { Button, Kbd } from './components/ui';
import { EvidencePanel } from './components/EvidencePanel';
import { PlanPanel } from './components/PlanPanel';
import { LivePanel } from './components/LivePanel';
import { Timeline } from './components/Timeline';
import { SendSheet } from './components/SendSheet';
import { ActionSheet } from './components/ActionSheet';
import { AlertBanner } from './components/AlertBanner';
import { Details } from './components/Details';

const SHORTCUTS: [string, string][] = [
  ['⏎', 'Primary action: Review & send · Send to crew'],
  ['Esc', 'Close a sheet, menu or drawer'],
  ['D', 'Details: report, rules, margins, sources'],
  ['S', 'Why this area? (safe-area explanation)'],
  ['E', 'Evidence: what we measure and assume'],
  ['G', 'Re-plan now'],
  ['H', 'EVA live: hazard reported (click the map)'],
  ['Z', 'Zoom to the route'],
  ['F', 'Fit the whole site'],
];

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const s = get();
      if (!s.pack) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        if (s.showHelp) set({ showHelp: false });
        else if (s.evidence !== 'closed') set({ evidence: 'closed' });
        else if (dismissMapUi()) return;
        else if (s.layersOpen || s.simOpen) set({ layersOpen: false, simOpen: false });
        else if (s.sheet) closeSheet();
        else if (s.hazardPick) startHazardPick();
        else if (s.details.open) closeDetails();
        else if (s.uiMode === 'send' && s.confirm.stage !== 'pushing' && s.confirm.stage !== 'awaitingAck') setMode(s.route?.acked && s.route.reqHash === s.plan?.reqHash ? 'live' : 'plan');
        else if (s.explain.running) void explainSafeZone();
        return;
      }
      if (k === 'enter') {
        // Buttons keep their native Enter; elsewhere Enter runs the current mode's primary action.
        if (t && (t.tagName === 'BUTTON' || t.tagName === 'A')) return;
        if (s.evidence !== 'closed' || s.showHelp) return;
        e.preventDefault();
        primaryAction();
        return;
      }
      if (k === '?') return set({ showHelp: !s.showHelp });
      if (k === 'e') return set({ evidence: s.evidence === 'closed' ? 'open' : 'closed' });
      if (s.evidence !== 'closed') return; // the evidence dialog is modal
      if (k === 'd') return s.details.open ? closeDetails() : openDetails();
      if (k === 'g') return void generatePlan('Re-planned');
      if (k === 's') return void explainSafeZone();
      if (k === 'f') return getMap()?.fit();
      if (k === 'z') return getMap()?.fitRoute();
      if (k === 'h' && s.uiMode === 'live' && !s.sheet) return openSheet('hazard');
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
              <span className={i === steps.length - 1 && !err ? 'text-cyan mw-pulse' : 'text-ok'}>{i === steps.length - 1 && !err ? '›' : '✓'}</span>
              {s}
            </motion.div>
          ))}
        </div>
        {err && (
          <div className="mt-6 rounded-[6px] bg-red/[0.06] p-3 text-[12px] text-ink-2 ring-1 ring-red/40">
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
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70" onClick={() => set({ showHelp: false })}>
          <motion.div role="dialog" aria-label="Keyboard" initial={{ y: 10, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 10, scale: 0.98 }} className="w-[440px] rounded-[12px] bg-panel p-5 ring-1 ring-white/[0.06]" onClick={(e) => e.stopPropagation()}>
            <div className="eyebrow">Keyboard</div>
            <div className="mt-3 flex flex-col gap-2.5">
              {SHORTCUTS.map(([k, d]) => (
                <div key={k} className="flex items-center justify-between gap-4 text-[13px] text-ink-2">
                  <span>{d}</span>
                  <Kbd>{k}</Kbd>
                </div>
              ))}
            </div>
            <div className="mt-4 text-[11.5px] leading-relaxed text-dim">Drag the pressurized rover on the map to move where the walk starts; the plan and the safe area update immediately.</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function App() {
  const pack = useConsole((s) => s.pack);
  const uiMode = useConsole((s) => s.uiMode);
  useShortcuts();
  useEffect(() => {
    void boot();
    window.addEventListener('beforeunload', shutdown);
  }, []);
  useEffect(() => {
    // A mode change moves focus off the previous mode's button so Enter means the new primary action.
    const a = document.activeElement as HTMLElement | null;
    if (a && !a.dataset.autofocus) a.blur?.();
  }, [uiMode]);
  if (!pack) return <Boot />;
  return (
    <div className="grid h-full w-full min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      <TopBar />
      <div className="relative grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] min-[900px]:grid-cols-[minmax(0,1fr)_clamp(320px,28vw,420px)]">
        <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_clamp(96px,15vh,128px)]">
          <div className="relative min-h-0 min-w-0 overflow-hidden">
            <MapView />
            <AlertBanner />
            <ActionSheet />
          </div>
          <div className="min-h-0 overflow-hidden bg-panel">
            <Timeline />
          </div>
        </div>
        <aside className="absolute inset-x-0 bottom-0 z-40 h-[46%] min-h-0 min-w-0 overflow-hidden border-t border-line-2 bg-panel min-[900px]:static min-[900px]:z-auto min-[900px]:h-auto min-[900px]:border-t-0" data-testid="side-panel" data-mode={uiMode}>
          {uiMode === 'live' ? <LivePanel /> : <PlanPanel />}
        </aside>
        <SendSheet />
        <Details />
      </div>
      <Help />
      <EvidencePanel />
    </div>
  );
}
