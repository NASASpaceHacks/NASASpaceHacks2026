import { AnimatePresence, motion } from 'motion/react';
import type { VisorController } from '../core/visor';
import type { Snapshot } from '../state/store';

/** Demo / simulator controls (key D). Keys inside: SPACE run, −/+ speed, L link drop, S SEP alert, P push v+1, C clear, K crash. */
export function DemoPanel({ s, ctl }: { s: Snapshot; ctl: VisorController }) {
  const rows: { k: string; label: string; value?: string; on?: boolean; run: () => void; hide?: boolean }[] = [
    { k: 'SPACE', label: 'Simulator', value: s.sim.running ? 'RUNNING' : 'PAUSED', on: s.sim.running, run: ctl.toggleRun },
    { k: '− / +', label: 'Sim speed', value: `${s.sim.speed}×`, run: () => ctl.stepSpeed(1) },
    { k: 'L', label: 'Drop surface link (local)', value: s.localDrop ? 'DROPPED' : 'OFF', on: s.localDrop, run: ctl.toggleDrop },
    { k: 'S', label: s.mode === 'mock' ? 'Hab: SEP nowcast alert' : 'Hab: SEP nowcast event', run: ctl.simulateSep },
    { k: 'P', label: 'Hab: push route v+1', run: ctl.pushNextVersion, hide: s.mode !== 'mock' },
    { k: 'C', label: 'Clear alert / return latch', run: ctl.clearAlert },
    { k: 'K', label: 'Crash + warm restart', run: ctl.crash },
    { k: 'W', label: 'Wipe checkpoint (cold start)', run: ctl.wipe },
  ];
  return (
    <AnimatePresence>
      {s.demoOpen && (
        <motion.div
          key="demo"
          className="absolute"
          style={{ left: 1132, top: 104, width: 772, height: 896, background: '#000', border: '3px solid var(--c)', zIndex: 45 }}
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 40 }}
          transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <div className="flex items-center" style={{ height: 70, padding: '0 26px', borderBottom: '2px solid var(--c3)', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: 30, letterSpacing: '0.14em', color: 'var(--c)' }}>DEMO · SIM CONTROL</span>
            <span className="lbl" style={{ fontSize: 18, color: 'var(--c)' }}>
              [D] CLOSE
            </span>
          </div>
          <div className="flex flex-col" style={{ padding: '14px 26px', gap: 8 }}>
            {rows
              .filter((r) => !r.hide)
              .map((r) => (
                <button
                  key={r.k}
                  onClick={r.run}
                  className="flex items-center"
                  style={{ gap: 18, height: 70, background: 'transparent', border: '2px solid var(--c3)', padding: '0 16px', cursor: 'pointer', color: 'var(--c)', textAlign: 'left' }}
                >
                  <span className="keycap" style={{ minWidth: 110, height: 46, fontSize: 22 }}>
                    {r.k}
                  </span>
                  <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 25, color: 'var(--w)', flex: 1 }}>{r.label}</span>
                  {r.value && (
                    <span className="num" style={{ fontSize: 26, color: r.on ? 'var(--a)' : 'var(--c)' }}>
                      {r.value}
                    </span>
                  )}
                </button>
              ))}
          </div>
          <div className="num" style={{ position: 'absolute', left: 26, right: 26, bottom: 18, fontSize: 17, lineHeight: '26px', color: 'var(--g3)' }}>
            <div>
              SAFETY CORE {s.impl.safetyCore.toUpperCase()} · PKG BUILDER {s.impl.toPlanPackage.toUpperCase()} · SUN {s.impl.sun.toUpperCase()}
            </div>
            <div>
              LINK {s.impl.link.toUpperCase()} · MAP PROJ {s.impl.map.toUpperCase()} · {s.mode === 'mock' ? `HAB RX TELEM ${s.habRx}` : 'HAB SIM STATE VIA /API/SIM'}
            </div>
            <div>SITE {s.siteName.toUpperCase() || '—'}</div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
