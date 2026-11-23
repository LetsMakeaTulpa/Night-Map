#!/usr/bin/env node
/**
 * Validate the privacy boundary and geometry of the published City snapshots.
 * Runs after refreshes and in CI against the committed snapshots.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isExcludedType, snapPoint } from './lib/incidents.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const BBOX = { south: 37.7585, west: -122.4275, north: 37.7975, east: -122.3905 };
const SPECS = {
  calls: {
    allowed: new Set(['kind', 'bucket', 'at', 'where', 'agency', 'priority', 'disposition', 'seenByOfficer', 'neighbourhood', 'district']),
  },
  cases311: {
    allowed: new Set(['kind', 'subtype', 'bucket', 'at', 'status', 'agency', 'neighbourhood']),
  },
};

const readJson = async (file) => JSON.parse(await readFile(path.join(ROOT, file), 'utf8'));
const meta = await readJson('src/data/incidents-meta.json');
const errors = [];
const assert = (condition, message) => {
  if (!condition) errors.push(message);
};

assert(Number(meta.coordinatePrecisionMetres) === 40, 'coordinate precision must remain approximately 40 m');
assert(Number.isFinite(Date.parse(meta.generatedAt)), 'snapshot generatedAt must be a valid timestamp');

for (const [feed, spec] of Object.entries(SPECS)) {
  const collection = await readJson(`public/incidents/${feed}.json`);
  const feedMeta = meta.feeds.find((entry) => entry.id === feed);
  assert(collection.type === 'FeatureCollection', `${feed}: expected a FeatureCollection`);
  assert(Array.isArray(collection.features), `${feed}: features must be an array`);
  assert(feedMeta, `${feed}: metadata entry is missing`);
  if (feedMeta) assert(feedMeta.rows === collection.features.length, `${feed}: metadata row count does not match GeoJSON`);

  for (const [index, feature] of collection.features.entries()) {
    const prefix = `${feed}[${index}]`;
    const properties = feature.properties ?? {};
    assert(feature.type === 'Feature', `${prefix}: invalid feature type`);
    assert(feature.geometry?.type === 'Point', `${prefix}: only point geometry is allowed`);
    assert(Array.isArray(feature.geometry?.coordinates) && feature.geometry.coordinates.length === 2, `${prefix}: invalid coordinates`);

    const extras = Object.keys(properties).filter((key) => !spec.allowed.has(key));
    assert(extras.length === 0, `${prefix}: unexpected fields: ${extras.join(', ')}`);
    assert(typeof properties.kind === 'string' && properties.kind.length > 0, `${prefix}: category is missing`);
    assert(!isExcludedType(properties.kind), `${prefix}: excluded person-sensitive category`);
    if (properties.subtype) assert(!isExcludedType(properties.subtype), `${prefix}: excluded person-sensitive subtype`);
    assert(Number.isFinite(Date.parse(properties.at)), `${prefix}: invalid event timestamp`);

    const [longitude, latitude] = feature.geometry?.coordinates ?? [];
    if (Number.isFinite(longitude) && Number.isFinite(latitude)) {
      assert(longitude > BBOX.west && longitude < BBOX.east && latitude > BBOX.south && latitude < BBOX.north, `${prefix}: outside the installed footprint`);
      const snapped = snapPoint(longitude, latitude);
      assert(snapped && Math.abs(snapped[0] - longitude) < 0.00001 && Math.abs(snapped[1] - latitude) < 0.00001, `${prefix}: coordinates are not snapped to the published grid`);
    } else {
      errors.push(`${prefix}: non-numeric coordinates`);
    }
  }

  console.log(`${feed}: ${collection.features.length.toLocaleString()} records checked`);
}

if (errors.length) {
  console.error(`Snapshot validation failed with ${errors.length} issue(s):`);
  for (const error of errors.slice(0, 40)) console.error(` - ${error}`);
  process.exitCode = 1;
} else {
  console.log('Civic snapshots pass schema, footprint, coordinate precision and category-exclusion checks.');
}
