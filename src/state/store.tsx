import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  CategoryId,
  ChangeRecord,
  Collection,
  CorrectionReport,
  Filters,
  LayerView,
  Observation,
  Place,
  PlaceOverride,
  ReportEvent,
  ReportResolution,
  RoutePlan,
  RouteStop,
  SavedPlace,
  Settings,
  Workspace,
} from '../domain/types';
import { SF_CENTER, haversineMeters } from '../domain/geo';
import { dataset } from '../data';
import { changeRecordSchema, correctionReportSchema, placeOverrideSchema } from '../domain/schemas';
import {
  applyResolution,
  describeOverride,
  findDuplicate,
  initialReportStatus,
  normalizeReport,
  resolutionLabel,
  validateReport,
  withEvent,
  type ReportDraft,
} from '../domain/verification';
import {
  loadChanges,
  loadCollections,
  loadLayerViews,
  loadObservations,
  loadPlaceOverrides,
  loadReports,
  loadRoutes,
  loadSavedPlaces,
  loadSettings,
  saveSettings,
  writeOne,
  deleteOne,
  storageMode,
} from '../services/storage';
import { fetchWalkingRoute, RoutingError, straightLineFallback } from '../services/routing';
import { LAYERS } from '../map/layers';

export interface UserLocation {
  coordinates: [number, number];
  accuracy: number;
  at: number;
}

export interface RouteState {
  origin: RouteStop | null;
  stops: RouteStop[];
  plan: RoutePlan | null;
  alternatives: RoutePlan[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  fallback: { distanceMeters: number; geometry: { type: 'LineString'; coordinates: [number, number][] }; note: string } | null;
  picking: 'origin' | 'stop' | null;
}

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'warn';
}

export interface AppState {
  hydrated: boolean;
  storageMode: 'indexeddb' | 'memory';
  workspace: Workspace;
  filters: Filters;
  layers: Record<string, boolean>;
  layerOpacity: Record<string, number>;
  layerViews: LayerView[];
  selectedPlaceId: string | null;
  selectedStopId: string | null;
  selectedExternal: { label: string; detail: string; coordinates: [number, number] } | null;
  saved: SavedPlace[];
  observations: Observation[];
  collections: Collection[];
  reports: CorrectionReport[];
  /** Local corrections layered over the bundled records, by place id. */
  overrides: Record<string, PlaceOverride>;
  /** Append-only trace of every review decision made on this device. */
  changes: ChangeRecord[];
  routes: RoutePlan[];
  settings: Settings;
  route: RouteState;
  compareIds: string[];
  userLocation: UserLocation | null;
  reference: { coordinates: [number, number]; label: string };
  toast: Toast | null;
  sheet: 'collapsed' | 'peek' | 'expanded';
}

const DEFAULT_CATEGORIES: CategoryId[] = ['food', 'water', 'bathroom', 'shelter', 'services', 'medical', 'civic', 'passage', 'popos'];

const initialSettings: Settings = {
  routingProvider: 'osrm',
  geocodingProvider: 'local',
  includePhotos: true,
  locationPermission: 'unknown',
  backgroundLocation: false,
  units: 'metric',
  showCoverageNote: true,
};

const initialLayers = Object.fromEntries(LAYERS.map((l) => [l.id, l.defaultVisible])) as Record<string, boolean>;

const initialState: AppState = {
  hydrated: false,
  storageMode,
  workspace: 'map',
  filters: {
    categories: DEFAULT_CATEGORIES,
    openNow: false,
    freeOnly: false,
    verifiedOnly: false,
    maxWalkMinutes: 0,
    nearTransit: false,
    accessibleOnly: false,
    afterDark: false,
    query: '',
  },
  layers: initialLayers,
  layerOpacity: Object.fromEntries(LAYERS.map((l) => [l.id, l.defaultOpacity ?? 1])),
  layerViews: [],
  selectedPlaceId: null,
  selectedStopId: null,
  selectedExternal: null,
  saved: [],
  observations: [],
  collections: [],
  reports: [],
  overrides: {},
  changes: [],
  routes: [],
  settings: initialSettings,
  route: {
    origin: null,
    stops: [],
    plan: null,
    alternatives: [],
    status: 'idle',
    error: null,
    fallback: null,
    picking: null,
  },
  compareIds: [],
  userLocation: null,
  reference: { coordinates: SF_CENTER, label: 'Map centre' },
  toast: null,
  sheet: 'collapsed',
};

let toastSeq = 1;

const uid = (prefix: string) =>
  `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;

const placeToStop = (place: Place): RouteStop => ({
  label: place.name,
  placeId: place.id,
  coordinates: place.geometry.coordinates,
});

export interface ObservationInput {
  placeId: string | null;
  placeName: string | null;
  geometry: [number, number] | null;
  type: Observation['type'];
  note: string;
  observedAt: string;
  photo: Observation['photo'];
  accessStatus?: NonNullable<Observation['accessStatus']>;
  sourceReference?: string;
  confidence?: NonNullable<Observation['confidence']>;
}

interface StoreValue {
  state: AppState;
  actions: {
    setWorkspace: (workspace: Workspace) => void;
    setSheet: (sheet: AppState['sheet']) => void;
    setFilter: (patch: Partial<Filters>) => void;
    toggleCategory: (id: CategoryId) => void;
    resetFilters: () => void;
    selectPlace: (id: string | null) => void;
    selectStop: (id: string | null) => void;
    selectExternal: (value: AppState['selectedExternal']) => void;
    setLayer: (id: string, visible: boolean) => void;
    setLayerOpacity: (id: string, opacity: number) => void;
    applyPreset: (preset: string) => void;
    saveLayerView: (name: string) => Promise<void>;
    applyLayerView: (id: string) => void;
    deleteLayerView: (id: string) => Promise<void>;
    toggleSaved: (placeId: string) => Promise<void>;
    setSavedNote: (placeId: string, note: string) => Promise<void>;
    createObservation: (input: ObservationInput) => Promise<Observation>;
    selectObservation: (id: string) => void;
    updateObservation: (observation: Observation) => Promise<void>;
    deleteObservation: (id: string) => Promise<void>;
    createCollection: (name: string, description: string) => Promise<Collection>;
    updateCollection: (collection: Collection) => Promise<void>;
    deleteCollection: (id: string) => Promise<void>;
    addToCollection: (collectionId: string, kind: 'place' | 'route' | 'observation', id: string) => Promise<void>;
    removeFromCollection: (collectionId: string, kind: string, id: string) => Promise<void>;
    addReport: (draft: ReportDraft) => Promise<CorrectionReport>;
    resolveReport: (id: string, resolution: ReportResolution, reviewNote: string) => Promise<void>;
    dismissReport: (id: string, note: string) => Promise<void>;
    reopenReport: (id: string) => Promise<void>;
    removeOverride: (placeId: string) => Promise<void>;
    startRouteTo: (place: Place) => void;
    addRouteStop: (place: Place) => void;
    addRoutePoint: (label: string, coordinates: [number, number]) => void;
    /** Route to a plotted feature that is not a place record (an incident, a landmark, a stop). */
    routeToPoint: (label: string, coordinates: [number, number]) => void;
    removeRouteStop: (index: number) => void;
    moveRouteStop: (index: number, direction: -1 | 1) => void;
    setRouteOrigin: (stop: RouteStop | null) => void;
    setPicking: (value: 'origin' | 'stop' | null) => void;
    useCurrentLocation: () => Promise<void>;
    planRoute: () => Promise<void>;
    clearRoute: () => void;
    saveCurrentRoute: (name: string) => Promise<void>;
    deleteSavedRoute: (id: string) => Promise<void>;
    setSettings: (patch: Partial<Settings>) => Promise<void>;
    toggleCompare: (placeId: string) => void;
    clearCompare: () => void;
    setReferenceToMap: (coordinates: [number, number]) => void;
    notify: (message: string, tone?: Toast['tone']) => void;
    dismissToast: () => void;
  };
}

const StoreContext = createContext<StoreValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(initialState);
  const hydrated = useRef(false);
  const toastTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [settings, saved, observations, collections, reports, routes, layerViews, placeOverrides, changes] =
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
      if (cancelled) return;
      setState((s) => ({
        ...s,
        hydrated: true,
        storageMode,
        settings: { ...s.settings, ...(settings ?? {}) },
        saved,
        observations: observations.sort((a, b) => b.observedAt.localeCompare(a.observedAt)),
        collections,
        reports: reports.map(normalizeReport),
        overrides: Object.fromEntries(placeOverrides.map((override) => [override.placeId, override])),
        changes,
        routes,
        layerViews,
      }));
      hydrated.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const notify = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const toast = { id: toastSeq++, message, tone };
    setState((s) => ({ ...s, toast }));
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      setState((s) => (s.toast?.id === toast.id ? { ...s, toast: null } : s));
    }, 4200);
  }, []);

  const updateRoute = useCallback((patch: Partial<RouteState>) => {
    setState((s) => ({ ...s, route: { ...s.route, ...patch } }));
  }, []);

  const actions = useMemo<StoreValue['actions']>(() => {    const setFilter = (patch: Partial<Filters>) =>
      setState((s) => ({ ...s, filters: { ...s.filters, ...patch } }));

    return {
      setWorkspace: (workspace) => {
        setState((s) => ({
          ...s,
          workspace,
          sheet: workspace === 'map' ? s.sheet : 'expanded',
        }));
      },
      setSheet: (sheet) => setState((s) => ({ ...s, sheet })),

      setFilter,
      toggleCategory: (id) =>
        setState((s) => {
          const has = s.filters.categories.includes(id);
          const categories = has
            ? s.filters.categories.filter((c) => c !== id)
            : [...s.filters.categories, id];
          return { ...s, filters: { ...s.filters, categories } };
        }),
      resetFilters: () =>
        setState((s) => ({
          ...s,
          filters: { ...initialState.filters, categories: DEFAULT_CATEGORIES },
        })),

      selectPlace: (id) =>
        setState((s) => ({
          ...s,
          selectedPlaceId: id,
          selectedStopId: null,
          selectedExternal: null,
          sheet: id ? 'peek' : s.sheet,
        })),
      selectStop: (id) => setState((s) => ({ ...s, selectedStopId: id, selectedPlaceId: null, sheet: 'peek' })),
      selectExternal: (value) =>
        setState((s) => ({ ...s, selectedExternal: value, selectedPlaceId: null, selectedStopId: null })),

      setLayer: (id, visible) => setState((s) => ({ ...s, layers: { ...s.layers, [id]: visible } })),
      setLayerOpacity: (id, opacity) =>
        setState((s) => ({ ...s, layerOpacity: { ...s.layerOpacity, [id]: opacity } })),
      applyPreset: (preset) =>
        setState((s) => {
          const presets: Record<string, string[]> = {
            essentials: ['streets', 'street-labels', 'parks', 'resources', 'neighbourhoods'],
            threed: [
              'streets',
              'street-labels',
              'parks',
              'neighbourhoods',
              'resources',
              'terrain',
              'buildings-3d',
            ],
            resources: ['streets', 'street-labels', 'parks', 'resources', 'neighbourhoods', 'transit-stops'],
            transit: ['streets', 'street-labels', 'parks', 'transit-stops', 'transit-lines', 'neighbourhoods'],
            notes: ['streets', 'street-labels', 'parks', 'observations', 'saved', 'resources'],
            incidents: [
              'streets',
              'street-labels',
              'parks',
              'neighbourhoods',
              'resources',
              'calls-recent',
              'cases-311',
            ],
            history: ['streets', 'street-labels', 'parks', 'landmarks', 'neighbourhoods'],
          };
          const visibleIds = presets[preset] ?? [];
          const layers = Object.fromEntries(LAYERS.map((l) => [l.id, visibleIds.includes(l.id)]));
          return { ...s, layers };
        }),
      saveLayerView: async (name) => {
        const view: LayerView = {
          id: uid('view'),
          name,
          visible: state.layers,
          createdAt: new Date().toISOString(),
        };
        await writeOne('layerViews', view);
        setState((s) => ({ ...s, layerViews: [...s.layerViews, view] }));
        notify(`Saved view “${name}”.`, 'success');
      },
      applyLayerView: (id) =>
        setState((s) => {
          const view = s.layerViews.find((v) => v.id === id);
          if (!view) return s;
          return { ...s, layers: { ...initialState.layers, ...view.visible } };
        }),
      deleteLayerView: async (id) => {
        await deleteOne('layerViews', id);
        setState((s) => ({ ...s, layerViews: s.layerViews.filter((v) => v.id !== id) }));
      },

      toggleSaved: async (placeId) => {
        const existing = state.saved.find((s) => s.placeId === placeId);
        if (existing) {
          await deleteOne('savedPlaces', placeId);
          setState((s) => ({ ...s, saved: s.saved.filter((p) => p.placeId !== placeId) }));
          notify('Removed from saved places.');
        } else {
          const record: SavedPlace = {
            placeId,
            savedAt: new Date().toISOString(),
            collectionIds: [],
            note: '',
          };
          await writeOne('savedPlaces', record);
          setState((s) => ({ ...s, saved: [record, ...s.saved] }));
          notify('Saved on this device.', 'success');
        }
      },
      setSavedNote: async (placeId, note) => {
        const existing = state.saved.find((s) => s.placeId === placeId);
        if (!existing) return;
        const updated = { ...existing, note };
        await writeOne('savedPlaces', updated);
        setState((s) => ({ ...s, saved: s.saved.map((p) => (p.placeId === placeId ? updated : p)) }));
      },

      selectObservation: (id) => {
        const observation = state.observations.find((item) => item.id === id);
        if (!observation) return;
        if (observation.geometry) setState((s) => ({ ...s, reference: { coordinates: observation.geometry!.coordinates, label: 'Observation location' } }));
        setState((s) => ({ ...s, selectedPlaceId: `private:${id}`, selectedStopId: null, selectedExternal: null, workspace: 'map', sheet: 'peek' }));
      },
      createObservation: async (input) => {
        const now = new Date().toISOString();
        const observation: Observation = {
          id: uid('obs'),
          placeId: input.placeId,
          placeName: input.placeName,
          geometry: input.geometry ? { type: 'Point', coordinates: input.geometry } : null,
          type: input.type,
          accessStatus: input.accessStatus ?? 'unknown',
          sourceReference: input.sourceReference?.trim() || undefined,
          confidence: input.confidence ?? 'unverified',
          note: input.note.trim(),
          observedAt: input.observedAt,
          recordedAt: now,
          photo: input.photo,
          visibility: 'private',
          verificationStatus: 'unverified',
          updatedAt: now,
        };
        await writeOne('observations', observation);
        setState((s) => ({ ...s, observations: [observation, ...s.observations] }));
        notify('Field note saved privately on this device.', 'success');
        return observation;
      },
      updateObservation: async (observation) => {
        const updated = { ...observation, updatedAt: new Date().toISOString() };
        await writeOne('observations', updated);
        setState((s) => ({
          ...s,
          observations: s.observations.map((o) => (o.id === observation.id ? updated : o)),
        }));
        notify('Field note updated.', 'success');
      },
      deleteObservation: async (id) => {
        await deleteOne('observations', id);
        setState((s) => ({
          ...s,
          observations: s.observations.filter((o) => o.id !== id),
          collections: s.collections.map((c) => ({
            ...c,
            itemRefs: c.itemRefs.filter((r) => !(r.kind === 'observation' && r.id === id)),
          })),
        }));
        notify('Field note deleted from this device.');
      },

      createCollection: async (name, description) => {
        const now = new Date().toISOString();
        const collection: Collection = {
          id: uid('col'),
          name,
          description,
          itemRefs: [],
          tags: [],
          visibility: 'private',
          createdAt: now,
          updatedAt: now,
        };
        await writeOne('collections', collection);
        setState((s) => ({ ...s, collections: [collection, ...s.collections] }));
        notify(`Created collection “${name}”.`, 'success');
        return collection;
      },
      updateCollection: async (collection) => {
        const updated = { ...collection, updatedAt: new Date().toISOString() };
        await writeOne('collections', updated);
        setState((s) => ({ ...s, collections: s.collections.map((c) => (c.id === collection.id ? updated : c)) }));
      },
      deleteCollection: async (id) => {
        await deleteOne('collections', id);
        setState((s) => ({ ...s, collections: s.collections.filter((c) => c.id !== id) }));
        notify('Collection deleted.');
      },
      addToCollection: async (collectionId, kind, id) => {
        const collection = state.collections.find((c) => c.id === collectionId);
        if (!collection) return;
        if (collection.itemRefs.some((r) => r.kind === kind && r.id === id)) {
          notify('Already in that collection.');
          return;
        }
        const updated: Collection = {
          ...collection,
          itemRefs: [...collection.itemRefs, { kind, id }],
          updatedAt: new Date().toISOString(),
        };
        await writeOne('collections', updated);
        setState((s) => ({ ...s, collections: s.collections.map((c) => (c.id === updated.id ? updated : c)) }));
        notify(`Added to “${collection.name}”.`, 'success');
      },
      removeFromCollection: async (collectionId, kind, id) => {
        const collection = state.collections.find((c) => c.id === collectionId);
        if (!collection) return;
        const updated: Collection = {
          ...collection,
          itemRefs: collection.itemRefs.filter((r) => !(r.kind === kind && r.id === id)),
          updatedAt: new Date().toISOString(),
        };
        await writeOne('collections', updated);
        setState((s) => ({ ...s, collections: s.collections.map((c) => (c.id === updated.id ? updated : c)) }));
      },

      addReport: async (draft) => {
        const now = new Date();
        const at = now.toISOString();
        // Steps 2–3 of the verification workflow: validate the structure, then look for duplicates.
        const validation = validateReport(draft, {
          knownPlaceIds: new Set(dataset.placeById.keys()),
          existingReports: state.reports,
          now,
        });
        const duplicate = validation.problems.length > 0 ? null : findDuplicate(draft, state.reports, now);
        const status = initialReportStatus(validation, duplicate);
        const history: ReportEvent[] = [
          { at, kind: 'received', note: 'Report received and kept on this device.', actor: 'this device' },
          validation.problems.length > 0
            ? {
                at,
                kind: 'needs_information',
                note: `Structure checked: ${validation.problems.length} problem${
                  validation.problems.length === 1 ? '' : 's'
                } to fix before this can be reviewed.`,
                actor: 'this device',
              }
            : {
                at,
                kind: 'validated',
                note: 'Structure checked against the record and the report schema.',
                actor: 'this device',
              },
          ...(duplicate
            ? [
                {
                  at,
                  kind: 'duplicate_flagged' as const,
                  note: 'An open report already describes this issue at this record, so this is a duplicate candidate.',
                  actor: 'this device' as const,
                },
              ]
            : []),
        ];
        const record: CorrectionReport = {
          id: uid('report'),
          placeId: draft.placeId,
          placeName: draft.placeName,
          issue: draft.issue,
          note: draft.note.trim(),
          observedAt: draft.observedAt,
          createdAt: at,
          updatedAt: at,
          status,
          validation,
          duplicateOfId: duplicate?.id ?? null,
          resolution: null,
          history,
          channel: 'on_device',
        };

        const parsed = correctionReportSchema.safeParse(record);
        if (!parsed.success) {
          notify('That report failed validation and was not stored. Add a short description of what you saw.', 'warn');
          return record;
        }

        await writeOne('reports', record);
        setState((s) => ({ ...s, reports: [record, ...s.reports] }));
        notify(
          status === 'queued'
            ? 'Report queued for review on this device. Nothing was sent — this release has no submission server.'
            : status === 'duplicate_candidate'
              ? 'Report saved and flagged as a possible duplicate for review.'
              : 'Report saved as needing information. Open Review to see what is missing.',
          status === 'queued' ? 'success' : 'warn',
        );
        return record;
      },

      resolveReport: async (id, resolution, reviewNote) => {
        const report = state.reports.find((r) => r.id === id);
        if (!report) return;
        const now = new Date();
        const place = dataset.placeById.get(report.placeId);
        const previous = state.overrides[report.placeId] ?? null;
        const { override, change } = applyResolution(report, resolution, reviewNote, place, previous, now);

        const parsedChange = changeRecordSchema.safeParse(change);
        if (!parsedChange.success) {
          notify('That decision could not be logged and was not applied.', 'warn');
          return;
        }
        if (override) {
          const parsedOverride = placeOverrideSchema.safeParse(override);
          if (!parsedOverride.success) {
            notify('That correction failed validation and was not applied.', 'warn');
            return;
          }
          await writeOne('placeOverrides', override);
        }
        await writeOne('changes', change);

        const updated = withEvent(
          report,
          {
            kind: 'resolved',
            note: `${resolutionLabel(resolution)} · ${
              change.disposition === 'applied_as_local_override' ? 'applied as a local override' : 'logged only'
            }. ${reviewNote.trim() || 'No reviewer note.'}`,
          },
          { status: 'resolved', resolution: { kind: resolution, note: reviewNote.trim(), at: change.at } },
          now,
        );
        await writeOne('reports', updated);
        setState((s) => ({
          ...s,
          reports: s.reports.map((r) => (r.id === id ? updated : r)),
          changes: [change, ...s.changes],
          overrides: override ? { ...s.overrides, [override.placeId]: override } : s.overrides,
        }));
        notify(
          change.disposition === 'applied_as_local_override'
            ? 'Decision logged and applied as a local override. The source value is still on the record.'
            : 'Decision logged. The record was not changed.',
          'success',
        );
      },

      dismissReport: async (id, note) => {
        const report = state.reports.find((r) => r.id === id);
        if (!report) return;
        const now = new Date();
        const { change } = applyResolution(
          report,
          'no_change',
          note,
          dataset.placeById.get(report.placeId),
          state.overrides[report.placeId] ?? null,
          now,
        );
        await writeOne('changes', change);
        const updated = withEvent(
          report,
          { kind: 'dismissed', note: note.trim() || 'Dismissed without a note.' },
          { status: 'dismissed', resolution: null },
          now,
        );
        await writeOne('reports', updated);
        setState((s) => ({
          ...s,
          reports: s.reports.map((r) => (r.id === id ? updated : r)),
          changes: [change, ...s.changes],
        }));
        notify('Report dismissed. The decision is in the change log.', 'warn');
      },

      reopenReport: async (id) => {
        const report = state.reports.find((r) => r.id === id);
        if (!report) return;
        const now = new Date();
        const updated = withEvent(
          report,
          {
            kind: 'reopened',
            note: 'Reopened for another look. Any local override already applied stays in place.',
          },
          { status: initialReportStatus(report.validation, null), resolution: null },
          now,
        );
        await writeOne('reports', updated);
        setState((s) => ({ ...s, reports: s.reports.map((r) => (r.id === id ? updated : r)) }));
        notify('Report reopened for review.', 'success');
      },

      removeOverride: async (placeId) => {
        const previous = state.overrides[placeId];
        if (!previous) return;
        const now = new Date();
        const change: ChangeRecord = {
          id: `change:override:${placeId}:${now.toISOString()}`,
          placeId,
          placeName: dataset.placeById.get(placeId)?.name ?? 'Unknown record',
          reportId: previous.reportIds[0] ?? 'override',
          kind: 'no_change',
          field: 'override',
          before: describeOverride(previous),
          after: 'Removed — the bundled record is shown unchanged',
          reason: 'Local override removed at the user’s request.',
          at: now.toISOString(),
          actor: 'local reviewer (this device)',
          disposition: 'applied_as_local_override',
        };
        await deleteOne('placeOverrides', placeId);
        await writeOne('changes', change);
        setState((s) => {
          const overrides = { ...s.overrides };
          delete overrides[placeId];
          return { ...s, overrides, changes: [change, ...s.changes] };
        });
        notify('Local override removed. The source record is visible unchanged.', 'success');
      },

      startRouteTo: (place) =>
        setState((s) => {
          const origin =
            s.userLocation
              ? { label: 'Current location', placeId: null, coordinates: s.userLocation.coordinates }
              : s.route.origin;
          return {
            ...s,
            workspace: 'routes',
            sheet: 'expanded',
            route: {
              ...s.route,
              origin,
              stops: [placeToStop(place)],
              plan: null,
              alternatives: [],
              status: 'idle',
              error: null,
              fallback: null,
            },
          };
        }),
      addRouteStop: (place) =>
        setState((s) => ({
          ...s,
          route: {
            ...s.route,
            stops: [...s.route.stops, placeToStop(place)],
            plan: null,
            status: 'idle',
            error: null,
          },
        })),
      addRoutePoint: (label, coordinates) =>
        setState((s) => ({
          ...s,
          route: {
            ...s.route,
            stops: [...s.route.stops, { label, placeId: null, coordinates }],
            plan: null,
            status: 'idle',
            error: null,
          },
        })),
      routeToPoint: (label, coordinates) =>
        setState((s) => ({
          ...s,
          workspace: 'routes',
          sheet: 'expanded',
          route: {
            ...s.route,
            origin:
              s.userLocation
                ? { label: 'Current location', placeId: null, coordinates: s.userLocation.coordinates }
                : s.route.origin,
            stops: [...s.route.stops, { label, placeId: null, coordinates }],
            plan: null,
            alternatives: [],
            status: 'idle',
            error: null,
            fallback: null,
          },
        })),
      removeRouteStop: (index) =>
        setState((s) => ({
          ...s,
          route: {
            ...s.route,
            stops: s.route.stops.filter((_, i) => i !== index),
            plan: null,
            status: 'idle',
          },
        })),
      moveRouteStop: (index, direction) =>
        setState((s) => {
          const stops = [...s.route.stops];
          const target = index + direction;
          if (target < 0 || target >= stops.length) return s;
          [stops[index], stops[target]] = [stops[target], stops[index]];
          return { ...s, route: { ...s.route, stops, plan: null, status: 'idle' } };
        }),
      setRouteOrigin: (origin) =>
        updateRoute({ origin, plan: null, status: 'idle', error: null }),
      setPicking: (value) => updateRoute({ picking: value }),

      useCurrentLocation: async () => {
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
          notify('This browser does not expose location.', 'warn');
          return;
        }
        if (!window.isSecureContext) {
          notify('Location needs a secure (https or localhost) context.', 'warn');
          return;
        }
        await new Promise<void>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (position) => {
              const location: UserLocation = {
                coordinates: [position.coords.longitude, position.coords.latitude],
                accuracy: position.coords.accuracy,
                at: Date.now(),
              };
              setState((s) => ({
                ...s,
                userLocation: location,
                reference: { coordinates: location.coordinates, label: 'Your location (this session only)' },
                settings: { ...s.settings, locationPermission: 'granted' },
                route: {
                  ...s.route,
                  origin:
                    s.route.picking === 'origin' || !s.route.origin
                      ? { label: 'Current location', placeId: null, coordinates: location.coordinates }
                      : s.route.origin,
                  picking: null,
                },
              }));
              void saveSettings({ ...state.settings, locationPermission: 'granted' });
              notify(`Location fixed to ±${Math.round(location.accuracy)} m. Not saved or shared.`, 'success');
              resolve();
            },
            (error) => {
              setState((s) => ({
                ...s,
                settings: {
                  ...s.settings,
                  locationPermission: error.code === error.PERMISSION_DENIED ? 'denied' : 'unknown',
                },
              }));
              notify(
                error.code === error.PERMISSION_DENIED
                  ? 'Location permission was denied. Search still works, and you can set an origin manually.'
                  : 'Could not get a location fix. You can set an origin from search or the map.',
                'warn',
              );
              resolve();
            },
            { enableHighAccuracy: false, timeout: 12_000, maximumAge: 60_000 },
          );
        });
      },

      planRoute: async () => {
        const { route, settings } = state;
        if (!route.origin) {
          updateRoute({ status: 'error', error: 'Set a starting point first — current location, search, or a point on the map.' });
          return;
        }
        if (route.stops.length === 0) {
          updateRoute({ status: 'error', error: 'Add at least one destination.' });
          return;
        }
        updateRoute({ status: 'loading', error: null, plan: null, alternatives: [], fallback: null });
        try {
          const plans = await fetchWalkingRoute(
            { origin: route.origin, stops: route.stops },
            { provider: settings.routingProvider },
          );
          updateRoute({
            status: 'ready',
            plan: plans[0] ?? null,
            alternatives: plans.slice(1),
            error: null,
          });
        } catch (err) {
          const routingError = err as RoutingError;
          const destination = route.stops[route.stops.length - 1];
          const fallback =
            route.origin && destination
              ? straightLineFallback(route.origin, destination)
              : null;
          updateRoute({
            status: 'error',
            error:
              routingError.code === 'disabled'
                ? 'Routing is switched off in Settings. The app still shows straight-line distance.'
                : routingError.message,
            fallback,
          });
        }
      },
      clearRoute: () =>
        setState((s) => ({
          ...s,
          route: { ...initialState.route, origin: s.route.origin },
        })),
      saveCurrentRoute: async (name) => {
        if (!state.route.plan) {
          notify('Plan a route first; there is nothing to save yet.', 'warn');
          return;
        }
        const savedRoute: RoutePlan = {
          ...state.route.plan,
          name,
          savedAt: new Date().toISOString(),
        };
        await writeOne('routes', savedRoute);
        setState((s) => ({ ...s, routes: [savedRoute, ...s.routes] }));
        notify('Route saved on this device.', 'success');
      },
      deleteSavedRoute: async (id) => {
        await deleteOne('routes', id);
        setState((s) => ({ ...s, routes: s.routes.filter((r) => r.id !== id) }));
      },

      setSettings: async (patch) => {
        const next = { ...state.settings, ...patch };
        await saveSettings(next);
        setState((s) => ({ ...s, settings: next }));
      },

      toggleCompare: (placeId) =>
        setState((s) => {
          if (s.compareIds.includes(placeId)) {
            return { ...s, compareIds: s.compareIds.filter((id) => id !== placeId) };
          }
          return { ...s, compareIds: [...s.compareIds, placeId].slice(-2) };
        }),
      clearCompare: () => setState((s) => ({ ...s, compareIds: [] })),
      setReferenceToMap: (coordinates) =>
        setState((s) => ({ ...s, reference: { coordinates, label: 'Map centre' } })),

      notify,
      dismissToast: () => setState((s) => ({ ...s, toast: null })),
    };
  }, [state, notify, updateRoute]);

  // Expose distances from the fixed reference for Nearby and cards.
  const value = useMemo<StoreValue>(() => ({ state, actions }), [state, actions]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <AppProvider>');
  return ctx;
}

/** Distance helpers that never imply a walking route. */
export function distanceTo(place: Place, reference: [number, number]): number {
  return haversineMeters(reference, place.geometry.coordinates);
}

