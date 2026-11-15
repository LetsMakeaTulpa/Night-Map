import { describe, expect, it } from 'vitest';
import {
  isPublicRealmMaintenanceKind,
  summarizePublicRealmMaintenanceForZone,
} from './public-realm-maintenance';
import { zoneIdForPoint } from './zone-intelligence';

describe('public-realm maintenance filter', () => {
  it('accepts only exact, public-realm City service types', () => {
    expect(isPublicRealmMaintenanceKind('Streetlights')).toBe(true);
    expect(isPublicRealmMaintenanceKind('Street and Sidewalk Cleaning')).toBe(true);
    expect(isPublicRealmMaintenanceKind('Graffiti Public')).toBe(true);
    expect(isPublicRealmMaintenanceKind('Graffiti Private')).toBe(false);
    expect(isPublicRealmMaintenanceKind('Encampment')).toBe(false);
    expect(isPublicRealmMaintenanceKind('General Request')).toBe(false);
    expect(isPublicRealmMaintenanceKind(null)).toBe(false);
  });

  it('counts only allowlisted records in the requested coarse grid cell', () => {
    const point: [number, number] = [-122.4085, 37.7835];
    const zone = zoneIdForPoint(point[0], point[1]);
    const summary = summarizePublicRealmMaintenanceForZone([
      { coordinates: point, kind: 'Streetlights' },
      { coordinates: point, kind: 'Streetlights' },
      { coordinates: point, kind: 'Graffiti Public' },
      { coordinates: point, kind: 'Graffiti Private' },
      { coordinates: [-122.41, 37.78], kind: 'Street Defect' },
    ], zone.id);
    expect(summary.total).toBe(3);
    expect(summary.categories).toEqual([
      { kind: 'Streetlights', label: 'Streetlight service requests', count: 2 },
      { kind: 'Graffiti Public', label: 'Public-property graffiti reports', count: 1 },
    ]);
  });

  it('ignores invalid positions rather than inventing a cell', () => {
    const zone = zoneIdForPoint(-122.4085, 37.7835);
    const summary = summarizePublicRealmMaintenanceForZone([
      { coordinates: [999, 91], kind: 'Streetlights' },
    ], zone.id);
    expect(summary).toEqual({ total: 0, categories: [] });
  });
});
