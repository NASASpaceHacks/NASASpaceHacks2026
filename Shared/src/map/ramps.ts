/**
 * Colour ramps for engine-field overlays. Stops are [value, [r, g, b, a]] with r,g,b 0..255 and a 0..1.
 * Sequential ramps vary mainly in lightness so they stay readable for colour-vision deficiencies;
 * the TI ramp follows viridis (van der Walt & Smith 2015, https://bids.github.io/colormap/).
 * Red is reserved for rule violations (e.g. slope above the hard limit).
 */
export type RGBA = [number, number, number, number];
export type RampStop = [number, RGBA];

export interface Ramp {
  id: string;
  stops: RampStop[];
}

export const MAP_COLORS = {
  ochre: '#C8763A',
  amber: '#F2B544',
  cyan: '#4FD1E0',
  red: '#FF5A4E',
  ink: '#0B0D10',
  paper: '#E9E4D8',
  muted: '#9A9CA3',
} as const;

/** Minutes-to-safety ramp (short = bright cyan, near the limit = deep blue). Values in minutes. */
export const TIME_RAMP: Ramp = {
  id: 'time',
  stops: [
    [0, [168, 244, 248, 0.5]],
    [10, [79, 209, 224, 0.42]],
    [20, [40, 146, 178, 0.4]],
    [30, [30, 84, 128, 0.42]],
    [60, [26, 46, 82, 0.45]],
  ],
};

/** Slope (deg): transparent on gentle ground, amber at the metabolic-data edge, red above the hard limit. */
export const SLOPE_RAMP: Ramp = {
  id: 'slope',
  stops: [
    [0, [242, 181, 68, 0]],
    [8, [242, 181, 68, 0]],
    [16.7, [242, 181, 68, 0.42]],
    [19.99, [242, 150, 60, 0.55]],
    [20, [255, 90, 78, 0.55]],
    [35, [255, 90, 78, 0.8]],
  ],
};

/** Round-trip minutes outside hab line of sight: 0 = in LOS (cyan wash), longer gaps = deeper shadow. */
export const LOS_RAMP: Ramp = {
  id: 'los',
  stops: [
    [0, [79, 209, 224, 0.2]],
    [0.01, [8, 10, 16, 0.32]],
    [10, [8, 10, 16, 0.62]],
    [30, [8, 10, 16, 0.78]],
  ],
};

/** Thermal inertia (J m⁻² K⁻¹ s⁻½), viridis reversed: loose sand (low TI) = yellow, bedrock = violet. */
export const TI_RAMP: Ramp = {
  id: 'ti',
  stops: [
    [50, [253, 231, 37, 0.62]],
    [150, [94, 201, 98, 0.5]],
    [250, [33, 145, 140, 0.42]],
    [400, [59, 82, 139, 0.36]],
    [700, [68, 1, 84, 0.42]],
  ],
};

/** Elevation tint for the hillshade base when no orthoimage is present (normalised 0..1). */
export const DEM_TINT: [number, [number, number, number]][] = [
  [0, [58, 34, 24]],
  [0.2, [104, 60, 38]],
  [0.45, [156, 94, 56]],
  [0.7, [198, 138, 88]],
  [0.88, [222, 176, 124]],
  [1, [236, 206, 162]],
];

/** CSS linear-gradient for a ramp legend between vmin..vmax. */
export function rampCss(r: Ramp, vmin: number, vmax: number): string {
  const span = vmax - vmin || 1;
  const parts = r.stops
    .filter(([v]) => v >= vmin && v <= vmax)
    .map(([v, [cr, cg, cb, a]]) => `rgba(${cr},${cg},${cb},${Math.max(a, 0.12).toFixed(2)}) ${(((v - vmin) / span) * 100).toFixed(1)}%`);
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}
