import type { Network } from "../types";

/** Illustrative logistics inputs. Corridors do not represent surveyed road geometry. */
export const network: Network = {
  region: "South Sudan",
  notice: "Illustrative scenario: approximate locations and synthetic corridors, travel times, risk, stock and population figures. No live access data.",
  nodes: [
    { id: "juba", name: "Juba", kind: "hub", coordinates: [31.5825, 4.8594], description: "National logistics hub", stockTonnes: 115 },
    { id: "wau", name: "Wau", kind: "hub", coordinates: [27.989, 7.703], description: "Regional depot", stockTonnes: 90 },
    { id: "malakal", name: "Malakal", kind: "hub", coordinates: [31.66, 9.533], description: "River transfer hub", stockTonnes: 85 },
    { id: "bor", name: "Bor", kind: "community", coordinates: [31.56, 6.21], people: 18400, demandTonnes: 28, ipc: 4, foodDays: 6, plannedHub: "juba" },
    { id: "rumbek", name: "Rumbek", kind: "community", coordinates: [29.68, 6.81], people: 15200, demandTonnes: 23, ipc: 3, foodDays: 9, plannedHub: "juba" },
    { id: "bentiu", name: "Bentiu", kind: "community", coordinates: [29.83, 9.23], people: 22600, demandTonnes: 34, ipc: 4, foodDays: 5, plannedHub: "malakal" },
    { id: "aweil", name: "Aweil", kind: "community", coordinates: [27.397, 8.769], people: 17100, demandTonnes: 26, ipc: 3, foodDays: 8, plannedHub: "wau" },
    { id: "yei", name: "Yei", kind: "community", coordinates: [30.677, 4.095], people: 13900, demandTonnes: 21, ipc: 4, foodDays: 7, plannedHub: "juba" },
    { id: "renk", name: "Renk", kind: "community", coordinates: [32.797, 11.749], people: 12400, demandTonnes: 19, ipc: 3, foodDays: 11, plannedHub: "malakal" },
    { id: "torit", name: "Torit", kind: "community", coordinates: [32.567, 4.411], people: 10800, demandTonnes: 17, ipc: 3, foodDays: 10, plannedHub: "juba" },
    { id: "mundri", name: "Mundri", kind: "junction", coordinates: [30.33, 5.35] },
  ],
  corridors: [
    { id: "juba-bor", from: "juba", to: "bor", hours: 5, name: "Juba–Bor", risk: 0.17 },
    { id: "bor-malakal", from: "bor", to: "malakal", hours: 9, name: "Bor–Malakal", risk: 0.24 },
    { id: "malakal-renk", from: "malakal", to: "renk", hours: 7, name: "Malakal–Renk", risk: 0.19 },
    { id: "juba-rumbek", from: "juba", to: "rumbek", hours: 10, name: "Juba–Rumbek", risk: 0.14 },
    { id: "rumbek-wau", from: "rumbek", to: "wau", hours: 7, name: "Rumbek–Wau", risk: 0.12 },
    { id: "rumbek-bentiu", from: "rumbek", to: "bentiu", hours: 9, name: "Rumbek–Bentiu", risk: 0.29 },
    { id: "bentiu-malakal", from: "bentiu", to: "malakal", hours: 8, name: "Bentiu–Malakal", risk: 0.27 },
    { id: "wau-aweil", from: "wau", to: "aweil", hours: 5, name: "Wau–Aweil", risk: 0.15 },
    { id: "bentiu-aweil", from: "bentiu", to: "aweil", hours: 10, name: "Bentiu–Aweil", risk: 0.23 },
    { id: "juba-mundri", from: "juba", to: "mundri", hours: 6, name: "Juba–Mundri", risk: 0.11 },
    { id: "mundri-wau", from: "mundri", to: "wau", hours: 12, name: "Mundri–Wau", risk: 0.18 },
    { id: "mundri-yei", from: "mundri", to: "yei", hours: 8, name: "Mundri–Yei", risk: 0.21 },
    { id: "juba-yei", from: "juba", to: "yei", hours: 5, name: "Juba–Yei", risk: 0.22 },
    { id: "juba-torit", from: "juba", to: "torit", hours: 6, name: "Juba–Torit", risk: 0.13 },
    { id: "torit-yei", from: "torit", to: "yei", hours: 12, name: "Torit–Yei", risk: 0.16 },
  ],
  scenarios: [
    { id: "open", label: "All corridors open", description: "Start with the planned supply network.", closedRoads: [] },
    { id: "bor", label: "Bor disruption", description: "Close the Juba–Bor corridor and find an alternative path.", closedRoads: ["juba-bor"] },
    { id: "flood", label: "Flood exposure", description: "Model three closures that leave Bor without an open supply route.", closedRoads: ["juba-bor", "bor-malakal", "rumbek-bentiu"] },
    { id: "south", label: "Southern disruption", description: "Reroute Yei deliveries through the remaining southern connection.", closedRoads: ["juba-yei", "mundri-yei"] },
    { id: "compound", label: "Compound disruption", description: "Combine closures to test supplier changes and rerouting.", closedRoads: ["juba-bor", "rumbek-bentiu", "bentiu-malakal", "juba-yei"] },
  ],
};
