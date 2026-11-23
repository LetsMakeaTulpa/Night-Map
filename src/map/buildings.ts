/**
 * 3D buildings, loaded tile by tile.
 *
 * The extract holds fourteen thousand footprints — several megabytes of GeoJSON
 * — so nothing is bundled into the app shell. Tiles are fetched only at street
 * zoom, only for the tiles the view actually touches, capped per load, and kept
 * in a small in-memory cache. The service worker caches each tile the first time
 * it is fetched, so the second visit works offline.
 *
 * Feature properties are deliberately short, because they are repeated once per
 * building in files that a phone downloads:
 *   `h`  render height in metres
 *   `b`  base height in metres (0 unless the way is a building:part above ground)
 *   `hs` which rule produced `h` — 'tag' | 'levels' | 'type' | 'default'
 */
import type { LngLatBounds, Map as MapLibreMap } from 'maplibre-gl';
import buildingsMeta from '../data/buildings-meta.json';
import { latToTileY, lonToTileX, tileKeysForView } from '../domain/tiles';

export const BUILDINGS_SOURCE_ID = 'buildings';
export const BUILDINGS_LAYER_ID = 'buildings-3d';
/** Matches the style layer's minzoom: below this the footprints would be unreadable. */
export const BUILDINGS_MIN_ZOOM = 14.6;
export const BUILDINGS_TILE_ZOOM = buildingsMeta.tileZoom;
export const BUILDINGS_AVAILABLE: readonly string[] = buildingsMeta.tileKeys;
export const BUILDINGS_COUNTS = buildingsMeta.counts;
export const BUILDINGS_HEIGHT_NOTE = buildingsMeta.heightNote;

/** A phone should not pull the whole city's geometry in one gesture. */
const MAX_TILES_PER_LOAD = 3;

export interface BuildingFeature {
  type: 'Feature';
  properties: { h: number; b: number; hs: 'tag' | 'levels' | 'type' | 'default' };
  geometry: { type: 'Polygon'; coordinates: number[][][] };
}

export interface BuildingCollection {
  type: 'FeatureCollection';
  features: BuildingFeature[];
}

const featureCache = new Map<string, BuildingFeature[]>();
const failedTiles = new Set<string>();

export function buildingsTileUrl(key: string): string {
  return `/buildings/${key}.json`;
}

/** Tiles the view needs, most central first, capped. Empty below street zoom. */
export function tilesForView(bounds: LngLatBounds, zoom: number): string[] {
  if (zoom < BUILDINGS_MIN_ZOOM) return [];
  const centreLon = (bounds.getWest() + bounds.getEast()) / 2;
  const centreLat = (bounds.getSouth() + bounds.getNorth()) / 2;
  const centreX = lonToTileX(centreLon, BUILDINGS_TILE_ZOOM);
  const centreY = latToTileY(centreLat, BUILDINGS_TILE_ZOOM);
  const keys = tileKeysForView(
    {
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth(),
    },
    BUILDINGS_TILE_ZOOM,
    BUILDINGS_AVAILABLE,
  );
  keys.sort(
    (a, b) =>
      distanceFromCentre(a, centreX, centreY) - distanceFromCentre(b, centreX, centreY),
  );
  return keys.slice(0, MAX_TILES_PER_LOAD);
}

function distanceFromCentre(key: string, centreX: number, centreY: number): number {
  const [, x, y] = key.split('/').map(Number);
  return Math.abs(x - centreX) + Math.abs(y - centreY);
}

/** Tiles of `keys` that are neither cached nor already known to be broken. */
export function tilesToFetch(keys: string[]): string[] {
  return keys.filter((key) => !featureCache.has(key) && !failedTiles.has(key));
}

export interface LoadOutcome {
  features: number;
  tilesHeld: number;
  failed: string[];
}

/**
 * Fetch any missing tiles and return everything cached for `keys`.
 * A failed tile is remembered so a slow request is not retried on every pan.
 */
export async function loadBuildingTiles(keys: string[]): Promise<LoadOutcome> {
  const wanted = tilesToFetch(keys);
  if (wanted.length > 0) {
    const results = await Promise.all(
      wanted.map(async (key) => {
        try {
          const response = await fetch(buildingsTileUrl(key));
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = (await response.json()) as BuildingCollection;
          if (!Array.isArray(payload.features)) throw new Error('unexpected tile payload');
          featureCache.set(key, payload.features);
          return null;
        } catch (err) {
          console.info('[night-map] building tile unavailable', key, (err as Error).message);
          failedTiles.add(key);
          return key;
        }
      }),
    );
    const failed = results.filter((key): key is string => key !== null);
    return { features: countFeatures(keys), tilesHeld: featureCache.size, failed };
  }
  return { features: countFeatures(keys), tilesHeld: featureCache.size, failed: [] };
}

function countFeatures(keys: string[]): number {
  return keys.reduce((total, key) => total + (featureCache.get(key)?.length ?? 0), 0);
}

export function buildingCollection(keys: string[]): BuildingCollection {
  const features: BuildingFeature[] = [];
  for (const key of keys) {
    const tile = featureCache.get(key);
    if (tile) features.push(...tile);
  }
  return { type: 'FeatureCollection', features };
}

/** Read path used by the map: the tiles the current view should show. */
export function visibleTileKeys(map: MapLibreMap): string[] {
  return tilesForView(map.getBounds(), map.getZoom());
}

export function failedTileCount(): number {
  return failedTiles.size;
}

/** Only for tests: clears the in-memory tile cache. */
export function resetBuildingCache(): void {
  featureCache.clear();
  failedTiles.clear();
}
