import type { AppDataset, CategoryId } from '../domain/types';
import { CATEGORY_BY_ID } from '../domain/categories';
import roads from '../data/basemap/roads.json';

export type HitKind = 'place' | 'stop' | 'street' | 'neighbourhood';

export interface SearchHit {
  id: string;
  kind: HitKind;
  title: string;
  subtitle: string;
  coordinates: [number, number];
  placeId?: string;
  category?: CategoryId;
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

interface IndexEntry extends SearchHit {
  haystack: string;
}

let index: IndexEntry[] | null = null;

function buildIndex(dataset: AppDataset): IndexEntry[] {
  const entries: IndexEntry[] = [];

  for (const place of dataset.places) {
    const category = CATEGORY_BY_ID.get(place.category);
    const extra = [place.address ?? '', place.neighborhood ?? '', category?.label ?? ''].join(' ');
    entries.push({
      id: place.id,
      kind: 'place',
      title: place.name,
      subtitle: [category?.label, place.address].filter(Boolean).join(' · '),
      coordinates: place.geometry.coordinates,
      placeId: place.id,
      category: place.category,
      haystack: normalize(`${place.name} ${extra}`),
    });
  }

  for (const stop of dataset.transit) {
    entries.push({
      id: stop.id,
      kind: 'stop',
      title: stop.name,
      subtitle: 'Muni stop · City inventory',
      coordinates: stop.geometry.coordinates,
      haystack: normalize(`${stop.name} muni transit stop ${stop.onStreet ?? ''}`),
    });
  }

  for (const hood of dataset.neighbourhoods) {
    entries.push({
      id: `hood:${hood.name}`,
      kind: 'neighbourhood',
      title: hood.name,
      subtitle: 'Neighbourhood',
      coordinates: hood.geometry.coordinates,
      haystack: normalize(hood.name),
    });
  }

  const seenStreets = new Map<string, { coordinates: [number, number]; count: number }>();
  for (const feature of (roads as GeoJSON.FeatureCollection).features) {
    const name = feature.properties?.name as string | undefined;
    if (!name) continue;
    const coords = (feature.geometry as GeoJSON.LineString).coordinates;
    if (!coords?.length) continue;
    const mid = coords[Math.floor(coords.length / 2)] as [number, number];
    const existing = seenStreets.get(name);
    if (existing) existing.count += 1;
    else seenStreets.set(name, { coordinates: mid, count: 1 });
  }
  for (const [name, info] of seenStreets) {
    entries.push({
      id: `street:${name}`,
      kind: 'street',
      title: name,
      subtitle: 'Street in the map footprint',
      coordinates: info.coordinates,
      haystack: normalize(`${name} street road`),
    });
  }

  return entries;
}

export function searchLocal(query: string, dataset: AppDataset, limit = 14): SearchHit[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  index ??= buildIndex(dataset);
  const terms = q.split(' ').filter(Boolean);

  const scored = index
    .map((entry) => {
      const title = normalize(entry.title);
      let score = 0;
      if (title === q) score += 100;
      else if (title.startsWith(q)) score += 60;
      else if (title.includes(q)) score += 35;
      if (entry.haystack.includes(q)) score += 18;
      for (const term of terms) {
        if (title.startsWith(term)) score += 8;
        else if (entry.haystack.includes(term)) score += 3;
        else score -= 4;
      }
      if (entry.kind === 'place') score += 4;
      return { entry, score };
    })
    .filter((s) => s.score > 6)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ entry }) => {
      const { haystack: _haystack, ...hit } = entry;
      return hit;
    });

  return scored;
}
