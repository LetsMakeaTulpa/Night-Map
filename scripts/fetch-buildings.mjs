#!/usr/bin/env node
/**
 * Build the 3D building layer for the Night Map footprint from OpenStreetMap.
 *
 * Most OpenStreetMap buildings carry no height, so every feature records which
 * rule decided its height (`h`, plus `hs` naming the rule). The app states that
 * split in the legend instead of presenting estimates as measurements.
 *
 * The footprint holds more than 13,000 buildings — several megabytes of GeoJSON
 * — so this writes one file per z14 tile under public/buildings and a small
 * manifest the app reads. Tiles are loaded on demand and cached by the service
 * worker the first time they are used, never precached at install.
 *
 * Data (c) OpenStreetMap contributors, ODbL 1.0 — see src/data/sources.json.
 * Usage: node scripts/fetch-buildings.mjs
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { centreOf, heightFor, MIN_FOOTPRINT_M2, ringAreaM2, simplify } from './lib/building-geometry.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, 'scripts', '.cache');
const OUT = path.join(ROOT, 'public', 'buildings');
const META = path.join(ROOT, 'src', 'data', 'buildings-meta.json');

// Same footprint as the street basemap, so layers line up.
const [S, W, N, E] = [37.7585, -122.4275, 37.7975, -122.3905];
const TILE_ZOOM = 14;
// About 2 m. Tighter keys look better in a plan view but push the busiest tile
// past a megabyte, which is a lot to spend on a phone. This keeps footprints
// recognisable at street zoom for roughly half the weight.
const SIMPLIFY_TOLERANCE = 0.00002;

const QUERY = `[out:json][timeout:600];
(
  way["building"](${S},${W},${N},${E});
  way["building:part"](${S},${W},${N},${E});
);
out geom tags;`;

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const lonToTileX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const latToTileY = (lat, z) => {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z,
  );
};

async function fetchBuildings() {
  const file = path.join(CACHE, 'buildings.json');
  try {
    const cached = JSON.parse(await readFile(file, 'utf8'));
    if (cached.elements?.length) {
      console.log(`  cached  buildings (${cached.elements.length} elements)`);
      return cached;
    }
  } catch {
    /* no cache yet */
  }
  let lastError;
  for (const endpoint of ENDPOINTS) {
    try {
      console.log(`  fetch   buildings from ${new URL(endpoint).host}`);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': 'NightMap-SF/0.1 (civic field map; contact: nightmap@example.org)',
        },
        body: new URLSearchParams({ data: QUERY }),
        signal: AbortSignal.timeout(600_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      if (!json.elements) throw new Error('unexpected payload');
      console.log(`          ${json.elements.length} elements`);
      await mkdir(CACHE, { recursive: true });
      await writeFile(file, JSON.stringify(json));
      return json;
    } catch (err) {
      lastError = err;
      console.warn(`          failed: ${err.message}`);
    }
  }
  throw new Error(`could not fetch buildings: ${lastError?.message}`);
}

const round = (n) => Math.round(n * 1e5) / 1e5;
const payload = await fetchBuildings();
const snapshotAt = payload.osm3s?.timestamp_osm_base ?? null;

const tiles = new Map();
const counts = { buildings: 0, withHeightTag: 0, withLevels: 0, guessed: 0, parts: 0, tooSmall: 0 };

for (const element of payload.elements ?? []) {
  if (element.type !== 'way' || !element.geometry || element.geometry.length < 4) continue;
  const tags = element.tags ?? {};
  const isPart = tags['building:part'] !== undefined && tags.building === undefined;

  const coords = simplify(
    element.geometry.map((point) => [round(point.lon), round(point.lat)]),
    SIMPLIFY_TOLERANCE,
  );
  if (coords.length < 4) continue;
  if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) {
    coords.push(coords[0]);
  }
  if (ringAreaM2(coords) < MIN_FOOTPRINT_M2) {
    counts.tooSmall += 1;
    continue;
  }

  const { height, minHeight, source } = heightFor(tags);
  const key = `${TILE_ZOOM}/${lonToTileX(centreOf(coords)[0], TILE_ZOOM)}/${latToTileY(
    centreOf(coords)[1],
    TILE_ZOOM,
  )}`;
  if (!tiles.has(key)) tiles.set(key, []);
  // Short property names keep the tile payload small; src/map/buildings.ts documents them.
  tiles.get(key).push({
    type: 'Feature',
    properties: { h: height, b: minHeight, hs: source },
    geometry: { type: 'Polygon', coordinates: [coords] },
  });

  counts.buildings += 1;
  if (isPart) counts.parts += 1;
  if (source === 'tag') counts.withHeightTag += 1;
  else if (source === 'levels') counts.withLevels += 1;
  else counts.guessed += 1;
}

await mkdir(OUT, { recursive: true });
let bytes = 0;
let largest = 0;
const written = [];
for (const [key, features] of [...tiles.entries()].sort()) {
  const [z, x, y] = key.split('/');
  const file = path.join(OUT, z, x, `${y}.json`);
  const body = JSON.stringify({ type: 'FeatureCollection', features });
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body);
  bytes += body.length;
  largest = Math.max(largest, body.length);
  written.push(key);
}

const meta = {
  sourceId: 'src:osm-buildings',
  generatedAt: new Date().toISOString(),
  generatedBy: 'node scripts/fetch-buildings.mjs',
  snapshotAt,
  bbox: [S, W, N, E],
  tileZoom: TILE_ZOOM,
  minZoom: 14,
  tileKeys: written,
  counts,
  bytes: { total: bytes, largest },
  pathTemplate: '/buildings/{z}/{x}/{y}.json',
  heightNote:
    'Heights come from a height tag where mappers set one, from building:levels otherwise, and from a footprint-type default when neither exists. They are render heights for a visual layer, not measurements, and they say nothing about accessibility, entrances or ground-floor use.',
};
await writeFile(META, `${JSON.stringify(meta, null, 1)}\n`);

console.log(
  `buildings: ${counts.buildings} features in ${written.length} tiles ` +
    `(${(bytes / 1024 / 1024).toFixed(2)} MB, largest ${(largest / 1024).toFixed(0)} KB)\n` +
    `heights — tag ${counts.withHeightTag}, levels ${counts.withLevels}, guessed ${counts.guessed}; ` +
    `${counts.parts} parts, ${counts.tooSmall} slivers dropped`,
);
