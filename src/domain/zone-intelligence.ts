/**
 * Zone-level context for choosing places to spend time.
 *
 * A zone is a coarse, stable grid cell, not an exact address or a person.
 * Official feeds remain separate from community ratings: dispatch volume is
 * not a crime count, a 311 request is not proof of wrongdoing, and neither is
 * a prediction that a visitor will be moved on or receive a complaint.
 */
export const ZONE_CELL_DEGREES = 0.0025; // roughly 220–280 m across in San Francisco
export type ZoneFeedKind = 'police_incident' | 'dispatched_call' | 'service_request' | 'street_condition' | 'community_note';
export type ZoneTimeBand = 'day' | 'evening' | 'late_night' | 'unknown';
export type ZoneRatingSource = 'self' | 'community';

export interface ZoneId {
  id: string;
  label: string;
  kind: 'grid_cell' | 'neighbourhood';
}

/** Input longitude/latitude and output a coarse, repeatable grid cell. */
export function zoneIdForPoint(longitude: number, latitude: number): ZoneId {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    throw new RangeError('Expected valid longitude and latitude');
  }
  const col = Math.floor(longitude / ZONE_CELL_DEGREES);
  const row = Math.floor(latitude / ZONE_CELL_DEGREES);
  return { id: `grid:${row}:${col}`, label: 'Approx. 250 m grid zone', kind: 'grid_cell' };
}

export interface ZoneFeedSignal {
  zoneId: string;
  feed: ZoneFeedKind;
  observedAt: string;
  /** Stable public category only; never include names, narrative or person details. */
  category: string;
}

export interface ZoneVisitRating {
  zoneId: string;
  observedAt: string;
  timeBand: ZoneTimeBand;
  source: ZoneRatingSource;
  /** 1 = very uncomfortable, 5 = very comfortable. Subjective, not a safety guarantee. */
  hangoutComfort: 1 | 2 | 3 | 4 | 5;
  /** 1 = frequent unwanted interruption, 5 = little/no unwanted interruption observed. */
  lowFriction: 1 | 2 | 3 | 4 | 5;
  /** 1 = access unclear/restricted, 5 = clearly public and permitted. */
  publicAccessClarity: 1 | 2 | 3 | 4 | 5;
}

export interface ZoneRatingSummary {
  score: number;
  reports: number;
  confidence: 'low' | 'medium' | 'high';
  freshness: 'recent' | 'aging' | 'stale' | 'unknown';
}

export interface ZoneIntelligenceSummary {
  zoneId: string;
  asOf: string;
  /** Community experience only; never computed from police/call counts. */
  hangoutComfort: ZoneRatingSummary | null;
  /** Community-reported low-friction experience, not a prediction of enforcement. */
  lowFriction: ZoneRatingSummary | null;
  /** Transparent counts, kept separate instead of merged into a danger score. */
  feedCounts: Record<ZoneFeedKind, number>;
  complaintSignals: number;
  caveat: string;
}

const FEED_KINDS: ZoneFeedKind[] = ['police_incident', 'dispatched_call', 'service_request', 'street_condition', 'community_note'];
const DAY_MS = 86_400_000;

function freshnessFor(dates: string[], now: Date): ZoneRatingSummary['freshness'] {
  if (dates.length === 0) return 'unknown';
  const times = dates.map((d) => new Date(d).getTime()).filter(Number.isFinite);
  if (times.length === 0) return 'unknown';
  const newest = Math.max(...times);
  const age = Math.max(0, (now.getTime() - newest) / DAY_MS);
  return age <= 30 ? 'recent' : age <= 180 ? 'aging' : 'stale';
}

function ratingSummary(values: ZoneVisitRating[], field: 'hangoutComfort' | 'lowFriction', now: Date): ZoneRatingSummary | null {
  if (values.length === 0) return null;
  const score = Math.round(values.reduce((sum, value) => sum + (value[field] - 1) * 25, 0) / values.length);
  const freshness = freshnessFor(values.map((v) => v.observedAt), now);
  const confidence: ZoneRatingSummary['confidence'] =
    values.length >= 10 && freshness === 'recent' ? 'high'
      : values.length >= 4 && freshness !== 'stale' && freshness !== 'unknown' ? 'medium'
        : 'low';
  return { score, reports: values.length, confidence, freshness };
}

/**
 * Summarize a single zone. Feed counts are limited to the last 30 days and do
 * not claim to be rates: population, reporting propensity and feed coverage
 * differ by place. Only explicitly marked complaint/service-request signals
 * contribute to complaintSignals; police calls and incident reports stay apart.
 */
export function summarizeZone(
  zoneId: string,
  signals: ZoneFeedSignal[],
  ratings: ZoneVisitRating[],
  now = new Date(),
): ZoneIntelligenceSummary {
  const cutoff = now.getTime() - 30 * DAY_MS;
  const recentSignals = signals.filter((s) => s.zoneId === zoneId && Number.isFinite(new Date(s.observedAt).getTime()) && new Date(s.observedAt).getTime() >= cutoff && new Date(s.observedAt).getTime() <= now.getTime());
  const recentRatings = ratings.filter((r) => r.zoneId === zoneId && Number.isFinite(new Date(r.observedAt).getTime()) && new Date(r.observedAt).getTime() <= now.getTime());
  const feedCounts = Object.fromEntries(FEED_KINDS.map((kind) => [kind, recentSignals.filter((s) => s.feed === kind).length])) as Record<ZoneFeedKind, number>;
  const complaintSignals = recentSignals.filter((s) => s.feed === 'service_request' && /noise|obstruction|sidewalk|parking|graffiti|litter|street cleaning|shared space/i.test(s.category)).length;

  return {
    zoneId,
    asOf: now.toISOString(),
    hangoutComfort: ratingSummary(recentRatings, 'hangoutComfort', now),
    lowFriction: ratingSummary(recentRatings, 'lowFriction', now),
    feedCounts,
    complaintSignals,
    caveat: 'Community ratings describe reported experiences, not objective safety or a promise of no complaints. Official feed counts are raw 30-day counts, not population-adjusted rates; calls, crime reports and service requests are different evidence and are not merged into a danger score.',
  };
}

export function zoneRatingLabel(summary: ZoneRatingSummary | null, kind: 'comfort' | 'friction'): string {
  if (!summary) return 'Not enough reports';
  if (summary.reports < 3) return 'Early reports · low confidence';
  const score = summary.score;
  if (kind === 'comfort') {
    return score >= 80 ? 'Often comfortable' : score >= 60 ? 'Generally comfortable' : score >= 40 ? 'Mixed experiences' : 'Often uncomfortable';
  }
  return score >= 80 ? 'Usually low-friction' : score >= 60 ? 'Mostly low-friction' : score >= 40 ? 'Mixed friction reports' : 'Frequent friction reported';
}
