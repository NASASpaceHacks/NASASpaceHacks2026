// Habitat <-> suit link. In the MVP both views run in one browser, so a BroadcastChannel stands in for the
// local surface network and localStorage for each node's persisted copy. Nothing goes through Earth: the
// crew must keep working when the Earth link is delayed (4-24 min one way) or blacked out.
import type { CrewPin, Mission, Telemetry } from './types';

export type LinkMsg =
  | { type: 'deploy'; mission: Mission }
  | { type: 'ack'; missionId: string; version: number; t: number }
  | { type: 'telemetry'; tel: Telemetry }
  | { type: 'pin'; pin: CrewPin }
  | { type: 'alert'; text: string; sev: 'caution' | 'warning'; t: number }
  | { type: 'note'; text: string; t: number }
  | { type: 'abort'; reason: string; t: number };

const KEY = { mission: 'eva.mission', tel: 'eva.telemetry', pins: 'eva.pins', notes: 'eva.notes' };

function read<T>(k: string, fallback: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(k: string, v: unknown) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked: link still works live */ }
}

export class Link {
  private ch: BroadcastChannel | null = null;
  private subs = new Set<(m: LinkMsg) => void>();

  constructor() {
    try {
      this.ch = new BroadcastChannel('mars-eva-link');
      this.ch.onmessage = (e) => this.subs.forEach((f) => f(e.data as LinkMsg));
    } catch { this.ch = null; }
  }

  on(f: (m: LinkMsg) => void) {
    this.subs.add(f);
    return () => { this.subs.delete(f); };
  }

  send(m: LinkMsg) {
    if (m.type === 'deploy') write(KEY.mission, m.mission);
    if (m.type === 'telemetry') write(KEY.tel, m.tel);
    if (m.type === 'pin') write(KEY.pins, [...this.pins(), m.pin]);
    this.ch?.postMessage(m);
  }

  mission(): Mission | null { return read<Mission | null>(KEY.mission, null); }
  telemetry(): Telemetry | null { return read<Telemetry | null>(KEY.tel, null); }
  pins(): CrewPin[] { return read<CrewPin[]>(KEY.pins, []); }
  clearPins() { write(KEY.pins, []); }
}

export const link = new Link();
