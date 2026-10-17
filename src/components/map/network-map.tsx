"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type {
  ExpressionSpecification,
  GeoJSONSource,
  Map as LibreMap,
  Marker,
} from "maplibre-gl";
import {
  ArrowUpRight,
  Crosshair,
  Layers,
  Minus,
  Mountain,
  Plus,
  Ship,
  TriangleAlert,
  Truck,
  Waves,
  X,
} from "lucide-react";
import type { FeatureCollection, Feature } from "geojson";
import boundary from "@/lib/data/south-sudan.json";
import { palette, percent, statusMeta } from "@/lib/presentation";
import type { HazardId, Network, Plan, SimulationClock } from "../model/types";
import { darkBasemap } from "./basemap";
import {
  circle,
  hatchTile,
  pointAlong,
  shipIcon,
  truckIcon,
  vehiclePosition,
  warehouseIcon,
} from "./geometry";
import { SchematicMap } from "./schematic-map";

export type MapView = "tower" | "forecast" | "playbook" | "corridors";

interface Props {
  network: Network;
  plan: Plan;
  baseline: Plan;
  selectedId: string;
  clock: RefObject<SimulationClock>;
  reducedMotion: boolean;
  onSelect: (id: string) => void;
  onToggleRoad: (id: string) => void;
  probabilities: Record<HazardId, number>;
  view: MapView;
  roadRisk: { id: string; probability: number }[] | null;
  highlightRoadId: string | null;
  children?: ReactNode;
}

const BOUNDS: [[number, number], [number, number]] = [
  [27.15, 4],
  [32.95, 11.85],
];
const collection = (features: Feature[]): FeatureCollection => ({
  type: "FeatureCollection",
  features,
});
const line = (coordinates: number[][], properties = {}): Feature => ({
  type: "Feature",
  properties,
  geometry: { type: "LineString", coordinates },
});
const modeColor: ExpressionSpecification = [
  "case",
  ["==", ["get", "mode"], "river"],
  palette.river,
  palette.route,
];
const riskColor: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["get", "risk"],
  0,
  "#33434b",
  0.35,
  palette.amber,
  0.7,
  palette.coral,
  1,
  "#ff7a6a",
];
// Dash phases that read as flow from the hub toward the community.
const FLOW_STEPS = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 0.5],
  [3, 4, 0],
  [0, 0.5, 3, 3.5],
  [0, 1, 3, 3],
  [0, 1.5, 3, 2.5],
  [0, 2, 3, 2],
  [0, 2.5, 3, 1.5],
  [0, 3, 3, 1],
  [0, 3.5, 3, 0.5],
];

export default function NetworkMap({
  network,
  plan,
  baseline,
  selectedId,
  clock,
  reducedMotion,
  onSelect,
  onToggleRoad,
  probabilities,
  view,
  roadRisk,
  highlightRoadId,
  children,
}: Props) {
  const container = useRef<HTMLDivElement>(null),
    mapRef = useRef<LibreMap | null>(null);
  const [ready, setReady] = useState(false),
    [failed, setFailed] = useState(false);
  const [risks, setRisks] = useState(false),
    [routes, setRoutes] = useState(true),
    [terrain, setTerrain] = useState(false);
  const [roadId, setRoadId] = useState<string | null>(null);
  const selected = plan.deliveries.find((d) => d.communityId === selectedId)!;
  const activeRoad = network.corridors.find((r) => r.id === roadId);
  const callbacks = useRef({ onSelect });
  useEffect(() => {
    callbacks.current = { onSelect };
  }, [onSelect]);
  // Marker elements keyed by node id or `vehicle:<community>` so selection can
  // toggle a class instead of rebuilding every marker.
  const markerEls = useRef(new Map<string, HTMLElement>());
  const selectedRef = useRef(selectedId);
  const risksVisible = risks || view === "forecast" || view === "playbook";
  const riskLayer = (view === "forecast" || view === "playbook") && !!roadRisk;
  // Leave room for the overlays: the journey inspector on wide screens sits on
  // the right; on narrow screens the overlays stack at the edges instead.
  const framePadding = (forView: MapView = view) => {
    const width = container.current?.clientWidth ?? 1200;
    if (width < 760) return { top: 90, bottom: 120, left: 24, right: 24 };
    return { top: 70, bottom: 90, left: 50, right: forView === "tower" ? 360 : 110 };
  };

  useEffect(() => {
    let disposed = false,
      instance: LibreMap | null = null;
    const timeout = window.setTimeout(() => {
      if (!disposed && !instance?.isStyleLoaded()) setFailed(true);
    }, 25000);
    let observer: ResizeObserver | null = null;
    async function initialize() {
      try {
        const { Map, setWorkerUrl, AttributionControl } =
          await import("maplibre-gl");
        if (disposed || !container.current) return;
        setWorkerUrl(
          new URL(
            "maplibre-gl/dist/maplibre-gl-worker.mjs",
            import.meta.url,
          ).toString(),
        );
        instance = new Map({
          container: container.current,
          style: darkBasemap(),
          center: [30.45, 7.85],
          zoom: 5.8,
          minZoom: 4,
          maxZoom: 14,
          attributionControl: false,
          pitch: 0,
          maxPitch: 55,
          renderWorldCopies: false,
          fadeDuration: 150,
        });
        mapRef.current = instance;
        instance.addControl(
          new AttributionControl({
            compact: true,
            customAttribution:
              '<a href="https://routing.openstreetmap.de/about.html" target="_blank">Routes: OSRM / OSM</a> · <a href="https://www.naturalearthdata.com/" target="_blank">Natural Earth</a>',
          }),
          "bottom-right",
        );
        instance.on("load", () => {
          if (disposed || !instance) return;
          clearTimeout(timeout);
          const map = instance;
          const firstLabel = map
            .getStyle()
            .layers.find((l) => l.type === "symbol")?.id;
          for (const hazard of network.hazards) {
            const tile = hatchTile(hazard.color);
            if (tile && !map.hasImage(`hatch-${hazard.id}`))
              map.addImage(`hatch-${hazard.id}`, tile, { pixelRatio: 1 });
          }
          map.addSource("country", {
            type: "geojson",
            data: boundary as unknown as FeatureCollection,
          });
          map.addLayer(
            {
              id: "country-fill",
              source: "country",
              type: "fill",
              paint: { "fill-color": "#ffffff", "fill-opacity": 0.035 },
            },
            firstLabel,
          );
          map.addLayer(
            {
              id: "country-glow",
              source: "country",
              type: "line",
              paint: {
                "line-color": palette.route,
                "line-width": 7,
                "line-blur": 8,
                "line-opacity": 0.22,
              },
            },
            firstLabel,
          );
          map.addLayer(
            {
              id: "country-edge",
              source: "country",
              type: "line",
              paint: {
                "line-color": "#4a6a60",
                "line-width": 1,
                "line-opacity": 0.9,
              },
            },
            firstLabel,
          );
          map.addSource("hazards", { type: "geojson", data: collection([]) });
          map.addLayer({
            id: "hazard-tint",
            type: "fill",
            source: "hazards",
            paint: { "fill-color": ["get", "color"], "fill-opacity": 0.1 },
          });
          map.addLayer({
            id: "hazard-hatch",
            type: "fill",
            source: "hazards",
            paint: {
              "fill-pattern": ["concat", "hatch-", ["get", "id"]],
              "fill-opacity": 0.5,
            },
          });
          map.addLayer({
            id: "hazard-edge",
            type: "line",
            source: "hazards",
            paint: {
              "line-color": ["get", "color"],
              "line-opacity": 0.75,
              "line-width": 1.2,
            },
          });
          map.addSource("corridors", { type: "geojson", data: collection([]) });
          map.addLayer({
            id: "corridor-casing",
            type: "line",
            source: "corridors",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": palette.canvas,
              "line-width": 6,
              "line-opacity": 0.9,
            },
          });
          map.addLayer({
            id: "corridor-road",
            type: "line",
            source: "corridors",
            filter: ["==", ["get", "mode"], "road"],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": [
                "case",
                ["get", "closed"],
                palette.coral,
                palette.corridor,
              ],
              "line-width": 2,
              "line-opacity": 0.95,
            },
          });
          map.addLayer({
            id: "corridor-river",
            type: "line",
            source: "corridors",
            filter: ["==", ["get", "mode"], "river"],
            paint: {
              "line-color": [
                "case",
                ["get", "closed"],
                palette.coral,
                palette.river,
              ],
              "line-width": 2.4,
              "line-dasharray": [2, 1.4],
            },
          });
          map.addLayer({
            id: "corridor-closed",
            type: "line",
            source: "corridors",
            filter: ["==", ["get", "closed"], true],
            paint: {
              "line-color": palette.coral,
              "line-width": 2.6,
              "line-dasharray": [2, 2],
            },
          });
          map.addLayer({
            id: "corridor-risk",
            type: "line",
            source: "corridors",
            layout: {
              "line-cap": "round",
              "line-join": "round",
              visibility: "none",
            },
            paint: { "line-color": riskColor, "line-width": 3.4 },
          });
          map.addSource("highlight", { type: "geojson", data: collection([]) });
          map.addLayer({
            id: "highlight-glow",
            type: "line",
            source: "highlight",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": palette.ink,
              "line-width": 12,
              "line-blur": 8,
              "line-opacity": 0.35,
            },
          });
          map.addLayer({
            id: "highlight-line",
            type: "line",
            source: "highlight",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": palette.ink, "line-width": 2.5 },
          });
          map.addSource("baseline", { type: "geojson", data: collection([]) });
          map.addLayer({
            id: "baseline-line",
            type: "line",
            source: "baseline",
            paint: {
              "line-color": palette.baseline,
              "line-width": 2.5,
              "line-opacity": 0.75,
              "line-dasharray": [2, 3],
            },
          });
          map.addSource("selected", { type: "geojson", data: collection([]) });
          map.addLayer({
            id: "selected-glow",
            type: "line",
            source: "selected",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": modeColor,
              "line-width": 16,
              "line-blur": 10,
              "line-opacity": 0.32,
            },
          });
          map.addLayer({
            id: "selected-halo",
            type: "line",
            source: "selected",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": palette.canvas, "line-width": 7 },
          });
          map.addLayer({
            id: "selected-line",
            type: "line",
            source: "selected",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": modeColor, "line-width": 3.5 },
          });
          map.addLayer({
            id: "selected-flow",
            type: "line",
            source: "selected",
            layout: { "line-cap": "butt", "line-join": "round" },
            paint: {
              "line-color": "#f4f7f5",
              "line-width": 1.6,
              "line-opacity": 0.6,
              "line-dasharray": FLOW_STEPS[0],
            },
          });
          map.addLayer({
            id: "corridor-hit",
            type: "line",
            source: "corridors",
            paint: { "line-width": 22, "line-opacity": 0 },
          });
          map.on("click", "corridor-hit", (event) => {
            const id = event.features?.[0]?.properties?.id;
            if (id) setRoadId(id);
          });
          map.on("mouseenter", "corridor-hit", () => {
            map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", "corridor-hit", () => {
            map.getCanvas().style.cursor = "";
          });
          map.fitBounds(BOUNDS, { padding: framePadding(), duration: 0 });
          setReady(true);
        });
        observer = new ResizeObserver(() => instance?.resize());
        observer.observe(container.current);
      } catch {
        if (!disposed) setFailed(true);
      }
    }
    void initialize();
    return () => {
      disposed = true;
      clearTimeout(timeout);
      observer?.disconnect();
      instance?.remove();
      mapRef.current = null;
    };
    // The network fixtures are static for the life of the map instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Corridors and hazards: only when the plan, risk inputs or forecast change.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const risk = new Map(roadRisk?.map((r) => [r.id, r.probability]));
    (map.getSource("corridors") as GeoJSONSource).setData(
      collection(
        network.corridors.map((r) =>
          line(r.coordinates, {
            id: r.id,
            mode: r.mode,
            closed: plan.closedRoads.includes(r.id),
            risk: risk.get(r.id) ?? 0,
          }),
        ),
      ),
    );
    (map.getSource("hazards") as GeoJSONSource).setData(
      collection(
        network.hazards
          .filter((h) => probabilities[h.id] > 0)
          .map((h) => ({
            type: "Feature",
            properties: { id: h.id, color: h.color },
            geometry: {
              type: "Polygon",
              coordinates: [
                circle(h.center, h.radiusKm * (0.5 + probabilities[h.id])),
              ],
            },
          })),
      ),
    );
  }, [ready, network, plan.closedRoads, probabilities, roadRisk]);

  // Selected route and the planned route before closures.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("selected") as GeoJSONSource).setData(
      collection(
        selected.legs.map((l) => line(l.coordinates, { mode: l.mode })),
      ),
    );
    const before = baseline.deliveries.find(
      (d) => d.communityId === selectedId,
    )!;
    (map.getSource("baseline") as GeoJSONSource).setData(
      collection(
        selected.status !== "on-plan" ? [line(before.coordinates)] : [],
      ),
    );
  }, [ready, selected, baseline, selectedId]);

  // Hover highlight from the corridor and exposure lists.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const highlighted = network.corridors.find((r) => r.id === highlightRoadId);
    (map.getSource("highlight") as GeoJSONSource).setData(
      collection(highlighted ? [line(highlighted.coordinates)] : []),
    );
  }, [ready, network, highlightRoadId]);

  // Flow along the selected route: one paint property every ~70 ms.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (reducedMotion) {
      map.setPaintProperty("selected-flow", "line-dasharray", FLOW_STEPS[0]);
      return;
    }
    let frame = 0,
      step = 0,
      last = 0;
    const tick = (now: number) => {
      if (now - last > 70) {
        step = (step + 1) % FLOW_STEPS.length;
        map.setPaintProperty("selected-flow", "line-dasharray", FLOW_STEPS[step]);
        last = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ready, reducedMotion]);

  // Markers are built once per plan; selection only toggles a class.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    let cancelled = false,
      frame = 0;
    const markers: Marker[] = [];
    const els = markerEls.current;
    async function drawMarkers() {
      const { Marker } = await import("maplibre-gl");
      if (cancelled || !map) return;
      for (const node of network.nodes) {
        if (node.kind === "junction") continue;
        const el = document.createElement("button");
        el.type = "button";
        const delivery = plan.deliveries.find((d) => d.communityId === node.id);
        el.className = `map-node ${node.kind} ${delivery ? `status-${delivery.status}` : ""}`;
        el.innerHTML = `<span class="node-symbol">${node.kind === "hub" ? warehouseIcon : "<span></span>"}</span><span class="node-label"><strong>${node.name}</strong><small>${node.kind === "hub" ? `${plan.stockRemaining[node.id]} t reserve` : `${(node.people / 1000).toFixed(1)}k people`}</small></span>`;
        el.setAttribute(
          "aria-label",
          node.kind === "hub"
            ? `${node.name} supply hub, ${plan.stockRemaining[node.id]} tonnes remaining`
            : `Select delivery to ${node.name}${delivery ? `, ${statusMeta[delivery.status].label}` : ""}`,
        );
        el.addEventListener("click", (event) => {
          event.stopPropagation();
          if (node.kind === "community") callbacks.current.onSelect(node.id);
          else {
            const served = plan.deliveries.find(
              (d) => d.supplierId === node.id,
            );
            if (served) callbacks.current.onSelect(served.communityId);
          }
        });
        els.set(node.id, el);
        markers.push(
          new Marker({ element: el, anchor: "left", offset: [-13, 0] })
            .setLngLat(node.coordinates)
            .addTo(map),
        );
      }
      for (const id of plan.closedRoads) {
        const road = network.corridors.find((r) => r.id === id)!;
        const el = document.createElement("button");
        el.type = "button";
        el.className = "closure-marker";
        el.textContent = "×";
        el.title = `${road.name} closed`;
        el.setAttribute("aria-label", `Inspect closed ${road.name}`);
        el.onclick = (event) => {
          event.stopPropagation();
          setRoadId(id);
        };
        markers.push(
          new Marker({ element: el })
            .setLngLat(pointAlong(road.coordinates, 0.5).point)
            .addTo(map),
        );
      }
      const vehicles = plan.deliveries.flatMap((delivery, index) => {
        if (!delivery.legs.length) return [];
        const el = document.createElement("button");
        el.type = "button";
        el.className = "map-vehicle";
        el.innerHTML = `<span class="vehicle-body">${truckIcon}</span><span class="vehicle-label">VM-${String(index + 1).padStart(3, "0")}</span>`;
        el.setAttribute("aria-label", `Track transport to ${delivery.name}`);
        el.onclick = (event) => {
          event.stopPropagation();
          callbacks.current.onSelect(delivery.communityId);
        };
        els.set(`vehicle:${delivery.communityId}`, el);
        const marker = new Marker({ element: el })
          .setLngLat(delivery.coordinates[0])
          .addTo(map);
        markers.push(marker);
        return [
          {
            delivery,
            index,
            marker,
            body: el.firstElementChild as HTMLElement,
            mode: "road",
            bearing: 0,
          },
        ];
      });
      applySelection(els, selectedRef.current);
      let last = 0;
      const animate = (now: number) => {
        if (!reducedMotion || now - last > 180) {
          const bearing = map.getBearing();
          for (const vehicle of vehicles) {
            const position = vehiclePosition(
              vehicle.delivery,
              vehicle.index,
              clock.current.hour,
            );
            if (!position) continue;
            vehicle.marker.setLngLat(position.point);
            if (vehicle.mode !== position.mode) {
              vehicle.body.innerHTML =
                position.mode === "river" ? shipIcon : truckIcon;
              vehicle.mode = position.mode;
            }
            const target = position.bearing - bearing;
            if (Math.abs(target - vehicle.bearing) > 0.5) {
              vehicle.bearing = target;
              vehicle.body.style.transform = `rotate(${target}deg)`;
            }
          }
          last = now;
        }
        frame = requestAnimationFrame(animate);
      };
      frame = requestAnimationFrame(animate);
    }
    void drawMarkers();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      markers.forEach((marker) => marker.remove());
      els.clear();
    };
  }, [ready, network, plan, clock, reducedMotion]);

  useEffect(() => {
    selectedRef.current = selectedId;
    applySelection(markerEls.current, selectedId);
  }, [selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const show = (ids: string[], visible: boolean) =>
      ids.forEach((id) =>
        map.setLayoutProperty(id, "visibility", visible ? "visible" : "none"),
      );
    show(["hazard-tint", "hazard-hatch", "hazard-edge"], risksVisible);
    show(
      ["corridor-casing", "corridor-road", "corridor-river", "corridor-closed", "corridor-hit"],
      routes,
    );
    show(["corridor-risk"], routes && riskLayer);
  }, [ready, risksVisible, routes, riskLayer]);

  useEffect(() => {
    if (!ready) return;
    mapRef.current?.fitBounds(BOUNDS, {
      padding: framePadding(),
      pitch: 0,
      bearing: 0,
      duration: reducedMotion ? 0 : 700,
    });
    // Re-frame only when the workspace changes shape (view switch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, view]);

  function fit() {
    mapRef.current?.fitBounds(BOUNDS, {
      padding: framePadding(),
      pitch: 0,
      bearing: 0,
      duration: reducedMotion ? 0 : 800,
    });
    setTerrain(false);
    mapRef.current?.setTerrain(null);
    if (mapRef.current?.getLayer("hillshade"))
      mapRef.current.setLayoutProperty("hillshade", "visibility", "none");
  }
  function toggleTerrain() {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!map.getSource("elevation")) {
      const tiles = [
        "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
      ];
      map.addSource("elevation", {
        type: "raster-dem",
        tiles,
        encoding: "terrarium",
        tileSize: 256,
        maxzoom: 12,
        attribution: "Elevation: Mapzen / AWS",
      });
      map.addSource("elevation-shade", {
        type: "raster-dem",
        tiles,
        encoding: "terrarium",
        tileSize: 256,
        maxzoom: 12,
      });
      map.addLayer(
        {
          id: "hillshade",
          type: "hillshade",
          source: "elevation-shade",
          paint: {
            "hillshade-exaggeration": 0.35,
            "hillshade-shadow-color": "#04070a",
            "hillshade-highlight-color": "#55656d",
            "hillshade-accent-color": "#0b1013",
          },
        },
        "country-fill",
      );
    }
    map.setTerrain(terrain ? null : { source: "elevation", exaggeration: 2 });
    map.setLayoutProperty(
      "hillshade",
      "visibility",
      terrain ? "none" : "visible",
    );
    map.easeTo({
      pitch: terrain ? 0 : 42,
      bearing: terrain ? 0 : -8,
      duration: reducedMotion ? 0 : 800,
    });
    setTerrain(!terrain);
  }
  function focusDelivery() {
    const coords = selected.coordinates.length
      ? selected.coordinates
      : [network.nodes.find((n) => n.id === selectedId)!.coordinates];
    const lngs = coords.map((p) => p[0]),
      lats = coords.map((p) => p[1]);
    mapRef.current?.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      {
        padding: framePadding(),
        maxZoom: 8.5,
        duration: reducedMotion ? 0 : 800,
      },
    );
  }

  return (
    <section className="map-stage" aria-label="South Sudan delivery map">
      {failed ? (
        <SchematicMap
          network={network}
          plan={plan}
          selectedId={selectedId}
          onSelect={onSelect}
          onToggleRoad={onToggleRoad}
        />
      ) : (
        <div ref={container} className="map-canvas" />
      )}
      {!ready && !failed && (
        <div className="map-loading">
          <svg className="loading-route" viewBox="0 0 72 24" aria-hidden="true">
            <path d="M3 20 C 16 20, 22 5, 36 12 S 56 20, 69 4" />
          </svg>
          <strong>Connecting the network</strong>
          <span>Loading the South Sudan map</span>
        </div>
      )}
      <div className="map-tools">
        <button
          title="Fit entire network"
          aria-label="Fit entire network"
          onClick={fit}
          disabled={!ready || failed}
        >
          <Crosshair size={17} />
        </button>
        <button
          title="Zoom in"
          aria-label="Zoom in"
          onClick={() => mapRef.current?.zoomIn()}
          disabled={!ready || failed}
        >
          <Plus size={17} />
        </button>
        <button
          title="Zoom out"
          aria-label="Zoom out"
          onClick={() => mapRef.current?.zoomOut()}
          disabled={!ready || failed}
        >
          <Minus size={17} />
        </button>
        <button
          title={terrain ? "Flat map" : "3D terrain"}
          aria-label={terrain ? "Return to flat map" : "Show 3D terrain"}
          aria-pressed={terrain}
          onClick={toggleTerrain}
          disabled={!ready || failed}
        >
          <Mountain size={17} />
        </button>
      </div>

      <div className="map-legend" aria-label="Map layers and legend">
        <div className="legend-toggles">
          <button
            aria-pressed={routes}
            onClick={() => setRoutes(!routes)}
            disabled={failed}
          >
            <Layers size={13} />
            Routes
          </button>
          <button
            aria-pressed={risksVisible}
            onClick={() => setRisks(!risks)}
            disabled={failed || view === "forecast" || view === "playbook"}
          >
            <Waves size={13} />
            Risk areas
          </button>
        </div>
        <ul className="legend-keys">
          <li>
            <i className="key-line key-road" />
            Road convoy
          </li>
          <li>
            <i className="key-line key-river" />
            River barge
          </li>
          <li>
            <i className="key-hub" />
            Supply hub
          </li>
          {plan.closedRoads.length > 0 && (
            <li>
              <i className="key-line key-closed" />
              Closed corridor
            </li>
          )}
          {selected.status !== "on-plan" && selected.path.length > 0 && (
            <li>
              <i className="key-line key-baseline" />
              Planned route before closures
            </li>
          )}
        </ul>
        <ul className="legend-status" aria-label="Community status">
          {(Object.keys(statusMeta) as (keyof typeof statusMeta)[]).map(
            (status) => (
              <li key={status}>
                <i className={`key-dot status-${status}`} />
                {statusMeta[status].label}
              </li>
            ),
          )}
        </ul>
        {risksVisible && (
          <div className="legend-hazards">
            <span>Illustrative hazard footprints</span>
            {network.hazards.map((h) => (
              <div key={h.id}>
                <i
                  className="key-hatch"
                  style={{
                    backgroundImage: `repeating-linear-gradient(45deg, ${h.color} 0 2px, transparent 2px 7px)`,
                    borderColor: h.color,
                  }}
                />
                <strong>{h.title.split(" · ")[0]}</strong>
                <b>{percent(probabilities[h.id])}</b>
              </div>
            ))}
          </div>
        )}
        {riskLayer && routes && (
          <div className="legend-scale">
            <span>Corridor closure probability</span>
            <i />
            <small>
              <span>0%</span>
              <span>100%</span>
            </small>
          </div>
        )}
      </div>

      <button
        className={`map-selected-card status-${selected.status}`}
        onClick={focusDelivery}
        disabled={!ready || failed}
      >
        <span className="selected-card-icon">
          {selected.status === "unreachable" ? (
            <TriangleAlert size={18} />
          ) : selected.legs.some((l) => l.mode === "river") ? (
            <Ship size={18} />
          ) : (
            <Truck size={18} />
          )}
        </span>
        <span>
          <small>Selected delivery</small>
          <strong>
            {selected.path.length
              ? `${network.nodes.find((n) => n.id === selected.supplierId)?.name} to `
              : ""}
            {selected.name}
          </strong>
          <em>
            {selected.hours === null
              ? "No open supply route"
              : `${selected.assignedTonnes} t food, ${selected.distanceKm} km, ${selected.hours} h`}
          </em>
        </span>
        <ArrowUpRight size={16} />
      </button>

      {activeRoad && (
        <div className="corridor-popover" role="dialog" aria-label="Corridor details">
          <div className="popover-head">
            <span>Corridor</span>
            <button
              className="icon-button"
              aria-label="Close corridor details"
              onClick={() => setRoadId(null)}
            >
              <X size={15} />
            </button>
          </div>
          <strong>{activeRoad.name}</strong>
          <p>
            {activeRoad.mode === "river" ? "River barge" : "Road convoy"},{" "}
            {Math.round(activeRoad.distanceKm)} km, {activeRoad.hours} h
          </p>
          <button
            className="button primary"
            onClick={() => {
              onToggleRoad(activeRoad.id);
              setRoadId(null);
            }}
          >
            {plan.closedRoads.includes(activeRoad.id)
              ? "Reopen corridor"
              : "Simulate closure"}
          </button>
        </div>
      )}
      {children}
    </section>
  );
}

function applySelection(els: Map<string, HTMLElement>, selectedId: string) {
  for (const [key, el] of els) {
    const isSelected =
      key === selectedId || key === `vehicle:${selectedId}`;
    if (el.classList.contains("selected") === isSelected) continue;
    el.classList.toggle("selected", isSelected);
  }
}
