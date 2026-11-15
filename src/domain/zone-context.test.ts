import { describe, expect, it } from 'vitest';
import { signalsFromPublishedRecords } from './zone-context';

describe('published records to zone signals', () => {
  it('reduces records to coarse grid ids and keeps the feed types separate', () => {
    const signals = signalsFromPublishedRecords(
      [
        { coordinates: [-122.4085, 37.7835], observedAt: '2026-10-27T10:00:00Z', category: 'published dispatched call' },
      ],
      [
        { coordinates: [-122.4084, 37.7836], observedAt: '2026-10-27T11:00:00Z', category: 'Noise · mechanical equipment' },
      ],
    );

    expect(signals).toHaveLength(2);
    expect(signals[0].zoneId).toBe(signals[1].zoneId);
    expect(signals[0].feed).toBe('dispatched_call');
    expect(signals[1].feed).toBe('service_request');
    expect(signals[1].category).toBe('Noise · mechanical equipment');
  });

  it('drops invalid coordinates instead of failing the whole context panel', () => {
    const signals = signalsFromPublishedRecords(
      [{ coordinates: [999, 91], observedAt: '2026-10-27T10:00:00Z', category: 'published dispatched call' }],
      [{ coordinates: [-122.4085, 37.7835], observedAt: '2026-10-27T11:00:00Z', category: 'Street cleaning' }],
    );

    expect(signals).toHaveLength(1);
    expect(signals[0].feed).toBe('service_request');
  });

  it('truncates categories to a broad label-sized field', () => {
    const signals = signalsFromPublishedRecords([], [
      { coordinates: [-122.4085, 37.7835], observedAt: '2026-10-27T11:00:00Z', category: 'x'.repeat(200) },
    ]);

    expect(signals[0].category).toHaveLength(80);
  });
});
