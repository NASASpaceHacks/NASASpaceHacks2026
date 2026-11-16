## Impact: Why does this matter?

NASA’s first priority is crew safety. On Mars, a message to Earth takes minutes to arrive, so an astronaut on a spacewalk can’t wait for mission control to say “turn left.” Marswalk keeps the crew safe on their own. It plans routes around steep slopes and boulders, tracks how much time and radiation each walk costs, and always knows the fastest way to shelter.

## Creativity: What’s new here?

Tools like JPL Mars Trek show NASA data at a regional or global scale. Marswalk works at the scale of a single walk. Three ideas set it apart:

The helmet reroutes on its own when the astronaut drifts off course, with no connection to the base station.
Shelter is part of the map, not an afterthought. Every point on the route shows the walking time to the nearest cover.
The HUD puts arrows on the ground, so the astronaut follows the path without reading a map.

## Validity: Does it actually work?

Yes, the routing runs end to end in the browser.

A pathfinding with a suit-adjusted hiking speed (Tobler’s function)
Shelters found by measuring how much of the sky the terrain blocks, in 16 directions
Radiation dose based on Curiosity RAD’s measured average of 0.64 mSv per day, reduced by terrain shielding
Position drift simulated the way an IMU would drift, with regular corrections

To be clear, the terrain is a simulated analogue of the Mount Sharp foothills in Gale Crater. Each layer maps to a named NASA dataset, and the pipeline is built to take HiRISE elevation tiles directly.

## Relevance: How does it answer the challenge?

The challenge asks for a tool a Mars astronaut could use on a surface mission, with at least three kinds of data, a focus on safety, and a route that avoids obstacles. Marswalk layers six:

Data type NASA source Use in Marswalk
Optical HiRISE, CTX Base map, sand and boulders
Topographic HiRISE DTM, MOLA Slope, no-go zones, walking time
Thermal THEMIS thermal inertia Soft ground warnings
Spectral CRISM Picking science targets
Radiation Curiosity RAD Dose along the route, shelter value
Space weather NASA DONKI Solar alerts that trigger shelter routes

## Presentation: What will the demo show?

In 30 seconds: the planner draws a route to a boxwork ridge. The astronaut starts walking and the position estimate slowly drifts. We push them off course, and the helmet reroutes on its own. Then a solar alert fires, and a pink route leads to the nearest shelter.
