import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import positron from "@/lib/data/map-style.json";

type Paint = Record<string, unknown>;

/**
 * Night basemap derived from the cached OpenFreeMap Positron style.
 * Every vector layer is kept (roads, rivers, land cover, places) and repainted
 * in graphite tones; the Natural Earth shaded-relief raster the style already
 * references is added back as a dark hillshade so the terrain reads at low zoom.
 */
export function darkBasemap(): StyleSpecification {
  const style = structuredClone(positron) as unknown as StyleSpecification;
  for (const layer of style.layers) {
    const paint = (layer.paint ?? {}) as Paint;
    if (layer.type === "background") {
      layer.paint = { ...paint, "background-color": "#0e1518" };
    } else if (layer.type === "fill") {
      const color =
        layer.id === "water"
          ? "#0a1721"
          : layer.id === "building"
            ? "#1b262c"
            : layer.id === "park" || layer.id === "landcover_wood"
              ? "#101a1a"
              : layer.id === "landuse_residential"
                ? "#141d21"
                : layer.id.startsWith("aeroway") || layer.id.startsWith("road_area")
                  ? "#1a2429"
                  : "#121b1f";
      layer.paint = { ...paint, "fill-color": color, "fill-opacity": layer.id === "water" ? 1 : 0.9 };
      delete (layer.paint as Paint)["fill-outline-color"];
    } else if (layer.type === "line") {
      const id = layer.id;
      const color = id.startsWith("boundary")
        ? "#35454d"
        : id === "waterway"
          ? "#163242"
          : id.includes("casing")
            ? "#0e1518"
            : id.startsWith("railway")
              ? "#26323a"
              : id.includes("motorway") || id.includes("major")
                ? "#2c3b43"
                : "#1f2b32";
      layer.paint = { ...paint, "line-color": color };
      if (id.startsWith("boundary")) layer.paint["line-opacity"] = 0.85;
    } else if (layer.type === "symbol") {
      if (layer.id.includes("shield")) {
        layer.layout = { ...layer.layout, visibility: "none" };
        continue;
      }
      layer.paint = {
        ...paint,
        "text-color": "#8ea39b",
        "text-halo-color": "#0b1013",
        "text-halo-width": 1.3,
      };
      if (layer["source-layer"] === "place") {
        layer.layout = {
          ...layer.layout,
          "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
        };
        if (layer.id.startsWith("label_country")) {
          layer.layout = {
            ...layer.layout,
            "text-size": 11,
            "text-letter-spacing": 0.12,
            "text-transform": "uppercase",
          };
          (layer.paint as Paint)["text-opacity"] = 0.5;
        } else layer.minzoom = Math.max(layer.minzoom ?? 0, 7.5);
      }
    }
  }
  if (style.sources.ne2_shaded) {
    const relief: LayerSpecification = {
      id: "relief",
      type: "raster",
      source: "ne2_shaded",
      maxzoom: 8,
      paint: {
        "raster-opacity": 0.6,
        "raster-brightness-min": 0,
        "raster-brightness-max": 0.34,
        "raster-saturation": -0.85,
        "raster-contrast": 0.3,
        "raster-fade-duration": 0,
      },
    };
    style.layers.splice(1, 0, relief);
  }
  return style;
}
