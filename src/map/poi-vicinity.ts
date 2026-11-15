import type { Feature, Polygon } from 'geojson';
import { haversineMeters, type LngLat } from '../domain/geo';
import type { CategoryId } from '../domain/types';
import type { PlaceView } from '../state/selectors';

/** A short walk, not the whole city. Toggleable in the map's radius panel. */
export const DEFAULT_VICINITY_RADIUS_M = 600;

export const VICINITY_RADIUS_OPTIONS = [300, 600, 1200, 2000] as const;

/** How many out-of-radius records stay on the map as context. */
export const OUTSIDE_LIMIT_OPTIONS = [0, 10, 25, 50] as const;

export type OutsideLimit = (typeof OUTSIDE_LIMIT_OPTIONS)[number];

/**
 * Records that answer a need tonight outrank ordinary context. This is a
 * display priority, never a claim that the place is open or verified.
 */
const ESSENTIAL_CATEGORIES = new Set<CategoryId>([
  'water',
  'bathroom',
  'food',
  'shelter',
  'medical',
  'services',
  'charging',
]);

function priority(view: PlaceView): number {
  if (view.saved) return 0;
  if (ESSENTIAL_CATEGORIES.has(view.place.category)) return 1;
  if (view.evidence.tone === 'official' || view.evidence.tone === 'verified') return 2;
  return 3;
}

export function viewsWithinRadius(
  views: PlaceView[],
  center: LngLat,
  radiusM: number,
): PlaceView[] {
  return views.filter(
    (view) => haversineMeters(center, view.place.geometry.coordinates) <= radiusM,
  );
}

/**
 * Every record inside the radius, plus a bounded set of the most important
 * records beyond it. Important means saved first, then tonight's essentials,
 * then officially sourced records; ties are nearest first.
 */
export function vicinityViews(
  views: PlaceView[],
  center: LngLat,
  radiusM: number,
  outsideLimit: OutsideLimit,
): PlaceView[] {
  const inside: PlaceView[] = [];
  const outside: PlaceView[] = [];
  for (const view of views) {
    const distance = haversineMeters(center, view.place.geometry.coordinates);
    if (distance <= radiusM) inside.push(view);
    else outside.push(view);
  }
  outside.sort(
    (a, b) =>
      priority(a) - priority(b) ||
      haversineMeters(center, a.place.geometry.coordinates) -
        haversineMeters(center, b.place.geometry.coordinates),
  );
  return [...inside, ...outside.slice(0, outsideLimit)];
}

/** A simple geodesic ring at the map's latitude, for the visible boundary. */
export function circlePolygon(center: LngLat, radiusM: number, steps = 64): Feature<Polygon> {
  const [lng, lat] = center;
  const latDelta = radiusM / 111_320;
  const lngDelta = radiusM / (111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    ring.push([lng + Math.cos(angle) * lngDelta, lat + Math.sin(angle) * latDelta]);
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
}
