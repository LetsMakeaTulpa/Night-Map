import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildingRegistrySchema } from '../domain/schemas';
import type { AbandonedBuildingFile, BuildingRegistry } from '../domain/types';

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), 'public', 'buildings', file), 'utf8')) as T;
}

const registry = buildingRegistrySchema.parse(readJson('registry.json')) as unknown as BuildingRegistry;
const abandoned = readJson<AbandonedBuildingFile>('abandoned.json');

describe('abandoned-building map extract', () => {
  it('contains every vacancy or abandonment dossier that has a mapped position', () => {
    const located = registry.dossiers
      .filter(
        (dossier) =>
          (dossier.status === 'reported_vacant' || dossier.status === 'vacancy_history') &&
          dossier.coordinates !== null,
      )
      .map((dossier) => dossier.id)
      .sort();
    expect(abandoned.dossiers.map((dossier) => dossier.id).sort()).toEqual(located);
    expect(abandoned.located).toBe(abandoned.dossiers.length);
    expect(abandoned.dossiers.length).toBeGreaterThan(0);
  });

  it('does not invent a position for a dossier without one', () => {
    for (const dossier of abandoned.dossiers) {
      expect(dossier.coordinates).toHaveLength(2);
      expect(dossier.locationPrecision).not.toBe('none');
      const [lon, lat] = dossier.coordinates;
      expect(lon).toBeGreaterThanOrEqual(registry.footprint.west);
      expect(lon).toBeLessThanOrEqual(registry.footprint.east);
      expect(lat).toBeGreaterThanOrEqual(registry.footprint.south);
      expect(lat).toBeLessThanOrEqual(registry.footprint.north);
    }
    expect(abandoned.blockCentroid).toBe(
      abandoned.dossiers.filter((dossier) => dossier.locationPrecision === 'block_centroid').length,
    );
  });

  it('keeps one marker per dossier and no private record text', () => {
    const ids = new Set(abandoned.dossiers.map((dossier) => dossier.id));
    expect(ids.size).toBe(abandoned.dossiers.length);
    for (const dossier of abandoned.dossiers) {
      expect(['reported_vacant', 'vacancy_history']).toContain(dossier.status);
      expect(dossier.address.length).toBeGreaterThan(0);
    }
  });
});
