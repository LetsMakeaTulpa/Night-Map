/**
 * Rules for turning public incident feeds into something a map may show.
 *
 * These are deliberately conservative, and the app states all of them:
 *
 *  - Coordinates are snapped to an approximate grid, so a layer never claims a
 *    precision the source does not have and a residence is not pinpointed.
 *  - Free-text fields are dropped. 311 `service_details` and police call notes
 *    can carry names, phone numbers and medical detail, none of which belongs on
 *    a public map.
 *  - Categories that describe people rather than places are excluded entirely:
 *    homelessness, encampments, mental-health and medical welfare. Plotting those
 *    would turn a navigation tool into a targeting tool.
 *  - Staleness is measured from the data, never asserted.
 */

/** ~40 m of latitude. Coarse enough not to identify a doorway. */
export const COORD_PRECISION = 0.0004;

export function snapCoordinate(value, precision = COORD_PRECISION) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number / precision) * precision;
}

export function snapPoint(lon, lat, precision = COORD_PRECISION) {
  const x = snapCoordinate(lon, precision);
  const y = snapCoordinate(lat, precision);
  if (x === null || y === null) return null;
  return [Number(x.toFixed(5)), Number(y.toFixed(5))];
}

/**
 * Categories that must never become map points, because they describe a person's
 * situation rather than a place. Matched against the service or call type.
 */
export const EXCLUDED_TYPE_PATTERNS = [
  /homeless/i,
  /encampment/i,
  /unhous/i,
  /mental/i,
  /psych/i,
  /welfare/i,
  /medical/i,
  /medic\b/i,
  /crisis/i,
  /suicide/i,
  /overdose/i,
  /substance/i,
  /drug/i,
  /alcohol|intoxicat|drunk/i,
  /needle|syringe/i,
  /shelter/i,
  /assault/i,
  /rape|sexual/i,
  /domestic/i,
  /abuse/i,
  /missing/i,
  /child/i,
  /juvenile/i,
  /person.*(down|injured)/i,
  /stalking|trespass/i,
  // Anything whose subject is a person rather than a place. "Suspicious person"
  // and suspect reports describe someone's body or behaviour at a spot; plotting
  // them would point at a human being, which is a targeting tool, not a map.
  /person/i,
  /suspect|wanted/i,
  /arrest|citation|booking/i,
];

export function isExcludedType(type) {
  const text = String(type ?? '');
  return EXCLUDED_TYPE_PATTERNS.some((pattern) => pattern.test(text));
}

/** Free-text fields that can carry personal information and are never kept. */
export const DROPPED_FIELDS = [
  'service_details',
  'service_notes',
  'status_notes',
  'resolution',
  'report_narrative',
  'call_notes',
  'responses',
];

/**
 * Bucket a dispatched call or a report into a small, stable set of kinds. Only
 * what the source actually states is used; anything unrecognised becomes
 * `other`, never a guess at a crime.
 */
const CALL_BUCKETS = [
  [/fire|medic|ems|rescue/i, 'fire_ems'],
  [/traffic|collision|accident|parking|vehicle|tow/i, 'traffic'],
  [/police|law enforcement|sheriff|disturbance|alarm|suspicious|noise/i, 'police'],
  [/water|sewer|street|sidewalk|tree|graffiti|litter|streetlight|light|pothole|sign/i, 'infrastructure'],
];

export function bucketFor(type) {
  const text = String(type ?? '');
  for (const [pattern, bucket] of CALL_BUCKETS) {
    if (pattern.test(text)) return bucket;
  }
  return 'other';
}

/** Human, honest description of how old the newest record is. */
export function describeLag(newestIso, now = new Date()) {
  if (!newestIso) return 'age unknown';
  const newest = new Date(newestIso);
  if (Number.isNaN(newest.getTime())) return 'age unknown';
  const minutes = Math.max(0, Math.round((now.getTime() - newest.getTime()) / 60000));
  if (minutes < 2) return 'under 2 minutes old';
  if (minutes < 90) return `about ${minutes} minutes old`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `about ${hours} hours old`;
  const days = Math.round(hours / 24);
  return `about ${days} days old`;
}

/** Canonical `feeds` record. One per upstream dataset, with its own staleness. */
export function summariseFeed({ id, name, rows, newest, oldest, now = new Date(), note }) {
  return {
    id,
    name,
    rows: rows ?? 0,
    newest: newest ?? null,
    oldest: oldest ?? null,
    lag: describeLag(newest, now),
    note: note ?? '',
  };
}

/** Round a time to the nearest quarter hour: a stale feed should not look live. */
export function toQuarterHour(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  date.setMinutes(Math.floor(date.getMinutes() / 15) * 15, 0, 0);
  return date.toISOString();
}
