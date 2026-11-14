import type { CostCtx, CostGrid, CostModel, CrewParams } from '../contracts/types';

/**
 * Metabolic cost model `pandolf-santee-mars`.
 *
 * Pandolf et al. (1977) load-carriage equation, in watts at 1 g:
 *   M_P = 1.5·W + 2.0·(W+L)·(L/W)² + η·(W+L)·(1.5·V² + 0.35·V·G)
 *   W = body mass (kg), L = carried load (kg; the suit + tools are treated as load),
 *   V = speed (m/s), G = grade (%), η = terrain factor.
 * Santee et al. (2003) downhill correction for G < 0:
 *   CF = η·[ G·(W+L)·V/3.5 − (W+L)·(G+6)²/W + (25 − V²) ],   M = M_P − CF
 * Mars scaling: the whole result is multiplied by crew.gRatio (g_mars/g_earth).
 *
 * Provenance:
 * - Pandolf–Santee with the suit treated as load is the formulation used at NASA JSC for suited
 *   EVA metabolic prediction (Kim et al., IEEE EMBC 2024, NTRS 20240001423).
 * - The g-scaled form is calibrated against NASA suited partial-gravity treadmill data
 *   (Norcross et al. 2010, NASA/TP-2010-216125, IST-2, 0.32 g: within −10 %/+15 %).
 * - Mars gravity (0.38 g) lies OUTSIDE the calibrated 0.12–0.32 g range: it is an extrapolation.
 * - Santee was fit on moderate downhill grades; grades steeper than the 16.7° soft limit
 *   (NASA/TP-2010-216125 data edge) are extrapolations too.
 *
 * Travel time: the planner walks at a constant planning pace, so edge time = 3-D length / v with
 * v = crew.v0 × ctx.speedFactor (xEVA ConOps planning pace 0.56 m/s, see DEFAULT_CREW). Metabolic
 * power does not change speed; it drives the energy budget and the suit-heat governor, whose rests
 * add time (see heat.ts).
 */
export const PANDOLF_SANTEE_MARS = 'pandolf-santee-mars';

/** Pandolf (+ Santee for G<0) metabolic rate at 1 g, watts. */
export function pandolfSanteeW(W: number, L: number, V: number, G: number, eta: number): number {
  const WL = W + L;
  const lw = L / W;
  const mp = 1.5 * W + 2.0 * WL * lw * lw + eta * WL * (1.5 * V * V + 0.35 * V * G);
  if (G < 0) {
    const g6 = G + 6;
    const cf = eta * ((G * WL * V) / 3.5 - (WL * g6 * g6) / W + (25 - V * V));
    return mp - cf;
  }
  return mp;
}

/** Mars metabolic rate (W) for a crew member at speed V (m/s), grade G (%), terrain factor η. */
export function marsMetabolicW(crew: CrewParams, V: number, G: number, eta: number): number {
  const L = crew.suitMassKg + crew.toolsKg;
  return pandolfSanteeW(crew.bodyMassKg, L, V, G, eta) * crew.gRatio;
}

/**
 * Terrain factor η from THEMIS thermal inertia (J m⁻² K⁻¹ s⁻½).
 * TEAM ASSUMPTION (not a published mapping): TI ≥ 350 → 1.0 (indurated / rocky, "hard surface"),
 * 100–350 → 1.2 (mixed), < 100 → 2.1 (loose fines; Pandolf's loose-sand value). Unknown → 1.0.
 */
export function etaFromThermalInertia(ti: number): number {
  if (!(ti === ti)) return 1.0; // NaN
  if (ti >= 350) return 1.0;
  if (ti >= 100) return 1.2;
  return 2.1;
}

const SQRT2 = Math.SQRT2;

/** Horizontal distance (m) between two cells of a grid. */
export function horizDistM(g: CostGrid, a: number, b: number): number {
  const w = g.w;
  const ra = (a / w) | 0;
  const rb = (b / w) | 0;
  const dr = ra - rb;
  const dc = a - ra * w - (b - rb * w);
  if ((dr === 0 && (dc === 1 || dc === -1)) || (dc === 0 && (dr === 1 || dr === -1))) return g.cellM;
  if ((dr === 1 || dr === -1) && (dc === 1 || dc === -1)) return g.cellM * SQRT2;
  return Math.hypot(dr, dc) * g.cellM;
}

export const pandolfSanteeMars: CostModel = {
  id: PANDOLF_SANTEE_MARS,
  label: 'Pandolf–Santee (suit as load) × g ratio — NASA JSC formulation, Mars extrapolation',
  edgeCost(g: CostGrid, from: number, to: number, ctx: CostCtx): number {
    if (g.blocked[from] !== 0 || g.blocked[to] !== 0) return Infinity;
    const dz = g.elev[to] - g.elev[from];
    if (!(dz === dz)) return Infinity;
    const d = horizDistM(g, from, to);
    const v = ctx.crew.v0 * ctx.speedFactor;
    if (!(v > 0)) return Infinity;
    return Math.sqrt(d * d + dz * dz) / v;
  },
  edgePowerW(g: CostGrid, from: number, to: number, ctx: CostCtx): number {
    const dz = g.elev[to] - g.elev[from];
    const d = horizDistM(g, from, to);
    const G = dz === dz ? (100 * dz) / d : 0;
    const ea = g.eta[from], eb = g.eta[to];
    const eta = 0.5 * ((ea === ea ? ea : 1) + (eb === eb ? eb : 1));
    return marsMetabolicW(ctx.crew, ctx.crew.v0 * ctx.speedFactor, G, eta);
  },
};
