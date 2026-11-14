## **Admin View — Mission Control**

**Purpose:** Plan, optimize, and manage Mars surface exploration missions using NASA scientific data.

| Feature               | Description                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| NASA Data Integration | Utilize relevant NASA APIs and scientific datasets to support mission planning and risk assessment. |
| Interactive Mars Map  | Display the Martian surface using NASA Mars Trek WMTS API.                                          |
| Layer Control         | Toggle Optical, Topographic, Spectral, and Thermal layers and adjust their opacity.                 |
| Waypoint Selection    | Select Point A, Point B, and intermediate scientific exploration sites.                             |
| Weight Control        | Adjust priorities for distance, slope, terrain safety, thermal conditions, and scientific value.    |
| Route Optimization    | Calculate the optimal route using weighted pathfinding and NASA datasets.                           |
| Route Comparison      | Compare routes based on distance, estimated travel time, safety, and scientific value.              |
| Hazard Management     | Identify hazardous terrain and define no-go zones.                                                  |
| Mission Deployment    | Send the approved route to the astronaut's device.                                                  |
| Mission Monitoring    | Track astronaut location and mission progress.                                                      |

## **User View — Astronaut HUD**

**Purpose:** Provide lightweight, intuitive, and safety-oriented navigation during Mars surface exploration.

| Feature                 | Description                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------- |
| Directional Arrow       | Display the recommended movement direction based on the astronaut's orientation.      |
| Waypoint Guidance       | Guide astronauts through predefined checkpoints.                                      |
| Distance Tracking       | Display the remaining distance to the next waypoint and final destination.            |
| Environmental Awareness | Provide relevant environmental and geological information derived from NASA datasets. |
| Hazard Alerts           | Warn astronauts about upcoming obstacles and hazardous terrain.                       |
| Mission Progress        | Track completed checkpoints and scientific objectives.                                |
| Resource Monitoring     | Display oxygen levels, battery levels, and remaining exploration time.                |
| Off-route Detection     | Detect route deviations and provide corrective guidance.                              |
| Emergency Return        | Calculate a return route to the habitat based on safety constraints.                  |
| Offline Navigation      | Operate independently of Earth-based network connectivity.                            |

## **NASA APIs & Datasets**

| Resource                                                                                                    | Application                                               |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| [NASA Mars Trek WMTS API](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars&utm_source=chatgpt.com) | Interactive map and multilayer visualization              |
| [HiRISE](https://www.uahirise.org/?utm_source=chatgpt.com)                                                  | Optical imagery and terrain analysis                      |
| [MOLA / HiRISE DTM](https://pds-geosciences.wustl.edu/missions/mgs/mola.html?utm_source=chatgpt.com)        | Elevation, slope, and mobility analysis                   |
| [CRISM](https://pds-geosciences.wustl.edu/missions/mro/crism.htm?utm_source=chatgpt.com)                    | Mineral identification and scientific exploration targets |
| [THEMIS](https://pds-geosciences.wustl.edu/missions/odyssey/themis.html?utm_source=chatgpt.com)             | Thermal properties and surface material analysis          |
| [NASA Planetary Data System](https://pds.nasa.gov/?utm_source=chatgpt.com)                                  | Access to scientific mission datasets                     |

## **Shared Technical Requirements**

- Lightweight and offline-first architecture
- Multi-mission NASA data integration
- Configurable, weighted pathfinding
- Safety-first route optimization
- Local data storage and mission synchronization
- Minimal dependency on Earth-based infrastructure

## **Core Workflow**

#### **01**

**Explore NASA Data Layers**

Optical · Topographic · Spectral · Thermal

Admin

#### **02**

**Select Point A and Point B**

Define the exploration mission

Admin

#### **03**

**Configure Weights**

Customize mission priorities

Admin

#### **04**

**Calculate & Deploy Route**

Generate the optimal path

Admin

#### **05**

**Navigate via HUD**

Follow directional arrows and safety alerts

User
