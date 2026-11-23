import raw from './transit-service.json';

/**
 * Scheduled overnight service derived from the SFMTA GTFS feed.
 *
 * This is a timetable, not a vehicle feed: it says what Muni scheduled between
 * 22:00 and 05:00 on one named service date. It cannot say that a bus is coming,
 * that a stop is safe to wait at, or that service is running normally tonight.
 *
 * Licence: the SFMTA Transit Data License Agreement permits reproduction,
 * redistribution and derivative versions provided every derivative carries the
 * clause-12 notice, which travels in `meta.notice` and is shown on the stop card.
 */
export interface OvernightRoute {
  route: string;
  departures: number;
  /** Median gap between departures in the window; null when too few to infer one. */
  headwayMinutes: number | null;
  /** GTFS clock time, which can pass midnight: "25:14" is 1:14 AM next day. */
  lastDeparture: string;
}

export interface OvernightStopService {
  stopId: string | null;
  /** A route is scheduled between 00:00 and 05:00 at this stop. */
  owl: boolean;
  departures: number;
  lastDeparture: string;
  routes: OvernightRoute[];
}

export interface TransitServiceMeta {
  generatedAt: string;
  sourceName: string;
  sourceUrl: string;
  feedUrl: string;
  feedStartDate: string;
  feedEndDate: string;
  serviceDate: string;
  serviceDay: string;
  window: string;
  license: string;
  licenseUrl: string;
  notice: string;
  counts: {
    installedStops: number;
    matchedStops: number;
    matchedById: number;
    matchedByName: number;
    unmatchedStops: number;
    withOvernightService: number;
    owlStops: number;
    sampledRoutes: number;
  };
  /** Installed stops with no GTFS counterpart; service is unknown, not absent. */
  unmatchedStopIds: string[];
}

interface TransitServiceFile {
  meta: TransitServiceMeta;
  stops: Record<string, OvernightStopService>;
}

const file = raw as TransitServiceFile;

export const transitServiceMeta = file.meta;

/** Stops with at least one scheduled departure inside the night window. */
export const overnightStops: Readonly<Record<string, OvernightStopService>> = file.stops;

export const overnightStopCount = Object.keys(file.stops).length;

export function overnightServiceFor(stopId: string): OvernightStopService | null {
  return file.stops[stopId] ?? null;
}

export function hasOvernightService(stopId: string): boolean {
  return Boolean(file.stops[stopId]);
}

/** "25:14" → "1:14 AM". Night-service times past midnight are kept as 24+. */
export function formatServiceClock(value: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return value;
  const total = Number(match[1]) * 60 + Number(match[2]);
  const minutes = ((total % 1440) + 1440) % 1440;
  const hours24 = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const suffix = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(mins).padStart(2, '0')} ${suffix}`;
}

/** Whether a night-clock value falls after midnight (i.e. 24:00 or later). */
export function isAfterMidnight(value: string): boolean {
  return Number(value.split(':')[0] ?? 0) >= 24;
}

export function formatServiceDate(date = transitServiceMeta.serviceDate): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function describeHeadway(route: OvernightRoute): string {
  if (route.headwayMinutes !== null) return `about every ${route.headwayMinutes} min`;
  return route.departures === 1 ? 'one scheduled departure' : `${route.departures} scheduled departures`;
}
