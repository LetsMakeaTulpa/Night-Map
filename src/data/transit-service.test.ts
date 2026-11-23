import { describe, expect, it } from 'vitest';
import transit from './transit.json';
import {
  formatServiceClock,
  isAfterMidnight,
  overnightServiceFor,
  overnightStops,
  transitServiceMeta,
} from './transit-service';

const installed = transit as { id: string }[];

describe('overnight Muni service', () => {
  it('keys every service record to an installed stop', () => {
    const ids = new Set(installed.map((stop) => stop.id));
    const records = Object.keys(overnightStops);
    expect(records.length).toBeGreaterThan(0);
    for (const id of records) expect(ids.has(id)).toBe(true);
  });

  it('keeps every scheduled departure inside the 22:00–05:00 window', () => {
    for (const service of Object.values(overnightStops)) {
      expect(service.departures).toBeGreaterThan(0);
      expect(service.routes.length).toBeGreaterThan(0);
      for (const route of service.routes) {
        const [hours, minutes] = route.lastDeparture.split(':').map(Number);
        expect(hours * 60 + minutes).toBeGreaterThanOrEqual(22 * 60);
        expect(hours * 60 + minutes).toBeLessThan(29 * 60);
        expect(route.departures).toBeGreaterThanOrEqual(1);
        if (route.headwayMinutes !== null) {
          expect(route.headwayMinutes).toBeGreaterThan(1);
          expect(route.headwayMinutes).toBeLessThanOrEqual(90);
        }
      }
      // A stop is only flagged owl when a trip is scheduled after midnight, so
      // its last departure must also fall after midnight.
      if (service.owl) expect(Number(service.lastDeparture.split(':')[0])).toBeGreaterThanOrEqual(24);
    }
  });

  it('formats GTFS night-clock times without wrapping the day label', () => {
    expect(formatServiceClock('22:05')).toBe('10:05 PM');
    expect(formatServiceClock('23:50')).toBe('11:50 PM');
    expect(formatServiceClock('00:10')).toBe('12:10 AM');
    expect(formatServiceClock('25:14')).toBe('1:14 AM');
    expect(formatServiceClock('28:32')).toBe('4:32 AM');
    expect(isAfterMidnight('25:14')).toBe(true);
    expect(isAfterMidnight('23:50')).toBe(false);
  });

  it('carries the SFMTA derivative notice and a service date inside the feed window', () => {
    expect(transitServiceMeta.notice).toContain('Reproduced with permission');
    expect(transitServiceMeta.notice).toContain('nonexclusive, limited, and revocable license');
    expect(transitServiceMeta.serviceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(transitServiceMeta.feedStartDate <= transitServiceMeta.serviceDate).toBe(true);
    expect(transitServiceMeta.serviceDate <= transitServiceMeta.feedEndDate).toBe(true);
  });

  it('describes scheduled data only', () => {
    const text = JSON.stringify(transitServiceMeta).toLowerCase();
    expect(text).not.toContain('real-time');
    expect(text).not.toContain('live');
    expect(transitServiceMeta.window).toContain('05:00');
  });

  it('names unmatched stops instead of claiming they have no service', () => {
    expect(transitServiceMeta.unmatchedStopIds).toHaveLength(transitServiceMeta.counts.unmatchedStops);
    const ids = new Set(installed.map((stop) => stop.id));
    for (const id of transitServiceMeta.unmatchedStopIds) {
      expect(ids.has(id)).toBe(true);
      expect(overnightServiceFor(id)).toBeNull();
    }
  });

  it('resolves a known owl stop to its routes', () => {
    const service = overnightServiceFor('stop:muni:3241:114071');
    expect(service).not.toBeNull();
    expect(service?.owl).toBe(true);
    expect(service?.routes.length).toBeGreaterThan(0);
  });

  it('returns null for a stop with no scheduled night service', () => {
    expect(overnightServiceFor('stop:missing')).toBeNull();
  });
});
