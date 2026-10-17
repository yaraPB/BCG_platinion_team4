import { palette } from "@/lib/presentation";
import type { Coordinate, Delivery } from "../model/types";

export function pointAlong(coordinates: Coordinate[], fraction: number) {
  if (coordinates.length < 2)
    return { point: coordinates[0] ?? ([0, 0] as Coordinate), bearing: 0 };
  const lengths = coordinates
    .slice(1)
    .map((p, i) =>
      Math.hypot(
        (p[0] - coordinates[i][0]) * Math.cos((p[1] * Math.PI) / 180),
        p[1] - coordinates[i][1],
      ),
    );
  let remaining =
    lengths.reduce((a, b) => a + b, 0) * Math.max(0, Math.min(1, fraction));
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const a = coordinates[i],
        b = coordinates[i + 1],
        t = lengths[i] ? remaining / lengths[i] : 0;
      return {
        point: [
          a[0] + (b[0] - a[0]) * t,
          a[1] + (b[1] - a[1]) * t,
        ] as Coordinate,
        bearing:
          (Math.atan2(
            (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180),
            b[1] - a[1],
          ) *
            180) /
          Math.PI,
      };
    }
    remaining -= lengths[i];
  }
  return { point: coordinates.at(-1)!, bearing: 0 };
}

export function vehiclePosition(
  delivery: Delivery,
  index: number,
  hour: number,
) {
  let elapsed = Math.max(0, hour - index * 0.6);
  for (let i = 0; i < delivery.legs.length; i++) {
    const leg = delivery.legs[i];
    if (elapsed <= leg.hours || i === delivery.legs.length - 1)
      return {
        ...pointAlong(leg.coordinates, Math.min(1, elapsed / leg.hours)),
        mode: leg.mode,
      };
    elapsed -= leg.hours;
  }
  return null;
}

export function circle(center: Coordinate, radiusKm: number): Coordinate[] {
  return Array.from({ length: 65 }, (_, i) => {
    const angle = (i / 64) * Math.PI * 2;
    return [
      center[0] +
        (Math.cos(angle) * radiusKm) /
          (111 * Math.cos((center[1] * Math.PI) / 180)),
      center[1] + (Math.sin(angle) * radiusKm) / 111,
    ];
  });
}

/** Diagonal hatch tile for hazard footprints; MapLibre consumes it as a fill pattern. */
export function hatchTile(color: string, size = 14): ImageData | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 2;
  ctx.lineCap = "square";
  for (const offset of [-size, 0, size]) {
    ctx.beginPath();
    ctx.moveTo(offset, size);
    ctx.lineTo(offset + size, 0);
    ctx.stroke();
  }
  return ctx.getImageData(0, 0, size, size);
}

export const warehouseIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m3 9 9-5 9 5v11H3Z"/><path d="M8 20v-8h8v8M8 15h8M8 18h8"/></svg>';
export const truckIcon = `<svg viewBox="0 0 24 36"><rect x="2" y="5" width="4" height="7" rx="1" fill="${palette.canvas}"/><rect x="18" y="5" width="4" height="7" rx="1" fill="${palette.canvas}"/><rect x="2" y="25" width="4" height="7" rx="1" fill="${palette.canvas}"/><rect x="18" y="25" width="4" height="7" rx="1" fill="${palette.canvas}"/><path d="M6 2h12l2 8v22H4V10Z" fill="${palette.route}" stroke="${palette.canvas}" stroke-width="1.4"/><path d="M7 5h10l1 5H6Z" fill="#0f2b22"/><rect x="6" y="14" width="12" height="16" rx="1" fill="#e4ebe6"/><path d="M8 18h8v2H8Zm0 4h8v2H8Z" fill="#9fb3a8"/></svg>`;
export const shipIcon = `<svg viewBox="0 0 24 36"><path d="M12 1 21 11 19 31 12 35 5 31 3 11Z" fill="${palette.river}" stroke="${palette.canvas}" stroke-width="1.5"/><path d="M9 5h6v7H9Z" fill="#0f2233"/><rect x="7" y="14" width="10" height="14" rx="1" fill="#e4ebe6"/><path d="M9 17h6M9 21h6M9 25h6" stroke="#8fa9bd" stroke-width="2"/></svg>`;
