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
  magenta: '#ff2bd6',
  cyan: '#00e5ff',
  red: '#ff3b30',
  ink: '#0B0D10',
  paper: '#e9edf2',
  muted: '#9aa3ad',
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

/** Slope (deg): transparent on gentle ground, white at the metabolic-data edge, red above the hard limit. */
export const SLOPE_RAMP: Ramp = {
  id: 'slope',
  stops: [
    [0, [255, 255, 255, 0]],
    [8, [255, 255, 255, 0]],
    [16.7, [255, 255, 255, 0.35]],
    [19.99, [255, 255, 255, 0.5]],
    [20, [255, 90, 78, 0.55]],
    [35, [255, 90, 78, 0.8]],
  ],
};

/**
 * Radio shadow: round-trip minutes outside hab / rover line of sight. 0 = in contact = fully transparent
 * (no tint); anything out of contact gets a red-violet tint that deepens with the length of the gap.
 */
export const LOS_RAMP: Ramp = {
  id: 'los',
  stops: [
    [0, [110, 30, 170, 0]],
    [0.01, [110, 30, 170, 0.3]],
    [10, [140, 24, 150, 0.45]],
    [30, [170, 20, 120, 0.6]],
  ],
};

/** Thermal inertia (J m⁻² K⁻¹ s⁻½), viridis reversed: loose sand (low TI) = pale blue, bedrock = violet. */
export const TI_RAMP: Ramp = {
  id: 'ti',
  stops: [
    [50, [190, 220, 255, 0.55]],
    [150, [94, 201, 98, 0.5]],
    [250, [33, 145, 140, 0.42]],
    [400, [59, 82, 139, 0.36]],
    [700, [68, 1, 84, 0.42]],
  ],
};

/**
 * Elevation overlay between `lo` and `hi` metres: deep blue (low) → blue → cyan → white (high).
 * No yellow/orange (the console's palette reserves warm colours); lightness rises monotonically.
 */
export function elevationRamp(lo: number, hi: number): Ramp {
  const at = (t: number) => lo + (hi - lo) * t;
  return {
    id: 'elevation',
    stops: [
      [at(0), [18, 28, 92, 0.62]],
      [at(0.35), [36, 104, 206, 0.55]],
      [at(0.7), [110, 214, 240, 0.5]],
      [at(1), [255, 255, 255, 0.58]],
    ],
  };
}

/** Surface roughness (m, std-dev of detrended 1 m heights per 5 m cell): smooth = clear, rough = pale blue → white. */
export const ROUGH_RAMP: Ramp = {
  id: 'rough',
  stops: [
    [0, [150, 175, 255, 0]],
    [0.03, [150, 175, 255, 0]],
    [0.08, [130, 165, 255, 0.38]],
    [0.2, [195, 212, 255, 0.62]],
    [0.5, [255, 255, 255, 0.85]],
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
