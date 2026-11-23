/**
 * The building registry is fetched, not bundled.
 *
 * Its 3,600 parcel dossiers are several megabytes — the same reason terrain and
 * 3D footprints are not installed up front. The first visit to Buildings, or the
 * first time the registry layer is switched on, downloads it once; the service
 * worker caches that response so the next visit works offline. The meta file is
 * small and ships with the shell so counts and limits are available before the
 * registry is.
 */
import metaJson from './building-registry-meta.json';
import { buildingRegistrySchema } from '../domain/schemas';
import type { BuildingDossier, BuildingRegistry, BuildingRegistryMeta } from '../domain/types';

export const BUILDING_REGISTRY_META = metaJson as unknown as BuildingRegistryMeta;
export const BUILDING_REGISTRY_URL = '/buildings/registry.json';

let cached: BuildingRegistry | null = null;
let index: Map<string, BuildingDossier> | null = null;
let inflight: Promise<BuildingRegistry> | null = null;

function parseRegistry(input: unknown): BuildingRegistry {
  const result = buildingRegistrySchema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues.slice(0, 3).map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`building registry failed validation — ${first.join('; ')}`);
  }
  return result.data as BuildingRegistry;
}

/** Loads once, validates once, and never refetches in the same session. */
export async function loadBuildingRegistry(): Promise<BuildingRegistry> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    const response = await fetch(BUILDING_REGISTRY_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status} for the building registry`);
    const payload = parseRegistry(await response.json());
    cached = payload;
    index = new Map(payload.dossiers.map((dossier) => [dossier.id, dossier]));
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

export function cachedBuildingRegistry(): BuildingRegistry | null {
  return cached;
}

export function buildingById(id: string | null): BuildingDossier | null {
  if (!id || !index) return null;
  return index.get(id) ?? null;
}

export function registeredBuildingCount(): number {
  return cached?.dossiers.length ?? 0;
}

/** Only for tests: clears the session cache. */
export function resetBuildingRegistryCache(): void {
  cached = null;
  index = null;
  inflight = null;
}
