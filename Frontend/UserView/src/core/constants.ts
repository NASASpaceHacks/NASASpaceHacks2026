/**
 * Visor constants. Flight-rule values come from the shared, cited DEFAULT_RULES / DEFAULT_CREW
 * (Shared/src/contracts/rules.ts carries the NTRS citations). Visor-only constants are marked
 * as team assumptions where no published number applies.
 */
import { DEFAULT_CREW, DEFAULT_RULES, ruleValue } from '@mw/shared/contracts';

/** Nominal walking speed, m/s (xEVA ConOps planning pace; DEFAULT_CREW). */
export const V0 = DEFAULT_CREW.v0;
/** Planned EVA duration, min (xEVA System ConOps EVA-EXP-0042 Rev B: 6 ± 2 h). */
export const EVA_DURATION_MIN = ruleValue(DEFAULT_RULES, 'eva_duration_max_min');
/** Egress + ingress overhead, min (xEVA ConOps: ~1 h per EVA). Half before the walk, half reserved for ingress. */
export const EGRESS_INGRESS_MIN = ruleValue(DEFAULT_RULES, 'egress_ingress_min');
export const EVA_T0_MIN = EGRESS_INGRESS_MIN / 2;
export const INGRESS_RESERVE_MIN = EGRESS_INGRESS_MIN / 2;
/** Max time to shelter, min (arXiv:2502.02469 nowcast lead; DRA 5.0 Addendum). */
export const SHELTER_MAX_MIN = ruleValue(DEFAULT_RULES, 'shelter_time_max_min');
/** Suit heat-rejection budget, W, rolling average (NASA ICES-2026-127; NTRS 20130014146). Averaged with the engine 30-min leaky integrator. */
export const HEAT_BUDGET_W = ruleValue(DEFAULT_RULES, 'heat_avg_max_w');
/** Contingency walkback speed factor (team assumption, Bellcomm TR-69-340-4 concept). */
export const WALKBACK_FACTOR = ruleValue(DEFAULT_RULES, 'walkback_speed_factor');

/** Arrival radius at a station, m (visor spec). */
export const ARRIVE_RADIUS_M = 15;
/** Dead-reckoning 1-σ growth as a fraction of distance since the last fix (team assumption, visor spec: 2 %). */
export const DR_SIGMA_FRAC = 0.02;
/** 1-σ position uncertainty right after a fix at a surveyed station, m (team assumption). */
export const SIGMA0_M = 3;
/** Pace the simulated crew adopts when the heat advisory is up (team assumption: −15 %). */
export const HEAT_PACE_FACTOR = 0.85;

/** Telemetry cadence (visor spec: every 2 s), heartbeat-loss → AUTONOMOUS delay (3 s). */
export const TELEM_PERIOD_MS = 2000;
export const AUTONOMOUS_AFTER_MS = 3000;
export const SIM_POLL_MS = 1000;
export const SIM_TICK_MS = 100;
/** Store-and-forward queue cap (≈1 h of TELEM at 2 s). */
export const OUTBOX_MAX = 1800;

/** Default sim speed for the offline mock demo (×real time). */
export const MOCK_DEFAULT_SPEED = 10;
export const SPEED_STEPS = [1, 2, 5, 10, 20, 30, 60, 120];
