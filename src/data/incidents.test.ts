import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import meta from './incidents-meta.json';
import datasetMeta from './meta.json';
import {
  COORD_PRECISION,
  bucketFor,
  describeLag,
  isExcludedType,
  snapCoordinate,
  snapPoint,
  toQuarterHour,
} from '../../scripts/lib/incidents.mjs';

interface ShippedFeature {
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: [number, number] };
}

function readFeed(name: 'calls' | 'cases311'): { features: ShippedFeature[] } {
  const file = path.join(process.cwd(), 'public', 'incidents', `${name}.json`);
  return JSON.parse(readFileSync(file, 'utf8')) as { features: ShippedFeature[] };
}

describe('incident rules', () => {
  it('snaps positions to a grid coarser than a doorway', () => {
    expect(snapCoordinate('-122.40851234')).toBeCloseTo(-122.4084, 6);
    expect(snapPoint('-122.40851234', '37.78351234')).toEqual([-122.4084, 37.7836]);
    // The grid is the point: about 40 m, which is wider than a house is.
    const metres = COORD_PRECISION * 111_320;
    expect(metres).toBeGreaterThan(30);
    expect(metres).toBeLessThan(60);
  });

  it('refuses values that are not numbers', () => {
    expect(snapCoordinate('not a number')).toBeNull();
    expect(snapCoordinate(undefined)).toBeNull();
    expect(snapPoint('x', 'y')).toBeNull();
  });

  it('never lets a person-describing category become a map point', () => {
    const refused = [
      'Homeless Encampment',
      'Encampment',
      'Welfare Check',
      'Medical Aid',
      'Psychiatric Emergency',
      'Suspicious Person',
      'Person Robbed',
      'Missing Person',
      'Domestic Violence',
      'Overdose',
      'Needle Pickup',
      'Suspect Search',
    ];
    for (const kind of refused) expect(isExcludedType(kind), kind).toBe(true);

    const kept = [
      'Street and Sidewalk Cleaning',
      'Graffiti',
      'Pothole',
      'Sidewalk Defect',
      'Abandoned Vehicle',
      'Traffic Collision',
      'Fire Department Response',
      'Tree Maintenance',
      'Streetlight Issue',
    ];
    for (const kind of kept) expect(isExcludedType(kind), kind).toBe(false);
  });

  it('buckets only what the source states, and never guesses a crime', () => {
    expect(bucketFor('Fire Department Response')).toBe('fire_ems');
    expect(bucketFor('Traffic Collision')).toBe('traffic');
    expect(bucketFor('Alarm Activation')).toBe('police');
    expect(bucketFor('Streetlight Issue')).toBe('infrastructure');
    expect(bucketFor('Something Unheard Of')).toBe('other');
    expect(bucketFor(null)).toBe('other');
  });

  it('measures staleness from the data and rounds a stale feed backwards', () => {
    const now = new Date('2026-10-27T13:00:00Z');
    expect(describeLag('2026-10-27T12:59:30Z', now)).toBe('under 2 minutes old');
    expect(describeLag('2026-10-27T12:20:00Z', now)).toBe('about 40 minutes old');
    expect(describeLag('2026-10-27T05:00:00Z', now)).toBe('about 8 hours old');
    expect(describeLag('2026-10-25T13:00:00Z', now)).toBe('about 2 days old');
    expect(describeLag(null, now)).toBe('age unknown');
    expect(toQuarterHour('2026-10-27T13:39:00Z')).toBe('2026-10-27T13:30:00.000Z');
    expect(toQuarterHour('nonsense')).toBeNull();
  });
});

describe('shipped incident snapshots', () => {
  const calls = readFeed('calls');
  const cases311 = readFeed('cases311');

  it('keeps both feeds, and only the two feeds it declares', () => {
    expect(calls.features.length).toBeGreaterThan(150);
    expect(cases311.features.length).toBeGreaterThan(500);
    expect(meta.feeds.map((f) => (f as { id: string }).id)).toEqual(['calls', 'cases311']);
  });

  it('contains nothing its own exclusion rules would refuse', () => {
    for (const feed of [calls, cases311]) {
      for (const feature of feed.features) {
        const kind = String(feature.properties.kind ?? '');
        expect(kind.length).toBeGreaterThan(0);
        expect(isExcludedType(kind), kind).toBe(false);
      }
    }
  });

  it('keeps every position on the published grid, inside the footprint', () => {
    const [west, south, east, north] = datasetMeta.footprint.bbox as [number, number, number, number];
    for (const feature of [...calls.features, ...cases311.features]) {
      const [lon, lat] = feature.geometry.coordinates;
      expect(Math.abs(lon / COORD_PRECISION - Math.round(lon / COORD_PRECISION))).toBeLessThan(1e-6);
      expect(Math.abs(lat / COORD_PRECISION - Math.round(lat / COORD_PRECISION))).toBeLessThan(1e-6);
      expect(lon).toBeGreaterThanOrEqual(west);
      expect(lon).toBeLessThanOrEqual(east);
      expect(lat).toBeGreaterThanOrEqual(south);
      expect(lat).toBeLessThanOrEqual(north);
    }
  });

  it('carries no address, narrative or personal field at all', () => {
    const dropped = (meta as { droppedFields: string[] }).droppedFields;
    const forbiddenKeys = [...dropped, 'address', 'intersection_name', 'caller', 'phone'];
    for (const feed of [calls, cases311]) {
      for (const feature of feed.features) {
        for (const key of forbiddenKeys) expect(feature.properties).not.toHaveProperty(key);
        for (const key of Object.keys(feature.properties)) {
          expect(
            /(address|note|narrative|detail|phone|caller|report_|response)/i.test(key),
            `${key} looks like a personal field`,
          ).toBe(false);
        }
      }
    }
  });

  it('states its staleness and its removals in the manifest', () => {
    for (const feed of meta.feeds as { id: string; rows: number; newest: string | null; lag: string }[]) {
      expect(feed.rows).toBeGreaterThan(0);
      expect(feed.newest).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(feed.lag).toMatch(/old$/);
    }
    expect((meta as { excludedTypePatterns: string[] }).excludedTypePatterns.length).toBeGreaterThanOrEqual(20);
    expect((meta as { droppedFields: string[] }).droppedFields.length).toBeGreaterThan(3);
  });
});
