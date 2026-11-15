import { useCallback } from 'react';
import { useConsole } from '../store';
import { useBaseInfo } from './base';
import { dropReason } from './plain';

/**
 * Why a chosen destination can't be included, in ONE wording everywhere (Directions row, verdict box,
 * plan list, place card). When the browser-side attempt walk exists for that destination its numbers win;
 * otherwise the rule is stated in its own unit from the plan's drop record.
 */
export function useDestReason(): (id: string) => string | null {
  const plan = useConsole((s) => s.plan);
  const rules = useConsole((s) => s.rules);
  const pack = useConsole((s) => s.pack);
  const customs = useConsole((s) => s.customStops);
  const attemptPlan = useConsole((s) => s.attemptPlan);
  const attemptPin = useConsole((s) => s.attemptPin);
  const base = useBaseInfo();
  return useCallback(
    (id: string) => {
      if (!plan || !pack || !base) return null;
      const d = plan.dropped.find((x) => x.id === id);
      if (!d) return null;
      const at = [attemptPlan, attemptPin].find((a) => a?.destId === id && a.failure);
      if (at?.failure) return at.failure.reason;
      const st = [...pack.manifest.stations, ...customs].find((x) => x.id === id);
      return dropReason(d, rules, st ? { pack, baseCell: base.cell, stopCell: st.cell } : undefined);
    },
    [plan, pack, base, rules, customs, attemptPlan, attemptPin],
  );
}
