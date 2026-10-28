/**
 * Web-mercator tile arithmetic.
 *
 * The build scripts write terrain and building tiles on the standard XYZ grid,
 * and this module is the single place the app works out which of them a view
 * needs. `src/map/buildings.test.ts` checks these functions against the tile
 * list the build script actually shipped, so the two cannot drift apart.
 */

export interface TileRange {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** [south, west, north, east] — the order the dataset metadata uses. */
export type Bbox = [number, number, number, number];

export function lonToTileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

export function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
}

export function tileRangeForBbox(bbox: Bbox, z: number): TileRange {
  const [south, west, north, east] = bbox;
  return {
    x0: lonToTileX(west, z),
    x1: lonToTileX(east, z),
    y0: latToTileY(north, z),
    y1: latToTileY(south, z),
  };
}

export function tileKey(z: number, x: number, y: number): string {
  return `${z}/${x}/${y}`;
}

export function tileKeysForBbox(bbox: Bbox, z: number): string[] {
  const range = tileRangeForBbox(bbox, z);
  const keys: string[] = [];
  for (let x = range.x0; x <= range.x1; x++) {
    for (let y = range.y0; y <= range.y1; y++) keys.push(tileKey(z, x, y));
  }
  return keys;
}

/**
 * Tiles of `available` that the given view bounds touch. A view larger than the
 * footprint returns everything the extract ships, which is why the caller also
 * gates loading on zoom.
 */
export function tileKeysForView(
  view: { west: number; south: number; east: number; north: number },
  z: number,
  available: Iterable<string>,
): string[] {
  const have = new Set(available);
  const range = tileRangeForBbox([view.south, view.west, view.north, view.east], z);
  const keys: string[] = [];
  for (let x = range.x0; x <= range.x1; x++) {
    for (let y = range.y0; y <= range.y1; y++) {
      const key = tileKey(z, x, y);
      if (have.has(key)) keys.push(key);
    }
  }
  return keys;
}

/** Ground resolution, used to describe what a terrain or building tile costs. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}
