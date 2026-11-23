import { describe, expect, it } from 'vitest';
import type { LngLatBounds } from 'maplibre-gl';
import meta from '../data/buildings-meta.json';
import { tileKeysForBbox } from '../domain/tiles';
import {
  BUILDINGS_AVAILABLE,
  BUILDINGS_COUNTS,
  BUILDINGS_MIN_ZOOM,
  BUILDINGS_TILE_ZOOM,
  buildingsTileUrl,
  tilesForView,
  tilesToFetch,
} from './buildings';

function fakeBounds(west: number, south: number, east: number, north: number): LngLatBounds {
  return {
    getWest: () => west,
    getSouth: () => south,
    getEast: () => east,
    getNorth: () => north,
  } as unknown as LngLatBounds;
}

describe('the shipped building tiles', () => {
  it('sit inside the grid the app computes from the same bounding box', () => {
    const grid = new Set(tileKeysForBbox(meta.bbox as [number, number, number, number], BUILDINGS_TILE_ZOOM));
    for (const key of BUILDINGS_AVAILABLE) expect(grid.has(key)).toBe(true);
  });

  it('are all named at the tile zoom the manifest declares', () => {
    for (const key of BUILDINGS_AVAILABLE) {
      const parts = key.split('/').map(Number);
      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe(BUILDINGS_TILE_ZOOM);
      expect(parts.every(Number.isFinite)).toBe(true);
    }
  });

  it('accounts for every height: tagged, storey count or estimate', () => {
    expect(BUILDINGS_COUNTS.withHeightTag + BUILDINGS_COUNTS.withLevels + BUILDINGS_COUNTS.guessed).toBe(
      BUILDINGS_COUNTS.buildings,
    );
    // If this ever hits zero the legend stops mentioning estimates, which would
    // be the moment the layer starts overstating what it knows.
    expect(BUILDINGS_COUNTS.guessed).toBeGreaterThan(0);
  });

  it('keeps the extract lighter than a bundled layer would be', () => {
    expect(BUILDINGS_AVAILABLE.length).toBeGreaterThan(0);
    expect(meta.bytes.largest).toBeLessThan(1_000_000);
  });
});

describe('tilesForView', () => {
  it('loads nothing down at city zoom', () => {
    expect(tilesForView(fakeBounds(-122.43, 37.76, -122.39, 37.8), 12)).toEqual([]);
    expect(tilesForView(fakeBounds(-122.43, 37.76, -122.39, 37.8), BUILDINGS_MIN_ZOOM - 0.1)).toEqual([]);
  });

  it('returns shipped tiles nearest the centre first, and caps how many', () => {
    const keys = tilesForView(fakeBounds(-122.424, 37.786, -122.416, 37.792), 16.4);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.length).toBeLessThanOrEqual(3);
    expect(keys[0]).toBe('14/2620/6331');
    for (const key of keys) expect(BUILDINGS_AVAILABLE).toContain(key);
  });
});

describe('tile fetching', () => {
  it('asks for a tile once and builds the same URL the build script wrote', () => {
    expect(tilesToFetch(['14/2620/6331'])).toEqual(['14/2620/6331']);
    expect(buildingsTileUrl('14/2620/6331')).toBe('/buildings/14/2620/6331.json');
  });
});
