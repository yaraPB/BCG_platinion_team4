"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { Map as LibreMap, Marker, GeoJSONSource } from "maplibre-gl";
import { Crosshair, Layers, Mountain, Plus, Minus, X, Route, Ship, Truck, ArrowUpRight, CloudRain, TriangleAlert } from "lucide-react";
import type { FeatureCollection, Feature } from "geojson";
import boundary from "@/lib/data/south-sudan.json";
import type { Network, Plan, SimulationClock, HazardId } from "../model/types";
import { lightBasemap } from "./basemap";
import { circle, pointAlong, vehiclePosition, warehouseIcon, shipIcon, truckIcon } from "./geometry";
import { SchematicMap } from "./schematic-map";

interface Props { network: Network; plan: Plan; baseline: Plan; selectedId: string; clock: RefObject<SimulationClock>; reducedMotion: boolean; onSelect: (id: string) => void; onToggleRoad: (id: string) => void; probabilities: Record<HazardId, number> }
const collection = (features: Feature[]): FeatureCollection => ({ type: "FeatureCollection", features });
const line = (coordinates: number[][], properties = {}): Feature => ({ type: "Feature", properties, geometry: { type: "LineString", coordinates } });

export default function NetworkMap({ network, plan, baseline, selectedId, clock, reducedMotion, onSelect, onToggleRoad, probabilities }: Props) {
  const container = useRef<HTMLDivElement>(null), mapRef = useRef<LibreMap | null>(null);
  const [ready, setReady] = useState(false), [failed, setFailed] = useState(false);
  const [risks, setRisks] = useState(false), [routes, setRoutes] = useState(true), [terrain, setTerrain] = useState(false);
  const [roadId, setRoadId] = useState<string | null>(null);
  const selected = plan.deliveries.find(d => d.communityId === selectedId)!;
  const activeRoad = network.corridors.find(r => r.id === roadId);
  const callbacks = useRef({ onSelect });
  useEffect(() => { callbacks.current = { onSelect }; }, [onSelect]);

  useEffect(() => {
    let disposed = false, instance: LibreMap | null = null;
    const timeout = window.setTimeout(() => { if (!disposed && !instance?.isStyleLoaded()) setFailed(true); }, 25000);
    let observer: ResizeObserver | null = null;
    async function initialize() {
      try {
        const { Map, setWorkerUrl, AttributionControl } = await import("maplibre-gl");
        if (disposed || !container.current) return;
        setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());
        instance = new Map({ container: container.current, style: lightBasemap(), center: [30.45, 7.85], zoom: 5.8, minZoom: 4, maxZoom: 14, attributionControl: false, pitch: 0, maxPitch: 55, renderWorldCopies: false });
        mapRef.current = instance;
        instance.addControl(new AttributionControl({ compact: true, customAttribution: '<a href="https://openfreemap.org/" target="_blank">OpenFreeMap</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap</a> · <a href="https://www.naturalearthdata.com/" target="_blank">Natural Earth</a>' }), "bottom-right");
        instance.on("load", () => {
          if (disposed || !instance) return;
          clearTimeout(timeout);
          const map = instance;
          const firstLabel = map.getStyle().layers.find(l => l.type === "symbol")?.id;
          map.addSource("country", { type: "geojson", data: boundary as unknown as FeatureCollection });
          map.addLayer({ id: "country-fill", source: "country", type: "fill", paint: { "fill-color": "#b9cabc", "fill-opacity": .11 } }, firstLabel);
          map.addLayer({ id: "country-edge", source: "country", type: "line", paint: { "line-color": "#7e9d8f", "line-width": 1.4, "line-opacity": .7, "line-dasharray": [3, 2] } }, firstLabel);
          map.addSource("hazards", { type: "geojson", data: collection([]) });
          map.addLayer({ id: "hazard-fill", type: "fill", source: "hazards", paint: { "fill-color": ["get", "color"], "fill-opacity": .12 } });
          map.addLayer({ id: "hazard-edge", type: "line", source: "hazards", paint: { "line-color": ["get", "color"], "line-opacity": .6, "line-width": 1.2, "line-dasharray": [3, 3] } });
          map.addSource("corridors", { type: "geojson", data: collection([]) });
          map.addLayer({ id: "corridor-casing", type: "line", source: "corridors", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": 6, "line-opacity": .9 } });
          map.addLayer({ id: "corridor-road", type: "line", source: "corridors", filter: ["==", ["get", "mode"], "road"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["case", ["get", "closed"], "#d08168", "#9cadab"], "line-width": 2, "line-opacity": .85 } });
          map.addLayer({ id: "corridor-river", type: "line", source: "corridors", filter: ["==", ["get", "mode"], "river"], paint: { "line-color": ["case", ["get", "closed"], "#d08168", "#65a2bb"], "line-width": 2.4, "line-dasharray": [2, 1] } });
          map.addLayer({ id: "corridor-closed", type: "line", source: "corridors", filter: ["==", ["get", "closed"], true], paint: { "line-color": "#c66c55", "line-width": 3, "line-dasharray": [2, 2] } });
          map.addSource("baseline", { type: "geojson", data: collection([]) });
          map.addLayer({ id: "baseline-line", type: "line", source: "baseline", paint: { "line-color": "#a27e6f", "line-width": 3, "line-opacity": .65, "line-dasharray": [2, 3] } });
          map.addSource("selected", { type: "geojson", data: collection([]) });
          map.addLayer({ id: "selected-halo", type: "line", source: "selected", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": .9 } });
          map.addLayer({ id: "selected-line", type: "line", source: "selected", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["case", ["==", ["get", "mode"], "river"], "#3986a6", "#11866a"], "line-width": 4 } });
          map.addLayer({ id: "corridor-hit", type: "line", source: "corridors", paint: { "line-width": 20, "line-opacity": 0 } });
          map.on("click", "corridor-hit", event => { const id = event.features?.[0]?.properties?.id; if (id) setRoadId(id); });
          map.on("mouseenter", "corridor-hit", () => { map.getCanvas().style.cursor = "pointer"; });
          map.on("mouseleave", "corridor-hit", () => { map.getCanvas().style.cursor = ""; });
          map.fitBounds([[26.6, 3.65], [33.5, 12.2]], { padding: { top: 80, bottom: 90, left: 50, right: 90 }, duration: 0 });
          setReady(true);
        });
        observer = new ResizeObserver(() => instance?.resize());
        observer.observe(container.current);
      } catch { if (!disposed) setFailed(true); }
    }
    void initialize();
    return () => { disposed = true; clearTimeout(timeout); observer?.disconnect(); instance?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current; if (!ready || !map) return;
    (map.getSource("corridors") as GeoJSONSource).setData(collection(network.corridors.map(r => line(r.coordinates, { id: r.id, mode: r.mode, closed: plan.closedRoads.includes(r.id) }))));
    (map.getSource("selected") as GeoJSONSource).setData(collection(selected.legs.map(l => line(l.coordinates, { mode: l.mode }))));
    const before = baseline.deliveries.find(d => d.communityId === selectedId)!;
    (map.getSource("baseline") as GeoJSONSource).setData(collection(selected.status !== "on-plan" ? [line(before.coordinates)] : []));
    (map.getSource("hazards") as GeoJSONSource).setData(collection(network.hazards.filter(h => probabilities[h.id] > 0).map(h => ({ type: "Feature", properties: { color: h.color }, geometry: { type: "Polygon", coordinates: [circle(h.center, h.radiusKm * (.5 + probabilities[h.id]))] } }))));
  }, [ready, network, plan, selected, baseline, selectedId, probabilities]);

  useEffect(() => {
    const map = mapRef.current; if (!ready || !map) return;
    let cancelled = false, frame = 0;
    const markers: Marker[] = [];
    async function drawMarkers() {
      const { Marker } = await import("maplibre-gl");
      if (cancelled || !map) return;
      for (const node of network.nodes) {
        if (node.kind === "junction" || node.kind === "port") continue;
        const el = document.createElement("button");
        el.type = "button";
        el.className = `map-node ${node.kind} ${node.id === selectedId ? "selected" : ""}`;
        const delivery = plan.deliveries.find(d => d.communityId === node.id);
        if (delivery?.status === "unreachable") el.classList.add("unreachable");
        el.innerHTML = `<span class="node-symbol">${node.kind === "hub" ? warehouseIcon : '<span></span>'}</span><span class="node-label"><strong>${node.name}</strong><small>${node.kind === "hub" ? (node.air ? "supplier · airstrip" : "supplier") : `${(node.people / 1000).toFixed(1)}k people`}</small></span>`;
        el.setAttribute("aria-label", node.kind === "hub" ? `${node.name} supplier` : `Select delivery to ${node.name}`);
        el.addEventListener("click", event => { event.stopPropagation(); if (node.kind === "community") callbacks.current.onSelect(node.id); else { const delivery = plan.deliveries.find(d => d.supplierId === node.id); if (delivery) callbacks.current.onSelect(delivery.communityId); } });
        markers.push(new Marker({ element: el, anchor: "left", offset: [-13, 0] }).setLngLat(node.coordinates).addTo(map));
      }
      for (const id of plan.closedRoads) {
        const road = network.corridors.find(r => r.id === id);
        if (!road) continue;  // e.g. a port transfer: closed in the model, not drawn on the map
        const el = document.createElement("button"); el.type = "button"; el.className = "closure-marker"; el.textContent = "×"; el.title = `${road.name} closed`; el.setAttribute("aria-label", `Inspect closed ${road.name}`);
        el.onclick = event => { event.stopPropagation(); setRoadId(id); };
        markers.push(new Marker({ element: el }).setLngLat(pointAlong(road.coordinates, .5).point).addTo(map));
      }
      const vehicles = plan.deliveries.flatMap((delivery, index) => {
        if (!delivery.legs.length) return [];
        const el = document.createElement("button"); el.type = "button"; el.className = `map-vehicle ${delivery.communityId === selectedId ? "selected" : ""}`;
        el.innerHTML = `<span class="vehicle-body">${truckIcon}</span><span class="vehicle-label">VM-${String(index + 1).padStart(3, "0")}</span>`;
        el.setAttribute("aria-label", `Track transport to ${delivery.name}`);
        el.onclick = event => { event.stopPropagation(); callbacks.current.onSelect(delivery.communityId); };
        const marker = new Marker({ element: el }).setLngLat(delivery.coordinates[0]).addTo(map); markers.push(marker);
        return [{ delivery, index, marker, body: el.firstElementChild as HTMLElement, mode: "road" }];
      });
      let last = 0;
      const animate = (now: number) => {
        if (now - last > (reducedMotion ? 180 : 32)) {
          for (const vehicle of vehicles) {
            const position = vehiclePosition(vehicle.delivery, vehicle.index, clock.current.hour);
            if (!position) continue;
            vehicle.marker.setLngLat(position.point);
            if (vehicle.mode !== position.mode) { vehicle.body.innerHTML = position.mode === "river" ? shipIcon : truckIcon; vehicle.mode = position.mode; }
            vehicle.body.style.transform = `rotate(${position.bearing - map.getBearing()}deg)`;
          }
          last = now;
        }
        frame = requestAnimationFrame(animate);
      };
      frame = requestAnimationFrame(animate);
    }
    void drawMarkers();
    return () => { cancelled = true; cancelAnimationFrame(frame); markers.forEach(marker => marker.remove()); };
  }, [ready, network, plan, selectedId, clock, reducedMotion]);

  useEffect(() => {
    const map = mapRef.current; if (!map || !ready) return;
    ["hazard-fill", "hazard-edge"].forEach(id => map.setLayoutProperty(id, "visibility", risks ? "visible" : "none"));
    ["corridor-casing", "corridor-road", "corridor-river", "corridor-closed", "corridor-hit"].forEach(id => map.setLayoutProperty(id, "visibility", routes ? "visible" : "none"));
  }, [ready, risks, routes]);

  function fit() { mapRef.current?.fitBounds([[26.6, 3.65], [33.5, 12.2]], { padding: { top: 80, bottom: 90, left: 50, right: 90 }, pitch: 0, bearing: 0, duration: reducedMotion ? 0 : 800 }); setTerrain(false); mapRef.current?.setTerrain(null); }
  function toggleTerrain() {
    const map = mapRef.current; if (!map || !ready) return;
    if (!map.getSource("elevation")) {
      map.addSource("elevation", { type: "raster-dem", tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"], encoding: "terrarium", tileSize: 256, maxzoom: 12, attribution: "Elevation: Mapzen / AWS" });
      map.addLayer({ id: "hillshade", type: "hillshade", source: "elevation", paint: { "hillshade-exaggeration": .22, "hillshade-shadow-color": "#768477", "hillshade-highlight-color": "#fffdf6" } }, "country-fill");
    }
    map.setTerrain(terrain ? null : { source: "elevation", exaggeration: 2 });
    map.setLayoutProperty("hillshade", "visibility", terrain ? "none" : "visible");
    map.easeTo({ pitch: terrain ? 0 : 42, bearing: terrain ? 0 : -8, duration: reducedMotion ? 0 : 800 }); setTerrain(!terrain);
  }
  function focusDelivery() {
    const coords = selected.coordinates.length ? selected.coordinates : [network.nodes.find(n => n.id === selectedId)!.coordinates];
    const lngs = coords.map(p => p[0]), lats = coords.map(p => p[1]);
    mapRef.current?.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 110, maxZoom: 8.5, duration: reducedMotion ? 0 : 800 });
  }

  return <section className="network-map" aria-label="South Sudan delivery map">
    {failed ? <SchematicMap network={network} plan={plan} selectedId={selectedId} onSelect={onSelect} onToggleRoad={onToggleRoad} /> : <div ref={container} className="map-canvas" />}
    {!ready && !failed && <div className="map-loading"><span className="loading-ring" /><strong>Connecting the network</strong><span>Loading the South Sudan map…</span></div>}
    <div className="map-title"><span className="map-title-icon"><Route size={17} /></span><div><strong>South Sudan</strong><span>FOOD DELIVERY NETWORK</span></div><span className="map-status"><i />{plan.closedRoads.length ? `${plan.closedRoads.length} closures` : "All corridors open"}</span></div>
    <div className="map-tools"><button title="Fit entire network" aria-label="Fit entire network" onClick={fit} disabled={!ready || failed}><Crosshair size={18} /></button><button title="Zoom in" aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()} disabled={!ready || failed}><Plus size={18} /></button><button title="Zoom out" aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()} disabled={!ready || failed}><Minus size={18} /></button></div>
    {!failed && <div className="map-layers"><button aria-pressed={routes} onClick={() => setRoutes(!routes)}><Layers size={14} />Routes</button><button aria-pressed={risks} onClick={() => setRisks(!risks)}><CloudRain size={14} />Risk areas</button><button aria-pressed={terrain} onClick={toggleTerrain} disabled={!ready}><Mountain size={14} />3D terrain</button></div>}
    {risks && !failed && <div className="hazard-legend"><span>ILLUSTRATIVE EXPOSURE</span>{network.hazards.map(h => <div key={h.id}><i style={{ background: h.color }} /><strong>{h.title.split(" · ")[0]}</strong><span>{Math.round(probabilities[h.id] * 100)}%</span></div>)}</div>}
    <div className="map-legend"><span><i className="legend-road" />Road convoy</span><span><i className="legend-river" />River barge</span><span><i className="legend-hub" />Supply hub</span>{plan.closedRoads.length > 0 && <span><i className="legend-closed" />Closed</span>}</div>
    <button className="map-selected-card" onClick={focusDelivery} disabled={!ready || failed}><span className="selected-card-icon">{selected.status === "unreachable" ? <TriangleAlert size={20} /> : selected.legs.some(l => l.mode === "river") ? <Ship size={20} /> : <Truck size={20} />}</span><span><small>SELECTED DELIVERY</small><strong>{selected.path.length ? network.nodes.find(n => n.id === selected.supplierId)?.name + " → " : ""}{selected.name}</strong><em>{selected.hours === null ? "No open supply route" : `${selected.assignedTonnes} t food · ${selected.distanceKm} km · ${selected.hours} h`}</em></span><ArrowUpRight size={17} /></button>
    {activeRoad && <div className="corridor-popover"><div><span className="eyebrow">CORRIDOR DETAILS</span><button className="icon-button" aria-label="Close corridor details" onClick={() => setRoadId(null)}><X size={16} /></button></div><strong>{activeRoad.name}</strong><p>{activeRoad.mode === "river" ? "River barge" : "Road convoy"} · {Math.round(activeRoad.distanceKm)} km · {activeRoad.hours} h</p><button className="button primary" onClick={() => { onToggleRoad(activeRoad.id); setRoadId(null); }}>{plan.closedRoads.includes(activeRoad.id) ? "Reopen corridor" : "Simulate closure"}</button></div>}
    <span className="map-simulation-note">Illustrative transport · no live tracking</span>
  </section>;
}
