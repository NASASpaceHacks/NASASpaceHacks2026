/**
 * Crash-safe checkpointing (simulated radiation upset → reload): the route package is written when it
 * changes, the small dynamic state on every simulator tick, the store-and-forward outbox when it changes.
 */
import type { LinkMsg, PlanPackage } from '@mw/shared/contracts';
import type { SimState } from './sim';

export interface DynState {
  v: 1;
  savedAt: number;
  siteId: string | null;
  sim: SimState | null;
  alert: { level: 'info' | 'caution' | 'warning'; code: string; text: string; t: number } | null;
  safetyLatched: boolean;
  mirror: boolean;
  lastResetSeen: unknown;
  localDrop: boolean;
}

export class Checkpoint {
  constructor(private prefix: string) {}
  private k(name: string) {
    return `${this.prefix}.${name}`;
  }
  private write(name: string, v: unknown) {
    try {
      if (v === null || v === undefined) localStorage.removeItem(this.k(name));
      else localStorage.setItem(this.k(name), JSON.stringify(v));
    } catch {
      /* quota / private mode: keep running without checkpoints */
    }
  }
  private read<T>(name: string): T | null {
    try {
      const s = localStorage.getItem(this.k(name));
      return s ? (JSON.parse(s) as T) : null;
    } catch {
      return null;
    }
  }
  savePkg(p: PlanPackage | null) { this.write('pkg', p); }
  savePending(p: PlanPackage | null) { this.write('pending', p); }
  saveDyn(d: DynState) { this.write('dyn', d); }
  saveOutbox(o: LinkMsg[]) { this.write('outbox', o); }
  load(): { pkg: PlanPackage | null; pending: PlanPackage | null; dyn: DynState | null; outbox: LinkMsg[] } {
    return {
      pkg: this.read<PlanPackage>('pkg'),
      pending: this.read<PlanPackage>('pending'),
      dyn: this.read<DynState>('dyn'),
      outbox: this.read<LinkMsg[]>('outbox') ?? [],
    };
  }
  clear() {
    for (const n of ['pkg', 'pending', 'dyn', 'outbox']) {
      try {
        localStorage.removeItem(this.k(n));
      } catch {
        /* ignore */
      }
    }
  }
}
