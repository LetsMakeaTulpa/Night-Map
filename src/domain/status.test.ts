import { describe, expect, it } from 'vitest';
import { daysSince, evidenceFor, formatAge, recency } from './status';
import type { Place, Resource, Source } from './types';

const now = new Date('2026-10-24T12:00:00Z');

const source: Source = {
  id: 'src:test',
  name: 'Test source',
  url: 'https://example.org',
  provider: 'Example',
  sourceType: 'official_web',
  license: 'Test',
  licenseUrl: null,
  retrievedAt: '2026-10-20',
  updateCadence: 'Never',
  fields: [],
  coverage: 'Test',
  limitations: 'Test only',
  importMethod: 'manual',
};

const place: Place = {
  id: 'place:test',
  name: 'Test place',
  category: 'food',
  geometry: { type: 'Point', coordinates: [-122.41, 37.78] },
  address: '1 Test St',
  addressType: 'street_address',
  description: 'A test',
  accessibility: { status: 'not_documented', note: 'none' },
  sourceIds: ['src:test'],
  status: 'active',
  locationPrecision: 'geocoded_address',
  neighborhood: null,
  createdAt: '2026-10-24',
  updatedAt: '2026-10-24',
};

const baseResource = (overrides: Partial<Resource> = {}): Resource => ({
  id: 'res:test',
  placeId: 'place:test',
  name: 'Test place',
  category: 'food',
  serviceTypes: ['prepared_meals'],
  cost: { kind: 'free', note: null },
  eligibility: null,
  intake: null,
  hours: { kind: 'weekly', days: [1, 2, 3, 4, 5], opens: '09:00', closes: '17:00', daysKnown: true },
  availability: { status: 'unknown', note: 'not checked' },
  officialContact: null,
  sourceIds: ['src:test'],
  sourceUpdatedAt: '2026-10-20',
  lastVerifiedAt: '2026-10-20',
  verification: { status: 'official_source', label: 'City inventory', note: 'dataset row' },
  details: {},
  license: 'test',
  ...overrides,
});

describe('recency', () => {
  it('categorises timestamps into fresh, aging and stale bands', () => {
    expect(recency('2026-10-20', now).level).toBe('fresh');
    expect(recency('2026-03-01', now).level).toBe('aging');
    expect(recency('2024-01-01', now).level).toBe('stale');
    expect(recency(null, now).level).toBe('unknown');
    expect(daysSince('2026-10-20', now)).toBe(4);
  });

  it('formats ages without inventing precision', () => {
    expect(formatAge(0)).toBe('today');
    expect(formatAge(4)).toBe('4 days ago');
    expect(formatAge(220)).toBe('7 months ago');
    expect(formatAge(null)).toBe('date unknown');
  });
});

describe('evidenceFor', () => {
  it('claims open status only for fresh, sourced hours', () => {
    // 2026-10-26T18:00:00Z = Monday 11:00 in San Francisco, inside 09:00-17:00.
    const fresh = evidenceFor(place, baseResource(), [source], new Date('2026-10-26T18:00:00Z'));
    expect(fresh.canClaimOpen).toBe(true);
    expect(fresh.openNow).toBe(true);
  });

  it('refuses to say open when the record is only a few months old', () => {
    const aging = evidenceFor(
      place,
      baseResource({ lastVerifiedAt: null, sourceUpdatedAt: '2026-03-01' }),
      [source],
      new Date('2026-10-24T18:00:00Z'),
    );
    expect(aging.canClaimOpen).toBe(false);
    expect(aging.openNow).toBeNull();
    expect(aging.label).toContain('aging');
    expect(aging.openNote).toContain('not fresh enough');
  });

  it('refuses to say open when no hours are published', () => {
    const noHours = evidenceFor(place, baseResource({ hours: null }), [source], now);
    expect(noHours.canClaimOpen).toBe(false);
    expect(noHours.openNow).toBeNull();
    expect(noHours.hours).toBeNull();
  });

  it('marks stale official records as potentially outdated', () => {
    const stale = evidenceFor(
      place,
      baseResource({ lastVerifiedAt: null, sourceUpdatedAt: '2024-01-01' }),
      [source],
      now,
    );
    expect(stale.tone).toBe('stale');
    expect(stale.label).toContain('potentially outdated');
  });

  it('never claims availability for closed records', () => {
    const closed = evidenceFor(
      place,
      baseResource({
        verification: { status: 'permanently_closed', label: 'Reported closed', note: 'closed' },
        lastVerifiedAt: '2026-10-23',
      }),
      [source],
      now,
    );
    expect(closed.openNow).toBeNull();
    expect(closed.tone).toBe('closed');
  });
});
