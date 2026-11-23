#!/usr/bin/env node
/**
 * Build the incident layers from City and County of San Francisco open data.
 *
 * Two real feeds, both published under PDDL, both fetched here and written to
 * public/incidents so the app ships a snapshot it can describe precisely:
 *
 *   calls  — "Law Enforcement Dispatched Calls for Service: Real-Time" (gnap-fj3t).
 *            Dispatched calls that closed in the last 48 hours. This is the
 *            nearest thing to a live public safety feed that exists: it is NOT
 *            live 911, there is no audio, and rows carry a `sensitive_call` flag
 *            that the City uses for redaction.
 *   311    — "311 Cases" (vw6y-z8j6), the city's service-request log, nightly.
 *
 * What this script refuses to do, and why — every rule below is enforced here,
 * before anything reaches the map, and restated in the app:
 *
 *   * Rows the City marks `sensitive_call` are dropped entirely.
 *   * Categories that describe a person's situation rather than a place
 *     (homelessness, encampments, mental health, medical welfare, drugs, and
 *     every kind of interpersonal harm) are dropped by pattern. 311 alone has
 *     1,127 "Encampment" cases in a fortnight here. Mapping them would turn a
 *     navigation tool into a targeting tool against unhoused people.
 *   * Free-text fields are dropped, because they carry names, phone numbers and
 *     medical detail.
 *   * Coordinates are snapped to roughly 40 m, and street addresses are not kept.
 *
 * Usage: node scripts/fetch-incidents.mjs [--refresh]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DROPPED_FIELDS,
  EXCLUDED_TYPE_PATTERNS,
  bucketFor,
  describeLag,
  isExcludedType,
  snapPoint,
  toQuarterHour,
} from './lib/incidents.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, 'scripts', '.cache');
const OUT = path.join(ROOT, 'public', 'incidents');
const META = path.join(ROOT, 'src', 'data', 'incidents-meta.json');
const REFRESH = process.argv.includes('--refresh');

const BBOX = { south: 37.7585, west: -122.4275, north: 37.7975, east: -122.3905 };
const CALLS_WINDOW_HOURS = 48;
const CASES_WINDOW_DAYS = 7;
const MAX_CASES = 4000;
const MAX_CASES_PER_SERVICE = 400;

const CALLS_ID = 'gnap-fj3t';
const CASES_ID = 'vw6y-z8j6';
const PAGE = 5000;
const UA = 'NightMap-SF/0.1 (civic field map; contact: nightmap@example.org)';

await mkdir(CACHE, { recursive: true });
await mkdir(OUT, { recursive: true });

const log = (...args) => console.log(' ', ...args);

async function soda(dataset, params) {
  const query = new URLSearchParams(params).toString();
  const url = `https://data.sf.gov/resource/${dataset}.json?${query}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${dataset}`);
  return response.json();
}

/** One page-cached SoQL query, so a re-run costs no network. */
async function cached(name, loader) {
  const file = path.join(CACHE, `${name}.json`);
  if (!REFRESH) {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      if (Array.isArray(parsed) && parsed.length) {
        log(`cached ${name} (${parsed.length} rows)`);
        return parsed;
      }
    } catch {
      /* no cache yet */
    }
  }
  const rows = await loader();
  await writeFile(file, JSON.stringify(rows));
  log(`fetched ${name} (${rows.length} rows)`);
  return rows;
}

async function pageAll(dataset, params, max) {
  const rows = [];
  for (let offset = 0; offset < max; offset += PAGE) {
    const page = await soda(dataset, { ...params, $limit: String(PAGE), $offset: String(offset) });
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

const now = new Date();
const callsSince = new Date(now.getTime() - CALLS_WINDOW_HOURS * 3600_000).toISOString().slice(0, 19);
const casesSince = new Date(now.getTime() - CASES_WINDOW_DAYS * 86400_000).toISOString().slice(0, 19);

/* ------------------------------------------------------------------- calls */

let droppedSensitive = 0;
let droppedCallsExcluded = 0;
let droppedNoPoint = 0;
let droppedOutside = 0;

/** Second line of defence, applied to the snapped position of every row. */
const insideBox = (lon, lat) =>
  lat > BBOX.south && lat < BBOX.north && lon > BBOX.west && lon < BBOX.east;

// The calls extract is pulled citywide for one reason: the City redacts the
// position of a sensitive call, so a spatial filter would silently hide the very
// rows that prove how much is withheld. The footprint is applied below instead,
// to the position the app would actually draw — and counted, so the number is
// reported rather than assumed.
const callsRaw = await cached('sfgov-calls-realtime', () =>
  pageAll(
    CALLS_ID,
    {
      $select:
        'cad_number,received_datetime,call_type_final_desc,priority_final,agency,disposition,onview_flag,sensitive_call,intersection_name,analysis_neighborhood,police_district,intersection_point,data_as_of',
      $where: `received_datetime > '${callsSince}'`,
      $order: 'received_datetime DESC',
    },
    20000,
  ),
);

const calls = [];
for (const row of callsRaw) {
  if (row.sensitive_call === true || row.sensitive_call === 'true') {
    droppedSensitive += 1;
    continue;
}
  const kind = row.call_type_final_desc || row.call_type_final || 'Call for service';
  if (isExcludedType(kind)) {
    droppedCallsExcluded += 1;
    continue;
  }
  const point = row.intersection_point?.coordinates;
  const snapped = point ? snapPoint(point[0], point[1]) : null;
  if (!snapped) {
    droppedNoPoint += 1;
    continue;
  }
  if (!insideBox(snapped[0], snapped[1])) {
    droppedOutside += 1;
    continue;
  }
  calls.push({
    type: 'Feature',
    properties: {
      kind,
      bucket: bucketFor(kind),
      at: row.received_datetime,
      // The City publishes intersections rather than addresses; keep that form.
      where: row.intersection_name || null,
      agency: row.agency || null,
      priority: row.priority_final || null,
      disposition: row.disposition || null,
      seenByOfficer: row.onview_flag === 'Y',
      neighbourhood: row.analysis_neighborhood || null,
      district: row.police_district || null,
    },
    geometry: { type: 'Point', coordinates: snapped },
  });
}

/* --------------------------------------------------------------------- 311 */

let dropped311Excluded = 0;
const perService = new Map();
const casesRaw = await cached('sfgov-cases311', () =>
  pageAll(
    CASES_ID,
    {
      $select:
        'service_request_id,requested_datetime,service_name,service_subtype,agency_responsible,status_description,lat,long,analysis_neighborhood',
      $where: `lat > ${BBOX.south} AND lat < ${BBOX.north} AND long > ${BBOX.west} AND long < ${BBOX.east} AND requested_datetime > '${casesSince}'`,
      $order: 'requested_datetime DESC',
    },
    20000,
  ),
);

for (const row of casesRaw) {
  const name = row.service_name || 'Service request';
  const subtype = row.service_subtype || '';
  // A case is dropped if either its category or its subtype describes a person.
  if (isExcludedType(name) || isExcludedType(subtype)) {
    dropped311Excluded += 1;
    continue;
  }
  const snapped = snapPoint(row.long, row.lat);
  if (!snapped) continue;
  if (!insideBox(snapped[0], snapped[1])) {
    droppedOutside += 1;
    continue;
  }
  const list = perService.get(name) ?? [];
  if (list.length >= MAX_CASES_PER_SERVICE) continue;
  list.push({
    type: 'Feature',
    properties: {
      kind: name,
      subtype: subtype || null,
      bucket: bucketFor(name),
      at: row.requested_datetime,
      status: row.status_description || null,
      agency: row.agency_responsible || null,
      neighbourhood: row.analysis_neighborhood || null,
    },
    geometry: { type: 'Point', coordinates: snapped },
  });
  perService.set(name, list);
}

const cases = [...perService.values()]
  .flat()
  .sort((a, b) => String(b.properties.at).localeCompare(String(a.properties.at)))
  .slice(0, MAX_CASES);

/* ------------------------------------------------------------------ output */

const newestOf = (features) => features[0]?.properties?.at ?? null;
const oldestOf = (features) => features[features.length - 1]?.properties?.at ?? null;

const write = async (name, features, extra) => {
  const body = JSON.stringify({ type: 'FeatureCollection', features });
  await writeFile(path.join(OUT, `${name}.json`), body);
  log(`${name}.json — ${features.length} features, ${(body.length / 1024).toFixed(0)} KB`);
  return { features, extra };
};

await write('calls', calls);
await write('cases311', cases);

const meta = {
  generatedAt: now.toISOString(),
  generatedBy: 'node scripts/fetch-incidents.mjs',
  coordinatePrecisionMetres: 40,
  droppedFields: DROPPED_FIELDS,
  excludedTypePatterns: EXCLUDED_TYPE_PATTERNS.map((p) => p.source),
  feeds: [
    {
      id: 'calls',
      layerId: 'calls-recent',
      sourceId: 'src:sfgov-calls-realtime',
      dataset: CALLS_ID,
      name: 'Law Enforcement Dispatched Calls for Service: Real-Time',
      rows: calls.length,
      window: `dispatched calls that closed within ${CALLS_WINDOW_HOURS} hours of retrieval`,
      newest: newestOf(calls),
      oldest: oldestOf(calls),
      lag: describeLag(newestOf(calls), now),
      dropped: {
        sensitiveCall: droppedSensitive,
        excludedCategory: droppedCallsExcluded,
        noLocation: droppedNoPoint,
        outsideFootprint: droppedOutside,
      },
      notLive:
        'This is not live 911 and carries no audio. It is a published record of dispatched calls, and it is incomplete while calls are open.',
    },
    {
      id: 'cases311',
      layerId: 'cases-311',
      sourceId: 'src:sfgov-cases311',
      dataset: CASES_ID,
      name: '311 Cases',
      rows: cases.length,
      window: `311 cases opened in the last ${CASES_WINDOW_DAYS} days, capped at ${MAX_CASES_PER_SERVICE} per service type`,
      newest: newestOf(cases),
      oldest: oldestOf(cases),
      lag: describeLag(newestOf(cases), now),
      dropped: { excludedCategory: dropped311Excluded, outsideFootprint: droppedOutside },
      notLive: 'The dataset is published nightly; a request may already be resolved or scheduled.',
    },
  ],
  note:
    'Both feeds are City of San Francisco open data (PDDL). Coordinates are snapped to about 40 m, street addresses and free-text details are not stored, and categories describing a person rather than a place are excluded before publication.',
};
await writeFile(META, `${JSON.stringify(meta, null, 1)}\n`);

console.log(
  `\ncalls: ${calls.length} (dropped ${droppedSensitive} sensitive, ${droppedCallsExcluded} excluded category, ${droppedNoPoint} without location) — newest ${meta.feeds[0].lag}\n` +
    `311:  ${cases.length} (dropped ${dropped311Excluded} excluded category) — newest ${meta.feeds[1].lag}\n` +
    `outside the declared footprint: ${droppedOutside}\n` +
    `last update marker: ${toQuarterHour(meta.generatedAt)}`,
);
