/**
 * Pure scale-bar maths (no DOM). `resolution` is ground metres per CSS pixel — on a Mars map
 * registered with `registerMarsProjection` that is simply `view.getResolution()`.
 */
export interface ScaleBar {
  /** Ground length the bar represents (m). */
  metres: number;
  /** Bar width in CSS pixels. */
  widthPx: number;
  label: string;
}

const STEPS = [1, 2, 5];

export function niceScaleBar(resolution: number, minWidthPx = 90): ScaleBar {
  if (!(resolution > 0) || !Number.isFinite(resolution)) return { metres: 0, widthPx: 0, label: '—' };
  const minMetres = resolution * minWidthPx;
  let exp = Math.floor(Math.log10(minMetres));
  let metres = 0;
  for (let guard = 0; guard < 4 && !metres; guard++, exp++) {
    for (const s of STEPS) {
      const m = s * 10 ** exp;
      if (m >= minMetres) {
        metres = m;
        break;
      }
    }
  }
  return { metres, widthPx: metres / resolution, label: formatDistance(metres) };
}

export function formatDistance(m: number): string {
  if (!Number.isFinite(m)) return '—';
  if (Math.abs(m) >= 1000) {
    const km = m / 1000;
    return `${km >= 10 ? km.toFixed(0) : km.toFixed(km % 1 === 0 ? 0 : 1)} km`;
  }
  return `${Math.round(m)} m`;
}
