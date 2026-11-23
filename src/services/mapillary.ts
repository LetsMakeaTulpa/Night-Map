/**
 * Mapillary street-level imagery.
 *
 * Mapillary's API needs a free client token. It is a public client credential,
 * not a user password, but it still must not be committed: this module reads
 * `VITE_MAPILLARY_TOKEN` at build time or a token the reader saves on this
 * device. Coverage is crowd-sourced, so an empty result is normal and never
 * means a street does not exist.
 */
const ENDPOINT = 'https://graph.mapillary.com/images';
const COVERAGE_ENDPOINT = 'https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}';
const TOKEN_KEY = 'nightmap.mapillary.token';
export const MAPILLARY_TOKEN_EVENT = 'nightmap:mapillary-token';
const RADIUS_METRES = 50;

export interface StreetImage {
  id: string;
  capturedAt: number | null;
  compassAngle: number | null;
  coordinates: [number, number];
  thumbUrl: string | null;
  isPano: boolean;
  distanceMeters: number;
}

interface MapillaryImage {
  id?: string;
  captured_at?: number;
  compass_angle?: number;
  geometry?: { type?: string; coordinates?: [number, number] };
  thumb_1024_url?: string;
  thumb_2048_url?: string;
  is_pano?: boolean;
}

export function readMapillaryToken(): string | null {
  const fromEnv = (import.meta.env.VITE_MAPILLARY_TOKEN as string | undefined)?.trim();
  if (fromEnv) return fromEnv;
  try {
    return window.localStorage.getItem(TOKEN_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

function announceTokenChange(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(MAPILLARY_TOKEN_EVENT));
}

export function saveMapillaryToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token.trim());
  } catch {
    /* storage can be unavailable in private modes; the session still works */
  }
  announceTokenChange();
}

export function clearMapillaryToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
  announceTokenChange();
}

/** Great-circle distance, metres. Used only to order images nearest-first. */
export function distanceMeters(a: [number, number], b: [number, number]): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const R = 6_371_000;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function mapillarySearchUrl(center: [number, number], token: string): string {
  const params = new URLSearchParams({
    fields: 'id,captured_at,compass_angle,geometry,thumb_1024_url,thumb_2048_url,is_pano',
    lat: String(center[1]),
    lng: String(center[0]),
    radius: String(RADIUS_METRES),
    limit: '24',
    access_token: token,
  });
  return `${ENDPOINT}?${params.toString()}`;
}

export async function fetchStreetImages(
  center: [number, number],
  token: string,
  signal?: AbortSignal,
): Promise<StreetImage[]> {
  const response = await fetch(mapillarySearchUrl(center, token), {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error('Mapillary rejected this token. Check the client token in the setup panel.');
  }
  if (!response.ok) throw new Error(`Mapillary returned HTTP ${response.status}`);
  const payload = (await response.json()) as { data?: MapillaryImage[] };
  if (!Array.isArray(payload.data)) throw new Error('Mapillary returned an unexpected payload');

  return payload.data
    .map((image): StreetImage | null => {
      const coordinates = image.geometry?.coordinates;
      if (!image.id || !coordinates) return null;
      return {
        id: image.id,
        capturedAt: typeof image.captured_at === 'number' ? image.captured_at : null,
        compassAngle: typeof image.compass_angle === 'number' ? image.compass_angle : null,
        coordinates,
        thumbUrl: image.thumb_2048_url ?? image.thumb_1024_url ?? null,
        isPano: Boolean(image.is_pano),
        distanceMeters: distanceMeters(center, coordinates),
      };
    })
    .filter((image): image is StreetImage => Boolean(image))
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

export function mapillaryCoverageTileUrl(token: string): string {
  return `${COVERAGE_ENDPOINT}?access_token=${encodeURIComponent(token)}`;
}

export function mapillaryViewerUrl(image: StreetImage): string {
  const [lon, lat] = image.coordinates;
  return `https://www.mapillary.com/app/?lat=${lat}&lng=${lon}&z=17&pKey=${image.id}`;
}

export { RADIUS_METRES };
