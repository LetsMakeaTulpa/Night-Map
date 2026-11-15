/**
 * Live-ish view of the City's dispatched-call feed.
 *
 * Source: "Law Enforcement Dispatched Calls for Service: Real-Time" (gnap-fj3t),
 * published by San Francisco DEM. The City updates it every ten minutes and adds
 * its own ten-minute delay, so this is the freshest lawful public record — not
 * live 911, not radio, and not a unit position.
 *
 * The same privacy rules as scripts/lib/incidents.mjs are applied here, because
 * a row that is refused at build time must also be refused when fetched at
 * runtime. Keep EXCLUDED_TYPE_PATTERNS in sync with that file.
 */
import { bucketForIncident, type IncidentCollection, type IncidentFeature } from './incident-shape';

const ENDPOINT = 'https://data.sf.gov/resource/gnap-fj3t.json';
const WINDOW_HOURS = 12;
const MAX_ROWS = 4000;
const TTL_MS = 120_000;
const COORD_PRECISION = 0.0004;
const BBOX = { south: 37.7585, west: -122.4275, north: 37.7975, east: -122.3905 };

/** Mirrors EXCLUDED_TYPE_PATTERNS in scripts/lib/incidents.mjs. */
const EXCLUDED_TYPE_PATTERNS = [
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
  /person/i,
  /suspect|wanted/i,
  /arrest|citation|booking/i,
];

interface RawCallRow {
  received_datetime?: string;
  call_type_final_desc?: string;
  call_type_final?: string;
  priority_final?: string;
  agency?: string;
  disposition?: string;
  onview_flag?: string;
  sensitive_call?: boolean | string;
  intersection_name?: string;
  analysis_neighborhood?: string;
  police_district?: string;
  intersection_point?: { coordinates?: [number, number] };
}

export interface LiveCallsResult {
  collection: IncidentCollection;
  fetchedAt: number;
  newest: string | null;
  rows: number;
  dropped: { sensitive: number; excluded: number; noPoint: number; outside: number };
}

let held: { at: number; result: LiveCallsResult } | null = null;
let inflight: Promise<LiveCallsResult> | null = null;

export function cachedLiveCalls(): LiveCallsResult | null {
  return held?.result ?? null;
}

export function resetLiveCallsCache(): void {
  held = null;
  inflight = null;
}

const snap = (value: number) =>
  Number((Math.round(Number(value) / COORD_PRECISION) * COORD_PRECISION).toFixed(5));

const inside = (lon: number, lat: number) =>
  lat > BBOX.south && lat < BBOX.north && lon > BBOX.west && lon < BBOX.east;

/** Pure transform, exported so the exclusion rules can be tested without a network. */
export function sanitizeCallRows(rows: RawCallRow[]): LiveCallsResult {
  const features: IncidentFeature[] = [];
  const dropped = { sensitive: 0, excluded: 0, noPoint: 0, outside: 0 };
  let newest: string | null = null;

  for (const row of rows) {
    if (row.sensitive_call === true || row.sensitive_call === 'true') {
      dropped.sensitive += 1;
      continue;
    }
    const kind = row.call_type_final_desc || row.call_type_final || 'Call for service';
    if (EXCLUDED_TYPE_PATTERNS.some((pattern) => pattern.test(kind))) {
      dropped.excluded += 1;
      continue;
    }
    const point = row.intersection_point?.coordinates;
    if (!point) {
      dropped.noPoint += 1;
      continue;
    }
    const lon = snap(point[0]);
    const lat = snap(point[1]);
    if (!inside(lon, lat)) {
      dropped.outside += 1;
      continue;
    }
    const at = row.received_datetime ?? null;
    if (at && (!newest || at > newest)) newest = at;
    features.push({
      type: 'Feature',
      properties: {
        kind,
        bucket: bucketForIncident(kind),
        at: at ?? '',
        where: row.intersection_name || null,
        agency: row.agency || null,
        priority: row.priority_final || null,
        disposition: row.disposition || null,
        seenByOfficer: row.onview_flag === 'Y',
        neighbourhood: row.analysis_neighborhood || null,
        district: row.police_district || null,
      },
      geometry: { type: 'Point', coordinates: [lon, lat] },
    });
  }

  return {
    collection: { type: 'FeatureCollection', features },
    fetchedAt: Date.now(),
    newest,
    rows: rows.length,
    dropped,
  };
}

export async function fetchLiveCalls(force = false): Promise<LiveCallsResult> {
  if (!force && held && Date.now() - held.at < TTL_MS) return held.result;
  if (inflight) return inflight;

  inflight = (async () => {
    const since = new Date(Date.now() - WINDOW_HOURS * 3600_000).toISOString().slice(0, 19);
    const params = new URLSearchParams({
      $select:
        'received_datetime,call_type_final_desc,call_type_final,priority_final,agency,disposition,onview_flag,sensitive_call,intersection_name,analysis_neighborhood,police_district,intersection_point',
      $where: `received_datetime > '${since}'`,
      $order: 'received_datetime DESC',
      $limit: String(MAX_ROWS),
    });
    const response = await fetch(`${ENDPOINT}?${params.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`City feed returned HTTP ${response.status}`);
    const rows = (await response.json()) as RawCallRow[];
    if (!Array.isArray(rows)) throw new Error('City feed returned an unexpected payload');
    const result = sanitizeCallRows(rows);
    held = { at: result.fetchedAt, result };
    return result;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
