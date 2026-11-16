import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { VisorController } from '../core/visor';
import { useVisor, type Snapshot } from '../state/store';
import { DemoPanel } from './DemoPanel';
import { MapView, MAP_H, MAP_W } from './MapView';
import { BootScreen, CompleteOverlay, MapLegend, NewRouteModal, ReturnNow, StationCard, Toasts, WaitingOverlay } from './Overlays';
import { Cluster, KeyLegend, TopBar, type KeyDef } from './Panels';
import { armAudio, sounds } from './sound';

const MapPane = memo(function MapPane({ ctl }: { ctl: VisorController }) {
  return <MapView ctl={ctl} />;
});

function useStageScale(): number {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const f = () => setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    f();
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return scale;
}

function useKeys(ctl: VisorController) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      armAudio();
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      const demo = useVisor.getState().snap.demoOpen;
      switch (k) {
        case 'a': void ctl.accept(); break;
        case 'n': ctl.next(); break;
        case 'h': ctl.request('HAZARD'); break;
        case 'r': ctl.request('NEW_TARGET'); break;
        case 'm': ctl.toggleMirror(); break;
        case 'd': ctl.toggleDemo(); break;
        default:
          if (!demo) return;
          if (k === ' ') ctl.toggleRun();
          else if (k === '+' || k === '=') ctl.stepSpeed(1);
          else if (k === '-' || k === '_') ctl.stepSpeed(-1);
          else if (k === 'l') ctl.toggleDrop();
          else if (k === 's') ctl.simulateSep();
          else if (k === 'p') ctl.pushNextVersion();
          else if (k === 'c') ctl.clearAlert();
          else if (k === 'k') ctl.crash();
          else if (k === 'w') ctl.wipe();
          else return;
      }
      e.preventDefault();
    };
    const arm = () => armAudio();
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', arm);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', arm);
    };
  }, [ctl]);
}

function useSounds(s: Snapshot) {
  const prev = useRef({ display: s.display, autonomous: s.autonomous, toast: 0 });
  useEffect(() => {
    const p = prev.current;
    if (s.display !== p.display) {
      if (s.display === 'NEW_ROUTE') sounds.newRoute();
      else if (s.display === 'RETURN_NOW') sounds.warning();
      else if (s.display === 'STATION') sounds.station();
    }
    if (s.autonomous && !p.autonomous) sounds.caution();
    const lastToast = s.toasts[s.toasts.length - 1];
    if (lastToast && lastToast.id !== p.toast && lastToast.level === 'ok') sounds.ok();
    prev.current = { display: s.display, autonomous: s.autonomous, toast: lastToast?.id ?? p.toast };
  }, [s.display, s.autonomous, s.toasts]);
}

export function App({ ctl }: { ctl: VisorController }) {
  const s = useVisor((st) => st.snap);
  const scale = useStageScale();
  useKeys(ctl);
  useSounds(s);
  const keys: KeyDef[] = [
    { k: 'A', label: 'ACCEPT ROUTE', enabled: !!s.pending, on: !!s.pending, run: () => void ctl.accept() },
    {
      k: 'N',
      label: s.station ? (s.station.tasksDone < s.station.tasks.length ? 'TICK TASK' : 'DEPART') : 'NEXT',
      enabled: !!s.station,
      run: ctl.next,
    },
    { k: 'H', label: 'HAZARD HERE', enabled: s.seq !== null, run: () => ctl.request('HAZARD') },
    { k: 'R', label: 'REQUEST REROUTE', enabled: s.seq !== null, run: () => ctl.request('NEW_TARGET') },
    { k: 'M', label: 'MIRROR', enabled: true, on: s.mirror, run: ctl.toggleMirror },
    { k: 'D', label: 'DEMO', enabled: true, on: s.demoOpen, run: ctl.toggleDemo },
  ];
  return (
    <div className="viewport">
      <div className="stage" style={{ transform: `translate(-50%, -50%) scale(${scale})${s.mirror ? ' scaleX(-1)' : ''}` }}>
        <TopBar s={s} />
        <div className="absolute" style={{ left: 16, top: 104, width: MAP_W, height: MAP_H, outline: s.autonomous ? '3px solid var(--k)' : '2px solid var(--line)', overflow: 'hidden' }}>
          <MapPane ctl={ctl} />
          <MapLegend s={s} />
          <WaitingOverlay s={s} />
          <CompleteOverlay s={s} />
          <StationCard s={s} />
        </div>
        <Cluster s={s} />
        <KeyLegend keys={keys} />
        <Toasts s={s} />
        <ReturnNow s={s} />
        <DemoPanel s={s} ctl={ctl} />
        <NewRouteModal s={s} />
        <BootScreen s={s} />
      </div>
    </div>
  );
}
