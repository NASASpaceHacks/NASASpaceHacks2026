## 1. EVA Route Planner (base station view)

- Click the map or pick a science target, and the planner builds a walking route with A\* pathfinding.
- It avoids boulders and slopes above the walkable limit (default 22°), and slows the pace on sand and rough ground.
- Walking speed uses Tobler’s hiking function, scaled down for a pressurized suit (default 45% of unsuited speed).
- Three planning modes: fastest walk, gentlest terrain, or stay near shelter.
- Mission check: distance, total climb, steepest step, estimated radiation dose, and EVA time used against the budget (default 6 hours).

## 2. Helmet Agent Logic

- Position estimate: Mars has no GPS, so the helmet estimates its position from an IMU and step counting. The app shows this error growing as an uncertainty circle. Every 10 minutes, a landmark or radio ranging to the rover corrects it.
- Off-route detection and reroute: If the astronaut drifts more than 25 m from the route, the helmet runs A\* on the spot and draws a new route (amber) to the next stop. No connection to the base station is needed.
- Emergency mode: When a solar particle alert fires, the app draws the fastest route (pink) from the astronaut’s current position to the nearest shelter.

## 3. Helmet HUD (visor view)

- Shows arrows on the ground along the route, a next-turn card, edge arrows when the route is out of view, and a compass tape across the top.
- Each colour has one fixed meaning: cyan for normal, amber for act soon, pink for emergency.
- Every arrow comes with plain words, so a tired, gloved astronaut never has to decode a symbol.
