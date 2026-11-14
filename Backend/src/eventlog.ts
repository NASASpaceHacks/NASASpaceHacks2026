import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EventLogEntry, EventLogType } from '@mw/shared/link';

/**
 * Append-only JSONL event log (Backend/var/events.jsonl). Each line is written synchronously so a
 * crash loses at most the line being written; a torn last line is skipped on replay.
 */
export class EventLog {
  private recent: EventLogEntry[] = [];
  private nextI = 0;

  constructor(readonly file: string, private keep = 500) {
    mkdirSync(dirname(file), { recursive: true });
  }

  /** Read every entry on disk (oldest first) and prime the in-memory tail. */
  replay(): EventLogEntry[] {
    if (!existsSync(this.file)) return [];
    const out: EventLogEntry[] = [];
    for (const line of readFileSync(this.file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as EventLogEntry;
        if (typeof e.i === 'number' && typeof e.type === 'string') out.push(e);
      } catch {
        /* torn write */
      }
    }
    this.nextI = out.length ? out[out.length - 1].i + 1 : 0;
    this.recent = out.slice(-this.keep);
    return out;
  }

  append(type: EventLogType, data: Record<string, unknown>): EventLogEntry {
    const e: EventLogEntry = { i: this.nextI++, ts: new Date().toISOString(), type, data };
    appendFileSync(this.file, JSON.stringify(e) + '\n');
    this.recent.push(e);
    if (this.recent.length > this.keep) this.recent.splice(0, this.recent.length - this.keep);
    return e;
  }

  /** Newest `n` entries (oldest first), excluding the given types; bulky payloads summarised. */
  tail(n: number, exclude: EventLogType[] = []): EventLogEntry[] {
    const out: EventLogEntry[] = [];
    for (let k = this.recent.length - 1; k >= 0 && out.length < n; k--) {
      const e = this.recent[k];
      if (!exclude.includes(e.type)) out.push(summarise(e));
    }
    return out.reverse();
  }
}

/** Strip large fields (full packages / requests) from tail entries served over HTTP. */
function summarise(e: EventLogEntry): EventLogEntry {
  const { pkg, req, ...rest } = e.data as { pkg?: { id: string; seq: number; parent?: string }; req?: unknown };
  if (!pkg && !req) return e;
  return { ...e, data: { ...rest, ...(pkg ? { id: pkg.id, seq: pkg.seq, parent: pkg.parent } : {}) } };
}
