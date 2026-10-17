import type { Coordinate, Delivery } from "../model/types";

export function pointAlong(coordinates: Coordinate[], fraction: number) {
  if (coordinates.length < 2) return { point: coordinates[0] ?? [0, 0] as Coordinate, bearing: 0 };
  const lengths = coordinates.slice(1).map((p, i) => Math.hypot((p[0] - coordinates[i][0]) * Math.cos(p[1] * Math.PI / 180), p[1] - coordinates[i][1]));
  let remaining = lengths.reduce((a, b) => a + b, 0) * Math.max(0, Math.min(1, fraction));
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const a = coordinates[i], b = coordinates[i + 1], t = lengths[i] ? remaining / lengths[i] : 0;
      return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] as Coordinate, bearing: Math.atan2((b[0] - a[0]) * Math.cos(a[1] * Math.PI / 180), b[1] - a[1]) * 180 / Math.PI };
    }
    remaining -= lengths[i];
  }
  return { point: coordinates.at(-1)!, bearing: 0 };
}

export function vehiclePosition(delivery: Delivery, index: number, hour: number) {
  let elapsed = Math.max(0, hour - index * .6);
  for (let i = 0; i < delivery.legs.length; i++) {
    const leg = delivery.legs[i];
    if (elapsed <= leg.hours || i === delivery.legs.length - 1) return { ...pointAlong(leg.coordinates, Math.min(1, elapsed / leg.hours)), mode: leg.mode };
    elapsed -= leg.hours;
  }
  return null;
}

export function circle(center: Coordinate, radiusKm: number): Coordinate[] {
  return Array.from({ length: 65 }, (_, i) => { const angle = i / 64 * Math.PI * 2; return [center[0] + Math.cos(angle) * radiusKm / (111 * Math.cos(center[1] * Math.PI / 180)), center[1] + Math.sin(angle) * radiusKm / 111]; });
}

export const warehouseIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m3 9 9-5 9 5v11H3Z"/><path d="M8 20v-8h8v8M8 15h8M8 18h8"/></svg>';
export const truckIcon = '<svg viewBox="0 0 24 36"><rect x="2" y="5" width="4" height="7" rx="1" fill="#263e36"/><rect x="18" y="5" width="4" height="7" rx="1" fill="#263e36"/><rect x="2" y="25" width="4" height="7" rx="1" fill="#263e36"/><rect x="18" y="25" width="4" height="7" rx="1" fill="#263e36"/><path d="M6 2h12l2 8v22H4V10Z" fill="#148465" stroke="white" stroke-width="1.4"/><path d="M7 5h10l1 5H6Z" fill="#bfe3df"/><rect x="6" y="14" width="12" height="16" rx="1" fill="#f5faf7"/><path d="M10 18h4v8h-4Z" fill="#3e957b"/><path d="M8 20h8v4H8Z" fill="#3e957b"/></svg>';
export const shipIcon = '<svg viewBox="0 0 24 36"><path d="M12 1 21 11 19 31 12 35 5 31 3 11Z" fill="#4386a5" stroke="white" stroke-width="1.5"/><path d="M9 5h6v7H9Z" fill="#c6e3ec"/><rect x="7" y="14" width="10" height="14" rx="1" fill="#f5faf7"/><path d="M9 17h6M9 21h6M9 25h6" stroke="#6fa5b5" stroke-width="2"/></svg>';
