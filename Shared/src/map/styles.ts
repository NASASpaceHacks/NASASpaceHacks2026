import type { ExpressionValue } from 'ol/expr/expression';
import type { Style as WebGLTileStyle } from 'ol/layer/WebGLTile';
import { DEM_TINT, type Ramp, type RGBA } from './ramps';

/**
 * WebGL tile style builders (pure data). All animation happens through style variables, so the
 * GPU re-evaluates the expression each frame without re-uploading any raster data.
 */

const D2R = Math.PI / 180;
const band = (i: number): ExpressionValue => ['band', i];
const v = (name: string): ExpressionValue => ['var', name];

function interpolate(input: ExpressionValue, stops: [number, ExpressionValue][]): ExpressionValue {
  const out: ExpressionValue[] = ['interpolate', ['linear'], input];
  for (const [x, y] of stops) out.push(x, y);
  return out;
}

const TRANSPARENT: RGBA = [0, 0, 0, 0];

/**
 * Single-band ramp. With `threshold`, values above the `threshold` style variable are hidden
 * (or dimmed with `aboveColor`) — e.g. "time to shelter ≤ threshold".
 */
export function rampStyle(ramp: Ramp, opts: { threshold?: number; aboveColor?: RGBA; bandIndex?: number } = {}): WebGLTileStyle {
  const b = band(opts.bandIndex ?? 1);
  const color = interpolate(b, ramp.stops.map(([x, c]) => [x, c as ExpressionValue]));
  if (opts.threshold === undefined) return { color };
  return {
    variables: { threshold: opts.threshold },
    color: ['case', ['>', b, v('threshold')], (opts.aboveColor ?? TRANSPARENT) as ExpressionValue, color],
  };
}

/**
 * GPU hillshade from the site pack `normals` raster (band 1 = nx east, band 2 = ny north;
 * nz = √(1 − nx² − ny²)). Shade = dot(normal, sun) with the sun from style variables
 * `sunAzDeg` (clockwise from north) and `sunElevDeg`; `ambient` lifts the shadows and
 * `zFactor` is the usual hillshade vertical exaggeration (applied to nx, ny before
 * re-normalising; 1 = true relief). With `tint`, band 3 is the DEM normalised by the
 * `demMin`/`demMax` variables and coloured with a Mars-ochre ramp (used when no orthoimage is
 * present); otherwise the output is grey, meant to be multiplied over imagery.
 */
export function hillshadeStyle(opts: { sunAzDeg: number; sunElevDeg: number; ambient?: number; zFactor?: number; tint?: boolean; demMin?: number; demMax?: number }): WebGLTileStyle {
  const nx0 = band(1), ny0 = band(2);
  const nz: ExpressionValue = ['sqrt', ['clamp', ['-', 1, ['+', ['*', nx0, nx0], ['*', ny0, ny0]]], 0, 1]];
  const nx: ExpressionValue = ['*', nx0, v('zFactor')];
  const ny: ExpressionValue = ['*', ny0, v('zFactor')];
  const len: ExpressionValue = ['sqrt', ['+', ['*', nx, nx], ['*', ny, ny], ['*', nz, nz]]];
  const az: ExpressionValue = ['*', v('sunAzDeg'), D2R];
  const el: ExpressionValue = ['*', v('sunElevDeg'), D2R];
  const sx: ExpressionValue = ['*', ['sin', az], ['cos', el]];
  const sy: ExpressionValue = ['*', ['cos', az], ['cos', el]];
  const sz: ExpressionValue = ['sin', el];
  const shade: ExpressionValue = ['clamp', ['/', ['+', ['*', nx, sx], ['*', ny, sy], ['*', nz, sz]], len], 0, 1];
  // Sky term: when the sun is below the horizon only diffuse skylight remains (fades over −6..+4°).
  const day: ExpressionValue = ['clamp', ['/', ['+', v('sunElevDeg'), 6], 10], 0, 1];
  const lit: ExpressionValue = ['+', ['*', v('ambient'), ['+', 0.35, ['*', 0.65, day]]], ['*', ['-', 1, v('ambient')], shade, day]];
  const variables = {
    sunAzDeg: opts.sunAzDeg,
    sunElevDeg: opts.sunElevDeg,
    ambient: opts.ambient ?? 0.22,
    zFactor: opts.zFactor ?? 1,
    demMin: opts.demMin ?? 0,
    demMax: opts.demMax ?? 1,
  };
  if (!opts.tint) {
    const g: ExpressionValue = ['*', 255, lit];
    return { variables, color: ['color', g, g, g, 1] };
  }
  // Normalised elevation; +1e-6 keeps the denominator non-zero on flat test grids.
  const tt: ExpressionValue = ['clamp', ['/', ['-', band(3), v('demMin')], ['+', ['-', v('demMax'), v('demMin')], 1e-6]], 0, 1];
  const ch = (k: 0 | 1 | 2): ExpressionValue => ['*', lit, interpolate(tt, DEM_TINT.map(([x, c]) => [x, c[k]]))];
  return { variables, color: ['color', ch(0), ch(1), ch(2), 1] };
}

/**
 * Band layout of the safe-zone source. "A/B" pairs let the zone morph smoothly between the
 * previous and the new solution (style variable `morph` 0 → 1) when a replan arrives.
 */
export const SAFE_ZONE_BANDS = {
  slope: 1,
  distHab: 2,
  walkbackA: 3,
  walkbackB: 4,
  shelterA: 5,
  shelterB: 6,
  losGapA: 7,
  losGapB: 8,
  keepout: 9,
  blocked: 10,
} as const;

/** Constraint indices used by the explainer sequence (style variable `act`). */
export const SAFE_ZONE_STEPS = ['slope', 'radius', 'walkback', 'shelter', 'los', 'final'] as const;

export interface SafeZoneVars {
  /** Slope limit (deg). */
  limSlope: number;
  /** Walk radius limit (m). */
  limRadius: number;
  /** Outbound + walkback limit (min). */
  limWalkback: number;
  /** Time-to-shelter limit (min). */
  limShelter: number;
  /** LOS round-trip gap limit (min). */
  limLos: number;
  /** 1 = apply keep-outs/hazards. */
  keepOn: number;
  /** 1 = apply engine-blocked cells. */
  blockedOn: number;
  /** 0 = previous fields (A), 1 = new fields (B). */
  morph: number;
  /** Active constraint index 1..6 (0 = none): cells it removes are highlighted. */
  act: number;
  /** Highlight strength of the active constraint (0..1). */
  actGlow: number;
}

export const SAFE_ZONE_OPEN: SafeZoneVars = {
  limSlope: 1e6,
  limRadius: 1e9,
  limWalkback: 1e9,
  limShelter: 1e9,
  limLos: 1e9,
  keepOn: 0,
  blockedOn: 0,
  morph: 1,
  act: 0,
  actGlow: 0,
};

export function safeZoneStyle(
  vars: Partial<SafeZoneVars> = {},
  colors: { safe?: RGBA; veil?: RGBA; active?: RGBA } = {},
): WebGLTileStyle {
  const B = SAFE_ZONE_BANDS;
  const mix = (a: number, b: number): ExpressionValue => ['+', band(a), ['*', ['-', band(b), band(a)], v('morph')]];
  const exclusions: [ExpressionValue, number][] = [
    [['>', band(B.slope), v('limSlope')], 1],
    [['>', ['*', band(B.keepout), v('keepOn')], 0.5], 1],
    [['>', band(B.distHab), v('limRadius')], 2],
    [['>', mix(B.walkbackA, B.walkbackB), v('limWalkback')], 3],
    [['>', mix(B.shelterA, B.shelterB), v('limShelter')], 4],
    [['>', mix(B.losGapA, B.losGapB), v('limLos')], 5],
    [['>', ['*', band(B.blocked), v('blockedOn')], 0.5], 6],
  ];
  const prev: ExpressionValue = ['any', ...exclusions.map(([e, i]) => ['all', e, ['!=', v('act'), i]] as ExpressionValue)];
  const active: ExpressionValue = ['any', ...exclusions.map(([e, i]) => ['all', e, ['==', v('act'), i]] as ExpressionValue)];
  const veil = colors.veil ?? [8, 9, 12, 0.58];
  const safe = colors.safe ?? [79, 209, 224, 0.12];
  const hot = colors.active ?? [255, 59, 48, 0.5]; // the rule being explained: red (no amber in this product)
  return {
    variables: { ...SAFE_ZONE_OPEN, ...vars } as unknown as Record<string, number>,
    color: [
      'case',
      prev,
      veil as ExpressionValue,
      active,
      ['interpolate', ['linear'], v('actGlow'), 0, veil as ExpressionValue, 1, hot as ExpressionValue],
      safe as ExpressionValue,
    ],
  };
}
