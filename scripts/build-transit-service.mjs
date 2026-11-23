#!/usr/bin/env node
/**
 * Night Service: SFMTA GTFS → per-stop scheduled service between 22:00 and 05:00.
 *
 * LICENCE — resolved 2026-11-23.
 * The SFMTA Transit Data License Agreement (https://www.sfmta.com/reports/gtfs-transit-data)
 * grants a non-exclusive, limited, revocable right to "use, reproduce, and
 * redistribute" the Data and to prepare derivative versions. Clause 12 requires
 * every derivative to carry the notice reproduced in `NOTICE` below, clause 7
 * forbids SFMTA/Muni logos, and the data is provided "as is". DataSF tags the same
 * file CC0, but the provider's own agreement is stricter, so this build complies
 * with the SFMTA terms: the notice travels in the JSON, on the stop card and in
 * the README. No feed content is committed except these derived aggregates.
 *
 * Output: src/data/transit-service.json
 *   - one record per installed Muni stop, for a single named service date;
 *   - routes, departures, median headway and last departure inside the window;
 *   - an `owl` flag when a route is scheduled between 00:00 and 05:00.
 * Nothing here is real-time and nothing claims a vehicle will arrive.
 */
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, 'scripts/.cache/gtfs');
const FEED = path.join(CACHE, 'feed');
const ZIP = path.join(CACHE, 'muni_gtfs-current.zip');
const ZIP_URL = 'https://muni-gtfs.apps.sfmta.com/data/muni_gtfs-current.zip';
const OUTPUT = path.join(ROOT, 'src/data/transit-service.json');
const WINDOW_START_S = 22 * 3600;
const WINDOW_END_S = 29 * 3600; // 05:00 on the following calendar day
const OWL_END_S = 5 * 3600;

const NOTICE =
  'Reproduced with permission granted by the City and County of San Francisco. The information has been provided by means of a nonexclusive, limited, and revocable license granted by the City and County of San Francisco. The City and County of San Francisco does not guarantee the accuracy, adequacy, completeness or usefulness of any information. The City and County of San Francisco provides this information "as is," without warranty of any kind, express or implied, including but not limited to warranties of merchantability or fitness for a particular purpose, and assumes no responsibility for anyone\'s use of the information.';

function parseLine(line) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else current += ch;
  }
  cells.push(current);
  return cells;
}

async function readTable(name) {
  const text = await readFile(path.join(FEED, name), 'utf8');
  const [header, ...lines] = text.split(/\r?\n/).filter((line) => line.length > 0);
  const columns = parseLine(header);
  return lines.map((line) => {
    const cells = parseLine(line);
    const row = {};
    for (let i = 0; i < columns.length; i += 1) row[columns[i]] = cells[i] ?? '';
    return row;
  });
}

async function ensureFeed() {
  if (existsSync(path.join(FEED, 'stop_times.txt'))) return;
  await mkdir(CACHE, { recursive: true });
  if (!existsSync(ZIP)) {
    console.log('downloading SFMTA GTFS…');
    const response = await fetch(ZIP_URL);
    if (!response.ok) throw new Error(`SFMTA GTFS download failed: HTTP ${response.status}`);
    await writeFile(ZIP, Buffer.from(await response.arrayBuffer()));
  }
  console.log('extracting…');
  execFileSync('unzip', ['-o', '-q', ZIP, '-d', FEED], { stdio: 'inherit' });
}

const seconds = (hhmmss) => {
  const [h, m, s] = hhmmss.split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
};
const clock = (total) => {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

function firstWednesday(fromIso) {
  const date = new Date(`${fromIso}T12:00:00Z`);
  while (date.getUTCDay() !== 3) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

const isoDate = (date) => date.toISOString().slice(0, 10);
const gtfsDate = (iso) => iso.replace(/-/g, '');

async function main() {
  await ensureFeed();

  const calendar = await readTable('calendar.txt');
  const exceptions = await readTable('calendar_dates.txt');
  const trips = await readTable('trips.txt');
  const routes = await readTable('routes.txt');
  const gtfsStops = await readTable('stops.txt');
  const installed = JSON.parse(await readFile(path.join(ROOT, 'src/data/transit.json'), 'utf8'));
  const installedStops = Array.isArray(installed) ? installed : installed.stops;

  const feedStart = calendar.map((row) => row.start_date).sort()[0];
  const feedEnd = calendar.map((row) => row.end_date).sort().at(-1);
  const feedStartIso = `${feedStart.slice(0, 4)}-${feedStart.slice(4, 6)}-${feedStart.slice(6, 8)}`;
  const feedEndIso = `${feedEnd.slice(0, 4)}-${feedEnd.slice(4, 6)}-${feedEnd.slice(6, 8)}`;
  const todayIso = isoDate(new Date());
  const startDate = todayIso > feedStartIso ? todayIso : feedStartIso;
  const serviceDate = firstWednesday(startDate);
  const serviceIso = isoDate(serviceDate);
  if (serviceIso > feedEndIso) {
    throw new Error(`No Wednesday inside the feed window (${feedStartIso} – ${feedEndIso}).`);
  }
  const serviceStamp = gtfsDate(serviceIso);

  const dayKey = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][
    serviceDate.getUTCDay()
  ];
  const activeServices = new Set();
  for (const row of calendar) {
    if (row[dayKey] === '1' && row.start_date <= serviceStamp && serviceStamp <= row.end_date) {
      activeServices.add(row.service_id);
    }
  }
  for (const row of exceptions) {
    if (row.date !== serviceStamp) continue;
    if (row.exception_type === '1') activeServices.add(row.service_id);
    if (row.exception_type === '2') activeServices.delete(row.service_id);
  }
  if (activeServices.size === 0) throw new Error(`No active service on ${serviceIso}.`);

  const activeTrips = new Map();
  for (const trip of trips) {
    if (activeServices.has(trip.service_id)) activeTrips.set(trip.trip_id, trip.route_id);
  }
  const routeName = new Map(routes.map((route) => [route.route_id, route.route_short_name || route.route_long_name]));

  // stop_id → route_id → departure seconds inside the night window
  const byStop = new Map();
  const stream = createReadStream(path.join(FEED, 'stop_times.txt'), 'utf8');
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let header = null;
  for await (const line of lines) {
    if (!line) continue;
    if (!header) {
      header = parseLine(line);
      continue;
    }
    const cells = parseLine(line);
    const row = {};
    for (let i = 0; i < header.length; i += 1) row[header[i]] = cells[i] ?? '';
    const route = activeTrips.get(row.trip_id);
    if (!route) continue;
    const departure = seconds(row.departure_time || row.arrival_time);
    if (!Number.isFinite(departure) || departure < WINDOW_START_S || departure >= WINDOW_END_S) continue;
    let routesAtStop = byStop.get(row.stop_id);
    if (!routesAtStop) byStop.set(row.stop_id, (routesAtStop = new Map()));
    let times = routesAtStop.get(route);
    if (!times) routesAtStop.set(route, (times = []));
    times.push(departure);
  }

  const gtfsById = new Map(gtfsStops.map((stop) => [stop.stop_id, stop]));
  const gtfsByName = new Map();
  for (const stop of gtfsStops) {
    const key = stop.stop_name.trim().toLowerCase();
    if (!gtfsByName.has(key)) gtfsByName.set(key, []);
    gtfsByName.get(key).push(stop);
  }

  const output = {};
  const unmatchedStopIds = [];
  let matchedById = 0;
  let matchedByName = 0;
  let unmatched = 0;
  let withService = 0;
  let owlStops = 0;

  for (const stop of installedStops) {
    let gtfs = stop.stopId ? gtfsById.get(String(stop.stopId)) : undefined;
    if (gtfs) matchedById += 1;
    else {
      const candidates = gtfsByName.get(stop.name.trim().toLowerCase()) ?? [];
      if (candidates.length === 1) {
        gtfs = candidates[0];
        matchedByName += 1;
      } else if (candidates.length > 1) {
        const [lon, lat] = stop.geometry.coordinates;
        gtfs = candidates
          .map((candidate) => ({
            candidate,
            distance: Math.hypot(Number(candidate.stop_lon) - lon, Number(candidate.stop_lat) - lat),
          }))
          .sort((a, b) => a.distance - b.distance)[0].candidate;
        matchedByName += 1;
      }
    }
    if (!gtfs) {
      unmatched += 1;
      unmatchedStopIds.push(stop.id);
      continue;
    }

    const routesAtStop = byStop.get(gtfs.stop_id);
    if (!routesAtStop) continue; // scheduled, but nothing inside the night window
    const entries = [];
    let lastDeparture = 0;
    let owl = false;
    let total = 0;
    for (const [route, times] of routesAtStop) {
      times.sort((a, b) => a - b);
      const gaps = [];
      for (let i = 1; i < times.length; i += 1) {
        const gap = (times[i] - times[i - 1]) / 60;
        if (gap >= 2 && gap <= 90) gaps.push(gap);
      }
      const headwayMinutes = times.length >= 3 && gaps.length >= 2 ? Math.round(median(gaps)) : null;
      lastDeparture = Math.max(lastDeparture, times.at(-1));
      total += times.length;
      if (times.some((time) => time % 86400 < OWL_END_S)) owl = true;
      entries.push({
        route: String(routeName.get(route) ?? route),
        departures: times.length,
        headwayMinutes,
        lastDeparture: clock(times.at(-1)),
      });
    }
    entries.sort((a, b) => b.departures - a.departures || (a.headwayMinutes ?? 999) - (b.headwayMinutes ?? 999));
    output[stop.id] = {
      stopId: stop.stopId,
      owl,
      departures: total,
      lastDeparture: clock(lastDeparture),
      routes: entries.slice(0, 3),
    };
    withService += 1;
    if (owl) owlStops += 1;
  }

  const document = {
    meta: {
      generatedAt: new Date().toISOString(),
      sourceName: 'SFMTA GTFS (Muni scheduled service)',
      sourceUrl: 'https://www.sfmta.com/reports/gtfs-transit-data',
      feedUrl: ZIP_URL,
      feedStartDate: feedStartIso,
      feedEndDate: feedEndIso,
      serviceDate: serviceIso,
      serviceDay: 'Wednesday',
      window: '22:00–05:00 the following morning',
      license: 'SFMTA Transit Data License Agreement',
      licenseUrl: 'https://www.sfmta.com/reports/gtfs-transit-data',
      notice: NOTICE,
      counts: {
        installedStops: installedStops.length,
        matchedStops: matchedById + matchedByName,
        matchedById,
        matchedByName,
        unmatchedStops: unmatched,
        withOvernightService: withService,
        owlStops,
        sampledRoutes: trips.length,
      },
      unmatchedStopIds,
    },
    stops: output,
  };

  await writeFile(OUTPUT, `${JSON.stringify(document)}\n`);
  const size = (await readFile(OUTPUT)).byteLength;
  console.log(
    `wrote ${path.relative(ROOT, OUTPUT)} (${(size / 1024).toFixed(1)} kB) — ` +
      `${withService}/${installedStops.length} stops with service in the window, ` +
      `${owlStops} owl stops, ${matchedById} matched by id, ${matchedByName} by name, ${unmatched} unmatched; ` +
      `service date ${serviceIso} (${dayKey}).`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
