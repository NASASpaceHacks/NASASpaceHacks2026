export const fmt = {
  min(m: number | null | undefined, digits = 0): string {
    if (m === null || m === undefined || !Number.isFinite(m)) return '—';
    return `${m.toFixed(digits)} min`;
  },
  dur(m: number): string {
    if (!Number.isFinite(m)) return '—';
    const h = Math.floor(m / 60);
    const mm = Math.round(m - h * 60);
    return h ? `${h} h ${String(mm).padStart(2, '0')} m` : `${mm} min`;
  },
  dist(m: number): string {
    if (!Number.isFinite(m)) return '—';
    return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
  },
  num(v: number, digits = 0): string {
    return Number.isFinite(v) ? v.toFixed(digits) : '—';
  },
  signed(v: number, digits = 0): string {
    if (!Number.isFinite(v)) return '—';
    const s = v.toFixed(digits);
    return v > 0 ? `+${s}` : s;
  },
  kb(bytes: number): string {
    return `${(bytes / 1000).toFixed(1)} KB`;
  },
  clock(utcMs: number): string {
    const d = new Date(utcMs);
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
  },
};

/** Unit-aware formatting for a rule value. */
export function fmtRule(value: number, unit: string): string {
  if (unit === 'deg') return `${value}°`;
  if (unit === 'm') return value >= 1000 ? `${value / 1000} km` : `${value} m`;
  if (unit === 'min') return `${value} min`;
  if (unit === 'W') return `${value} W`;
  return `${value} ${unit}`;
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
