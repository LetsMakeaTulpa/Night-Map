#!/usr/bin/env node
/**
 * Pre-tiles the bundled street extract so the browser does not have to parse
 * and index a 671 KB GeoJSON source before the first street frame.
 *
 * The extract covers central San Francisco only. Tiles are emitted for z13–z15;
 * MapLibre overzooms z15 above that range and uses z13 below it. Run from
 * predev/prebuild so both the dev server and the production build see the same
 * tile set.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import GeojsonVt from 'geojson-vt';
import vtpbf from 'vt-pbf';

const ROOT = path.resolve(import.meta.dirname, '..');
const INPUT = path.join(ROOT, 'src', 'data', 'basemap', 'roads.json');
const OUTPUT = path.join(ROOT, 'public', 'basemap', 'roads');
const MIN_ZOOM = 13;
const MAX_ZOOM = 15;

const source = JSON.parse(await readFile(INPUT, 'utf8'));
const index = GeojsonVt(source, {
  maxZoom: MAX_ZOOM,
  indexMaxZoom: MAX_ZOOM,
  indexMaxPoints: 0,
  extent: 4096,
  buffer: 64,
  tolerance: 0.5,
  promoteId: 'id',
});

const bbox = [Infinity, Infinity, -Infinity, -Infinity];
const walk = (coords) => {
  if (typeof coords[0] === 'number') {
    bbox[0] = Math.min(bbox[0], coords[0]);
    bbox[1] = Math.min(bbox[1], coords[1]);
    bbox[2] = Math.max(bbox[2], coords[0]);
    bbox[3] = Math.max(bbox[3], coords[1]);
    return;
  }
  for (const part of coords) walk(part);
};
for (const feature of source.features) walk(feature.geometry.coordinates);

const tileXY = (lon, lat, z) => {
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  return [
    Math.floor(((lon + 180) / 360) * n),
    Math.floor(
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
    ),
  ];
};

await rm(OUTPUT, { recursive: true, force: true });
await mkdir(OUTPUT, { recursive: true });

let tileCount = 0;
let byteCount = 0;
for (let z = MIN_ZOOM; z <= MAX_ZOOM; z += 1) {
  const [minX, maxY] = tileXY(bbox[0], bbox[1], z);
  const [maxX, minY] = tileXY(bbox[2], bbox[3], z);
  // One tile of padding keeps buffered geometry available at the extract edge.
  for (let x = minX - 1; x <= maxX + 1; x += 1) {
    for (let y = minY - 1; y <= maxY + 1; y += 1) {
      const tile = index.getTile(z, x, y);
      if (!tile?.features.length) continue;
      const pbf = vtpbf.fromGeojsonVt({ roads: tile });
      const dir = path.join(OUTPUT, String(z), String(x));
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, `${y}.pbf`), Buffer.from(pbf));
      tileCount += 1;
      byteCount += pbf.length;
    }
  }
}

console.log(
  `wrote ${tileCount} road vector tiles (${Math.round(byteCount / 1024)} KB) for z${MIN_ZOOM}–z${MAX_ZOOM}`,
);
