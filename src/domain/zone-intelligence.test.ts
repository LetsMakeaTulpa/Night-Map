import { describe, expect, it } from 'vitest';
import { summarizeZone, zoneIdForPoint, zoneRatingLabel, type ZoneFeedSignal, type ZoneVisitRating } from './zone-intelligence';

describe('zone intelligence', () => {
  const now = new Date('2026-10-28T12:00:00Z');

  it('maps nearby coordinates into a stable coarse grid zone', () => {
    expect(zoneIdForPoint(-122.4085, 37.7835).id).toBe(zoneIdForPoint(-122.4084, 37.7836).id);
    expect(zoneIdForPoint(-122.4085, 37.7835).kind).toBe('grid_cell');
  });

  it('rejects invalid coordinates', () => {
    expect(() => zoneIdForPoint(500, 91)).toThrow(RangeError);
  });

  it('keeps feed counts separate and ignores stale or future signals', () => {
    const signals: ZoneFeedSignal[] = [
      { zoneId: 'z', feed: 'dispatched_call', observedAt: '2026-10-27T10:00:00Z', category: 'noise' },
      { zoneId: 'z', feed: 'police_incident', observedAt: '2026-10-26T10:00:00Z', category: 'reported incident' },
      { zoneId: 'z', feed: 'service_request', observedAt: '2026-10-25T10:00:00Z', category: 'noise complaint' },
      { zoneId: 'z', feed: 'service_request', observedAt: '2026-09-01T10:00:00Z', category: 'noise complaint' },
      { zoneId: 'elsewhere', feed: 'service_request', observedAt: '2026-10-27T10:00:00Z', category: 'noise complaint' },
      { zoneId: 'z', feed: 'service_request', observedAt: '2026-10-29T10:00:00Z', category: 'noise complaint' },
    ];
    const summary = summarizeZone('z', signals, [], now);
    expect(summary.feedCounts.dispatched_call).toBe(1);
    expect(summary.feedCounts.police_incident).toBe(1);
    expect(summary.feedCounts.service_request).toBe(1);
    expect(summary.complaintSignals).toBe(1);
    expect(summary.hangoutComfort).toBeNull();
  });

  it('does not convert official feed counts into a comfort score', () => {
    const signals: ZoneFeedSignal[] = Array.from({ length: 30 }, (_, i) => ({
      zoneId: 'z', feed: 'police_incident', observedAt: '2026-10-27T10:00:00Z', category: `incident-${i}`,
    }));
    const summary = summarizeZone('z', signals, [], now);
    expect(summary.hangoutComfort).toBeNull();
    expect(summary.lowFriction).toBeNull();
  });

  it('rates comfort and low friction only from dated community reports', () => {
    const ratings: ZoneVisitRating[] = [1, 2, 3, 4].map(() => ({
      zoneId: 'z', observedAt: '2026-10-27T10:00:00Z', timeBand: 'late_night', source: 'community',
      hangoutComfort: 5, lowFriction: 4, publicAccessClarity: 5,
    }));
    const summary = summarizeZone('z', [], ratings, now);
    expect(summary.hangoutComfort?.score).toBe(100);
    expect(summary.hangoutComfort?.confidence).toBe('medium');
    expect(summary.lowFriction?.score).toBe(75);
    expect(summary.publicAccessClarity?.score).toBe(100);
    expect(summarizeZone('z', [], ratings, now, 'day').hangoutComfort).toBeNull();
    expect(zoneRatingLabel(summary.hangoutComfort, 'comfort')).toBe('Often comfortable');
  });

  it('requires three reports before using a substantive label', () => {
    const ratings: ZoneVisitRating[] = [{
      zoneId: 'z', observedAt: '2026-10-27T10:00:00Z', timeBand: 'day', source: 'self',
      hangoutComfort: 5, lowFriction: 5, publicAccessClarity: 5,
    }];
    const summary = summarizeZone('z', [], ratings, now);
    expect(zoneRatingLabel(summary.hangoutComfort, 'comfort')).toBe('Early reports · low confidence');
  });
});
