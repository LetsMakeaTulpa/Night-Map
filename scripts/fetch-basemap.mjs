#!/usr/bin/env node
/**
 * Fetch OpenStreetMap geometry for the Night Map core footprint and convert it
 * into small, simplified GeoJSON layers for a fully self-hosted vector basemap.
 *
 * Data (c) OpenStreetMap contributors, ODbL 1.0 — attribution is rendered in the
 * app footer and recorded in the source registry.
 *
 * Usage: node scripts/fetch-basemap.mjs
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, 'scripts', '.cache');
const OUT = path.join(ROOT, 'src', 'data', 'basemap');
const BBOX = [37.7585, -122.4275, 37.7975, -122.3905]; // south, west, north, east
const [S, W, N, E] = BBOX;

await mkdir(CACHE, { recursive: true });
await mkdir(OUT, { recursive: true });

const QUERIES = {
  roads: `[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|unclassified|living_street|pedestrian|footway|steps|path)$"](${S},${W},${N},${E});
);
out geom tags;`,
  green: `[out:json][timeout:180];
(
  way["leisure"~"^(park|garden|playground)$"](${S},${W},${N},${E});
  way["landuse"~"^(grass|recreation_ground|cemetery|meadow)$"](${S},${W},${N},${E});
  way["natural"~"^(wood|scrub)$"](${S},${W},${N},${E});
);
out geom tags;`,
  water: `[out:json][timeout:180];
(
  way["natural"="water"](${S},${W},${N},${E});
  way["waterway"="riverbank"](${S},${W},${N},${E});
);
out geom tags;`,
  coast: `[out:json][timeout:180];
(
  way["natural"="coastline"](${S},${W},${N},${E});
);
out geom tags;`,
  rail: `[out:json][timeout:180];
(
  way["railway"~"^(rail|subway|light_rail|tram)$"](${S},${W},${N},${E});
);
out geom tags;`,
  places: `[out:json][timeout:180];
(
  node["place"~"^(neighbourhood|quarter|suburb)$"](${S},${W},${N},${E});
  node["railway"~"^(station|subway_entrance|tram_stop)$"](${S},${W},${N},${E});
);
out body;`,
};

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function fetchCached(name, body) {
  const file = path.join(CACHE, `${name}.json`);
  try {
    const raw = await readFile(file, 'utf8');
    const json = JSON.parse(raw);
    if (json.elements) {
      console.log(`  cached  ${name} (${json.elements.length} elements)`);
      return json;
    }
  } catch {
    /* no cache yet */
  }
  let lastError;
  for (const endpoint of ENDPOINTS) {
    try {
      console.log(`  fetch   ${name} from ${new URL(endpoint).host}`);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'NightMap-SF/0.1 (civic field map; contact: nightmap@example.org)',
        },
        body: new URLSearchParams({ data: body }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.elements) throw new Error('unexpected payload');
      console.log(`          ${json.elements.length} elements`);
      await writeFile(file, JSON.stringify(json));
      return json;
    } catch (err) {
      lastError = err;
      console.warn(`          failed: ${err.message}`);
    }
  }
  throw new Error(`could not fetch ${name}: ${lastError?.message}`);
}

/** Ramer–Douglas–Peucker on [lon, lat] pairs. */
function simplify(points, tolerance) {
  if (points.length <= 2) return points;
  const sq = tolerance * tolerance;
  const first = points[0];
  const last = points[points.length - 1];
  let index = -1;
  let maxSq = sq;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularSq(points[i], first, last);
    if (d > maxSq) {
      index = i;
      maxSq = d;
    }
  }
  if (index === -1) return [first, last];
  const left = simplify(points.slice(0, index + 1), tolerance);
  const right = simplify(points.slice(index), tolerance);
  return left.slice(0, -1).concat(right);
}

function perpendicularSq(p, a, b) {
  let x = a[0];
  let y = a[1];
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b[0];
      y = b[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

const round = (n) => Math.round(n * 1e5) / 1e5;

function wayCoords(way) {
  return (way.geometry || []).map((g) => [round(g.lon), round(g.lat)]);
}

function classifyRoad(tags) {
  const h = tags.highway;
  if (h === 'steps') return 'steps';
  if (h === 'footway' || h === 'path' || h === 'pedestrian') return 'path';
  if (h === 'motorway' || h === 'motorway_link' || h === 'trunk' || h === 'trunk_link')
    return 'arterial';
  if (h === 'primary' || h === 'primary_link' || h === 'secondary' || h === 'secondary_link')
    return 'major';
  if (h === 'tertiary' || h === 'tertiary_link') return 'secondary';
  if (h === 'service') return 'service';
  return 'local';
}

const roadFeatures = [];
const greenFeatures = [];
const waterFeatures = [];
const coastFeatures = [];
const railFeatures = [];
const placeFeatures = [];

const roads = await fetchCached('roads', QUERIES.roads);
for (const el of roads.elements) {
  if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
  if (el.tags?.area === 'yes') continue;
  if (el.tags?.highway === 'service' && !el.tags?.name) continue;
  const coords = simplify(wayCoords(el), 0.00002);
  if (coords.length < 2) continue;
  roadFeatures.push({
    type: 'Feature',
    properties: {
      class: classifyRoad(el.tags || {}),
      name: el.tags?.name || null,
    },
    geometry: { type: 'LineString', coordinates: coords },
  });
}
console.log(`roads: ${roadFeatures.length} features`);

const green = await fetchCached('green', QUERIES.green);
for (const el of green.elements) {
  if (el.type !== 'way' || !el.geometry || el.geometry.length < 4 || !el.tags?.name) continue;
  const ring = simplify(wayCoords(el), 0.00004);
  if (ring.length < 4) continue;
  if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
    ring.push(ring[0]);
  }
  greenFeatures.push({
    type: 'Feature',
    properties: { name: el.tags.name || null, kind: el.tags.leisure || el.tags.landuse || 'green' },
    geometry: { type: 'Polygon', coordinates: [ring] },
  });
}
console.log(`green: ${greenFeatures.length} features`);

const water = await fetchCached('water', QUERIES.water);
for (const el of water.elements) {
  if (el.type !== 'way' || !el.geometry || el.geometry.length < 4) continue;
  const ring = simplify(wayCoords(el), 0.00004);
  if (ring.length < 4) continue;
  if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
    ring.push(ring[0]);
  }
  waterFeatures.push({
    type: 'Feature',
    properties: { name: el.tags?.name || null },
    geometry: { type: 'Polygon', coordinates: [ring] },
  });
}
console.log(`water: ${waterFeatures.length} features`);

const coast = await fetchCached('coast', QUERIES.coast);
for (const el of coast.elements) {
  if (el.type !== 'way' || !el.geometry) continue;
  const coords = simplify(wayCoords(el), 0.00003);
  if (coords.length < 2) continue;
  coastFeatures.push({
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: coords },
  });
}
console.log(`coastline: ${coastFeatures.length} features`);

const rail = await fetchCached('rail', QUERIES.rail);
for (const el of rail.elements) {
  if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
  const coords = simplify(wayCoords(el), 0.00002);
  if (coords.length < 2) continue;
  railFeatures.push({
    type: 'Feature',
    properties: { kind: el.tags?.railway || 'rail', name: el.tags?.name || null },
    geometry: { type: 'LineString', coordinates: coords },
  });
}
console.log(`rail: ${railFeatures.length} features`);

const places = await fetchCached('places', QUERIES.places);
for (const el of places.elements) {
  if (el.type !== 'node' || !el.tags) continue;
  if (el.tags.place) {
    placeFeatures.push({
      type: 'Feature',
      properties: {
        kind: 'neighbourhood',
        name: el.tags.name || null,
        rank: el.tags.place === 'suburb' ? 1 : el.tags.place === 'quarter' ? 2 : 3,
      },
      geometry: { type: 'Point', coordinates: [round(el.lon), round(el.lat)] },
    });
  } else if (el.tags.railway) {
    placeFeatures.push({
      type: 'Feature',
      properties: {
        kind: 'station',
        name: el.tags.name || el.tags.railway,
        stationType: el.tags.railway,
      },
      geometry: { type: 'Point', coordinates: [round(el.lon), round(el.lat)] },
    });
  }
}

const write = async (name, features) => {
  const fc = { type: 'FeatureCollection', features };
  const file = path.join(OUT, `${name}.json`);
  await writeFile(file, JSON.stringify(fc));
  const size = JSON.stringify(fc).length;
  console.log(`wrote ${name}.json — ${(size / 1024).toFixed(0)} KB`);
};

await write('roads', roadFeatures);
await write('green', greenFeatures);
await write('water', waterFeatures);
await write('coastline', coastFeatures);
await write('rail', railFeatures);
await write('base-points', placeFeatures);

console.log('done');
