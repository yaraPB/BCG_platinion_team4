import type { DeliveryStatus } from "./types";

/**
 * Night-operations palette. Marks (lines, dots, bars) use the base colours;
 * text set in a status colour uses the lighter `text` step so it clears 4.5:1
 * on the panel surface. Status colours always ship with an icon and a label.
 * Validated for colour-vision separation on the dark surfaces with the
 * data-viz palette checks (adjacent pairs pass; all pairs warn only on
 * amber vs green under protan, which the icon + label pairing covers).
 */
export const palette = {
  canvas: "#0b1013",
  panel: "#111a1e",
  raised: "#172128",
  line: "#243036",
  ink: "#e7ece9",
  ink2: "#a4b0ab",
  ink3: "#6c7a74",
  route: "#18a874",
  river: "#3b85d8",
  amber: "#b08c2b",
  coral: "#c43f33",
  corridor: "#4b5b64",
  baseline: "#8a7a62",
  text: {
    route: "#5fd6a8",
    river: "#86bbff",
    amber: "#e3bb55",
    coral: "#ff8c7c",
  },
  hazard: {
    flood: "#4f9bd2",
    rain: "#c9a35a",
    security: "#d98570",
  },
} as const;

export const statusMeta: Record<
  DeliveryStatus,
  { label: string; color: string; text: string }
> = {
  "on-plan": { label: "On plan", color: palette.route, text: palette.text.route },
  rerouted: { label: "Rerouted", color: palette.river, text: palette.text.river },
  "supplier-changed": {
    label: "New supplier",
    color: palette.amber,
    text: palette.text.amber,
  },
  unreachable: {
    label: "Unreachable",
    color: palette.coral,
    text: palette.text.coral,
  },
};

export const formatNumber = (value: number) =>
  new Intl.NumberFormat("en-US").format(value);
export const percent = (value: number) => `${Math.round(value * 100)}%`;
