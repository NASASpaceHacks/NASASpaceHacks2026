import { parentPort, workerData } from 'node:worker_threads';
import type { LoadedSitePack, PlanRequest } from '@mw/shared/contracts';
import { loadEngine } from '../engine';
import { runPlanJob } from './job';

/**
 * Planning worker: keeps engine `plan()` (sync, up to ~1.5 s on 1M cells) off the hab server's
 * event loop so heartbeats stay on time. The site pack arrives once via workerData.
 */
const pack = workerData.pack as LoadedSitePack;
const forceFallback = !!workerData.forceFallback;

const port = parentPort!;
const { caps } = await loadEngine();
port.postMessage({ type: 'ready', caps });

port.on('message', async (m: { id: number; req: PlanRequest; reqKey: string }) => {
  try {
    const out = await runPlanJob(pack, m.req, m.reqKey, forceFallback);
    const f = out.fields;
    const buffers = new Set<ArrayBuffer>();
    for (const a of [f.walkbackMin, f.shelterMin, f.outboundMin, f.los, f.blocked]) {
      if (a?.buffer instanceof ArrayBuffer) buffers.add(a.buffer);
    }
    port.postMessage({ type: 'result', id: m.id, ok: true, out }, [...buffers]);
  } catch (e) {
    port.postMessage({ type: 'result', id: m.id, ok: false, error: (e as Error).message });
  }
});
