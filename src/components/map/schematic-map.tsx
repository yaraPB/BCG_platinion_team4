import { palette } from "@/lib/presentation";
import type { Coordinate, Network, Plan } from "../model/types";

export function SchematicMap({
  network,
  plan,
  selectedId,
  onSelect,
  onToggleRoad,
}: {
  network: Network;
  plan: Plan;
  selectedId: string;
  onSelect: (id: string) => void;
  onToggleRoad: (id: string) => void;
}) {
  const project = (p: Coordinate) => [
    80 + ((p[0] - 26.5) / 7.5) * 640,
    510 - ((p[1] - 3.6) / 8.8) * 460,
  ];
  const selectedRoads =
    plan.deliveries.find((d) => d.communityId === selectedId)?.roadIds ?? [];
  return (
    <div className="schematic-map">
      <p>Basemap unavailable. Showing the geographic network without tiles.</p>
      <svg
        viewBox="0 0 800 580"
        role="img"
        aria-label="Geographic delivery routes in South Sudan"
      >
        <defs>
          <pattern
            id="map-grid"
            width="40"
            height="40"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke={palette.raised}
              strokeWidth=".6"
            />
          </pattern>
        </defs>
        <rect width="800" height="580" fill="url(#map-grid)" />
        {network.corridors.map((r) => {
          const closed = plan.closedRoads.includes(r.id);
          const selected = selectedRoads.includes(r.id);
          return (
            <polyline
              key={r.id}
              points={r.coordinates.map((p) => project(p).join(",")).join(" ")}
              fill="none"
              stroke={
                closed
                  ? palette.coral
                  : selected
                    ? r.mode === "river"
                      ? palette.river
                      : palette.route
                    : palette.corridor
              }
              strokeWidth={selected ? 4 : 2.5}
              strokeLinecap="round"
              strokeDasharray={r.mode === "river" || closed ? "6 4" : undefined}
              role="button"
              tabIndex={0}
              aria-label={`${closed ? "Reopen" : "Close"} ${r.name}`}
              onClick={() => onToggleRoad(r.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onToggleRoad(r.id);
                }
              }}
            />
          );
        })}
        {network.nodes
          .filter((n) => n.kind !== "junction")
          .map((n) => {
            const p = project(n.coordinates);
            const selected = n.id === selectedId;
            return (
              <g
                key={n.id}
                transform={`translate(${p[0]},${p[1]})`}
                role={n.kind === "community" ? "button" : undefined}
                tabIndex={n.kind === "community" ? 0 : undefined}
                aria-label={n.name}
                onClick={() => {
                  if (n.kind === "community") onSelect(n.id);
                }}
                onKeyDown={(e) => {
                  if (
                    n.kind === "community" &&
                    (e.key === "Enter" || e.key === " ")
                  ) {
                    e.preventDefault();
                    onSelect(n.id);
                  }
                }}
              >
                {n.kind === "hub" ? (
                  <rect
                    x="-8"
                    y="-8"
                    width="16"
                    height="16"
                    rx="4"
                    fill={palette.canvas}
                    stroke={palette.route}
                    strokeWidth="2"
                  />
                ) : (
                  <circle
                    r={selected ? 7 : 5}
                    fill={selected ? palette.route : palette.canvas}
                    stroke={selected ? palette.ink : palette.route}
                    strokeWidth="2"
                  />
                )}
                <text
                  x="13"
                  y="4"
                  fill={palette.ink}
                  fontSize="13"
                  fontWeight="600"
                  style={{ paintOrder: "stroke", stroke: palette.canvas, strokeWidth: 3 }}
                >
                  {n.name}
                </text>
              </g>
            );
          })}
      </svg>
    </div>
  );
}
