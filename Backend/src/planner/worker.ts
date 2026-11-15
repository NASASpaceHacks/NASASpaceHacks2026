import { parentPort, workerData } from 'node:worker_threads';
import type { LoadedSitePack, PlanRequest } from '@mw/shared/contracts';
import { loadEngine } from '../engine';
import { runPlanJob } from './job';

/**
 * Planning worker: keeps engine `plan()` (sync, up to ~1.5 s on 1M cells) off the hab server's
 * event loop so heartbeats stay on time. The site pack arrives once via workerData.
 */
const packs = new Map<string, LoadedSitePack>();
const first = workerData.pack as LoadedSitePack;
packs.set(first.manifest.id, first);
const forceFallback = !!workerData.forceFallback;

const port = parentPort!;
const { caps } = await loadEngine();
port.postMessage({ type: 'ready', caps });

port.on('message', async (m: { id: number; req: PlanRequest; reqKey: string; packId: string; pack?: LoadedSitePack }) => {
  try {
    if (m.pack) packs.set(m.packId, m.pack);
    const pack = packs.get(m.packId);
    if (!pack) throw new Error(`site pack ${m.packId} not loaded in worker`);
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
