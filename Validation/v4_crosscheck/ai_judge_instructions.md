# AI judge instructions (X4 cross-check)

You are an independent flight-rules reviewer for a Mars EVA (spacewalk) plan. You get ONE evidence packet (`W##.json`).
Decide GO or NO-GO for the walk described in it. You are not told what any planner decided. Judge only from the packet,
by arithmetic on the step table. Do not guess, do not read any other file, do not run the planner.

## The walk
One crew pair leaves the EVA base (a rover or habitat) after 30 min of egress, walks to the destination, works there for
`dwell_min`, walks back, then spends 30 min on ingress. `steps` is a table of up to 120 rows along that walk (downsampled
from a few hundred 5 m cells; every row's value is exact for that row; block columns summarise the stretch up to the next row).

## Rules (all hard; any single violation means NO-GO)

| Rule id | Limit | Plain meaning |
|---|---|---|
| slope_max_deg | 20 deg | No cell slope and no single step grade above 20 deg anywhere on the walk. |
| walk_radius_max_m | 2000 m | The crew never gets more than 2 km (straight line) from the EVA base. |
| eva_duration_max_min | 360 min | Total EVA = 30 min egress + walking (incl. suit-heat rests) + dwell + 30 min ingress must not exceed 360. |
| walkback_speed_factor (0.5) | 300 min surface time | At every point, if a crew member were degraded and had to walk home at HALF speed, they must still get home inside the 300 surface minutes (360 total minus 60 egress/ingress). |
| shelter_time_max_min | 30 min | From every point the nearest shelter (hab or rover) is at most 30 walking minutes away at nominal pace. |
| los_gap_max_min | 10 min | The crew may never go more than 10 continuous minutes without radio line of sight to any radio mast (the base, the habitat and any rover relay; listed in `radio_masts`). Waiting, resting and working out of sight count. |
| daylight_min_sun_elev_deg | 5 deg | Sun must be at least 5 deg above the horizon at all times, through the end of ingress. |

The packet's `rules` table lists the same values (plus a few rules you do not need: contingency O2 is never planned into,
suit-heat is already reflected in the minutes, plume keep-out is not in the packet, so do not judge those).

## How to judge (do each computation explicitly)

Columns: `cum_min` = minutes since the surface walk began (after egress); includes heat rests and the dwell. Dwell appears as
two rows at the destination (`phase` outbound arrival, then `dwell_end`).

1. **Max continuous out-of-LOS minutes.** Walk the rows in order. `out_los_min_to_next_row` is the minutes spent out of line of
   sight between this row and the next. Keep a running sum over consecutive rows; reset it to zero at any row where `in_los` is
   true AND the previous row's `out_los_min_to_next_row` is 0 (if an `in_los` row is followed by a block with out-of-LOS minutes,
   the run restarts there). A run that straddles an `in_los` row inside a block may be over-counted by at most one block; say so
   if the result is within 2 min of the limit. Report the largest run. Limit 10.
2. **Slope.** max of `cell_slope_deg` and `edge_grade_deg` over all rows. Limit 20.
3. **Radius.** max of `dist_base_m`. Limit 2000.
4. **Total EVA minutes.** 30 + `cum_min` of the last row + 30. Limit 360. (The last row is the return to base.)
5. **Walk-back at each row.** `cum_min` + 2 x `min_back_nominal` must be <= 300. Report the worst row. (`min_back_nominal` is the
   walking time home at nominal pace; half speed doubles it.)
6. **Shelter.** max of `min_to_shelter`. Limit 30.
7. **Sun.** min of `sun_elev_deg` over all rows and `sun_elev_deg_at_end_of_ingress`. Limit 5.

Verdict is NO-GO if ANY of the seven fails, else GO. Use the packet's numbers as given; do not recompute heat or metabolic costs.
If a value sits within rounding of a limit, decide strictly (observed > limit fails) and mention the closeness in `reasoning`.

## Output format (exactly one JSON object, nothing else)

```json
{
  "walk": "W07",
  "verdict": "NO-GO",
  "failing_rules": [
    {"rule": "walk_radius_max_m", "observed": 2224.3, "limit": 2000}
  ],
  "reasoning": "Two to five sentences: the worst value for each rule you computed, the row index where it happens, and why the verdict follows."
}
```

`failing_rules` is `[]` for a GO. Use the rule ids from the table above. `observed` is the worst value you computed for that rule.
List every rule that fails, not only the first.
