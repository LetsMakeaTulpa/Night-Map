/**
 * Incident layers: dispatched calls and the city's 311 service log.
 *
 * The calls layer is refreshed at runtime from the City's 10-minute-delayed CAD
 * extract (see live-calls.ts) and falls back to the bundled snapshot when the
 * network is unavailable. 311 is a nightly dataset, so its bundled snapshot is
 * still the honest unit. Neither is live 911 and there is no audio; the app says
 * so on the card, in the layer drawer and in the legend. The exclusion rules that
 * keep people out of these layers are applied at build time and again at runtime.
 */
import incidentsMeta from '../data/incidents-meta.json';
import type { IncidentCollection, IncidentFeature } from './incident-shape';

export type { IncidentCollection, IncidentFeature } from './incident-shape';

export type IncidentFeed = 'calls' | 'cases311';

export const INCIDENT_SOURCE: Record<IncidentFeed, string> = {
  calls: 'callsRecent',
  cases311: 'cases311',
};

export const INCIDENT_LAYER: Record<IncidentFeed, string> = {
  calls: 'calls-recent',
  cases311: 'cases-311',
};

/** The expanding ring drawn under recent dispatched calls. */
export const INCIDENT_PULSE_LAYER = 'calls-pulse';

export const INCIDENT_META = incidentsMeta;

export interface FeedSummary {
  id: IncidentFeed;
  name: string;
  dataset: string;
  sourceId: string;
  rows: number;
  newest: string | null;
  lag: string;
  window: string;
  notLive: string;
  dropped: Record<string, number>;
}

const FEEDS = incidentsMeta.feeds as unknown as FeedSummary[];

export function feedSummary(feed: IncidentFeed): FeedSummary {
  const found = FEEDS.find((f) => f.id === feed);
  if (!found) throw new Error(`unknown incident feed ${feed}`);
  return found;
}

export const EXCLUDED_PATTERN_COUNT = incidentsMeta.excludedTypePatterns.length;
export const COORDINATE_PRECISION_METRES = incidentsMeta.coordinatePrecisionMetres;
export const INCIDENT_SNAPSHOT_AT = incidentsMeta.generatedAt;

const cache = new Map<IncidentFeed, IncidentCollection>();
const inflight = new Map<IncidentFeed, Promise<IncidentCollection>>();

export function incidentFeedUrl(feed: IncidentFeed): string {
  return `/incidents/${feed}.json`;
}

/** Loads a feed once and keeps it for the session. */
export async function loadIncidentFeed(feed: IncidentFeed): Promise<IncidentCollection> {
  const cached = cache.get(feed);
  if (cached) return cached;
  const pending = inflight.get(feed);
  if (pending) return pending;
  const request = (async () => {
    const response = await fetch(incidentFeedUrl(feed));
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${feed}`);
    const payload = (await response.json()) as IncidentCollection;
    if (!Array.isArray(payload.features)) throw new Error(`unexpected payload for ${feed}`);
    cache.set(feed, payload);
    inflight.delete(feed);
    return payload;
  })();
  inflight.set(feed, request);
  return request;
}

export function cachedIncidentFeed(feed: IncidentFeed): IncidentCollection | null {
  return cache.get(feed) ?? null;
}

export function incidentCounts(): Record<IncidentFeed, number> {
  return {
    calls: cache.get('calls')?.features.length ?? 0,
    cases311: cache.get('cases311')?.features.length ?? 0,
  };
}

export function resetIncidentCache(): void {
  cache.clear();
  inflight.clear();
}

/** How old the newest record is, measured now — a snapshot ages as it sits. */
export function ageInWords(iso: string | null, now = new Date()): string {
  if (!iso) return 'age unknown';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'age unknown';
  const minutes = Math.max(0, Math.round((now.getTime() - then) / 60000));
  if (minutes < 90) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/**
 * The datapoints shown on a feature card. Only fields the source actually
 * provides appear; nothing is inferred and no field is invented.
 */
export function describeIncident(
  feed: IncidentFeed,
  properties: IncidentFeature['properties'],
  coordinates: [number, number],
  now = new Date(),
): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [
    { label: 'Type', value: properties.kind },
    { label: 'Logged', value: `${new Date(properties.at).toLocaleString()} (${ageInWords(properties.at, now)})` },
  ];
  if (properties.subtype) rows.push({ label: 'Subtype', value: properties.subtype });
  if (properties.where) rows.push({ label: 'Location given as', value: properties.where });
  if (properties.agency) rows.push({ label: 'Agency', value: properties.agency });
  if (properties.priority) rows.push({ label: 'Priority', value: properties.priority });
  if (properties.disposition) rows.push({ label: 'Disposition', value: properties.disposition.replace(/_/g, ' ').toLowerCase() });
  if (properties.status) rows.push({ label: 'Status', value: properties.status });
  if (properties.neighbourhood) rows.push({ label: 'Neighbourhood', value: properties.neighbourhood });
  if (properties.district) rows.push({ label: 'Police district', value: properties.district });
  if (properties.seenByOfficer) rows.push({ label: 'Seen by', value: 'officer on view' });
  rows.push({
    label: 'Position',
    value: `${coordinates[1].toFixed(4)}, ${coordinates[0].toFixed(4)}`,
  });
  rows.push({
    label: 'Accuracy',
    value: `snapped to about ${COORDINATE_PRECISION_METRES} m; street addresses and free-text details are not stored`,
  });
  if (feed === 'calls') {
    rows.push({
      label: 'What this is not',
      value: 'not live 911, not a dispatch audio feed, and it omits the City\u2019s withheld sensitive calls',
    });
  }
  return rows.filter((row) => row.value !== undefined && row.value !== null && row.value !== '');
}
