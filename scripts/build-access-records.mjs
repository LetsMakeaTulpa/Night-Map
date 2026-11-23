#!/usr/bin/env node
/**
 * Build src/data/access.json — Night Map's hand-checked access records.
 *
 * Input:  scripts/inputs/access-records.json  (addresses, and the page every fact came from)
 * Output: src/data/access.json                (the same records with coordinates attached)
 *
 * Coordinates are never typed by hand. Each record's `addressQuery` is sent to
 * Nominatim (OpenStreetMap) once, and both the coordinates and the OSM object
 * that matched are stored in the output, so the placement can be re-checked and
 * this script re-run without a network. Existing coordinates are reused unless
 * --refresh is passed.
 *
 * The build fails rather than guessing. It refuses to write a record that is
 * outside the footprint in src/data/meta.json, that cites a source id which is
 * not in the registry, or whose friction lines are not each attributed.
 *
 * Geocoding data © OpenStreetMap contributors, ODbL 1.0.
 * Usage: node scripts/build-access-records.mjs [--refresh]
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const INPUT = path.join(ROOT, 'scripts/inputs/access-records.json');
const OUTPUT = path.join(ROOT, 'src/data/access.json');
const SOURCES = path.join(ROOT, 'src/data/sources.json');
const META = path.join(ROOT, 'src/data/meta.json');
const USER_AGENT = 'NightMap-dataset-build/1.0 (offline field guide; local build script)';
const REFRESH = process.argv.includes('--refresh');

const GEOCODER = {
  name: 'Nominatim (OpenStreetMap)',
  url: 'https://nominatim.openstreetmap.org/',
  method: 'One search query per record, addressQuery, format=jsonv2, limit=1, one request per second',
  note: 'Coordinates come from OpenStreetMap addresses, so each record keeps the query it used and the OSM object that matched. Night Map does not hand-place these markers, and a poor match is visible in this file rather than hidden in the code.',
};

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function geocode(record, existing) {
  if (existing && !REFRESH) {
    return existing;
  }
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', record.addressQuery);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Nominatim responded ${response.status} for "${record.addressQuery}"`);
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`No geocoding match for "${record.addressQuery}" — fix the query rather than placing the marker by hand`);
  }
  const [row] = rows;
  return {
    query: record.addressQuery,
    coordinates: [Number(row.lon), Number(row.lat)],
    osmMatch: `${row.osm_type}/${row.osm_id}`,
    displayName: row.display_name,
    retrievedAt: new Date().toISOString().slice(0, 10),
  };
}

function buildPlace(record, geocodeResult) {
  const place = {
    id: record.id,
    name: record.name,
    category: record.category,
    geometry: { type: 'Point', coordinates: geocodeResult.coordinates },
    address: record.address,
    addressType: record.addressType ?? 'street_address',
    description: record.description,
    accessibility:
      record.accessibility ?? {
        status: 'not_documented',
        note: 'Accessibility is not documented for this record in this release.',
      },
    sourceIds: record.sourceIds,
    status: record.status ?? 'active',
    // These records are placed by a geocoder, and say so on the record itself.
    locationPrecision: 'geocoded_address',
    neighborhood: record.neighborhood ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
  return place;
}

function buildResources(placeId, resources) {
  return (resources ?? []).map((resource) => ({ ...resource, placeId }));
}

function checkSources(label, sourceIds, registry) {
  for (const id of sourceIds) {
    if (!registry.has(id)) {
      throw new Error(`${label} cites source ${id}, which is not in src/data/sources.json`);
    }
  }
}

async function main() {
  const input = await readJson(INPUT);
  const sources = await readJson(SOURCES);
  const meta = await readJson(META);
  const registry = new Set(sources.map((s) => s.id));

  let existing = null;
  try {
    existing = await readJson(OUTPUT);
  } catch {
    existing = null;
  }

  const [west, south, east, north] = meta.footprint.bbox;
  const places = [];
  const resources = [];
  const geocodes = {};

  for (const record of input.records) {
    const prior = existing?.geocodes?.[record.id];
    const geocodeResult = await geocode(record, prior);
    if (!prior || REFRESH) {
      // Be a good client of a free service.
      await new Promise((resolve) => setTimeout(resolve, 1100));
    }
    const [lon, lat] = geocodeResult.coordinates;
    if (lon < west || lon > east || lat < south || lat > north) {
      throw new Error(
        `${record.id} geocoded to ${lat},${lon}, which is outside the declared footprint (${meta.footprint.name}). ` +
          'A record outside the footprint belongs in a note, not as a marker.',
      );
    }
    checkSources(record.id, record.sourceIds, registry);
    for (const resource of record.resources ?? []) {
      checkSources(resource.id, resource.sourceIds, registry);
      for (const line of resource.friction ?? []) {
        checkSources(`${resource.id} friction "${line.label}"`, [line.sourceId], registry);
      }
    }
    places.push(buildPlace(record, geocodeResult));
    resources.push(...buildResources(record.id, record.resources));
    geocodes[record.id] = geocodeResult;
  }

  for (const attached of input.attached ?? []) {
    if (!resources.length && !places.length) throw new Error('attached records require the main list to load first');
    for (const resource of attached.resources ?? []) {
      checkSources(resource.id, resource.sourceIds, registry);
      for (const line of resource.friction ?? []) {
        checkSources(`${resource.id} friction "${line.label}"`, [line.sourceId], registry);
      }
    }
    // Attached resources ride on a place that already exists in places.json.
    resources.push(...buildResources(attached.placeId, attached.resources));
  }

  const output = {
    generatedAt: new Date().toISOString(),
    note:
      `${input.records.length} access records checked page by page, plus ${(input.attached ?? []).reduce((n, a) => n + (a.resources ?? []).length, 0)} ` +
      'records attached to places that already exist. Each fact names the page it came from; where a source is silent, the value is null and the interface says the source does not say.',
    geocoder: GEOCODER,
    places,
    resources,
    geocodes,
  };

  await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  const reused = Object.keys(geocodes).filter((id) => existing?.geocodes?.[id]).length;
  console.log(
    `access.json written: ${places.length} places, ${resources.length} resources, ` +
      `${Object.keys(geocodes).length} geocodes (${reused} reused from the previous file, ${REFRESH ? 'refresh forced' : 'no refresh'})`,
  );
}

await main();
