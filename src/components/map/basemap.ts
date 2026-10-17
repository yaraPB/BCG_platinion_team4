import type { StyleSpecification } from "maplibre-gl";
import positron from "@/lib/data/map-style.json";

export function lightBasemap(): StyleSpecification {
  const style = structuredClone(positron) as unknown as StyleSpecification;
  // Retain the complete vector style: roads, rivers, land cover and place labels.
  for (const layer of style.layers) {
    if (layer.type === "background") layer.paint = { ...layer.paint, "background-color": "#f1f3ee" };
    if (layer.id === "water" && layer.type === "fill") layer.paint = { ...layer.paint, "fill-color": "#c8dfe6" };
  }
  return style;
}
