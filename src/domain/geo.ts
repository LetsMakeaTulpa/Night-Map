export type LngLat = [number, number];

const EARTH_RADIUS_M = 6_371_008.8;

export function haversineMeters(a: LngLat, b: LngLat): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatDistance(meters: number, units: 'metric' | 'imperial' = 'metric'): string {
  if (units === 'imperial') {
    const feet = meters * 3.28084;
    if (feet < 1000) return `${Math.round(feet / 10) * 10} ft`;
    return `${(meters / 1609.34).toFixed(1)} mi`;
  }
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function walkingMinutes(meters: number): number {
  // 4.5 km/h is a deliberately conservative city walking pace.
  return Math.max(1, Math.round(meters / 75));
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return 'Unknown time';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

export function formatLatLng(point: { coordinates: [number, number] }): string {
  const [lon, lat] = point.coordinates;
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

/** Small geographic bbox helper for "is this record in view" questions. */
export function boundsOf(points: LngLat[]): [number, number, number, number] | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [minX, minY, maxX, maxY];
}

export function pointInBbox(point: LngLat, bbox: [number, number, number, number]): boolean {
  const [minX, minY, maxX, maxY] = bbox;
  return point[0] >= minX && point[0] <= maxX && point[1] >= minY && point[1] <= maxY;
}

export const SF_CENTER: LngLat = [-122.4085, 37.7835];
