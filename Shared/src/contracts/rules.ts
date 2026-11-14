import type { CrewParams, Rule, RuleId } from './types';

/**
 * Default flight rules. Every value carries its citation; `assumption: true` marks team design
 * parameters (shown as such in the UI). Mirrors Content/flightrules.yaml.
 */
export const DEFAULT_RULES: Rule[] = [
  {
    id: 'slope_max_deg',
    evidence: 'A',
    label: 'Max walking slope',
    value: 20,
    unit: 'deg',
    hard: true,
    enabled: true,
    citation:
      'xEVA System ConOps EVA-EXP-0042 Rev B (NASA, 2020): suited crew up/down/cross slopes ≤20°; Artemis III EVA slope <20° (NTRS 20230005904).',
  },
  {
    id: 'slope_soft_deg',
    evidence: 'M',
    label: 'Slope comfort limit (metabolic data edge)',
    value: 16.7,
    unit: 'deg',
    hard: false,
    enabled: true,
    citation:
      'Norcross et al. 2010, NASA/TP-2010-216125 (suited metabolic data only up to 30% grade ≈ 16.7°).',
  },
  {
    id: 'eva_duration_max_min',
    evidence: 'D',
    label: 'EVA duration (nominal)',
    value: 360,
    unit: 'min',
    hard: true,
    enabled: true,
    citation: 'xEVA System ConOps EVA-EXP-0042 Rev B: EVA 6 ± 2 h.',
  },
  {
    id: 'egress_ingress_min',
    evidence: 'D',
    label: 'Egress + ingress overhead',
    value: 60,
    unit: 'min',
    hard: true,
    enabled: true,
    citation: 'xEVA System ConOps EVA-EXP-0042 Rev B: ~1 h of each EVA for egress/ingress.',
  },
  {
    id: 'contingency_o2_min',
    evidence: 'D',
    label: 'Contingency O₂ reserve (never planned into)',
    value: 60,
    unit: 'min',
    hard: true,
    enabled: true,
    citation: 'xEVA System ConOps EVA-EXP-0042 Rev B: +1 h backup O₂ for off-nominal use only.',
  },
  {
    id: 'walkback_speed_factor',
    evidence: 'E',
    label: 'Contingency walkback speed factor',
    value: 0.5,
    unit: '×v₀',
    hard: true,
    enabled: true,
    assumption: true,
    citation:
      'Team assumption: degraded-crew return at half nominal speed (Apollo walkback-limit concept, Bellcomm TR-69-340-4).',
  },
  {
    id: 'shelter_time_max_min',
    evidence: 'D',
    label: 'Max time to shelter (SEP)',
    value: 30,
    unit: 'min',
    hard: true,
    enabled: true,
    citation:
      'Onboard dose-rate nowcast gives ≥30 min warning before peak SEP dose (arXiv:2502.02469); DRA 5.0 Addendum (NASA SP-2009-566-ADD): return crews to shelter on warning.',
  },
  {
    id: 'los_gap_max_min',
    evidence: 'E',
    label: 'Max time without habitat line-of-sight',
    value: 10,
    unit: 'min',
    hard: true,
    enabled: true,
    assumption: true,
    citation:
      'FOD constraint "maximum time without line of sight to lander" (Caswell et al., ASCEND 2025, NTRS 20250006063). Value is a team design parameter.',
  },
  {
    id: 'daylight_min_sun_elev_deg',
    evidence: 'E',
    label: 'Min sun elevation (daylight only)',
    value: 5,
    unit: 'deg',
    hard: true,
    enabled: true,
    assumption: true,
    citation: 'DRA 5.0 Addendum (NASA SP-2009-566-ADD): no nominal night EVAs. Threshold is a team parameter.',
  },
  {
    id: 'heat_avg_max_w',
    evidence: 'D',
    label: 'Suit heat-rejection budget (30-min avg)',
    value: 352,
    unit: 'W',
    hard: true,
    enabled: true,
    citation:
      'Future suits sized for 1200 BTU/h (352 W) average (NASA ICES-2026-127); SWME heat rejection 370 W in Mars conditions vs 810 W in vacuum (NTRS 20130014146).',
  },
  {
    id: 'walk_radius_max_m',
    evidence: 'D',
    label: 'Max distance from habitat (walking)',
    value: 2000,
    unit: 'm',
    hard: true,
    enabled: true,
    citation:
      'Tenets of Lunar EVA for Artemis III (NTRS 20230008183): ≤2 km from lander, based on 1 h emergency return on contingency O₂; xEVA ConOps walking-only 2 km radius.',
  },
  {
    id: 'plume_keepout_m',
    evidence: 'D',
    label: 'Lander plume-ejecta keep-out radius',
    value: 1000,
    unit: 'm',
    hard: true,
    enabled: true,
    citation: 'Hoffman et al., First Landing Site/Exploration Zone workshop (NTRS 20160002370): 1 km plume-ejecta hazard zone.',
  },
];

export function ruleValue(rules: Rule[], id: RuleId): number {
  const r = rules.find((x) => x.id === id);
  if (!r) throw new Error(`rule ${id} missing`);
  return r.value;
}

export function ruleEnabled(rules: Rule[], id: RuleId): boolean {
  const r = rules.find((x) => x.id === id);
  return !!r && r.enabled;
}

/**
 * Default crew. Suit mass from the Mark III configuration used in NASA/TP-2010-216125 (121 kg);
 * nominal speed 0.56 m/s (~2 km/h, xEVA ConOps planning pace); Mars g ratio 3.711/9.807.
 */
export const DEFAULT_CREW: CrewParams = {
  bodyMassKg: 80,
  suitMassKg: 121,
  toolsKg: 10,
  v0: 0.56,
  gRatio: 3.711 / 9.807,
};

/** Stable hash of rules for caching / package rulesHash. */
export function rulesHash(rules: Rule[]): string {
  const canon = [...rules]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((r) => `${r.id}=${r.value}:${r.hard ? 1 : 0}:${r.enabled ? 1 : 0}`)
    .join('|');
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < canon.length; i++) {
    h ^= canon.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
