/**
 * Suit heat governor.
 *
 * Constraint: rolling average metabolic power ≤ heat_avg_max_w (352 W: future suits sized for
 * 1200 BTU/h average, NASA ICES-2026-127; SWME rejects ~370 W in Mars conditions, NTRS 20130014146).
 *
 * WINDOW = 30 MIN. The rolling average is implemented as a first-order leaky integrator (exponential
 * moving average, time constant τ = 30 min): dH/dt = (P − H)/τ. It is the "leaky bucket" form of a
 * 30-min average and has a single scalar state, which keeps the orienteering DP exact. (The contract
 * comment on BurndownPoint.heatAvgW says 15 min; the engine uses 30 min — documented here.)
 *
 * Governor (deterministic, greedy, time-optimal for this model): before each chunk of work (an edge
 * walked at power P for dt, or a slice of station dwell), if finishing the chunk would push H above
 * the budget B, rest at REST_W until it would not. Because H relaxes toward P monotonically during a
 * chunk, H ≤ B at chunk ends implies H ≤ B throughout. A chunk whose start threshold is ≤ REST_W
 * (could not be walked even after a full rest) is infeasible whatever the current heat.
 *
 * Team assumptions: rest power 250 W, default station task power 250 W, initial heat state 250 W at
 * EVA start (egress activity), and heat = budget (worst case) when replanning mid-EVA.
 */
export const HEAT_TAU_MIN = 30;
export const REST_W = 250;
export const TASK_W_DEFAULT = 250;
export const HEAT_INITIAL_W = 250;

export interface HeatParams {
  budgetW: number;
  restW: number;
  tauMin: number;
}

/**
 * Rest (minutes) needed before a chunk of duration dt (min) at power P from heat H, or −1 when the
 * chunk is impossible. After resting, H equals the returned threshold (see restThreshold()).
 */
export function restNeeded(H: number, dt: number, P: number, hp: HeatParams): number {
  const B = hp.budgetW;
  if (P <= B) return 0;
  const e = Math.exp(-dt / hp.tauMin);
  const thr = P + (B - P) / e;
  // A chunk that could not be walked even after a full rest is infeasible whatever the current heat
  // (conservative, and keeps feasibility monotone in heat — required for exact DP pruning).
  if (thr <= hp.restW) return -1;
  if (H <= thr) return 0;
  return hp.tauMin * Math.log((H - hp.restW) / (thr - hp.restW));
}

/** Heat after resting `rest` minutes at REST_W. */
export function heatAfterRest(H: number, rest: number, hp: HeatParams): number {
  return hp.restW + (H - hp.restW) * Math.exp(-rest / hp.tauMin);
}

/** Heat after working dt minutes at power P. */
export function heatAfterWork(H: number, dt: number, P: number, hp: HeatParams): number {
  return P + (H - P) * Math.exp(-dt / hp.tauMin);
}

/** Split a station dwell into governor chunks (one chunk when no rest can ever be needed). */
export function dwellChunks(dwellMin: number, taskW: number, budgetW: number): number[] {
  if (dwellMin <= 0) return [];
  if (taskW <= budgetW) return [dwellMin];
  const out: number[] = [];
  let left = dwellMin;
  while (left > 1e-9) {
    const d = left > 1 ? 1 : left;
    out.push(d);
    left -= d;
  }
  return out;
}

export interface SegEval {
  feasible: boolean;
  dur: number;
  rest: number;
  hEnd: number;
}

/**
 * A sequence of work chunks (dt minutes, P watts) — an edge path plus an optional dwell — with an
 * EXACT closed-form evaluation of the governor as a function of the starting heat H0.
 *
 * Free phase: H_k = α_k + β_k·H0 (the EMA is linear). The first rest happens at the first chunk k
 * with H0 > c_k = (thr_k − α_k)/β_k; only prefix-minimum "records" of c can be first-rest chunks.
 * After a rest at chunk k the heat equals thr_k regardless of H0, so the remainder of the segment is
 * simulated once per record. eval(H0) is then O(log R). duration and end heat are non-decreasing in
 * H0, which makes Pareto pruning on (time, heat) in the DP exact.
 */
export class Seg {
  readonly dt: Float64Array;
  readonly P: Float64Array;
  private hp: HeatParams | null = null;
  private infeasible = false;
  private tFree = 0;
  private aL = 0;
  private bL = 1;
  private recC: number[] = [];
  private recK: number[] = [];
  private recT: number[] = [];
  private recA: number[] = [];
  private recB: number[] = [];
  private recThr: number[] = [];
  private sufDur: number[] = [];
  private sufRest: number[] = [];
  private sufH: number[] = [];

  constructor(dt: ArrayLike<number>, P: ArrayLike<number>) {
    this.dt = Float64Array.from(dt);
    this.P = Float64Array.from(P);
  }

  get length(): number {
    return this.dt.length;
  }

  /** Total work time without rests (min). */
  get workMin(): number {
    let s = 0;
    for (let i = 0; i < this.dt.length; i++) s += this.dt[i];
    return s;
  }

  prepare(hp: HeatParams): void {
    if (this.hp && this.hp.budgetW === hp.budgetW && this.hp.restW === hp.restW && this.hp.tauMin === hp.tauMin) return;
    this.hp = { ...hp };
    const { dt, P } = this;
    const L = dt.length;
    const B = hp.budgetW, tau = hp.tauMin;
    this.infeasible = false;
    this.recC = []; this.recK = []; this.recT = []; this.recA = []; this.recB = []; this.recThr = [];
    this.sufDur = []; this.sufRest = []; this.sufH = [];
    let a = 0, b = 1, T = 0, minC = Infinity;
    for (let k = 0; k < L; k++) {
      const e = Math.exp(-dt[k] / tau);
      if (P[k] > B) {
        const thr = P[k] + (B - P[k]) / e;
        if (thr <= hp.restW) {
          this.infeasible = true;
          return;
        }
        const c = (thr - a) / b;
        if (c < minC) {
          minC = c;
          this.recC.push(c); this.recK.push(k); this.recT.push(T); this.recA.push(a); this.recB.push(b); this.recThr.push(thr);
        }
      }
      a = P[k] * (1 - e) + e * a;
      b = e * b;
      T += dt[k];
    }
    this.tFree = T;
    this.aL = a;
    this.bL = b;
    for (let r = 0; r < this.recK.length; r++) {
      let H = this.recThr[r], dur = 0, rest = 0;
      for (let k = this.recK[r]; k < L; k++) {
        const rn = restNeeded(H, dt[k], P[k], hp);
        if (rn > 0) {
          H = heatAfterRest(H, rn, hp);
          rest += rn;
          dur += rn;
        }
        H = heatAfterWork(H, dt[k], P[k], hp);
        dur += dt[k];
      }
      this.sufDur.push(dur);
      this.sufRest.push(rest);
      this.sufH.push(H);
    }
  }

  /** Evaluate from starting heat H0 (prepare() first). Writes into `out` (no allocation). */
  eval(H0: number, out: SegEval): SegEval {
    if (this.infeasible) {
      out.feasible = false;
      out.dur = Infinity;
      out.rest = 0;
      out.hEnd = Infinity;
      return out;
    }
    const c = this.recC;
    // first record with c < H0 (c strictly decreasing)
    let lo = 0, hi = c.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (c[mid] < H0) hi = mid;
      else lo = mid + 1;
    }
    out.feasible = true;
    if (lo === c.length) {
      out.dur = this.tFree;
      out.rest = 0;
      out.hEnd = this.aL + this.bL * H0;
      return out;
    }
    const hp = this.hp!;
    const Hk = this.recA[lo] + this.recB[lo] * H0;
    const rd = hp.tauMin * Math.log((Hk - hp.restW) / (this.recThr[lo] - hp.restW));
    out.dur = this.recT[lo] + rd + this.sufDur[lo];
    out.rest = rd + this.sufRest[lo];
    out.hEnd = this.sufH[lo];
    return out;
  }

  /** Reference step-by-step governor (used by tests and the simulator's semantics). */
  simulate(H0: number, hp: HeatParams): SegEval {
    let H = H0, dur = 0, rest = 0;
    for (let k = 0; k < this.dt.length; k++) {
      const rn = restNeeded(H, this.dt[k], this.P[k], hp);
      if (rn < 0) return { feasible: false, dur: Infinity, rest: 0, hEnd: Infinity };
      if (rn > 0) {
        H = heatAfterRest(H, rn, hp);
        rest += rn;
        dur += rn;
      }
      H = heatAfterWork(H, this.dt[k], this.P[k], hp);
      dur += this.dt[k];
    }
    return { feasible: true, dur, rest, hEnd: H };
  }
}
