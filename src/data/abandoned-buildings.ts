/**
 * A small, map-only extract of the building registry.
 *
 * The full registry is several megabytes and is deliberately fetched only when
 * the Buildings workspace or dossier layer is opened. The vacancy/abandonment
 * parcels are needed on the map by default, so the build writes this separate
 * point-only file. It contains no complaint text, contacts or record history.
 */
import type { AbandonedBuilding, AbandonedBuildingFile } from '../domain/types';

export const ABANDONED_BUILDINGS_URL = '/buildings/abandoned.json';

let cached: AbandonedBuildingFile | null = null;
let inflight: Promise<AbandonedBuildingFile> | null = null;

function parse(input: unknown): AbandonedBuildingFile {
  const file = input as Partial<AbandonedBuildingFile>;
  if (!file || !Array.isArray(file.dossiers)) throw new Error('unexpected abandoned-building payload');
  const dossiers: AbandonedBuilding[] = [];
  for (const entry of file.dossiers) {
    if (
      !entry ||
      typeof entry.id !== 'string' ||
      typeof entry.address !== 'string' ||
      !Array.isArray(entry.coordinates) ||
      entry.coordinates.length !== 2 ||
      !entry.coordinates.every((value) => Number.isFinite(value))
    ) {
      throw new Error('abandoned-building payload has an invalid dossier');
    }
    dossiers.push({
      id: entry.id,
      address: entry.address,
      status: entry.status === 'vacancy_history' ? 'vacancy_history' : 'reported_vacant',
      coordinates: entry.coordinates as [number, number],
      locationPrecision: entry.locationPrecision,
    });
  }
  return {
    generatedAt: typeof file.generatedAt === 'string' ? file.generatedAt : '',
    totalVacancy: Number(file.totalVacancy) || dossiers.length,
    located: Number(file.located) || dossiers.length,
    blockCentroid: Number(file.blockCentroid) || 0,
    dossiers,
  };
}

/** Loads the point-only extract once per session. */
export async function loadAbandonedBuildings(): Promise<AbandonedBuildingFile> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    const response = await fetch(ABANDONED_BUILDINGS_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status} for abandoned building markers`);
    const payload = parse(await response.json());
    cached = payload;
    inflight = null;
    return payload;
  })();
  try {
    return await inflight;
  } catch (error) {
    inflight = null;
    throw error;
  }
}

export function cachedAbandonedBuildings(): AbandonedBuildingFile | null {
  return cached;
}

/** Only for tests: clears the session cache. */
export function resetAbandonedBuildingsCache(): void {
  cached = null;
  inflight = null;
}
