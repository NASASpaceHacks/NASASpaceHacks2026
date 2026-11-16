import { useEffect, useRef, useState } from 'react';

/** Rear camera into a <video>. Needs a secure origin (HTTPS or localhost). */
export function useCamera(enabled: boolean) {
  const ref = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'off' | 'starting' | 'on' | 'error'>('off');
  useEffect(() => {
    if (!enabled) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    setState('starting');
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('error');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        const v = ref.current;
        if (v) {
          v.srcObject = s;
          void v.play().catch(() => {});
        }
        setState('on');
      })
      .catch(() => !cancelled && setState('error'));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      setState('off');
    };
  }, [enabled]);
  return { ref, state };
}

type IOSOrientationEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };
type IOSOrientationCtor = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

/** iOS asks for motion permission; must be called from a tap handler. */
export async function requestCompassPermission(): Promise<boolean> {
  const C = (globalThis as { DeviceOrientationEvent?: IOSOrientationCtor }).DeviceOrientationEvent;
  if (!C) return false;
  if (typeof C.requestPermission !== 'function') return true;
  try {
    return (await C.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/** Device compass heading in degrees (0 = north, clockwise), smoothed; null until the first reading. */
export function useCompass(enabled: boolean): number | null {
  const [hdg, setHdg] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) {
      setHdg(null);
      return;
    }
    let cur: number | null = null;
    let raf = 0;
    let pending: number | null = null;
    const onEv = (e: Event) => {
      const ev = e as IOSOrientationEvent;
      let h: number | null = null;
      if (typeof ev.webkitCompassHeading === 'number') h = ev.webkitCompassHeading;
      else if (ev.absolute && ev.alpha !== null) h = 360 - ev.alpha;
      if (h === null) return;
      h += screen.orientation?.angle ?? 0;
      // Exponential smoothing on the circle.
      if (cur === null) cur = h;
      else cur += (((h - cur + 540) % 360) - 180) * 0.25;
      pending = ((cur % 360) + 360) % 360;
      if (!raf) raf = requestAnimationFrame(() => {
        raf = 0;
        setHdg(pending);
      });
    };
    const evName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    window.addEventListener(evName, onEv);
    return () => {
      window.removeEventListener(evName, onEv);
      cancelAnimationFrame(raf);
    };
  }, [enabled]);
  return hdg;
}

/** Keep the screen on while navigating (supported on iOS 16.4+). */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const get = () => navigator.wakeLock.request('screen').then((l) => (lock = l)).catch(() => {});
    void get();
    const onVis = () => document.visibilityState === 'visible' && void get();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      void lock?.release();
    };
  }, [enabled]);
}

// ─────────────────────────── voice commands ───────────────────────────

/** Minimal Web Speech API surface (Chrome: SpeechRecognition / webkitSpeechRecognition; iOS Safari 14.5+). */
interface SpeechRecLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecCtor = new () => SpeechRecLike;

function speechCtor(): SpeechRecCtor | null {
  const w = globalThis as { SpeechRecognition?: SpeechRecCtor; webkitSpeechRecognition?: SpeechRecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// ── fuzzy phrase matching ──
// Speech recognisers often mishear short commands ("accept route" → "except root", "a set route").
// A command fires when any recogniser alternative contains a run of words that sounds close to one of the
// command's phrases: exact alias hit, or a similarity ≥ threshold on a rough phonetic key.

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Rough sound-alike key: collapse letters English speech engines confuse (c/k/q/x, ph/f, vowels, doubles). */
function soundKey(s: string): string {
  return s
    .replace(/ph/g, 'f').replace(/ck|q|c(?=[aou])|k/g, 'k').replace(/c(?=[eiy])/g, 's').replace(/x/g, 'ks')
    .replace(/z/g, 's').replace(/dt|tt/g, 't').replace(/[aeiouy]+/g, 'a').replace(/(.)\1+/g, '$1').replace(/ /g, '');
}

function lev(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

const sim = (a: string, b: string) => 1 - lev(a, b) / Math.max(a.length, b.length, 1);

/** Best similarity (0–1) of `phrase` against any word window of `heard`. */
export function phraseScore(heard: string, phrase: string): number {
  const h = norm(heard), p = norm(phrase);
  if (!h || !p) return 0;
  if (` ${h} `.includes(` ${p} `)) return 1;
  const hw = h.split(' '), n = p.split(' ').length;
  const pk = soundKey(p);
  let best = 0;
  for (let len = Math.max(1, n - 1); len <= n + 1; len++) {
    for (let i = 0; i + len <= hw.length; i++) {
      const win = hw.slice(i, i + len).join(' ');
      best = Math.max(best, sim(win.replace(/ /g, ''), p.replace(/ /g, '')), sim(soundKey(win), pk));
    }
  }
  return best;
}

/** One-word phrases need a closer match ("don't" must not count as "done"). */
export const phraseThreshold = (phrase: string, base = 0.72) => (norm(phrase).includes(' ') ? base : Math.max(base, 0.86));

export interface VoiceCommand {
  /** Matched against the lower-cased transcript (interim results included, so it fires fast). */
  /** Phrases that trigger it: the one shown to the crew first, then common mishearings / short forms. */
  phrases: string[];
  /** Minimum similarity 0–1 (default 0.72). */
  threshold?: number;
  run: () => void;
}

export type VoiceState = 'off' | 'listening' | 'unsupported' | 'denied' | 'error';

/**
 * Hands-free commands: continuous speech recognition, restarted whenever the browser ends a session.
 * The active command list can change every render without restarting the recogniser.
 */
export function useVoiceCommands(enabled: boolean, commands: VoiceCommand[]): { state: VoiceState } {
  const cmds = useRef(commands);
  cmds.current = commands;
  const [state, setState] = useState<VoiceState>('off');
  useEffect(() => {
    if (!enabled) return;
    const Ctor = speechCtor();
    if (!Ctor) {
      setState('unsupported');
      return;
    }
    let alive = true;
    let lastFire = 0;
    // Result index → transcript that already fired (interim results for one index grow word by word).
    const fired = new Map<number, string>();
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.maxAlternatives = 5;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const alts = Array.from({ length: r.length }, (_, k) => r[k].transcript.toLowerCase().trim());
        const prev = fired.get(i);
        if ((prev !== undefined && alts[0]?.startsWith(prev)) || performance.now() - lastFire < 1500) continue;
        const hit = cmds.current.find((c) => alts.some((t) => c.phrases.some((p) => phraseScore(t, p) >= phraseThreshold(p, c.threshold))));
        if (hit) {
          fired.set(i, alts[0] ?? '');
          lastFire = performance.now();
          hit.run();
        }
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        alive = false;
        setState('denied');
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') setState('error');
    };
    rec.onend = () => {
      fired.clear();
      if (!alive) return;
      // Chrome ends a session after silence / ~60 s; keep listening.
      setTimeout(() => {
        if (!alive) return;
        try {
          rec.start();
          setState('listening');
        } catch { /* already started */ }
      }, 250);
    };
    try {
      rec.start();
      setState('listening');
    } catch {
      setState('error');
    }
    return () => {
      alive = false;
      rec.onend = null;
      rec.abort();
      setState('off');
    };
  }, [enabled]);
  return { state };
}
