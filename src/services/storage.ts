import { openDB, type IDBPDatabase } from 'idb';
import type {
  ChangeRecord,
  Collection,
  CorrectionReport,
  LayerView,
  Observation,
  PlaceOverride,
  RoutePlan,
  SavedPlace,
  Settings,
} from '../domain/types';

const DB_NAME = 'night-map';
// v2 adds the local correction layer: place overrides and the change log.
const DB_VERSION = 2;

export type StoreName =
  | 'settings'
  | 'savedPlaces'
  | 'observations'
  | 'collections'
  | 'reports'
  | 'routes'
  | 'layerViews'
  | 'drafts'
  | 'placeOverrides'
  | 'changes';

const memory: Record<string, Map<string, unknown>> = {};
let dbPromise: Promise<IDBPDatabase | null> | null = null;
export let storageMode: 'indexeddb' | 'memory' = 'indexeddb';

function mem(store: StoreName) {
  memory[store] ??= new Map();
  return memory[store];
}

async function getDb(): Promise<IDBPDatabase | null> {
  if (!dbPromise) {
    dbPromise = (async () => {
      try {
        if (typeof indexedDB === 'undefined') throw new Error('IndexedDB unavailable');
        return await openDB(DB_NAME, DB_VERSION, {
          upgrade(db) {
            if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
            if (!db.objectStoreNames.contains('savedPlaces')) db.createObjectStore('savedPlaces', { keyPath: 'placeId' });
            if (!db.objectStoreNames.contains('observations')) db.createObjectStore('observations', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('collections')) db.createObjectStore('collections', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('reports')) db.createObjectStore('reports', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('routes')) db.createObjectStore('routes', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('layerViews')) db.createObjectStore('layerViews', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts');
            if (!db.objectStoreNames.contains('placeOverrides')) db.createObjectStore('placeOverrides', { keyPath: 'placeId' });
            if (!db.objectStoreNames.contains('changes')) db.createObjectStore('changes', { keyPath: 'id' });
          },
        });
      } catch (err) {
        console.warn('[night-map] IndexedDB unavailable, using session memory', err);
        storageMode = 'memory';
        return null;
      }
    })();
  }
  return dbPromise;
}

export async function readAll<T>(store: StoreName): Promise<T[]> {
  const db = await getDb();
  if (!db) return [...mem(store).values()] as T[];
  try {
    return (await db.getAll(store)) as T[];
  } catch {
    return [...mem(store).values()] as T[];
  }
}

export async function readOne<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await getDb();
  if (!db) return mem(store).get(key) as T | undefined;
  try {
    return (await db.get(store, key)) as T | undefined;
  } catch {
    return mem(store).get(key) as T | undefined;
  }
}

export async function writeOne<T>(store: StoreName, value: T, key?: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    const k = key ?? (value as { id?: string; placeId?: string }).id ?? (value as { placeId?: string }).placeId ?? 'value';
    mem(store).set(k, value);
    return;
  }
  try {
    if (key !== undefined) await db.put(store, value as never, key);
    else await db.put(store, value as never);
  } catch (err) {
    console.warn(`[night-map] write failed for ${store}`, err);
    throw err;
  }
}

export async function deleteOne(store: StoreName, key: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    mem(store).delete(key);
    return;
  }
  try {
    await db.delete(store, key);
  } catch {
    mem(store).delete(key);
  }
}

const SETTINGS_KEY = 'night-map-settings';

export async function loadSettings(): Promise<Partial<Settings> | null> {
  return (await readOne<Partial<Settings>>('settings', SETTINGS_KEY)) ?? null;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await writeOne('settings', settings, SETTINGS_KEY);
}

export async function loadSavedPlaces(): Promise<SavedPlace[]> {
  return readAll<SavedPlace>('savedPlaces');
}

export async function loadObservations(): Promise<Observation[]> {
  return readAll<Observation>('observations');
}

export async function loadCollections(): Promise<Collection[]> {
  return readAll<Collection>('collections');
}

export async function loadReports(): Promise<CorrectionReport[]> {
  return readAll<CorrectionReport>('reports');
}

export async function loadPlaceOverrides(): Promise<PlaceOverride[]> {
  return readAll<PlaceOverride>('placeOverrides');
}

export async function loadChanges(): Promise<ChangeRecord[]> {
  return readAll<ChangeRecord>('changes');
}

export async function loadRoutes(): Promise<RoutePlan[]> {
  return readAll<RoutePlan>('routes');
}

export async function loadLayerViews(): Promise<LayerView[]> {
  return readAll<LayerView>('layerViews');
}

export async function loadDraft<T>(key = 'observation-draft'): Promise<T | undefined> {
  return readOne<T>('drafts', key);
}

export async function saveDraft<T>(value: T, key = 'observation-draft'): Promise<void> {
  await writeOne('drafts', value, key);
}

export async function clearDraft(key = 'observation-draft'): Promise<void> {
  await deleteOne('drafts', key);
}

export async function exportPersonalData() {
  const [settings, savedPlaces, observations, collections, reports, routes, layerViews, placeOverrides, changes] =
    await Promise.all([
      loadSettings(),
      loadSavedPlaces(),
      loadObservations(),
      loadCollections(),
      loadReports(),
      loadRoutes(),
      loadLayerViews(),
      loadPlaceOverrides(),
      loadChanges(),
    ]);
  return {
    exportedAt: new Date().toISOString(),
    app: 'Night Map 0.1.0',
    storageMode,
    settings,
    savedPlaces,
    observations,
    collections,
    reports,
    routes,
    layerViews,
    placeOverrides,
    changes,
    note: 'This export contains only data stored in this browser. Private field notes are included; review before sharing.',
  };
}

export async function deletePersonalData(): Promise<void> {
  const db = await getDb();
  const stores: StoreName[] = [
    'savedPlaces',
    'observations',
    'collections',
    'reports',
    'routes',
    'layerViews',
    'drafts',
    'placeOverrides',
    'changes',
  ];
  if (!db) {
    for (const store of stores) memory[store]?.clear();
    return;
  }
  for (const store of stores) {
    await db.clear(store);
  }
  await db.delete('settings', SETTINGS_KEY);
}

export async function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  try {
    const estimate = await navigator.storage.estimate();
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
  } catch {
    return null;
  }
}
