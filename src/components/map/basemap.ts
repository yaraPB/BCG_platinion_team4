import type { Map as MapLibreMap } from "maplibre-gl";

/** A restrained OpenMapTiles style that keeps delivery routes in the foreground. */
export function addLightBasemap(map: MapLibreMap) {
  map.addSource("basemap", {
    type: "vector",
    url: "https://tiles.openfreemap.org/planet",
    attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://openmaptiles.org">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  });
  map.addLayer({ id: "basemap-water", type: "fill", source: "basemap", "source-layer": "water", paint: { "fill-color": "#dde8ed" } });
  map.addLayer({ id: "basemap-rivers", type: "line", source: "basemap", "source-layer": "waterway", paint: { "line-color": "#d3e1e7", "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.6, 10, 2] } });
  map.addLayer({ id: "basemap-roads", type: "line", source: "basemap", "source-layer": "transportation", minzoom: 7, paint: { "line-color": "#e1e4e7", "line-width": 1 } });
  map.addLayer({ id: "basemap-borders", type: "line", source: "basemap", "source-layer": "boundary", filter: ["==", "admin_level", 2], paint: { "line-color": "#c3cbd1", "line-width": 1.2, "line-dasharray": [5, 3] } });
  map.addLayer({ id: "basemap-countries", type: "symbol", source: "basemap", "source-layer": "place", filter: ["==", "class", "country"], layout: { "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]], "text-font": ["Arial", "sans-serif"], "text-size": 13, "text-transform": "uppercase", "text-letter-spacing": 0.15 }, paint: { "text-color": "#a4afb8", "text-halo-color": "#f3f5f6", "text-halo-width": 2 } });
}
