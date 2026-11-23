import { haversineMeters } from '../domain/geo';
import type { CoverageBbox, LonLat } from './aperture';

/**
 * The bundled extract is a data boundary, not just a camera limit. A search
 * result beyond it must not silently move the camera into an intentionally
 * blank basemap, so every result is checked before it is plotted.
 */

/**
 * The fallback point sits slightly inside the amber line. Landing exactly on
 * the boundary would frame half the screen on blank map on the next repaint.
 */
export const COVERED_POINT_INSET_M = 30;

export function pointInCoverage(coordinates: LonLat, bbox: CoverageBbox): boolean {
  const [west, south, east, north] = bbox;
  const [lng, lat] = coordinates;
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= west &&
    lng <= east &&
    lat >= south &&
    lat <= north
  );
}

/** Clamp an outside point to the nearest point just inside the extract. */
export function nearestCoveredPoint(
  coordinates: LonLat,
  bbox: CoverageBbox,
  insetMeters = COVERED_POINT_INSET_M,
): [number, number] {
  const [west, south, east, north] = bbox;
  const latInset = insetMeters / 110_574;
  const lngInset =
    insetMeters /
    (111_320 * Math.max(0.01, Math.cos((coordinates[1] * Math.PI) / 180)));
  // A very small or malformed box must not invert its own clamping range.
  const insetLng = Math.min(lngInset, (east - west) / 3);
  const insetLat = Math.min(latInset, (north - south) / 3);
  const lng = Math.min(east - insetLng, Math.max(west + insetLng, coordinates[0]));
  const lat = Math.min(north - insetLat, Math.max(south + insetLat, coordinates[1]));
  return [lng, lat];
}

/**
 * Whether any mapped ground could appear in a [west, south, east, north]
 * viewport. An outside camera can still see the edge at low zoom, so this is
 * an intersection test rather than a centre-in-extract test.
 */
export function viewportTouchesCoverage(
  bounds: [number, number, number, number],
  bbox: CoverageBbox,
): boolean {
  const [west, south, east, north] = bounds;
  const [coverWest, coverSouth, coverEast, coverNorth] = bbox;
  return west <= coverEast && east >= coverWest && south <= coverNorth && north >= coverSouth;
}

export interface OutsideCoverageInfo {
  nearest: [number, number];
  distanceMeters: number;
}

const COMPASS_DIRECTIONS = [
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
] as const;

export type CompassDirection = (typeof COMPASS_DIRECTIONS)[number];

export interface NearestCoveredEdgeInfo {
  /** The closest point on the extract boundary itself. */
  point: [number, number];
  distanceMeters: number;
  direction: CompassDirection;
}

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

function bearingDegrees(from: LonLat, to: LonLat): number {
  const dLon = toRadians(to[0] - from[0]);
  const lat1 = toRadians(from[1]);
  const lat2 = toRadians(to[1]);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/**
 * Distance and compass direction from a point to the closest edge of the
 * extract, whether that point is inside or outside. The UI uses this to explain
 * where mapped ground is when the boundary itself is off-screen.
 */
export function nearestCoveredEdge(
  coordinates: LonLat,
  bbox: CoverageBbox,
): NearestCoveredEdgeInfo | null {
  if (!coordinates.every(Number.isFinite)) return null;
  const [west, south, east, north] = bbox;
  const [lng, lat] = coordinates;
  const clampLat = Math.min(north, Math.max(south, lat));
  const clampLng = Math.min(east, Math.max(west, lng));
  const candidates: Array<[number, number]> = [
    [west, clampLat],
    [east, clampLat],
    [clampLng, south],
    [clampLng, north],
  ];
  let point = candidates[0];
  let distanceMeters = haversineMeters([lng, lat], point);
  for (const candidate of candidates.slice(1)) {
    const distance = haversineMeters([lng, lat], candidate);
    if (distance < distanceMeters) {
      point = candidate;
      distanceMeters = distance;
    }
  }
  const bearing = ((bearingDegrees([lng, lat], point) % 360) + 360) % 360;
  const direction = COMPASS_DIRECTIONS[Math.round(bearing / 45) % COMPASS_DIRECTIONS.length];
  return { point, distanceMeters, direction };
}

/**
 * Describe how far an outside result is from the nearest covered point, or
 * return null when the point is already inside the extract.
 */
export function outsideCoverageInfo(
  coordinates: LonLat,
  bbox: CoverageBbox,
): OutsideCoverageInfo | null {
  if (pointInCoverage(coordinates, bbox)) return null;
  if (!coordinates.every(Number.isFinite)) return null;
  const nearest = nearestCoveredPoint(coordinates, bbox);
  return {
    nearest,
    distanceMeters: haversineMeters([coordinates[0], coordinates[1]], nearest),
  };
}
