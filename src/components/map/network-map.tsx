"use client";

import { useEffect, useRef, useState } from "react";
import { Expand } from "lucide-react";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { Network, Plan } from "@/lib/types";
import { emptyCollection, networkFeatures, vehicleFeatures } from "./geometry";
import { SchematicMap } from "./schematic-map";
import { addLightBasemap } from "./basemap";

interface Props { network: Network; plan: Plan; selectedId: string; playing: boolean; onSelect: (id: string) => void; onToggleRoad: (id: string) => void }

function fitNetwork(map: MapLibreMap, network: Network) {
  map.resize();
  const lngs = network.nodes.map((n) => n.coordinates[0]);
  const lats = network.nodes.map((n) => n.coordinates[1]);
  map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: { top: 45, right: 60, bottom: 55, left: 60 }, duration: 0 });
}

function updateSources(map: MapLibreMap, network: Network, plan: Plan, selectedId: string, phase: number) {
  const data = networkFeatures(network, plan, selectedId);
  (map.getSource("roads") as GeoJSONSource).setData(data.roads);
  (map.getSource("nodes") as GeoJSONSource).setData(data.points);
  (map.getSource("paths") as GeoJSONSource).setData(data.paths);
  (map.getSource("vehicles") as GeoJSONSource).setData(vehicleFeatures(plan, phase));
}

export default function NetworkMap(props: Props) {
  const { network, plan, selectedId, playing, onSelect, onToggleRoad } = props;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const latest = useRef({ plan, selectedId, onSelect, onToggleRoad });
  const phase = useRef(0);
  const [ready, setReady] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [basemapMissing, setBasemapMissing] = useState(false);

  useEffect(() => {
    latest.current = { plan, selectedId, onSelect, onToggleRoad };
    if (ready && mapRef.current) updateSources(mapRef.current, network, plan, selectedId, phase.current);
  }, [network, plan, selectedId, onSelect, onToggleRoad, ready]);

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;
    async function initialize() {
      try {
        const { Map, NavigationControl, AttributionControl, setWorkerUrl } = await import("maplibre-gl");
        if (cancelled || !container.current) return;
        setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());
        const map = new Map({ container: container.current, center: [30.3, 8], zoom: 5, minZoom: 3, maxZoom: 12, attributionControl: false, style: { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#f3f5f6" } }] } });
        mapRef.current = map;
        map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
        map.addControl(new AttributionControl({ compact: true }), "bottom-left");
        map.on("error", (event) => {
          if (cancelled) return;
          if (event.error.message.includes("openfreemap") || ("sourceId" in event && event.sourceId === "basemap")) setBasemapMissing(true);
          if (event.error.message.includes("Worker failed")) {
            resizeObserver?.disconnect();
            mapRef.current = null;
            setReady(false);
            setFallback(true);
            queueMicrotask(() => map.remove());
          }
        });
        map.on("load", () => {
          if (cancelled) return;
          addLightBasemap(map);
          for (const id of ["roads", "nodes", "paths", "vehicles"]) map.addSource(id, { type: "geojson", data: emptyCollection() });
          map.addLayer({ id: "roads", type: "line", source: "roads", paint: { "line-color": ["case", ["get", "closed"], "#bc665c", "#b9c1c6"], "line-width": 2, "line-dasharray": [3, 2] } });
          map.addLayer({ id: "road-hit", type: "line", source: "roads", paint: { "line-width": 16, "line-opacity": 0 } });
          map.addLayer({ id: "paths", type: "line", source: "paths", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#8ca69c", "line-width": 3, "line-opacity": 0.5 } });
          map.addLayer({ id: "selected-halo", type: "line", source: "paths", filter: ["==", "selected", true], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": 9 } });
          map.addLayer({ id: "selected-route", type: "line", source: "paths", filter: ["==", "selected", true], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#287b61", "line-width": 4 } });
          map.addLayer({ id: "node-halo", type: "circle", source: "nodes", paint: { "circle-radius": ["case", ["get", "selected"], 15, ["==", ["get", "kind"], "hub"], 12, 8], "circle-color": "#ffffff", "circle-stroke-color": "#dce3df", "circle-stroke-width": 1 } });
          map.addLayer({ id: "node-point", type: "circle", source: "nodes", paint: { "circle-radius": ["case", ["==", ["get", "kind"], "hub"], 6, 4], "circle-color": ["case", ["==", ["get", "kind"], "hub"], "#287b61", "#6e8093"] } });
          map.addLayer({ id: "labels", type: "symbol", source: "nodes", layout: { "text-field": ["get", "name"], "text-font": ["Arial", "sans-serif"], "text-size": 12, "text-offset": [0, 1.3], "text-anchor": "top", "text-allow-overlap": true }, paint: { "text-color": "#38434b", "text-halo-color": "#ffffff", "text-halo-width": 2 } });
          map.addLayer({ id: "vehicles", type: "circle", source: "vehicles", paint: { "circle-radius": 4, "circle-color": "#ffffff", "circle-stroke-color": "#287b61", "circle-stroke-width": 2.5 } });
          map.on("click", (event) => {
            const point = map.queryRenderedFeatures(event.point, { layers: ["node-halo"] })[0];
            if (point) { if (point.properties.kind === "community") latest.current.onSelect(point.properties.id); return; }
            const road = map.queryRenderedFeatures(event.point, { layers: ["road-hit"] })[0];
            if (road) latest.current.onToggleRoad(road.properties.id);
          });
          for (const layer of ["road-hit", "node-halo"]) {
            map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
            map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
          }
          fitNetwork(map, network);
          const current = latest.current;
          updateSources(map, network, current.plan, current.selectedId, phase.current);
          setReady(true);
        });
        resizeObserver = new ResizeObserver(() => fitNetwork(map, network));
        resizeObserver.observe(container.current);
      } catch {
        if (!cancelled) {
          mapRef.current?.remove();
          mapRef.current = null;
          setFallback(true);
        }
      }
    }
    void initialize();
    return () => { cancelled = true; resizeObserver?.disconnect(); mapRef.current?.remove(); mapRef.current = null; };
  }, [network]);

  useEffect(() => {
    if (!ready || !playing) return;
    let frame = 0;
    let last = 0;
    function animate(timestamp: number) {
      frame = requestAnimationFrame(animate);
      if (last && timestamp - last < 70) return;
      if (last) phase.current = (phase.current + Math.min(timestamp - last, 200) / 25000) % 1;
      last = timestamp;
      const source = mapRef.current?.getSource("vehicles") as GeoJSONSource | undefined;
      source?.setData(vehicleFeatures(latest.current.plan, phase.current));
    }
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [ready, playing]);

  if (fallback) return <SchematicMap {...props} />;
  return <div className="map-stage"><div ref={container} className="map-canvas" role="region" aria-label="Interactive food corridors in South Sudan" />{!ready && <div className="map-loading-overlay">Preparing network map…</div>}{basemapMissing && <span className="map-notice">Basemap unavailable · corridor model remains interactive</span>}<button className="map-fit icon-button" aria-label="Fit all corridors on map" title="Fit network" disabled={!ready} onClick={() => mapRef.current && fitNetwork(mapRef.current, network)}><Expand size={17} /></button><span className="map-interaction-hint">Select a community · Click a corridor to close or reopen</span></div>;
}
