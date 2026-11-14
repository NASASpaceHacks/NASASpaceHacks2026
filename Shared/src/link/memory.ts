import { mulberry32 } from '../contracts/sitepack';
import { LinkCore, NOMINAL_CONDITIONS, type Link, type LinkConditions, type LinkTiming } from './core';

export interface MemoryLink extends Link {
  /** Change latency / loss / drop for BOTH directions of the pair (demo degradation controls). */
  setConditions(c: Partial<LinkConditions>): void;
  conditions(): LinkConditions;
  /** Messages waiting in this endpoint's store-and-forward queue. */
  queued(): number;
}

export type MemoryLinkPair = [MemoryLink, MemoryLink] & {
  setConditions(c: Partial<LinkConditions>): void;
  conditions(): LinkConditions;
};

export interface MemoryLinkOptions extends Partial<LinkConditions> {
  /** Seed for the loss PRNG (deterministic tests). Default: Math.random. */
  seed?: number;
  timing?: Partial<LinkTiming>;
  maxQueue?: number;
}

/**
 * Two in-process link endpoints wired back-to-back: [hab side, visor side].
 * Used by the static public demo build (engine in a Web Worker, no server) and by tests.
 * Every frame goes through the real CBOR codec, then latency (setTimeout), random loss, and
 * drop (radio silence: nothing delivered either way, so both sides go 'down' after 3 s).
 */
export function createMemoryLinkPair(opts: MemoryLinkOptions = {}): MemoryLinkPair {
  let cond: LinkConditions = {
    latencyMs: opts.latencyMs ?? NOMINAL_CONDITIONS.latencyMs,
    lossPct: opts.lossPct ?? NOMINAL_CONDITIONS.lossPct,
    drop: opts.drop ?? NOMINAL_CONDITIONS.drop,
  };
  const rnd = opts.seed === undefined ? Math.random : mulberry32(opts.seed);
  const cores: LinkCore[] = [];
  const pending = new Set<ReturnType<typeof setTimeout>>();

  const deliver = (toIdx: number, bytes: Uint8Array) => {
    if (cond.drop) return; // transmitted into the void
    if (cond.lossPct > 0 && rnd() * 100 < cond.lossPct) return;
    const copy = bytes.slice();
    const h = setTimeout(() => {
      pending.delete(h);
      const dst = cores[toIdx];
      if (dst && !dst.isClosed()) dst.receive(copy);
    }, Math.max(0, cond.latencyMs));
    pending.add(h);
  };

  const setConditions = (c: Partial<LinkConditions>) => {
    cond = {
      latencyMs: Math.max(0, c.latencyMs ?? cond.latencyMs),
      lossPct: Math.min(100, Math.max(0, c.lossPct ?? cond.lossPct)),
      drop: c.drop ?? cond.drop,
    };
  };
  const conditions = () => ({ ...cond });

  const make = (idx: 0 | 1): MemoryLink => {
    const core = new LinkCore(
      { send: (bytes) => (cores[idx].isClosed() ? false : (deliver(1 - idx, bytes), true)) },
      {
        from: idx === 0 ? 'hab' : 'visor',
        timing: opts.timing,
        maxQueue: opts.maxQueue,
        onClose() {
          if (cores.every((c) => c.isClosed() || c === core)) {
            for (const h of pending) clearTimeout(h);
            pending.clear();
          }
        },
      },
    );
    cores[idx] = core;
    return Object.assign(core, { setConditions, conditions }) as unknown as MemoryLink;
  };

  const a = make(0);
  const b = make(1);
  cores[0].setOpen(true);
  cores[1].setOpen(true);
  return Object.assign([a, b] as [MemoryLink, MemoryLink], { setConditions, conditions });
}
