#!/usr/bin/env node
/**
 * Pull City of San Francisco open datasets used by Night Map:
 *   - Public Bathrooms and Water Fountains (wfq4-upmv)
 *   - Muni Stops (i28k-bkz6)
 *   - Privately Owned Public Open Spaces (65ik-7wqd)
 * Spatial rows are filtered to the Night Map core footprint; POPOS metadata and
 * all city-listed POPOS records are retained in cache for the bounded city map.
 *
 * Also checks each dataset's published license/metadata before import.
 *
 * Usage: node scripts/fetch-sfgov.mjs [--refresh]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, 'scripts', '.cache');
const BBOX = { south: 37.7585, west: -122.4275, north: 37.7975, east: -122.3905 };
await mkdir(CACHE, { recursive: true });

const BASE = 'https://data.sf.gov';
const refresh = process.argv.includes('--refresh');
if (refresh) console.log('refresh requested: bypassing cached source responses');

async function getJson(url, cacheName) {
  const file = path.join(CACHE, cacheName);
  if (!refresh) {
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch {
      /* fall through to network */
    }
  }
  console.log(`fetch ${url}`);
  const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const json = await res.json();
  await writeFile(file, JSON.stringify(json));
  return json;
}

async function metadata(id) {
  const meta = await getJson(`${BASE}/api/views/${id}.json`, `meta-${id}.json`);
  return {
    id,
    name: meta.name,
    attribution: meta.attribution,
    license: meta.license?.name || meta.licenseId || null,
    licenseUrl: meta.license?.termsLink || null,
    description: (meta.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    updatedAt: meta.rowsUpdatedAt ? new Date(meta.rowsUpdatedAt * 1000).toISOString() : null,
  };
}

const waterMeta = await metadata('wfq4-upmv');
const muniMeta = await metadata('i28k-bkz6');
const poposMeta = await metadata('65ik-7wqd');
console.log('water/fountain dataset:', waterMeta.name, '| license:', waterMeta.license);
console.log('muni stops dataset:', muniMeta.name, '| license:', muniMeta.license);
console.log('POPOS dataset:', poposMeta.name, '| license:', poposMeta.license);

const waterWhere = `within_box(point, ${BBOX.north}, ${BBOX.west}, ${BBOX.south}, ${BBOX.east})`;
const muniWhere = `within_box(shape, ${BBOX.north}, ${BBOX.west}, ${BBOX.south}, ${BBOX.east})`;
const water = await getJson(
  `${BASE}/resource/wfq4-upmv.json?$limit=2000&$where=${encodeURIComponent(waterWhere)}`,
  'sfgov-water-assets.json',
);
const muni = await getJson(
  `${BASE}/resource/i28k-bkz6.json?$limit=2000&$where=${encodeURIComponent(muniWhere)}`,
  'sfgov-muni-stops.json',
);
const popos = await getJson(
  `${BASE}/resource/65ik-7wqd.json?$limit=2000&$order=name,popos_address`,
  'sfgov-popos.json',
);
console.log(`water assets in footprint: ${water.length}`);
console.log(`muni stops in footprint: ${muni.length}`);
console.log(`city-listed POPOS: ${popos.length}`);

await writeFile(
  path.join(CACHE, 'sfgov-meta.json'),
  JSON.stringify({ water: waterMeta, muni: muniMeta, popos: poposMeta }, null, 2),
);
console.log('done');
