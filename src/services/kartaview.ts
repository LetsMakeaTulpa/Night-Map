/**
 * KartaView (formerly OpenStreetCam) nearby street-level photos.
 *
 * The 1.0 nearby-photos endpoint is public and returns CC BY-SA imagery without
 * an API key. Photos are crowd-sourced, may predate the current streetscape and
 * may show a neighbouring building rather than the exact parcel, so the UI says
 * that rather than presenting one as a realtor listing.
 */
import { haversineMeters } from '../domain/geo';

const ENDPOINT = 'https://api.kartaview.org/1.0/list/nearby-photos/';
export const KARTAVIEW_RADIUS_METRES = 100;
const LIMIT = 12;

// The public endpoint is rate-limited, and readers often reopen the same
// dossier. Keep this session's answers so a revisit is instant and quiet.
const cache = new Map<string, KartaViewPhoto[]>();

function cacheKey(center: [number, number]): string {
  return `${center[0].toFixed(4)},${center[1].toFixed(4)}`;
}

export interface KartaViewPhoto {
  id: string;
  sequenceId: string | null;
  coordinates: [number, number];
  capturedAt: number | null;
  heading: number | null;
  distanceMeters: number;
  thumbUrl: string;
}

interface KartaViewPhotoPayload {
  id?: string;
  sequence_id?: string;
  lat?: string;
  lng?: string;
  heading?: string;
  timestamp?: string;
  date_added?: string;
  th_name?: string;
  lth_name?: string;
}

interface KartaViewResponse {
  status?: { apiCode?: number; apiMessage?: string };
  currentPageItems?: KartaViewPhotoPayload[];
}

/** Turns KartaView's storage-relative path into the storage host that serves it. */
export function kartaviewImageUrl(path: string | null | undefined): string | null {
  const value = path?.trim().replace(/^\/+/, '');
  if (!value) return null;
  const absolute = /^(storage\d+)\.openstreetcam\.org\/(.+)$/i.exec(value);
  if (absolute) return `https://${absolute[1].toLowerCase()}.openstreetcam.org/${absolute[2]}`;
  const relative = /^(storage\d+)\/(.+)$/i.exec(value);
  if (relative) return `https://${relative[1].toLowerCase()}.openstreetcam.org/${relative[2]}`;
  return null;
}

function capturedAt(photo: KartaViewPhotoPayload): number | null {
  const seconds = Number(photo.timestamp);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  const added = photo.date_added ? Date.parse(photo.date_added.replace(' ', 'T')) : NaN;
  return Number.isFinite(added) ? added : null;
}

function finiteNumber(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function fetchKartaviewPhotos(
  center: [number, number],
  signal?: AbortSignal,
): Promise<KartaViewPhoto[]> {
  const key = cacheKey(center);
  const held = cache.get(key);
  if (held) return held;
  const body = new URLSearchParams({
    lat: String(center[1]),
    lng: String(center[0]),
    radius: String(KARTAVIEW_RADIUS_METRES),
    ipp: String(LIMIT),
  });
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal,
  });
  if (!response.ok) throw new Error(`KartaView returned HTTP ${response.status}`);
  const payload = (await response.json()) as KartaViewResponse;
  if (payload.status?.apiCode !== 600) {
    throw new Error(payload.status?.apiMessage ?? 'KartaView returned an unexpected payload');
  }
  if (!Array.isArray(payload.currentPageItems)) {
    throw new Error('KartaView returned an unexpected payload');
  }

  const parsed = payload.currentPageItems
    .map((photo): KartaViewPhoto | null => {
      const lat = finiteNumber(photo.lat);
      const lng = finiteNumber(photo.lng);
      const thumbUrl = kartaviewImageUrl(photo.lth_name ?? photo.th_name);
      if (!photo.id || lat === null || lng === null || !thumbUrl) return null;
      const coordinates: [number, number] = [lng, lat];
      return {
        id: String(photo.id),
        sequenceId: photo.sequence_id ? String(photo.sequence_id) : null,
        coordinates,
        capturedAt: capturedAt(photo),
        heading: finiteNumber(photo.heading),
        distanceMeters: haversineMeters(center, coordinates),
        thumbUrl,
      };
    })
    .filter((photo): photo is KartaViewPhoto => Boolean(photo))
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  // The API returns several consecutive frames from the same drive. Keep one
  // frame per sequence first so Next/Prev shows different visits, not a
  // slightly shifted copy of the same view.
  const seenSequences = new Set<string>();
  const firstPerSequence: KartaViewPhoto[] = [];
  const remaining: KartaViewPhoto[] = [];
  for (const photo of parsed) {
    const sequence = photo.sequenceId ?? photo.id;
    if (seenSequences.has(sequence)) {
      remaining.push(photo);
    } else {
      seenSequences.add(sequence);
      firstPerSequence.push(photo);
    }
  }
  const result = [...firstPerSequence, ...remaining].slice(0, LIMIT);
  cache.set(key, result);
  if (cache.size > 200) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return result;
}
