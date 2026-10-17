# Lifeline Logistics

**Food reaches people even when the roads don't.**

Lifeline Logistics is a demo built by Team 4 for the BCG Platinion hackathon on world hunger. It shows how relief food can keep moving from ports, depots and hubs to camps and villages when the road network is unreliable.

When a road is cut, deliveries are rerouted. If a community is left with no road to its planned supplier, the nearest supplier it can still reach that has stock takes over. Live hazard alerts let teams plan for this before a road closes.

> The demo runs on a fictional network, the **Kaveri region**: 4 suppliers, 8 communities and about 108,500 people. All stocks, roads and alerts are made up.

---

## Features

### 1. At-a-glance overview

The page opens with four headline numbers that update as conditions change:

- **People with food en route**: how many people are still reachable
- **Deliveries on plan**: how many are on plan, rerouted, served by a different supplier, or unreachable
- **Network state**: whether the road network is still connected or has split into separate parts
- **Chance of disruption (72 h)**: how likely the network is to be disrupted, according to the forecast

### 2. Control tower

An interactive map of suppliers, junctions, communities and roads.

- **Close or reopen any road** by clicking it. Every delivery is recalculated straight away.
- **One-click scenarios** to try common disruptions:
  - Checkpoint on the N1 highway
  - Sava river flood
  - Storm (flood plus landslide)
  - Port access blocked
- **Status banner** that explains in plain language what changed: all roads open, roads closed but the network still connected, or the network split into separate parts.
- **Delivery details**: select a community to see its route, supplier, travel time, why that choice was made, and the alternatives.
- **Event log** listing every closure and decision, newest first.
- **Dispatch board** listing all deliveries for the current cycle. The most urgent communities are served first, ranked by food insecurity level (IPC phase) and days of food left.

### 3. Risk forecast and simulation (next 72 hours)

- **Active hazard alerts** (heavy rainfall, landslide risk, insecurity, tropical storm), each with its source and likelihood. **Drag the sliders** to see how the outlook changes if an alert becomes more or less likely.
- **Road failure probability**: the 8 roads most likely to fail, shown as a chart or a table.
- **Delivery outcome by community**: run 2,000 simulated futures to see how likely each community is to stay on plan, be rerouted, need a different supplier, or be cut off.
- **Apply to control tower**: send the most likely closures to the map to see their effect.

### 4. Fallback playbook

A contingency plan that is ready before anything goes wrong.

- **Pre-positioning recommendations**: how much extra stock each supplier should hold so it can cover for others.
- **Contingency plan per community**: the most likely disruption, the road closure that triggers it, and what to do.

### 5. Usability

- Light and dark mode
- Statuses use an icon and a label as well as colour, so they don't depend on colour alone
- Hover tooltips on the map and charts
- Every chart can also be viewed as a table

---

## How it works (in short)

1. **Map the network.** Suppliers, communities and the roads between them, with travel times that depend on the road surface.
2. **Detect the split.** When roads close, check whether each community can still reach its supplier.
3. **Reroute or switch supplier.** Use the fastest open route, or switch to the nearest supplier that can still reach the community and has stock. The neediest communities get stock first.
4. **Predict and pre-plan.** Turn weather, river, landslide and security alerts into road risks, simulate the next 72 hours, and prepare the playbook in advance.

The same approach works for any logistics network. This demo is set up for food security.

---

## Running the demo

Open `demo/index_lina.html` in a web browser.

---

*IPC = Integrated Food Security Phase Classification.*
