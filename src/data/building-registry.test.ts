import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildingRegistrySchema } from '../domain/schemas';
import { BUILDING_STATUSES } from '../domain/buildings';
import meta from './building-registry-meta.json';
import sourcesJson from './sources.json';
import type { BuildingRegistry } from '../domain/types';

function readRegistry(): BuildingRegistry {
  const file = path.join(process.cwd(), 'public', 'buildings', 'registry.json');
  const parsed = buildingRegistrySchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
  if (!parsed.success) {
    const first = parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`registry failed validation — ${first.join('; ')}`);
  }
  return parsed.data as BuildingRegistry;
}

const registry = readRegistry();
const dossiers = registry.dossiers;
const statusIds = new Set(BUILDING_STATUSES.map((status) => status.id));
const sourceIds = new Set((sourcesJson as { id: string }[]).map((source) => source.id));

describe('shipped building registry', () => {
  it('is a parcel-level dossier set, not a list of pins', () => {
    expect(dossiers.length).toBeGreaterThan(1000);
    for (const dossier of dossiers) {
      expect(dossier.id).toBe(`bldg:${dossier.block}-${dossier.lot}`);
      expect(dossier.address.length).toBeGreaterThan(0);
      expect(dossier.complaintCount).toBe(dossier.counts.complaints);
      expect(dossier.noticeCount).toBe(dossier.counts.notices);
      expect(dossier.permitCount).toBe(dossier.counts.permits);
    }
  });

  it('keeps unique dossiers and never repeats a parcel', () => {
    const ids = new Set(dossiers.map((dossier) => dossier.id));
    expect(ids.size).toBe(dossiers.length);
  });

  it('places every published point inside the declared footprint, or leaves it out honestly', () => {
    for (const dossier of dossiers) {
      if (!dossier.coordinates) {
        expect(dossier.locationPrecision).toBe('none');
        continue;
      }
      const [lon, lat] = dossier.coordinates;
      expect(lon).toBeGreaterThanOrEqual(registry.footprint.west);
      expect(lon).toBeLessThanOrEqual(registry.footprint.east);
      expect(lat).toBeGreaterThanOrEqual(registry.footprint.south);
      expect(lat).toBeLessThanOrEqual(registry.footprint.north);
      expect(dossier.locationPrecision).not.toBe('none');
    }
  });

  it('classifies every dossier with a label that is a reading of records', () => {
    for (const dossier of dossiers) {
      expect(statusIds.has(dossier.status)).toBe(true);
      expect(dossier.score).toBeGreaterThanOrEqual(0);
      expect(dossier.score).toBeLessThanOrEqual(100);
      expect(['high', 'medium', 'low']).toContain(dossier.confidence);
      // A dossier is only in the build if it carries a record.
      expect(dossier.complaints.length + dossier.notices.length + dossier.permits.length).toBeGreaterThan(0);
    }
    expect(registry.classificationNote.toLowerCase()).toContain('not a field check');
  });

  it('keeps every record inside the counts it reports', () => {
    for (const dossier of dossiers) {
      expect(dossier.complaints.length).toBeLessThanOrEqual(dossier.counts.complaints);
      expect(dossier.notices.length).toBeLessThanOrEqual(dossier.counts.notices);
      expect(dossier.permits.length).toBeLessThanOrEqual(dossier.counts.permits);
      expect(dossier.counts.vacancyComplaints).toBeLessThanOrEqual(dossier.counts.complaints);
      expect(dossier.counts.vacancyNotices).toBeLessThanOrEqual(dossier.counts.notices);
    }
  });

  it('dates each dossier from its own newest preserved record', () => {
    for (const dossier of dossiers) {
      const dates = [
        ...dossier.complaints.map((row) => row.date),
        ...dossier.notices.map((row) => row.date),
        ...dossier.permits.map((row) => row.date),
      ].filter((date): date is string => Boolean(date));
      if (dates.length === 0) continue;
      expect(dossier.lastRecordAt).toBe(dates.sort().at(-1));
    }
  });

  it('cites only registered DBI sources', () => {
    expect(new Set(registry.sources.map((source) => source.id))).toEqual(
      new Set(['src:sfgov-dbi-complaints', 'src:sfgov-dbi-permits', 'src:sfgov-dbi-novs']),
    );
    for (const source of registry.sources) expect(sourceIds.has(source.id)).toBe(true);
  });
});

describe('building registry manifest', () => {
  it('matches the shipped file', () => {
    expect(meta.counts.dossiers).toBe(dossiers.length);
    expect(meta.counts.withCoordinates + meta.counts.withoutCoordinates).toBe(dossiers.length);
    const byStatus = Object.values(meta.counts.byStatus).reduce((total, count) => total + count, 0);
    expect(byStatus).toBe(dossiers.length);
    expect(meta.newestRecordAt).toBe(
      dossiers
        .map((dossier) => dossier.lastRecordAt)
        .filter((date): date is string => Boolean(date))
        .sort()
        .at(-1),
    );
  });

  it('states its window, its sources and what it cannot establish', () => {
    expect(meta.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(meta.scope.length).toBeGreaterThan(80);
    expect(meta.limitations.length).toBeGreaterThanOrEqual(5);
    const text = meta.limitations.join(' ').toLowerCase();
    expect(text).toContain('not');
    expect(text).toContain('complaint');
    expect(meta.counts.permitsRead).toBeGreaterThan(meta.counts.dossiers);
  });
});
