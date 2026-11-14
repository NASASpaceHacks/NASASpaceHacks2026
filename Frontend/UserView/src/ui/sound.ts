/**
 * Alert tones (WebAudio). The AudioContext is only created after a user gesture, so browsers never
 * log autoplay warnings; before that, tones are silently skipped.
 */
let ctx: AudioContext | null = null;

export function armAudio() {
  if (ctx) return;
  try {
    ctx = new AudioContext();
  } catch {
    ctx = null;
  }
}

function tone(freq: number, startS: number, durS: number, type: OscillatorType = 'sine', gain = 0.12) {
  if (!ctx || ctx.state !== 'running') return;
  const t0 = ctx.currentTime + startS;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.015);
  g.gain.setValueAtTime(gain, t0 + durS - 0.03);
  g.gain.linearRampToValueAtTime(0, t0 + durS);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + durS + 0.02);
}

export const sounds = {
  newRoute: () => { tone(880, 0, 0.14); tone(1320, 0.18, 0.22); },
  station: () => tone(660, 0, 0.25),
  caution: () => { tone(740, 0, 0.18, 'triangle'); tone(560, 0.24, 0.26, 'triangle'); },
  warning: () => { for (let i = 0; i < 3; i++) tone(620, i * 0.28, 0.18, 'square', 0.08); },
  ok: () => tone(990, 0, 0.12),
};
