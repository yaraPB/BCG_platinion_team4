import type { KeyboardEvent } from "react";
import type { Network, Plan } from "@/lib/types";

interface Props { network: Network; plan: Plan; selectedId: string; playing: boolean; onSelect: (id: string) => void; onToggleRoad: (id: string) => void }
const project = ([lon, lat]: number[]) => [70 + (lon - 27) / 6 * 760, 35 + (12.1 - lat) / 8.5 * 490];
const keyboardAction = (event: KeyboardEvent<SVGGElement>, action: () => void) => {
  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); action(); }
};

export function SchematicMap({ network, plan, selectedId, playing, onSelect, onToggleRoad }: Props) {
  const nodes = new Map(network.nodes.map((node) => [node.id, node]));
  const selected = plan.deliveries.find((d) => d.communityId === selectedId);
  const selectedPath = selected?.coordinates.map((coordinates) => project(coordinates).join(",")).join(" ");
  return <div className="schematic-map"><span className="map-notice">Schematic view · geographic rendering unavailable</span><svg viewBox="0 0 900 560" role="group" aria-label="Interactive schematic food corridor network">
    <defs><pattern id="map-grid" width="60" height="60" patternUnits="userSpaceOnUse"><path d="M60 0H0V60" fill="none" stroke="#e9ecee" strokeWidth="1" /></pattern></defs>
    <rect width="900" height="560" fill="#f7f8f9" /><rect width="900" height="560" fill="url(#map-grid)" />
    {network.corridors.map((road) => {
      const a = project(nodes.get(road.from)!.coordinates), b = project(nodes.get(road.to)!.coordinates);
      const closed = plan.closedRoads.includes(road.id);
      return <line key={road.id} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={closed ? "#ba5e55" : "#c7cdd0"} strokeWidth={closed ? 3 : 2} strokeDasharray={closed ? "6 5" : undefined} />;
    })}
    {selected?.supplierId && <polyline points={selectedPath} fill="none" stroke="#2b8066" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" />}
    {network.corridors.map((road) => {
      const a = project(nodes.get(road.from)!.coordinates), b = project(nodes.get(road.to)!.coordinates);
      const label = `${plan.closedRoads.includes(road.id) ? "Reopen" : "Close"} ${road.name}`;
      return <g key={road.id} role="button" tabIndex={0} aria-label={label} className="svg-control" onClick={() => onToggleRoad(road.id)} onKeyDown={(event) => keyboardAction(event, () => onToggleRoad(road.id))}><title>{label}</title><line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="transparent" strokeWidth="18" /></g>;
    })}
    {plan.deliveries.filter((d) => d.supplierId).map((d) => { const path = d.coordinates.map((c, i) => `${i ? "L" : "M"}${project(c).join(" ")}`).join(" "); const start = project(d.coordinates[0]); return playing ? <circle key={d.communityId} r="4" fill="white" stroke="#287b61" strokeWidth="2"><animateMotion path={path} dur={`${14 + d.hours! / 3}s`} repeatCount="indefinite" /></circle> : <circle key={d.communityId} cx={start[0]} cy={start[1]} r="4" fill="white" stroke="#287b61" strokeWidth="2" />; })}
    {network.nodes.map((node) => {
      const [x, y] = project(node.coordinates);
      return <g key={node.id} role={node.kind === "community" ? "button" : undefined} tabIndex={node.kind === "community" ? 0 : undefined} aria-label={node.kind === "community" ? `Select ${node.name} delivery` : undefined} className="svg-control" onClick={() => node.kind === "community" && onSelect(node.id)} onKeyDown={(event) => keyboardAction(event, () => node.kind === "community" && onSelect(node.id))}>
        <circle cx={x} cy={y} r={node.id === selectedId ? 12 : node.kind === "hub" ? 10 : 7} fill="white" />
        <circle cx={x} cy={y} r={node.kind === "hub" ? 6 : 4} fill={node.kind === "hub" ? "#287b61" : "#6e8093"} /><text x={x + 12} y={y - 10} fill="#374151" stroke="white" strokeWidth="3" paintOrder="stroke" fontSize="13" fontWeight="600">{node.name}</text>
      </g>;
    })}
  </svg></div>;
}
