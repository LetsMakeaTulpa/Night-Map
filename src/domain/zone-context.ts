import { zoneIdForPoint, type ZoneFeedSignal } from './zone-intelligence';

export interface PublishedZoneRecord {
  coordinates: [number, number];
  observedAt: string;
  /** A broad source category only; never a narrative or person detail. */
  category: string;
}

/**
 * Convert already-sanitized City snapshot records into coarse grid signals.
 * Coordinates are immediately reduced to the same approximate 250 m cell;
 * callers should retain only the returned signals, not publish raw positions.
 */
export function signalsFromPublishedRecords(
  calls: PublishedZoneRecord[],
  serviceRequests: PublishedZoneRecord[],
): ZoneFeedSignal[] {
  const convert = (
    records: PublishedZoneRecord[],
    feed: ZoneFeedSignal['feed'],
  ): ZoneFeedSignal[] => records.flatMap((record) => {
    try {
      return [{
        zoneId: zoneIdForPoint(record.coordinates[0], record.coordinates[1]).id,
        feed,
        observedAt: record.observedAt,
        category: record.category.slice(0, 80),
      }];
    } catch {
      return [];
    }
  });

  return [
    ...convert(calls, 'dispatched_call'),
    ...convert(serviceRequests, 'service_request'),
  ];
}
