export const pad = (n: number, w = 2) => String(Math.max(0, Math.floor(n))).padStart(w, '0');

/** LTST minutes after local midnight → HH:MM (Mars hours, scenario convention). */
export function fmtLtst(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad(m / 60)}:${pad(m % 60)}`;
}

export function fmtElapsed(min: number): string {
  const m = Math.max(0, min);
  return `${pad(m / 60)}:${pad(m % 60)}`;
}

/** Countdown (minutes) → M:SS or H:MM:SS. */
export function fmtCountdown(min: number): string {
  const neg = min < 0;
  const s = Math.round(Math.abs(min) * 60);
  const h = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  const body = h > 0 ? `${h}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
  return neg ? `−${body}` : body;
}

export function fmtDist(m: number): { v: string; u: string } {
  if (!Number.isFinite(m)) return { v: '—', u: '' };
  if (m < 1000) return { v: String(Math.round(m)), u: 'M' };
  return { v: (m / 1000).toFixed(m < 10000 ? 2 : 1), u: 'KM' };
}

export function fmtMin(min: number | null | undefined): string {
  if (min === null || min === undefined || !Number.isFinite(min)) return '—';
  return String(Math.round(min));
}

export const hdg = (d: number) => pad(((Math.round(d) % 360) + 360) % 360, 3);

export const clockText = (rel: number) => {
  const h = Math.round((((rel % 360) + 360) % 360) / 30) % 12;
  return h === 0 ? 12 : h;
};
