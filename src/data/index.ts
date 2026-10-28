import { z } from 'zod';
import type { AccessFile, AppDataset, DisclosureFile, Place, Resource, Source, TransitStop } from '../domain/types';
import {
  accessFileSchema,
  datasetMetaSchema,
  disclosureFileSchema,
  placeSchema,
  resourceSchema,
  sourceSchema,
  transitSchema,
} from '../domain/schemas';
import { haversineMeters } from '../domain/geo';
import placesJson from './places.json';
import resourcesJson from './resources.json';
import sourcesJson from './sources.json';
import transitJson from './transit.json';
import neighbourhoodsJson from './neighbourhoods.json';
import metaJson from './meta.json';
import accessJson from './access.json';
import disclosuresJson from './disclosures.json';

export interface DatasetIndex {
  data: AppDataset;
  /** The hand-checked access file, with the geocode match behind each marker. */
  access: AccessFile;
  disclosureFile: DisclosureFile;
  placeById: Map<string, Place>;
  resourceById: Map<string, Resource>;
  resourceByPlaceId: Map<string, Resource>;
  resourcesByPlaceId: Map<string, Resource[]>;
  sourceById: Map<string, Source>;
  /** Places within 400 m (straight line) of a mapped Muni stop. */
  nearTransit: Set<string>;
  /** Category counts, so the UI can be honest about empty categories. */
  categoryCounts: Record<string, number>;
}

function parseOrThrow<T>(label: string, schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues.slice(0, 4).map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`${label} failed validation — ${first.join('; ')}`);
  }
  return result.data;
}

let cached: DatasetIndex | null = null;

export function loadDataset(): DatasetIndex {
  if (cached) return cached;

  const places = parseOrThrow('places.json', z.array(placeSchema), placesJson) as Place[];
  const resources = parseOrThrow('resources.json', z.array(resourceSchema), resourcesJson) as Resource[];
  const access = parseOrThrow('access.json', accessFileSchema, accessJson) as AccessFile;
  const disclosureFile = parseOrThrow('disclosures.json', disclosureFileSchema, disclosuresJson) as DisclosureFile;
  // Hand-checked records ride alongside the generated City files rather than
  // inside them, so a rebuild of the City extract cannot silently drop them.
  places.push(...access.places);
  resources.push(...access.resources);
  const sources = parseOrThrow('sources.json', z.array(sourceSchema), sourcesJson) as Source[];
  const transit = parseOrThrow('transit.json', z.array(transitSchema), transitJson) as TransitStop[];
  const meta = parseOrThrow('meta.json', datasetMetaSchema, metaJson);

  const placeById = new Map(places.map((p) => [p.id, p]));
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const resourceById = new Map(resources.map((r) => [r.id, r]));
  const resourceByPlaceId = new Map<string, Resource>();
  const resourcesByPlaceId = new Map<string, Resource[]>();
  for (const resource of resources) {
    if (!resourceByPlaceId.has(resource.placeId)) resourceByPlaceId.set(resource.placeId, resource);
    const list = resourcesByPlaceId.get(resource.placeId) ?? [];
    list.push(resource);
    resourcesByPlaceId.set(resource.placeId, list);
  }

  const nearTransit = new Set<string>();
  for (const place of places) {
    for (const stop of transit) {
      if (haversineMeters(place.geometry.coordinates, stop.geometry.coordinates) <= 400) {
        nearTransit.add(place.id);
        break;
      }
    }
  }

  const categoryCounts: Record<string, number> = {};
  for (const p of places) categoryCounts[p.category] = (categoryCounts[p.category] ?? 0) + 1;

  // Counts are computed from what is actually installed, so adding a record can
  // never leave the About panel quoting an older number.
  const counts = {
    ...meta.counts,
    places: places.length,
    resources: resources.length,
    disclosures: disclosureFile.entries.length,
  };

  cached = {
    data: {
      places,
      resources,
      sources,
      transit,
      neighbourhoods: neighbourhoodsJson as AppDataset['neighbourhoods'],
      disclosures: disclosureFile.entries,
      meta: { ...meta, counts },
    },
    access,
    disclosureFile,
    placeById,
    resourceById,
    resourceByPlaceId,
    resourcesByPlaceId,
    sourceById,
    nearTransit,
    categoryCounts,
  };
  return cached;
}

export interface IntegrityIssue {
  level: 'error' | 'warning';
  message: string;
}

export function checkIntegrity(index: DatasetIndex): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const ids = new Set<string>();
  for (const place of index.data.places) {
    if (ids.has(place.id)) issues.push({ level: 'error', message: `duplicate place id ${place.id}` });
    ids.add(place.id);
    for (const sourceId of place.sourceIds) {
      if (!index.sourceById.has(sourceId)) {
        issues.push({ level: 'error', message: `${place.id} references missing source ${sourceId}` });
      }
    }
    if (!Number.isFinite(place.geometry.coordinates[0]) || !Number.isFinite(place.geometry.coordinates[1])) {
      issues.push({ level: 'error', message: `${place.id} has invalid coordinates` });
    }
  }
  for (const resource of index.data.resources) {
    if (!index.placeById.has(resource.placeId)) {
      issues.push({ level: 'error', message: `${resource.id} points at missing place ${resource.placeId}` });
    }
    for (const sourceId of resource.sourceIds) {
      if (!index.sourceById.has(sourceId)) {
        issues.push({ level: 'error', message: `${resource.id} references missing source ${sourceId}` });
      }
    }
    // A resource that claims availability without a source or timestamp is a defect.
    if (resource.availability.status !== 'unknown' && resource.sourceIds.length === 0) {
      issues.push({ level: 'error', message: `${resource.id} claims availability without a source` });
    }
    // Cost and friction lines are only as good as the page they came from.
    for (const line of resource.friction ?? []) {
      if (!index.sourceById.has(line.sourceId)) {
        issues.push({
          level: 'error',
          message: `${resource.id} friction “${line.label}” cites missing source ${line.sourceId}`,
        });
      }
      if (line.kind === 'true_price' && line.value === null) {
        issues.push({ level: 'error', message: `${resource.id} friction “${line.label}” is a price with no value` });
      }
      if (line.asOf !== null && Number.isNaN(Date.parse(line.asOf))) {
        issues.push({ level: 'error', message: `${resource.id} friction “${line.label}” has an unreadable date` });
      }
    }
  }

  // A placed record must be reproducible: the coordinates have to match the
  // geocode match that is recorded next to them.
  for (const place of index.access.places) {
    const record = index.access.geocodes[place.id];
    if (!record) {
      issues.push({ level: 'error', message: `${place.id} has no recorded geocode match` });
      continue;
    }
    if (record.coordinates[0] !== place.geometry.coordinates[0] || record.coordinates[1] !== place.geometry.coordinates[1]) {
      issues.push({ level: 'error', message: `${place.id} sits at coordinates the recorded geocode did not return` });
    }
    if (place.locationPrecision !== 'geocoded_address') {
      issues.push({ level: 'error', message: `${place.id} is hand-placed but is not labelled as geocoded` });
    }
  }

  const disclosureUrls = new Set<string>();
  for (const entry of index.disclosureFile.entries) {
    if (disclosureUrls.has(entry.url)) {
      issues.push({ level: 'error', message: `disclosure ${entry.id} repeats a url` });
    }
    disclosureUrls.add(entry.url);
  }

  return issues;
}

export const dataset = loadDataset();
