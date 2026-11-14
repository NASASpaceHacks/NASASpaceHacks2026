import { Worker } from 'node:worker_threads';
import type { LoadedSitePack, PlanRequest } from '@mw/shared/contracts';
import { loadEngine, type EngineHandle } from '../engine';
import { fallbackPlan, runPlanJob, type PlanJobResult } from './job';

interface Pending {
  resolve: (r: PlanJobResult) => void;
  timer: ReturnType<typeof setTimeout>;
  reqKey: string;
}

export interface PlannerOptions {
  useWorker: boolean;
  /** A job slower than this is answered with the golden fixture and the worker is recycled. */
  timeoutMs: number;
  /** Never call the engine (deterministic tests). */
  forceFallback?: boolean;
  log: (s: string) => void;
}

/**
 * Single planning worker (worker_threads). Jobs run in order; results (FieldSet buffers) come back
 * as transferables. If the worker cannot start, planning runs inline (blocking) instead.
 */
export class Planner {
  mode: 'worker' | 'inline' = 'inline';
  caps: EngineHandle['caps'] = { plan: false, computeFields: false, toPlanPackage: false, encodePackage: false };
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private closing = false;
  private respawning: Promise<void> | null = null;

  constructor(private pack: LoadedSitePack, private opts: PlannerOptions) {}

  async start(): Promise<void> {
    if (this.opts.useWorker) {
      try {
        await this.spawn();
        this.mode = 'worker';
        return;
      } catch (e) {
        this.opts.log(`planner worker failed to start (${(e as Error).message}); planning inline`);
      }
    }
    this.mode = 'inline';
    this.caps = (await loadEngine()).caps;
  }

  private spawn(): Promise<void> {
    return new Promise((resolve, reject) => {
      const w = new Worker(new URL('./boot.mjs', import.meta.url), { workerData: { pack: this.pack, forceFallback: !!this.opts.forceFallback } });
      const t = setTimeout(() => {
        reject(new Error('worker start timeout'));
        void w.terminate();
      }, 60_000);
      w.on('message', (m: { type: string; caps?: EngineHandle['caps']; id?: number; ok?: boolean; out?: PlanJobResult; error?: string }) => {
        if (m.type === 'ready') {
          clearTimeout(t);
          this.caps = m.caps!;
          this.worker = w;
          resolve();
        } else if (m.type === 'result') {
          const p = this.pending.get(m.id!);
          if (!p) return;
          clearTimeout(p.timer);
          this.pending.delete(m.id!);
          p.resolve(m.ok ? m.out! : fallbackPlan(this.pack, p.reqKey, `planner worker error: ${m.error}`));
        }
      });
      w.on('error', (e: Error) => {
        clearTimeout(t);
        this.opts.log(`planner worker error: ${e.message}`);
        reject(e);
      });
      w.on('exit', () => {
        if (this.worker !== w) return;
        this.worker = null;
        for (const [id, p] of this.pending) {
          clearTimeout(p.timer);
          p.resolve(fallbackPlan(this.pack, p.reqKey, 'planner worker exited'));
          this.pending.delete(id);
        }
        if (!this.closing) this.respawn();
      });
    });
  }

  private respawn(): void {
    this.respawning ??= this.spawn()
      .catch((e) => this.opts.log(`planner worker respawn failed: ${(e as Error).message}`))
      .finally(() => (this.respawning = null));
  }

  async plan(req: PlanRequest, reqKey: string): Promise<PlanJobResult> {
    if (this.mode === 'worker' && !this.worker && this.respawning) await this.respawning;
    const w = this.worker;
    if (this.mode === 'inline' || !w) return runPlanJob(this.pack, req, reqKey, this.opts.forceFallback);
    return new Promise((resolve) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(fallbackPlan(this.pack, reqKey, `engine timeout after ${this.opts.timeoutMs} ms`));
        void w.terminate(); // exit handler respawns
      }, this.opts.timeoutMs);
      this.pending.set(id, { resolve, timer, reqKey });
      w.postMessage({ id, req, reqKey });
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    const w = this.worker;
    this.worker = null;
    if (w) await w.terminate();
  }
}
