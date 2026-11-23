import { describe, expect, it } from 'vitest';
import { matchesFilters, viewsInBounds, type PlaceView } from './selectors';
import { evidenceFor } from '../domain/status';
import type { Filters, Place, Resource } from '../domain/types';

const place: Place = {
  id: 'place:t',
  name: 'Test',
  category: 'water',
  geometry: { type: 'Point', coordinates: [-122.41, 37.78] },
  address: null,
  addressType: 'point',
  description: '',
  accessibility: { status: 'not_documented', note: '' },
  sourceIds: ['src:test'],
  status: 'active',
  locationPrecision: 'dataset_point',
  neighborhood: null,
  createdAt: '2026-10-01',
  updatedAt: '2026-10-01',
};

const resource: Resource = {
  id: 'res:t',
  placeId: place.id,
  name: 'Test',
  category: 'water',
  serviceTypes: ['drinking_water'],
  cost: { kind: 'free', note: 'free' },
  eligibility: null,
  intake: null,
  hours: { kind: 'weekly', days: [0, 1, 2, 3, 4, 5, 6], opens: '07:00', closes: '19:00', daysKnown: true },
  availability: { status: 'unknown', note: 'unknown' },
  officialContact: null,
  sourceIds: ['src:test'],
  sourceUpdatedAt: '2026-10-01',
  lastVerifiedAt: null,
  verification: { status: 'official_source', label: 'City', note: '' },
  details: {},
  license: 'PDDL',
};

const view = (now = new Date('2026-10-24T18:00:00Z')): PlaceView => ({
  place,
  resource,
  evidence: evidenceFor(place, resource, [], now),
  distanceMeters: 400,
  walkMinutes: 6,
  isNearTransit: true,
  saved: false,
});

const baseFilters: Filters = {
  categories: ['water'],
  openNow: false,
  freeOnly: false,
  verifiedOnly: false,
  maxWalkMinutes: 0,
  nearTransit: false,
  accessibleOnly: false,
  afterDark: false,
  overnightStops: false,
  query: '',
};

describe('matchesFilters', () => {
  it('passes a matching category', () => {
    expect(matchesFilters(view(), baseFilters)).toBe(true);
  });

  it('excludes categories that are not selected', () => {
    expect(matchesFilters(view(), { ...baseFilters, categories: ['food'] })).toBe(false);
  });

  it('requires a real open claim for the open-now condition', () => {
    expect(matchesFilters(view(), { ...baseFilters, openNow: true })).toBe(true);
    const staleEvidence = view();
    staleEvidence.resource = { ...resource, sourceUpdatedAt: '2026-03-01' };
    staleEvidence.evidence = evidenceFor(place, staleEvidence.resource, [], new Date('2026-10-24T18:00:00Z'));
    expect(matchesFilters(staleEvidence, { ...baseFilters, openNow: true })).toBe(false);
  });

  it('returns nothing when accessibility is required, because no record documents it', () => {
    expect(matchesFilters(view(), { ...baseFilters, accessibleOnly: true })).toBe(false);
  });

  it('limits after-dark results to POPOS explicitly listed open at all times', () => {
    const popos = { ...view(), place: { ...place, category: 'popos' as const }, resource: { ...resource, category: 'popos' as const, details: { cityHours: 'Open at all times' } } };
    const daylightPopos = { ...popos, resource: { ...popos.resource!, details: { cityHours: 'Open during daylight hours' } } };
    expect(matchesFilters(popos, { ...baseFilters, categories: ['popos'], afterDark: true })).toBe(true);
    expect(matchesFilters(daylightPopos, { ...baseFilters, categories: ['popos'], afterDark: true })).toBe(false);
    expect(matchesFilters(view(), { ...baseFilters, afterDark: true })).toBe(false);
  });

  it('honours distance, free and transit conditions', () => {
    expect(matchesFilters(view(), { ...baseFilters, maxWalkMinutes: 5 })).toBe(false);
    expect(matchesFilters(view(), { ...baseFilters, maxWalkMinutes: 10 })).toBe(true);
    expect(matchesFilters(view(), { ...baseFilters, freeOnly: true })).toBe(true);
    expect(matchesFilters(view(), { ...baseFilters, nearTransit: true })).toBe(true);
    expect(matchesFilters({ ...view(), isNearTransit: false }, { ...baseFilters, nearTransit: true })).toBe(false);
  });
});

describe('viewsInBounds', () => {
  const at = (coordinates: [number, number]): PlaceView => ({
    ...view(),
    place: { ...place, geometry: { type: 'Point', coordinates } },
  });
  const bounds: [number, number, number, number] = [-122.42, 37.77, -122.4, 37.79];

  it('returns only records inside the viewport, including its edges', () => {
    expect(viewsInBounds([at([-122.41, 37.78]), at([-122.42, 37.77]), at([-122.4, 37.79])], bounds)).toHaveLength(3);
    expect(viewsInBounds([at([-122.43, 37.78]), at([-122.41, 37.8])], bounds)).toEqual([]);
  });

  it('returns no in-view records before the map publishes camera bounds', () => {
    expect(viewsInBounds([at([-122.41, 37.78])], null)).toEqual([]);
  });
});
