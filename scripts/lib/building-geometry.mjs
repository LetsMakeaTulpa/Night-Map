/**
 * Pure geometry and height helpers for the building extract.
 *
 * The application never imports this file: it only reads the tiles this
 * produces. Keeping the rules here lets scripts/fetch-buildings.mjs and
 * src/data/building-geometry.test.ts share one definition of how a height is
 * decided, which matters because most OpenStreetMap buildings have no height.
 */

/** Ramer–Douglas–Peucker on [lon, lat] pairs. Mirrors scripts/fetch-basemap.mjs. */
export function simplify(points, tolerance) {
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

/**
 * Shoelace area of a ring in square metres, using an equirectangular
 * approximation at the ring's mean latitude. Accurate to well under a percent
 * over a city block, which is all that is needed to discard slivers.
 */
export function ringAreaM2(ring) {
  if (!ring || ring.length < 3) return 0;
  const meanLat = ring.reduce((sum, p) => sum + p[1], 0) / ring.length;
  const rad = (meanLat * Math.PI) / 180;
  const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * rad) + 1.175 * Math.cos(4 * rad);
  const mPerDegLon = 111412.84 * Math.cos(rad) - 93.5 * Math.cos(3 * rad);
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    area += x1 * mPerDegLon * y2 * mPerDegLat - x2 * mPerDegLon * y1 * mPerDegLat;
  }
  return Math.abs(area) / 2;
}

/** Mean of the ring's vertices — good enough to pick a tile and a label anchor. */
export function centreOf(ring) {
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

/**
 * Parse an OpenStreetMap length tag. Handles `12`, `12 m`, `12.5 m`, `45'`,
 * `40 ft` and returns metres, or null when the value cannot be read.
 */
export function parseLength(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toLowerCase().replace(',', '.');
  if (!text) return null;
  const feet = /^([0-9.]+)\s*(ft|feet|foot|')$/.exec(text);
  if (feet) {
    const n = Number(feet[1]);
    return Number.isFinite(n) && n > 0 ? n * 0.3048 : null;
  }
  const metres = /^([0-9.]+)\s*(m|meters|meter|metres)$/.exec(text);
  if (metres) {
    const n = Number(metres[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const bare = /^([0-9.]+)$/.exec(text);
  if (bare) {
    const n = Number(bare[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

/** One storey, in metres. The value OpenStreetMap's own height guidelines use. */
export const LEVEL_HEIGHT_M = 3.2;

/** Applied to a tagged `building:levels` value so a roof is not counted as a floor. */
export const ROOF_M = 0.4;

/**
 * Footprint types that never carry a height tag in practice. These are visual
 * defaults, not measurements, and every feature records which rule produced it.
 */
export const TYPE_HEIGHTS = [
  [/^(garage|garages|carport|parking)$/, 3],
  [/^(shed|hut|kiosk|roof|canopy|garage_shed)$/, 3.5],
  [/^(house|detached|semidetached_house|bungalow|terrace|farm)$/, 8],
  [/^(church|cathedral|chapel|synagogue|mosque|temple|shrine)$/, 18],
  [/^(school|university|college|kindergarten|hospital|museum)$/, 16],
  [/^(warehouse|industrial|factory|hangar|storage_tank|silo)$/, 10],
  [/^(civic|public|government|train_station|transportation|stadium)$/, 18],
  [/^(apartments|residential)$/, 21],
  [/^(hotel|retail|supermarket|commercial|mall)$/, 30],
  [/^(office|skyscraper)$/, 45],
];

export const DEFAULT_HEIGHT_M = 12;

/** Clamp so a mis-tagged value cannot produce a spire that dwarfs the city. */
export const MIN_HEIGHT_M = 2.5;
export const MAX_HEIGHT_M = 330;
export const MIN_FOOTPRINT_M2 = 12;

/**
 * Decide a render height for one way.
 *
 * Returns metres plus the rule that produced them:
 *   `tag`     — a height tag was read
 *   `levels`  — a building:levels tag was read
 *   `type`    — the footprint type has a default (a guess)
 *   `default` — nothing usable was tagged (a guess)
 *
 * `grounded` is false when the way has no height tag at all, so the UI can
 * describe the layer honestly instead of implying measured building heights.
 */
export function heightFor(tags = {}) {
  const tagged = parseLength(tags.height);
  const taggedMin = parseLength(tags['min_height']);
  const levels = Number.parseFloat(String(tags['building:levels'] ?? ''));
  const minLevels = Number.parseFloat(String(tags['building:min_level'] ?? ''));

  let height = null;
  let source = 'default';
  if (tagged !== null) {
    height = tagged;
    source = 'tag';
  } else if (Number.isFinite(levels) && levels > 0) {
    height = levels * LEVEL_HEIGHT_M + ROOF_M;
    source = 'levels';
  } else {
    const type = String(tags.building ?? tags['building:part'] ?? '').toLowerCase();
    const match = TYPE_HEIGHTS.find(([pattern]) => pattern.test(type));
    height = match ? match[1] : DEFAULT_HEIGHT_M;
    source = match ? 'type' : 'default';
  }

  let minHeight = 0;
  if (taggedMin !== null) minHeight = taggedMin;
  else if (Number.isFinite(minLevels) && minLevels > 0) minHeight = minLevels * LEVEL_HEIGHT_M;

  if (minHeight >= height) minHeight = 0;
  return {
    height: Math.min(MAX_HEIGHT_M, Math.max(MIN_HEIGHT_M, Math.round(height * 10) / 10)),
    minHeight: minHeight > 0 ? Math.round(Math.min(minHeight, height - MIN_HEIGHT_M) * 10) / 10 : 0,
    source,
    grounded: source === 'tag' || source === 'levels',
  };
}
