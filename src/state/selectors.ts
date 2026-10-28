import type { CategoryId, Filters, Place, Resource } from '../domain/types';
import type { DatasetIndex } from '../data';
import type { AppState } from './store';
import { evidenceFor, recency, type EvidenceStatus } from '../domain/status';
import { haversineMeters, walkingMinutes } from '../domain/geo';
import { CATEGORY_BY_ID } from '../domain/categories';

export interface PlaceView {
  place: Place;
  resource: Resource | undefined;
  evidence: EvidenceStatus;
  distanceMeters: number;
  walkMinutes: number;
  isNearTransit: boolean;
  saved: boolean;
}

export function buildPlaceView(place: Place, index: DatasetIndex, state: AppState, now = new Date()): PlaceView {
  const resource = index.resourceByPlaceId.get(place.id);
  const distance = haversineMeters(state.reference.coordinates, place.geometry.coordinates);
  const override = state.overrides[place.id] ?? null;
  return {
    place, resource, evidence: evidenceFor(place, resource, index.data.sources, now, override),
    distanceMeters: distance, walkMinutes: walkingMinutes(distance), isNearTransit: index.nearTransit.has(place.id),
    saved: state.saved.some((saved) => saved.placeId === place.id),
  };
}

export function matchesFilters(view: PlaceView, filters: Filters, now = new Date()): boolean {
  const { place, evidence, resource } = view;
  if (place.category === 'history' || !filters.categories.includes(place.category)) return false;
  if (filters.openNow && evidence.openNow !== true) return false;
  if (filters.freeOnly && resource?.cost?.kind !== 'free') return false;
  if (filters.nearTransit && !view.isNearTransit) return false;
  if (filters.accessibleOnly && place.accessibility.status !== 'documented_accessible') return false;
  if (filters.afterDark && !(place.category === 'popos' && /open at all times|accessible at all times/i.test(String(resource?.details.cityHours ?? '')))) return false;
  if (filters.maxWalkMinutes > 0 && view.walkMinutes > filters.maxWalkMinutes) return false;
  if (filters.verifiedOnly && (!(evidence.tone === 'official' || evidence.tone === 'verified') || recency(evidence.checkedAt, now).level !== 'fresh')) return false;
  return true;
}

const DISCOVERY_TYPES: string[] = ['passage_discovery', 'popos_observation', 'entrance_observation', 'stairs_ramp_observation', 'architectural_detail', 'historical_discovery', 'research_lead'];

export function filteredViews(state: AppState, index: DatasetIndex, now = new Date()): PlaceView[] {
  const bundled = index.data.places.filter((place) => place.category !== 'history').map((place) => buildPlaceView(place, index, state, now));
  const source = {
    id: 'src:private-observation', name: 'Private field observation', url: '', provider: 'This device',
    sourceType: 'official_web' as const, license: 'Private local data', licenseUrl: null,
    retrievedAt: now.toISOString().slice(0, 10), updateCadence: 'user observation', fields: [], coverage: 'This device',
    limitations: 'Unverified private observation; not an accepted public record.', importMethod: 'Local fieldnote',
  };
  const privateIndex = { ...index, data: { ...index.data, sources: [...index.data.sources, source] } };
  const local = state.observations
    .filter((observation) => observation.visibility === 'private' && observation.geometry && DISCOVERY_TYPES.includes(observation.type))
    .map((observation): PlaceView => {
      const category: CategoryId = observation.type === 'passage_discovery' ? 'passage'
        : observation.type === 'popos_observation' ? 'popos'
          : observation.type === 'entrance_observation' || observation.type === 'stairs_ramp_observation' ? 'pedestrian_connection'
            : observation.type === 'research_lead' ? 'research_lead'
              : observation.type === 'historical_discovery' || observation.type === 'architectural_detail' ? 'urban_clue' : 'urban_clue';
      const definition = CATEGORY_BY_ID.get(category);
      const place: Place = {
        id: `private:${observation.id}`, name: observation.placeName ?? `Private ${definition?.short ?? 'field'} observation`,
        category, geometry: observation.geometry!, address: null, addressType: 'point',
        description: `${observation.note} Access: ${(observation.accessStatus ?? 'unknown').replaceAll('_', ' ')}. Evidence: ${(observation.confidence ?? 'unverified').replaceAll('_', ' ')}. Private, unverified field observation.`,
        accessibility: { status: 'not_documented', note: 'Accessibility has not been independently verified.' },
        sourceIds: [source.id], status: 'unknown', locationPrecision: 'dataset_point', neighborhood: null,
        createdAt: observation.recordedAt.slice(0, 10), updatedAt: observation.updatedAt.slice(0, 10),
        verificationOverride: { status: 'unverified', label: 'Private · unverified', note: 'This observation is stored on this device only.' },
      };
      const base = buildPlaceView(place, privateIndex, state, now);
      return {
        ...base, resource: undefined,
        evidence: {
          tone: 'unknown', label: 'Private · unverified', detail: 'Private field observation on this device; not an accepted or published record.',
          checkedAt: null, recency: 'unknown', days: null, openNow: null,
          openNote: 'Access is unknown unless supported by source information.', hours: null, hoursNote: null, closingHint: null, canClaimOpen: false,
        },
      };
    });
  return [...bundled, ...local].filter((view) => matchesFilters(view, state.filters, now));
}

export function nearbyViews(state: AppState, index: DatasetIndex, now = new Date()): PlaceView[] {
  const maxMeters = state.filters.maxWalkMinutes > 0 ? state.filters.maxWalkMinutes * 75 : 2000;
  return filteredViews(state, index, now).filter((view) => view.distanceMeters <= maxMeters).sort((a, b) => a.distanceMeters - b.distanceMeters);
}

export function historyViews(state: AppState, index: DatasetIndex, now = new Date()): PlaceView[] {
  if (!state.layers.landmarks) return [];
  return index.data.places.filter((place) => place.category === 'history').map((place) => buildPlaceView(place, index, state, now));
}

export function categoryCountsForResults(views: PlaceView[]): Record<CategoryId, number> {
  const counts = {} as Record<CategoryId, number>;
  for (const view of views) counts[view.place.category] = (counts[view.place.category] ?? 0) + 1;
  return counts;
}

export function activeFilterCount(filters: Filters): number {
  let count = 0;
  if (filters.openNow) count++;
  if (filters.freeOnly) count++;
  if (filters.verifiedOnly) count++;
  if (filters.maxWalkMinutes > 0) count++;
  if (filters.nearTransit) count++;
  if (filters.accessibleOnly) count++;
  if (filters.afterDark) count++;
  if (filters.query.trim()) count++;
  return count;
}
