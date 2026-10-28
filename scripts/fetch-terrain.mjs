#!/usr/bin/env node
/**
 * Fetch public-domain elevation tiles for the Night Map footprint.
 *
 * Source: AWS Open Data "Terrain Tiles" (elevation-tiles-prod) — terrarium-encoded
 * 256x256 PNG, assembled from USGS 3DEP and other public-domain surveys. No key,
 * no account, and the tiles are copied locally so the map never calls a
 * third-party elevation service at runtime. Attribution is registered in
 * src/data/sources.json and rendered in the app.
 *
 * The tiles are written to public/terrain/<z>/<x>/<y>.png and are deliberately
 * NOT precached by the service worker: they are cached the first time the user
 * turns terrain on, so installing the app stays light on a metered connection.
 *
 * Usage: node scripts/fetch-terrain.mjs [--refresh]
 */
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'public', 'terrain');
const META = path.join(ROOT, 'src', 'data', 'terrain-meta.json');
const REFRESH = process.argv.includes('--refresh');

/** The record footprint, plus a margin so a tilted camera still has terrain at the edges. */
const BBOX = { south: 37.748, west: -122.4405, north: 37.808, east: -122.3775 };
const ZOOMS = [10, 11, 12, 13, 14];
const MAX_ZOOM = 14;
const tileUrl = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

const lonToTileX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const latToTileY = (lat, z) => {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z,
  );
};

async function fetchTile(z, x, y) {
  const file = path.join(OUT, String(z), String(x), `${y}.png`);
  if (!REFRESH) {
    try {
      const info = await stat(file);
      if (info.size > 0) return { bytes: info.size, cached: true };
    } catch {
      /* not downloaded yet */
    }
  }
  const response = await fetch(tileUrl(z, x, y), {
    headers: { 'User-Agent': 'NightMap-SF/0.1 (civic field map; contact: nightmap@example.org)' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${z}/${x}/${y}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.subarray(1, 4).toString('ascii').startsWith('PNG')) {
    throw new Error(`not a PNG: ${z}/${x}/${y}`);
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, buffer);
  return { bytes: buffer.byteLength, cached: false };
}

let tiles = 0;
let bytes = 0;
let fromCache = 0;
const written = [];

for (const z of ZOOMS) {
  const x0 = lonToTileX(BBOX.west, z);
  const x1 = lonToTileX(BBOX.east, z);
  const y0 = latToTileY(BBOX.north, z);
  const y1 = latToTileY(BBOX.south, z);
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const result = await fetchTile(z, x, y);
      tiles += 1;
      bytes += result.bytes;
      if (result.cached) fromCache += 1;
      written.push(`${z}/${x}/${y}`);
    }
  }
  console.log(`zoomed ${z}: ${written.filter((t) => t.startsWith(`${z}/`)).length} tiles`);
}

const meta = {
  sourceId: 'src:aws-terrain-tiles',
  generatedAt: new Date().toISOString(),
  generatedBy: 'node scripts/fetch-terrain.mjs',
  encoding: 'terrarium',
  tileSize: 256,
  minzoom: ZOOMS[0],
  maxzoom: MAX_ZOOM,
  bbox: [BBOX.south, BBOX.west, BBOX.north, BBOX.east],
  tiles,
  bytes,
  tileKeys: written,
  urlTemplate: '/terrain/{z}/{x}/{y}.png',
  verticalAccuracyNote:
    'Terrarium elevation from public-domain surveys (USGS 3DEP in the United States, SRTM elsewhere), resampled to about 7 m per pixel here. It is a coarse terrain model, not a survey: it cannot show curbs, stairs, retaining walls or a slope you can walk up.',
  attribution: 'Elevation tiles: AWS Open Data Terrain Tiles (public domain)',
};
await writeFile(META, `${JSON.stringify(meta, null, 1)}\n`);
console.log(
  `wrote ${tiles} tiles (${(bytes / 1024 / 1024).toFixed(2)} MB, ${fromCache} reused) and src/data/terrain-meta.json`,
);
