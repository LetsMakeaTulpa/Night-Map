import { useEffect, useRef, useState } from 'react';
import maplibregl, { type Map as MapLibreMap, type MapGeoJSONFeature } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { buildMinimapStyle, buildStyle, EMPTY_FC } from './style';
import { buildMarkerImages, buildLocationDot } from './icons';
import { useStore } from '../state/store';
import { CATEGORIES, SWATCH } from '../domain/categories';
import { dataset } from '../data';
import type { PlaceView } from '../state/selectors';
import { LAYERS } from './layers';
import {
  BUILDINGS_LAYER_ID,
  BUILDINGS_SOURCE_ID,
  BUILDINGS_COUNTS,
  BUILDINGS_MIN_ZOOM,
  buildingCollection,
  failedTileCount,
  loadBuildingTiles,
  visibleTileKeys,
} from './buildings';
import { fetchLiveCalls } from './live-calls';
import {
  ageInWords,
  INCIDENT_LAYER,
  INCIDENT_PULSE_LAYER,
  INCIDENT_SOURCE,
  cachedIncidentFeed,
  feedSummary,
  loadIncidentFeed,
  type IncidentCollection,
  type IncidentFeed,
  type IncidentFeature,
} from './incidents';
import { IncidentCard } from '../features/incidents/IncidentCard';
import { StreetPanel } from '../features/street/StreetPanel';
import { SURVEY_FLY_TO_EVENT, type SurveyFlyToDetail } from './survey-flyto';
import { MAPILLARY_TOKEN_EVENT, readMapillaryToken } from '../services/mapillary';
import {
  addMapillaryCoverage,
  MAPILLARY_COVERAGE_SOURCE,
  removeMapillaryCoverage,
} from './mapillary-coverage';
import { buildingById, cachedBuildingRegistry, loadBuildingRegistry } from '../data/building-registry';
import { cachedAbandonedBuildings, loadAbandonedBuildings } from '../data/abandoned-buildings';
import type { AbandonedBuildingFile, BuildingDossier } from '../domain/types';

export interface MapLiveCounts {
  calls: number;
  cases311: number;
  /** Positioned dossiers currently loaded, not the table-only manifest total. */
  registry: number;
  /** Located vacancy/abandonment parcels currently drawn. */
  abandoned: number;
}

interface MapViewProps {
  views: PlaceView[];
  onOpenLayers: () => void;
  onLiveCountsChange?: (counts: MapLiveCounts) => void;
  onAddMissingPlace?: (coordinates: [number, number]) => void;
}

const MAP_PADDING = () => {
  const desktop = window.innerWidth >= 960;
  return { top: 76, bottom: desktop ? 76 : 240, left: desktop ? 348 : 24, right: desktop ? 424 : 24 };
};

const TERRAIN_SOURCE_ID = 'terrain';
/**
 * Deliberate vertical exaggeration. San Francisco's hills are real but gentle at
 * city scale, so terrain is drawn taller than it is — and the UI says so, because
 * an exaggerated relief must never be read as a slope measurement.
 */
const TERRAIN_EXAGGERATION = 1.4;
const PITCH_3D = 55;

/**
 * One step of the alert pulse. This changes paint only: no layer is added,
 * removed or re-ordered, so a blink can never break the map beneath it.
 */
function applyPulse(map: MapLibreMap, phase: number) {
  if (!map.getLayer(INCIDENT_PULSE_LAYER)) return;
  map.setPaintProperty(INCIDENT_PULSE_LAYER, 'circle-stroke-opacity', phase === 1 ? 0.16 : 0.62);
  map.setPaintProperty(INCIDENT_PULSE_LAYER, 'circle-stroke-width', phase === 1 ? 2.8 : 1.4);
}

export function MapView({ views, onOpenLayers, onLiveCountsChange, onAddMissingPlace }: MapViewProps) {
  const { state, actions } = useStore();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const minimapContainerRef = useRef<HTMLDivElement | null>(null);
  const miniMapRef = useRef<MapLibreMap | null>(null);
  const [minimapOpen, setMinimapOpen] = useState(true);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [camera, setCamera] = useState({ pitch: 0, bearing: 0 });
  const [buildingsState, setBuildingsState] = useState({ loaded: 0, failed: 0 });
  const [terrainTilesMissing, setTerrainTilesMissing] = useState(false);
  const [incidentCard, setIncidentCard] = useState<{
    feed: IncidentFeed;
    properties: IncidentFeature['properties'];
    coordinates: [number, number];
  } | null>(null);
  const [incidentCountsState, setIncidentCountsState] = useState<Record<IncidentFeed, number>>({
    calls: 0,
    cases311: 0,
  });
  const [incidentIssue, setIncidentIssue] = useState<string | null>(null);
  const [callsLive, setCallsLive] = useState<{ at: number; newest: string | null } | null>(null);
  const [callsLiveError, setCallsLiveError] = useState<string | null>(null);
  const [streetOpen, setStreetOpen] = useState(false);
  const [streetCenter, setStreetCenter] = useState<[number, number]>([-122.4085, 37.7835]);
  const [missingPlacePicking, setMissingPlacePicking] = useState(false);
  const [mapillaryToken, setMapillaryToken] = useState<string | null>(() => readMapillaryToken());
  const [coverageIssue, setCoverageIssue] = useState<string | null>(null);
  const [registryState, setRegistryState] = useState<{ loaded: number; error: string | null }>({
    loaded: 0,
    error: null,
  });
  const [abandonedState, setAbandonedState] = useState<{ loaded: number; error: string | null }>({
    loaded: 0,
    error: null,
  });
  const locationMarker = useRef<maplibregl.Marker | null>(null);
  const gpsFirstFollow = useRef(true);
  const selectedPlace = state.selectedPlaceId
    ? dataset.placeById.get(state.selectedPlaceId) ?? (state.selectedPlaceId.startsWith('private:')
        ? (() => {
            const observation = state.observations.find((item) => `private:${item.id}` === state.selectedPlaceId);
            if (!observation?.geometry) return null;
            const category = observation.suggestedCategory ?? (observation.type === 'passage_discovery' ? 'passage'
              : observation.type === 'popos_observation' ? 'popos'
                : observation.type === 'entrance_observation' || observation.type === 'stairs_ramp_observation' ? 'pedestrian_connection'
                  : 'services');
            return { id: state.selectedPlaceId, name: observation.placeName ?? 'Private field observation', category, geometry: observation.geometry } as { id: string; name: string; category: typeof CATEGORIES[number]['id']; geometry: { type: 'Point'; coordinates: [number, number] } };
          })()
        : null)
    : null;
  const selectedStop = state.selectedStopId
    ? dataset.data.transit.find((s) => s.id === state.selectedStopId)
    : null;
  const selectedBuilding = buildingById(state.selectedBuildingId);

  // The Street panel owns token entry, but the coverage layer must react when
  // the token is saved or removed without waiting for a page reload.
  useEffect(() => {
    const sync = () => setMapillaryToken(readMapillaryToken());
    window.addEventListener(MAPILLARY_TOKEN_EVENT, sync);
    return () => window.removeEventListener(MAPILLARY_TOKEN_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let map: MapLibreMap;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: buildStyle(),
        center: [-122.4085, 37.7835],
        zoom: 14.1,
        minZoom: 11.4,
        maxZoom: 18.5,
        maxBounds: [
          [-122.475, 37.735],
          [-122.345, 37.82],
        ],
        attributionControl: false,
        // A top-down plan is one view, not the only one: drag with two fingers
        // or control-drag to tilt, and the compass returns to north.
        dragRotate: true,
        pitchWithRotate: true,
        touchPitch: true,
        maxPitch: 78,
        antialias: true,
        fadeDuration: 0,
      });
    } catch (err) {
      setMapError((err as Error).message);
      return;
    }
    mapRef.current = map;
    if (import.meta.env.DEV) (window as unknown as { __nightmap?: MapLibreMap }).__nightmap = map;
    map.touchZoomRotate.enableRotation();
    map.keyboard.enableRotation();

    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: '© OpenStreetMap contributors · City of San Francisco open data' }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 90 }), 'bottom-left');

    // style.load is the reliable moment to install images: waiting for the full
    // 'load' event also waits on every glyph and tile range, which one bad range
    // can delay indefinitely.
    let setupDone = false;
    const setup = () => {
      if (setupDone) return;
      setupDone = true;
      try {
        for (const image of buildMarkerImages()) {
          if (!map.hasImage(image.id)) map.addImage(image.id, image.data);
        }
        const dot = buildLocationDot();
        if (!map.hasImage(dot.id)) map.addImage(dot.id, dot.data);
        setReady(true);
        console.info('[night-map] map style ready, marker images installed');
      } catch (err) {
        console.error('[night-map] marker setup failed', err);
        setMapError((err as Error).message);
      }
    };
    map.on('style.load', setup);
    map.on('load', setup);
    map.once('idle', setup);

    map.on('error', (event) => {
      const message = (event.error as Error | undefined)?.message ?? 'Map failed to render';
      const sourceId = (event as { sourceId?: string }).sourceId;
      console.info('[night-map] map event error', message, sourceId ?? '');
      // Style resource errors are noisy but not fatal; only fail the canvas on
      // a WebGL context problem.
      if (/webgl|context/i.test(message)) setMapError(message);
      // Elevation tiles are fetched on demand, so the first offline attempt can
      // legitimately fail. Say so instead of showing a flat map as if it were real.
      if (sourceId === TERRAIN_SOURCE_ID) setTerrainTilesMissing(true);
      if (sourceId === MAPILLARY_COVERAGE_SOURCE) setCoverageIssue(message);
      console.warn('[night-map] map error', message);
    });
    map.on('sourcedata', (event) => {
      const detail = event as { sourceId?: string; isSourceLoaded?: boolean };
      if (detail.sourceId === TERRAIN_SOURCE_ID && detail.isSourceLoaded) setTerrainTilesMissing(false);
      if (detail.sourceId === BUILDINGS_SOURCE_ID && detail.isSourceLoaded) setTerrainTilesMissing(false);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // A corner overview built from the same local geometry. Clicking recenters;
  // dragging moves the viewport continuously. It has no labels or terrain of
  // its own, so it can never compete with the map it is describing.
  useEffect(() => {
    if (!minimapOpen || !ready) return;
    const main = mapRef.current;
    const container = minimapContainerRef.current;
    if (!main || !container || miniMapRef.current) return;
    const shell = container.parentElement;
    let mini: MapLibreMap;
    try {
      mini = new maplibregl.Map({
        container,
        style: buildMinimapStyle(),
        center: [-122.4194, 37.7749],
        zoom: 11.45,
        minZoom: 11.2,
        maxZoom: 14,
        maxBounds: [
          [-122.475, 37.735],
          [-122.345, 37.82],
        ],
        interactive: false,
        attributionControl: false,
        fadeDuration: 0,
      });
    } catch (err) {
      console.warn('[night-map] overview map failed to start', err);
      return;
    }
    miniMapRef.current = mini;

    const update = () => {
      if (!mini.isStyleLoaded()) return;
      const bounds = main.getBounds();
      const nw = bounds.getNorthWest();
      const se = bounds.getSouthEast();
      (mini.getSource('viewport') as maplibregl.GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [nw.lng, nw.lat],
                  [se.lng, nw.lat],
                  [se.lng, se.lat],
                  [nw.lng, se.lat],
                  [nw.lng, nw.lat],
                ],
              ],
            },
          },
        ],
      });
    };

    let activePointer: number | null = null;
    let dragging = false;
    let moved = false;
    let suppressClickUntil = 0;
    let start = { x: 0, y: 0 };
    let pending: [number, number] | null = null;
    let frame = 0;

    const targetAt = (event: PointerEvent | MouseEvent): [number, number] | null => {
      if (!mini.isStyleLoaded()) return null;
      const rect = container.getBoundingClientRect();
      const x = Math.min(rect.width, Math.max(0, event.clientX - rect.left));
      const y = Math.min(rect.height, Math.max(0, event.clientY - rect.top));
      const target = mini.unproject([x, y]);
      return [target.lng, target.lat];
    };

    const flush = () => {
      frame = 0;
      if (!pending) return;
      main.jumpTo({ center: pending });
      pending = null;
    };

    const queueCenter = (center: [number, number] | null) => {
      if (!center) return;
      pending = center;
      if (frame === 0) frame = requestAnimationFrame(flush);
    };

    const onClick = (event: MouseEvent) => {
      if (performance.now() < suppressClickUntil) {
        suppressClickUntil = 0;
        return;
      }
      const target = targetAt(event);
      if (target) main.easeTo({ center: target, duration: 450 });
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !mini.isStyleLoaded()) return;
      activePointer = event.pointerId;
      dragging = true;
      moved = false;
      suppressClickUntil = 0;
      start = { x: event.clientX, y: event.clientY };
      (shell ?? container).classList.add('is-dragging');
      container.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging || event.pointerId !== activePointer) return;
      if (!moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 3) return;
      moved = true;
      queueCenter(targetAt(event));
      event.preventDefault();
    };

    const onPointerEnd = (event: PointerEvent) => {
      if (event.pointerId !== activePointer) return;
      if (container.hasPointerCapture?.(event.pointerId)) container.releasePointerCapture(event.pointerId);
      dragging = false;
      activePointer = null;
      (shell ?? container).classList.remove('is-dragging');
      if (frame !== 0) {
        cancelAnimationFrame(frame);
        frame = 0;
        if (pending) {
          main.jumpTo({ center: pending });
          pending = null;
        }
      }
      if (moved) suppressClickUntil = performance.now() + 400;
    };

    mini.on('load', update);
    main.on('move', update);
    container.addEventListener('click', onClick);
    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerEnd);
    container.addEventListener('pointercancel', onPointerEnd);
    return () => {
      main.off('move', update);
      container.removeEventListener('click', onClick);
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerEnd);
      container.removeEventListener('pointercancel', onPointerEnd);
      if (frame !== 0) cancelAnimationFrame(frame);
      mini.remove();
      miniMapRef.current = null;
    };
  }, [minimapOpen, ready]);

  // Keep the canvas in sync with filtered data.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const features = views.map((view) => ({
      type: 'Feature' as const,
      id: view.place.id,
      properties: {
        id: view.place.id,
        category: view.place.category,
        saved: view.saved,
        name: view.place.name,
      },
      geometry: view.place.geometry,
    }));
    (map.getSource('places') as maplibregl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features,
    });
  }, [views, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const fc = (map.getSource('stops') as maplibregl.GeoJSONSource | undefined);
    fc?.setData({
      type: 'FeatureCollection',
      features: dataset.data.transit.map((stop) => ({
        type: 'Feature' as const,
        properties: { id: stop.id, name: stop.name },
        geometry: stop.geometry,
      })),
    });
  }, [ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource('observations') as maplibregl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: state.observations
        .filter((o) => o.geometry)
        .map((o) => ({
          type: 'Feature' as const,
          properties: { id: o.id, type: o.type },
          geometry: o.geometry!,
        })),
    });
  }, [state.observations, ready]);

  // Focus marker (selected place or stop) sits above clusters.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource('focus') as maplibregl.GeoJSONSource | undefined;
    if (selectedPlace) {
      source?.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { id: selectedPlace.id, category: selectedPlace.category },
            geometry: selectedPlace.geometry,
          },
        ],
      });
    } else if (selectedStop) {
      source?.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { id: selectedStop.id, category: 'transit' },
            geometry: selectedStop.geometry,
          },
        ],
      });
    } else {
      source?.setData(EMPTY_FC);
    }
  }, [selectedPlace, selectedStop, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource('external') as maplibregl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: state.selectedExternal
        ? [
            {
              type: 'Feature',
              properties: { label: state.selectedExternal.label },
              geometry: { type: 'Point', coordinates: state.selectedExternal.coordinates },
            },
          ]
        : [],
    });
  }, [state.selectedExternal, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const plan = state.route.plan;
    (map.getSource('route') as maplibregl.GeoJSONSource | undefined)?.setData(
      plan?.geometry ? { type: 'Feature', properties: {}, geometry: plan.geometry } : EMPTY_FC,
    );
    (map.getSource('routeStops') as maplibregl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: state.route.stops.map((stop) => ({
        type: 'Feature' as const,
        properties: { label: stop.label },
        geometry: { type: 'Point' as const, coordinates: stop.coordinates },
      })),
    });
    if (plan?.geometry) {
      const bounds = plan.geometry.coordinates.reduce(
        (b, c) => b.extend(c as [number, number]),
        new maplibregl.LngLatBounds(plan.geometry.coordinates[0], plan.geometry.coordinates[0]),
      );
      map.fitBounds(bounds, { padding: MAP_PADDING(), maxZoom: 16.5, duration: 600 });
    }
  }, [state.route.plan, state.route.stops, ready]);

  // Mapillary coverage is mounted only while its layer is on and a token is
  // present. Nothing is requested merely because the layer exists.
  const coverageOn = Boolean(state.layers['mapillary-coverage']);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!coverageOn || !mapillaryToken) {
      removeMapillaryCoverage(map);
      setCoverageIssue(null);
      return;
    }
    setCoverageIssue(null);
    addMapillaryCoverage(map, mapillaryToken);
  }, [coverageOn, mapillaryToken, ready]);

  // Layer visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const set = (ids: string[], visible: boolean) => {
      for (const id of ids) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    };
    set(['road-casing', 'roads', 'paths'], state.layers.streets);
    set(['street-labels'], state.layers['street-labels']);
    set(['green-fill', 'green-edge'], state.layers.parks);
    set(['hood-labels'], state.layers.neighbourhoods);
    set(['rail-line'], state.layers['transit-lines']);
    set(['stops-dots', 'stops-labels'], state.layers['transit-stops']);
    set(['hillshade'], state.layers.terrain);
    set([BUILDINGS_LAYER_ID], state.layers['buildings-3d']);
    set(['places-symbol', 'cluster-halo', 'cluster-count'], state.layers.resources);
    set(['saved-rings'], state.layers.saved);
    set(['obs-symbol'], state.layers.observations);
    set([INCIDENT_PULSE_LAYER, INCIDENT_LAYER.calls], Boolean(state.layers['calls-recent']));
    set([INCIDENT_LAYER.cases311], Boolean(state.layers['cases-311']));
    set(['building-registry-dots', 'building-registry-labels'], Boolean(state.layers['building-registry']));
    set(
      ['abandoned-glow', 'abandoned-ring-soft', 'abandoned-ring'],
      Boolean(state.layers['abandoned-buildings']),
    );

    if (map.getLayer('hillshade')) {
      map.setPaintProperty('hillshade', 'hillshade-exaggeration', state.layerOpacity.terrain ?? 0.32);
    }
  }, [state.layers, state.layerOpacity, ready]);

  // Camera readout: the compass needle and the tilt chip both follow this.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const sync = () => {
      const pitch = Math.round(map.getPitch());
      const bearing = Math.round(map.getBearing());
      setCamera((prev) =>
        prev.pitch === pitch && prev.bearing === bearing ? prev : { pitch, bearing },
      );
    };
    map.on('pitch', sync);
    map.on('rotate', sync);
    map.on('moveend', sync);
    sync();
    return () => {
      map.off('pitch', sync);
      map.off('rotate', sync);
      map.off('moveend', sync);
    };
  }, [ready]);

  // Terrain is a real displacement of the map surface, so it is switched on
  // explicitly and switched off completely — never left half-applied.
  const terrainOn = Boolean(state.layers.terrain);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const active = map.getTerrain();
    if (terrainOn && !active) {
      map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: TERRAIN_EXAGGERATION });
    } else if (!terrainOn && active) {
      map.setTerrain(null);
    }
  }, [terrainOn, ready]);

  // 3D buildings: three-ish tiles at a time, only where the view reaches.
  const buildingsOn = Boolean(state.layers['buildings-3d']);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource(BUILDINGS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!buildingsOn) {
      source?.setData(EMPTY_FC);
      setBuildingsState({ loaded: 0, failed: 0 });
      return;
    }
    let cancelled = false;
    let timer: number | null = null;
    const load = async () => {
      const keys = visibleTileKeys(map);
      if (keys.length === 0) {
        source?.setData(EMPTY_FC);
        if (!cancelled) setBuildingsState({ loaded: 0, failed: failedTileCount() });
        return;
      }
      const outcome = await loadBuildingTiles(keys);
      if (cancelled) return;
      source?.setData(buildingCollection(keys) as unknown as GeoJSON.FeatureCollection);
      setBuildingsState({ loaded: outcome.features, failed: failedTileCount() });
    };
    void load();
    const onMoveEnd = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(), 350);
    };
    map.on('moveend', onMoveEnd);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      map.off('moveend', onMoveEnd);
    };
  }, [buildingsOn, ready]);

  // A plan view gets flat footprints; a tilted view gets real extrusion. The
  // style is touched only once the camera has settled, never while MapLibre is
  // interpolating it: re-styling mid-move can swallow the move itself.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const apply = () => {
      if (!map.getLayer(BUILDINGS_LAYER_ID)) return;
      const extruded = map.getPitch() > 4;
      map.setPaintProperty(
        BUILDINGS_LAYER_ID,
        'fill-extrusion-height',
        extruded ? ['get', 'h'] : ['*', ['get', 'h'], 0],
      );
      map.setPaintProperty(BUILDINGS_LAYER_ID, 'fill-extrusion-base', extruded ? ['get', 'b'] : 0);
    };
    apply();
    map.on('moveend', apply);
    map.on('pitchend', apply);
    return () => {
      map.off('moveend', apply);
      map.off('pitchend', apply);
    };
  }, [ready]);

  // Reported activity. The calls layer refreshes every two minutes from the
  // City's 10-minute-delayed CAD extract and keeps the bundled snapshot as an
  // offline fallback; 311 is nightly, so its snapshot is the honest unit.
  const callsOn = Boolean(state.layers['calls-recent']);
  const cases311On = Boolean(state.layers['cases-311']);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !cases311On) return;
    const source = map.getSource(INCIDENT_SOURCE.cases311) as maplibregl.GeoJSONSource | undefined;
    const held = cachedIncidentFeed('cases311');
    if (held) {
      source?.setData(held as unknown as GeoJSON.FeatureCollection);
      setIncidentCountsState((prev) => ({ ...prev, cases311: held.features.length }));
      return;
    }
    let cancelled = false;
    loadIncidentFeed('cases311')
      .then((collection) => {
        if (cancelled) return;
        source?.setData(collection as unknown as GeoJSON.FeatureCollection);
        setIncidentCountsState((prev) => ({ ...prev, cases311: collection.features.length }));
      })
      .catch((err: Error) => {
        if (!cancelled) setIncidentIssue(`311 cases unavailable offline — ${err.message}`);
      });
    return () => {
      cancelled = true;
    };
  }, [cases311On, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!callsOn) {
      setCallsLive(null);
      setCallsLiveError(null);
      setIncidentCard(null);
      return;
    }
    const source = map.getSource(INCIDENT_SOURCE.calls) as maplibregl.GeoJSONSource | undefined;
    let cancelled = false;
    let liveApplied = false;

    const apply = (collection: IncidentCollection) => {
      source?.setData(collection as unknown as GeoJSON.FeatureCollection);
      setIncidentCountsState((prev) => ({ ...prev, calls: collection.features.length }));
    };

    const fallback = async () => {
      const snapshot = cachedIncidentFeed('calls');
      if (snapshot) {
        apply(snapshot);
        return;
      }
      try {
        const collection = await loadIncidentFeed('calls');
        if (!cancelled) apply(collection);
      } catch (err) {
        if (!cancelled) setIncidentIssue(`Dispatched calls unavailable offline — ${(err as Error).message}`);
      }
    };

    const refresh = async (force: boolean) => {
      try {
        if (!navigator.onLine) throw new Error('this device is offline');
        const result = await fetchLiveCalls(force);
        if (cancelled) return;
        liveApplied = true;
        apply(result.collection);
        setCallsLive({ at: result.fetchedAt, newest: result.newest });
        setCallsLiveError(null);
        setIncidentIssue(null);
      } catch (err) {
        if (cancelled) return;
        setCallsLiveError((err as Error).message);
        if (!liveApplied) await fallback();
      }
    };

    void refresh(false);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(true);
    }, 120_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [callsOn, ready]);

  // Vacancy/abandonment markers are a point-only extract, small enough to load
  // by default. They are deliberately separate from the multi-megabyte registry.
  const abandonedOn = Boolean(state.layers['abandoned-buildings']);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource('abandonedBuildings') as maplibregl.GeoJSONSource | undefined;
    if (!abandonedOn) {
      source?.setData(EMPTY_FC);
      setAbandonedState({ loaded: 0, error: null });
      return;
    }
    let cancelled = false;
    const apply = (file: AbandonedBuildingFile) => {
      if (cancelled) return;
      const features = file.dossiers.map((dossier) => ({
        type: 'Feature' as const,
        properties: {
          id: dossier.id,
          address: dossier.address,
          status: dossier.status,
          precision: dossier.locationPrecision,
        },
        geometry: { type: 'Point' as const, coordinates: dossier.coordinates },
      }));
      source?.setData({ type: 'FeatureCollection', features } as unknown as GeoJSON.FeatureCollection);
      setAbandonedState({ loaded: features.length, error: null });
    };
    const held = cachedAbandonedBuildings();
    if (held) apply(held);
    else {
      loadAbandonedBuildings()
        .then(apply)
        .catch((err: Error) => {
          if (!cancelled) setAbandonedState({ loaded: 0, error: err.message });
        });
    }
    return () => {
      cancelled = true;
    };
  }, [abandonedOn, ready]);

  // Building registry: a parcel dossier set, fetched the first time the layer is
  // switched on and kept by the service worker afterwards. Counts in the status
  // chip come from what actually loaded, not from the manifest.
  const registryOn = Boolean(state.layers['building-registry']);
  useEffect(() => {
    onLiveCountsChange?.({
      calls: incidentCountsState.calls,
      cases311: incidentCountsState.cases311,
      registry: registryState.loaded,
      abandoned: abandonedState.loaded,
    });
  }, [
    incidentCountsState.calls,
    incidentCountsState.cases311,
    registryState.loaded,
    abandonedState.loaded,
    onLiveCountsChange,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource('buildingRegistry') as maplibregl.GeoJSONSource | undefined;
    if (!registryOn) {
      source?.setData(EMPTY_FC);
      setRegistryState({ loaded: 0, error: null });
      return;
    }
    let cancelled = false;
    const apply = (registry: { dossiers: BuildingDossier[] }) => {
      if (cancelled) return;
      const features = registry.dossiers
        .filter((dossier) => dossier.coordinates)
        .map((dossier) => ({
          type: 'Feature' as const,
          properties: { id: dossier.id, status: dossier.status, address: dossier.address },
          geometry: { type: 'Point' as const, coordinates: dossier.coordinates as [number, number] },
        }));
      source?.setData({ type: 'FeatureCollection', features } as unknown as GeoJSON.FeatureCollection);
      setRegistryState({ loaded: features.length, error: null });
    };
    const held = cachedBuildingRegistry();
    if (held) apply(held);
    else {
      loadBuildingRegistry()
        .then(apply)
        .catch((err: Error) => {
          if (!cancelled) setRegistryState({ loaded: 0, error: err.message });
        });
    }
    return () => {
      cancelled = true;
    };
  }, [registryOn, ready]);

  // The alert blink. A steady ring is drawn instead when the reader prefers
  // reduced motion, and the animation pauses while the tab is hidden, so a phone
  // in a pocket is not repainting a map nobody is looking at.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !callsOn) return;
    const reduced =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      applyPulse(map, 0);
      return;
    }
    let phase = 0;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      phase = phase === 0 ? 1 : 0;
      applyPulse(map, phase);
    }, 750);
    return () => {
      window.clearInterval(timer);
      applyPulse(map, 0);
    };
  }, [callsOn, ready]);

  // Street imagery follows the map only while its panel is open. Closing the
  // panel stops the requests entirely; nothing is fetched in the background.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !streetOpen) return;
    const update = () => {
      const center = map.getCenter();
      setStreetCenter([center.lng, center.lat]);
    };
    map.on('moveend', update);
    return () => {
      map.off('moveend', update);
    };
  }, [streetOpen, ready]);

  // Click handling
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const handleClick = (event: maplibregl.MapMouseEvent) => {
      if (missingPlacePicking) {
        setMissingPlacePicking(false);
        onAddMissingPlace?.([event.lngLat.lng, event.lngLat.lat]);
        return;
      }
      if (state.route.picking) return; // handled by a dedicated listener below
      const incidentLayers = [INCIDENT_LAYER.calls, INCIDENT_LAYER.cases311].filter((id) => map.getLayer(id));
      const hits = map.queryRenderedFeatures(event.point, {
        layers: [
          'places-symbol',
          'stops-dots',
          'abandoned-glow',
          'abandoned-ring-soft',
          'abandoned-ring',
          'building-registry-dots',
          ...incidentLayers,
        ].filter((id) => map.getLayer(id)),
      });
      // A tap resolves to the dot actually under the finger. Reported activity
      // wins when it is the nearer feature, so a red dot stays tappable where it
      // overlaps a marker, and a resource stays reachable where its own marker is
      // the closer thing to the tap.
      const distanceToTap = (hit: MapGeoJSONFeature) => {
        if (hit.geometry.type !== 'Point') return Number.POSITIVE_INFINITY;
        const projected = map.project(hit.geometry.coordinates as [number, number]);
        return Math.abs(projected.x - event.point.x) + Math.abs(projected.y - event.point.y);
      };
      const nearestOf = (ids: string[]) =>
        hits
          .filter((hit) => ids.includes(hit.layer.id))
          .reduce<MapGeoJSONFeature | null>(
            (best, hit) => (!best || distanceToTap(hit) < distanceToTap(best) ? hit : best),
            null,
          );

      const placeHit = hits.find((h) => h.layer.id === 'places-symbol');
      const stopHit = hits.find((h) => h.layer.id === 'stops-dots');
      const markerHit = placeHit ?? stopHit ?? null;
      const incidentHit = nearestOf(incidentLayers);
      const abandonedHit = nearestOf(['abandoned-glow', 'abandoned-ring-soft', 'abandoned-ring']);
      const buildingHit = nearestOf(['building-registry-dots']);

      if (incidentHit && (!markerHit || distanceToTap(incidentHit) < distanceToTap(markerHit))) {
        const geometry = incidentHit.geometry as GeoJSON.Point;
        setIncidentCard({
          feed: incidentHit.layer.id === INCIDENT_LAYER.calls ? 'calls' : 'cases311',
          properties: incidentHit.properties as unknown as IncidentFeature['properties'],
          coordinates: [geometry.coordinates[0], geometry.coordinates[1]],
        });
        return;
      }
      // A parcel marker carries a dossier, so it opens the registry rather than
      // the place inspector. It is preferred only when it is the nearer marker.
      const dossierHit =
        abandonedHit && (!buildingHit || distanceToTap(abandonedHit) <= distanceToTap(buildingHit))
          ? abandonedHit
          : buildingHit;
      if (dossierHit && (!markerHit || distanceToTap(dossierHit) < distanceToTap(markerHit))) {
        const id = String(dossierHit.properties?.id ?? '');
        if (id) actions.selectBuilding(id);
        return;
      }
      if (placeHit) {
        const id = String(placeHit.properties?.id);
        if (!id.startsWith('private:') || state.observations.some((observation) => `private:${observation.id}` === id)) {
          actions.selectPlace(id);
        }
        return;
      }
      if (stopHit) {
        actions.selectStop(String(stopHit.properties?.id));
        return;
      }
      const clusters = map.queryRenderedFeatures(event.point, { layers: ['cluster-halo'] });
      if (clusters.length > 0) {
        const feature = clusters[0] as MapGeoJSONFeature;
        const clusterId = feature.properties?.cluster_id as number;
        const source = map.getSource('places') as maplibregl.GeoJSONSource;
        source.getClusterExpansionZoom(clusterId).then((zoom) => {
          map.easeTo({
            center: (feature.geometry as GeoJSON.Point).coordinates as [number, number],
            zoom,
          });
        });
      }
    };

    const handleMove = (event: maplibregl.MapMouseEvent) => {
      const hits = map.queryRenderedFeatures(event.point, {
        layers: [
          'places-symbol',
          'stops-dots',
          'abandoned-glow',
          'abandoned-ring-soft',
          'abandoned-ring',
          'building-registry-dots',
          'cluster-halo',
          INCIDENT_LAYER.calls,
          INCIDENT_LAYER.cases311,
        ].filter((id) => map.getLayer(id)),
      });
      map.getCanvas().style.cursor = hits.length > 0 ? 'pointer' : '';
    };

    const handlePick = (event: maplibregl.MapMouseEvent) => {
      if (!state.route.picking) return;
      actions.setPicking(null);
      if (state.route.picking === 'origin') {
        actions.setRouteOrigin({
          label: 'Map point',
          placeId: null,
          coordinates: [event.lngLat.lng, event.lngLat.lat],
        });
        actions.notify('Starting point set from the map.');
      } else {
        actions.addRoutePoint('Map point', [event.lngLat.lng, event.lngLat.lat]);
        actions.notify('Stop added from the map.');
      }
    };

    map.on('click', handleClick);
    map.on('mousemove', handleMove);
    map.on('click', handlePick);
    return () => {
      map.off('click', handleClick);
      map.off('mousemove', handleMove);
      map.off('click', handlePick);
    };
  }, [ready, state.route.picking, missingPlacePicking, onAddMissingPlace, actions]);

  // Fly to a selected place and account for the panels.
  const lastFocus = useRef<string | null>(null);

  // Nearby survey cards get a short cinematic preview: fly to the place at a
  // tilt, hold it for a beat, then settle back to the camera orientation the
  // reader had before. Reduced-motion readers skip the flourish entirely and
  // keep the ordinary selection centring below.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let settle: number | null = null;
    const onSurveyFlyTo = (event: Event) => {
      const detail = (event as CustomEvent<SurveyFlyToDetail>).detail;
      if (!detail?.placeId || !detail.coordinates) return;
      if (
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        return;
      }
      const startPitch = map.getPitch();
      const startBearing = map.getBearing();
      const from = map.getCenter();
      const radians = Math.PI / 180;
      const bearing =
        ((Math.atan2(
          (detail.coordinates[0] - from.lng) * Math.cos(detail.coordinates[1] * radians),
          detail.coordinates[1] - from.lat,
        ) *
          180) /
          Math.PI +
          360) %
        360;

      lastFocus.current = detail.placeId;
      if (settle !== null) window.clearTimeout(settle);
      map.stop();
      map.flyTo({
        center: detail.coordinates,
        zoom: Math.max(map.getZoom(), 16),
        pitch: Math.max(52, startPitch),
        bearing,
        padding: MAP_PADDING(),
        duration: 950,
        curve: 1.35,
        essential: true,
      });
      settle = window.setTimeout(() => {
        map.easeTo({
          pitch: startPitch,
          bearing: startBearing,
          duration: 850,
          essential: true,
        });
      }, 1100);
    };
    window.addEventListener(SURVEY_FLY_TO_EVENT, onSurveyFlyTo);
    return () => {
      window.removeEventListener(SURVEY_FLY_TO_EVENT, onSurveyFlyTo);
      if (settle !== null) window.clearTimeout(settle);
    };
  }, [ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const key = selectedPlace?.id ?? selectedStop?.id ?? null;
    if (!key || key === lastFocus.current) return;
    lastFocus.current = key;
    const coordinates = selectedPlace?.geometry.coordinates ?? selectedStop?.geometry.coordinates;
    if (!coordinates) return;
    map.easeTo({
      center: coordinates,
      zoom: Math.max(map.getZoom(), 16),
      padding: MAP_PADDING(),
      duration: 700,
    });
  }, [selectedPlace, selectedStop, ready]);

  // Fly to a selected building dossier. The registry may not be in memory yet on
  // a deep link, so it is fetched once here rather than silently doing nothing.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !state.selectedBuildingId) return;
    const fly = (coordinates: [number, number]) => {
      map.easeTo({
        center: coordinates,
        zoom: Math.max(map.getZoom(), 16.2),
        padding: MAP_PADDING(),
        duration: 700,
      });
    };
    const held = buildingById(state.selectedBuildingId);
    if (held?.coordinates) {
      fly(held.coordinates);
      return;
    }
    let cancelled = false;
    loadBuildingRegistry()
      .then((registry) => {
        if (cancelled) return;
        const dossier = registry.dossiers.find((entry) => entry.id === state.selectedBuildingId);
        if (dossier?.coordinates) fly(dossier.coordinates);
      })
      .catch(() => {
        /* the dossier itself reports the failure */
      });
    return () => {
      cancelled = true;
    };
  }, [state.selectedBuildingId, ready]);

  // Session-only location dot. Nothing is persisted.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const loc = state.userLocation;
    if (!loc) {
      locationMarker.current?.remove();
      locationMarker.current = null;
      return;
    }
    if (!locationMarker.current) {
      const el = document.createElement('div');
      el.className = 'user-location-dot';
      el.setAttribute('aria-label', 'Your approximate location');
      locationMarker.current = new maplibregl.Marker({ element: el, pitchAlignment: 'map' })
        .setLngLat(loc.coordinates)
        .addTo(map);
    } else {
      locationMarker.current.setLngLat(loc.coordinates);
    }
    const el = locationMarker.current.getElement();
    el.classList.toggle('is-locked', state.gpsLocked);
    el.setAttribute(
      'aria-label',
      state.gpsLocked ? 'Your live location, GPS locked' : 'Your approximate location',
    );
  }, [state.userLocation, state.gpsLocked, ready]);

  // GPS lock is a live follow, not a one-off fix. The first fix also zooms in;
  // later fixes only move the camera so a user's chosen scale is preserved.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !state.gpsLocked || !state.userLocation) {
      gpsFirstFollow.current = true;
      return;
    }
    const first = gpsFirstFollow.current;
    gpsFirstFollow.current = false;
    map.easeTo({
      center: state.userLocation.coordinates,
      zoom: first ? Math.max(map.getZoom(), 16) : undefined,
      padding: MAP_PADDING(),
      duration: first ? 650 : 400,
    });
  }, [state.gpsLocked, state.userLocation, ready]);

  // A real map drag means the person wants to look around. Release the follow
  // lock rather than snapping the map back on the next GPS update.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !state.gpsLocked) return;
    const release = () => actions.stopGpsLock();
    map.on('dragstart', release);
    return () => {
      map.off('dragstart', release);
    };
  }, [ready, state.gpsLocked, actions]);

  const recenter = () => {
    const map = mapRef.current;
    if (!map) return;
    const center = state.userLocation?.coordinates ?? [-122.4085, 37.7835];
    map.easeTo({ center, zoom: state.userLocation ? 16 : 14.1, padding: MAP_PADDING(), duration: 600 });
  };

  const stopCount = views.length;
  const is3d = camera.pitch > 4;

  const openStreetImagery = () => {
    if (streetOpen) {
      setStreetOpen(false);
      return;
    }
    const selected = selectedPlace?.geometry.coordinates ?? selectedBuilding?.coordinates ?? null;
    const map = mapRef.current;
    if (selected) setStreetCenter(selected);
    else if (map) {
      const center = map.getCenter();
      setStreetCenter([center.lng, center.lat]);
    }
    setStreetOpen(true);
  };

  /**
   * Camera moves that are guaranteed to arrive. An eased move is only as
   * reliable as the frame callbacks driving it, and a phone that stalls them —
   * backgrounded tab, battery saver, a GPU hiccup — would leave the 3D control
   * looking broken. So the target is re-applied once if the ease did not finish.
   */
  const cameraRequest = useRef(0);
  const moveCamera = (target: { pitch: number; bearing: number }) => {
    const map = mapRef.current;
    if (!map) return;
    const request = ++cameraRequest.current;
    map.easeTo({ ...target, duration: 700, padding: MAP_PADDING() });
    window.setTimeout(() => {
      if (cameraRequest.current !== request) return;
      const live = mapRef.current;
      if (!live) return;
      if (Math.abs(live.getPitch() - target.pitch) > 0.5) live.setPitch(target.pitch);
      if (Math.abs(live.getBearing() - target.bearing) > 0.5) live.setBearing(target.bearing);
    }, 1100);
  };

  const toggle3d = () => {
    const map = mapRef.current;
    if (!map) return;
    if (is3d) {
      moveCamera({ pitch: 0, bearing: 0 });
      return;
    }
    // Tilting only looks three-dimensional with the two layers that carry the
    // third dimension, so they are switched on together — and named out loud.
    if (!state.layers.terrain) actions.setLayer('terrain', true);
    if (!state.layers['buildings-3d']) actions.setLayer('buildings-3d', true);
    moveCamera({ pitch: PITCH_3D, bearing: map.getBearing() });
    actions.notify(
      '3D view on. Terrain relief is exaggerated ×1.4; building heights come from OpenStreetMap tags where present and are estimated elsewhere.',
    );
  };

  const resetNorth = () => moveCamera({ pitch: 0, bearing: 0 });

  return (
    <div className={`map-stage ${minimapOpen ? 'has-minimap' : ''}`}>
      <div ref={containerRef} className="map-canvas" role="application" aria-label="Night Map of central San Francisco" />

      {mapError && (
        <div className="map-failed" role="alert">
          <h3>The map canvas could not start</h3>
          <p>{mapError}</p>
          <p>Search, placed lists and saved records still work. Try a browser with WebGL enabled.</p>
        </div>
      )}

      <div className="map-topline">
        <span className="map-scale-note is-count">
          {stopCount} {stopCount === 1 ? 'record' : 'records'} in this filter
        </span>
        {is3d && (
          <span className="map-scale-note is-3d">
            tilted {camera.pitch}° · facing {camera.bearing === 0 ? 'north' : `${camera.bearing}°`}
          </span>
        )}
        {buildingsOn && (
          <span className="map-scale-note" data-testid="buildings-status">
            {buildingsState.loaded > 0
              ? `3D buildings: ${buildingsState.loaded} loaded`
              : `3D buildings load at street zoom (z${BUILDINGS_MIN_ZOOM})`}
          </span>
        )}
        {terrainOn && terrainTilesMissing && (
          <span className="map-scale-note is-warn" data-testid="terrain-status">
            Elevation tiles not cached yet — terrain stays flat until they load
          </span>
        )}
        {callsOn && (
          <span
            className="map-scale-note is-alert"
            data-testid="calls-status"
            title={callsLiveError ? `Live refresh failed: ${callsLiveError}` : undefined}
          >
            {incidentCountsState.calls > 0
              ? `${incidentCountsState.calls} dispatched calls · ${
                  callsLive
                    ? `City feed ${new Date(callsLive.at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })} · 10 min delay`
                    : `offline snapshot, newest ${ageInWords(feedSummary('calls').newest)}`
                }`
              : (callsLiveError ?? incidentIssue ?? 'Loading dispatched calls…')}
          </span>
        )}
        {cases311On && (
          <span className="map-scale-note" data-testid="cases311-status">
            {incidentCountsState.cases311 > 0
              ? `${incidentCountsState.cases311} 311 cases · published snapshot, newest ${ageInWords(feedSummary('cases311').newest)}`
              : (incidentIssue ?? 'Loading 311 cases…')}
          </span>
        )}
        {registryOn && (
          <span className="map-scale-note" data-testid="registry-status">
            {registryState.loaded > 0
              ? `${registryState.loaded.toLocaleString()} parcel dossiers · City records, not field checks`
              : (registryState.error ?? 'Loading building registry…')}
          </span>
        )}
        {coverageOn && (
          <span
            className={`map-scale-note ${!mapillaryToken || coverageIssue ? 'is-warn' : ''}`}
            data-testid="coverage-status"
            title={
              !mapillaryToken
                ? 'Open Street-level imagery to save a Mapillary client token.'
                : (coverageIssue ?? 'Coverage is crowd-sourced and may be incomplete or old.')
            }
          >
            {!mapillaryToken
              ? 'Mapillary coverage: add a token in Street-level imagery'
              : coverageIssue
                ? 'Mapillary coverage unavailable'
                : 'Mapillary coverage · crowd-sourced, may be incomplete'}
          </span>
        )}
        {state.route.picking && (
          <span className="picking-chip" role="status">
            Tap the map to set {state.route.picking === 'origin' ? 'the start' : 'a stop'}
            <button type="button" onClick={() => actions.setPicking(null)}>
              Cancel
            </button>
          </span>
        )}
        {missingPlacePicking && (
          <span className="picking-chip" role="status">
            Tap the map where the missing place is
            <button type="button" onClick={() => setMissingPlacePicking(false)}>
              Cancel
            </button>
          </span>
        )}
      </div>

      {minimapOpen && (
        <div className="minimap" role="group" aria-label="Overview minimap">
          <div ref={minimapContainerRef} className="minimap-canvas" />
          <span className="minimap-label">Overview</span>
        </div>
      )}

      {streetOpen && (
        <StreetPanel
          center={streetCenter}
          onClose={() => setStreetOpen(false)}
          onCenter={(coordinates) => {
            const map = mapRef.current;
            map?.easeTo({ center: coordinates, zoom: Math.max(map.getZoom(), 17), duration: 600 });
          }}
        />
      )}

      <div className="map-controls" aria-label="Map controls">
        <button
          type="button"
          className={`map-control ${is3d ? 'is-active' : ''}`}
          onClick={toggle3d}
          aria-pressed={is3d}
          aria-label="3D view"
          title={`Tilt the map and show terrain and buildings. Two-finger drag or control-drag tilts by hand (max ${78}°).`}
        >
          <CubeIcon />
        </button>
        <button
          type="button"
          className="map-control compass"
          onClick={resetNorth}
          aria-label="Reset north and tilt"
          title="Face north, top-down"
        >
          <CompassIcon bearing={camera.bearing} />
        </button>
        <button
          type="button"
          className={`map-control ${state.gpsLocked ? 'is-active' : ''}`}
          onClick={actions.toggleGpsLock}
          aria-pressed={state.gpsLocked}
          aria-label={state.gpsLocked ? 'Stop GPS lock' : 'Lock map to my GPS location'}
          title={
            state.gpsLocked
              ? 'GPS locked: the map follows this device. Drag the map or press again to release.'
              : 'Lock the map to this device and follow live GPS fixes'
          }
        >
          <CrosshairIcon />
        </button>
        <button
          type="button"
          className="map-control"
          onClick={onOpenLayers}
          aria-label="Layers"
          title="Layers"
        >
          <LayersIcon />
        </button>
        <button
          type="button"
          className="map-control"
          onClick={() => setLegendOpen((v) => !v)}
          aria-label="Map legend"
          aria-expanded={legendOpen}
          title="Legend"
        >
          <LegendIcon />
        </button>
        <button
          type="button"
          className={`map-control ${streetOpen ? 'is-active' : ''}`}
          onClick={openStreetImagery}
          aria-pressed={streetOpen}
          aria-label="Street-level imagery"
          title="Mapillary street-level photos near the selected place, building or map centre"
        >
          <svg viewBox="0 0 24 24" className="path-icon" width="19" height="19" aria-hidden="true">
            <rect x="3" y="7" width="18" height="12.5" rx="2" />
            <circle cx="12" cy="13.2" r="3.4" />
            <path d="m8.5 7 1.3-2.2h4.4L15.5 7" />
          </svg>
        </button>
        <button
          type="button"
          className={`map-control ${missingPlacePicking ? 'is-active' : ''}`}
          onClick={() => {
            actions.setPicking(null);
            setMissingPlacePicking((picking) => !picking);
          }}
          aria-pressed={missingPlacePicking}
          aria-label="Add a missing place"
          title="Add a missing place at a map point"
        >
          <svg viewBox="0 0 24 24" className="path-icon" width="19" height="19" aria-hidden="true">
            <path d="M12 21s7-5.9 7-12a7 7 0 1 0-14 0c0 6.1 7 12 7 12Z" />
            <path d="M12 6.5v6M9 9.5h6" />
          </svg>
        </button>
        <button
          type="button"
          className={`map-control ${minimapOpen ? 'is-active' : ''}`}
          onClick={() => setMinimapOpen((open) => !open)}
          aria-pressed={minimapOpen}
          aria-label="Overview minimap"
          title="Toggle the overview minimap"
        >
          <svg viewBox="0 0 24 24" className="path-icon" width="19" height="19" aria-hidden="true">
            <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
            <path d="M3.5 9.5h17M9 4.5v15" />
          </svg>
        </button>
        <div className="map-control-group">
          <button type="button" className="map-control" onClick={() => mapRef.current?.zoomIn()} aria-label="Zoom in">
            +
          </button>
          <button type="button" className="map-control" onClick={() => mapRef.current?.zoomOut()} aria-label="Zoom out">
            −
          </button>
        </div>
      </div>

      <button
        type="button"
        className={`map-recenter ${state.gpsLocked ? 'is-active' : ''}`}
        onClick={recenter}
        aria-pressed={state.gpsLocked}
      >
        <CrosshairIcon />
        <span>{state.gpsLocked ? 'GPS locked' : 'Recenter'}</span>
      </button>

      {legendOpen && (
        <div className="legend" role="dialog" aria-label="Map legend">
          <div className="legend-head">
            <h3>Legend</h3>
            <button type="button" className="icon-button" onClick={() => setLegendOpen(false)} aria-label="Close legend">
              ×
            </button>
          </div>
          <ul className="legend-list">
            {CATEGORIES.filter((c) => c.layerGroup === 'resources').map((category) => (
              <li key={category.id}>
                <span className="legend-swatch" style={{ background: category.color }}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d={category.icon} />
                  </svg>
                </span>
                <span>{category.label}</span>
                <span className="legend-count">{dataset.categoryCounts[category.id] ?? 0}</span>
              </li>
            ))}
            <li>
              <span className="legend-shape legend-saved" />
              <span>Saved place</span>
            </li>
            <li>
              <span className="legend-shape legend-observation" />
              <span>Your field note</span>
            </li>
            <li>
              <span className="legend-shape legend-abandoned" />
              <span>Abandoned building · City record</span>
            </li>
            <li>
              <span className="legend-shape legend-stop" />
              <span>Muni stop</span>
            </li>
            {coverageOn && (
              <li>
                <span className="legend-shape legend-coverage" />
                <span>Mapillary photo coverage</span>
              </li>
            )}
            {callsOn && (
              <li>
                <span className="legend-shape legend-call" />
                <span>Reported dispatched call</span>
              </li>
            )}
            {cases311On && (
              <li>
                <span className="legend-shape legend-311" />
                <span>Recent 311 request</span>
              </li>
            )}
          </ul>
          {(callsOn || cases311On) && (
            <div className="legend-3d" data-testid="legend-incidents">
              <h4>About reported activity</h4>
              <ul>
                <li>
                  Dispatched calls refresh every two minutes from the City’s CAD extract, which is itself delayed ten
                  minutes and only publishes calls that have closed. It withholds sensitive calls, and every record is
                  placed at an intersection or block, not a door. This is not live 911 and carries no audio.
                </li>
                <li>
                  311 cases come from the nightly service-request dataset and are often already resolved by the
                  time they are read here.
                </li>
                <li>
                  Categories that describe a person — encampments, welfare checks, medical and crisis calls, and
                  anything else about someone’s body, housing or state of mind — are removed before the file is
                  written, as are addresses, narratives and notes. Around 40 m of position is all that is kept.
                </li>
              </ul>
            </div>
          )}
          {coverageOn && (
            <div className="legend-3d">
              <h4>About photo coverage</h4>
              <ul>
                <li>
                  Lines and dots show where Mapillary contributors have uploaded street-level photos. Coverage is
                  crowd-sourced, incomplete and sometimes years old; an empty street here is not evidence that no
                  photo exists. Photos are © Mapillary contributors, CC BY-SA.
                </li>
              </ul>
            </div>
          )}
          {(terrainOn || buildingsOn) && (
            <div className="legend-3d">
              <h4>About the 3D view</h4>
              <ul>
                {terrainOn && (
                  <li>
                    Relief comes from a public-domain elevation model at about 7 m per pixel, drawn with ×
                    {TERRAIN_EXAGGERATION} vertical exaggeration. It shows hills and slopes; it cannot show kerbs,
                    stairs, retaining walls or whether a slope is walkable.
                  </li>
                )}
                {buildingsOn && (
                  <li>
                    OpenStreetMap footprints: {BUILDINGS_COUNTS.withHeightTag} of {BUILDINGS_COUNTS.buildings} carry a
                    height tag, {BUILDINGS_COUNTS.withLevels} give storey counts and {BUILDINGS_COUNTS.guessed} are
                    estimated from footprint type. Extrusion is a visual aid, not a survey.
                  </li>
                )}
                <li>
                  Tilting, rotating and zooming change the camera only. No place's status, evidence or hours change with
                  the view.
                </li>
              </ul>
            </div>
          )}
          <p className="legend-foot">
            Counts are records installed in this release, not everything that exists. Colour is never the only cue:
            every marker also has a symbol, and every category is named.
          </p>
        </div>
      )}

      {incidentCard && (
        <IncidentCard
          feed={incidentCard.feed}
          properties={incidentCard.properties}
          coordinates={incidentCard.coordinates}
          onClose={() => setIncidentCard(null)}
        />
      )}

      <div className="map-legend-strip" aria-hidden="true">
        <span style={{ color: SWATCH.saved }}>●</span> saved
        <span style={{ color: SWATCH.observation }}>◆</span> notes
        <span className="legend-layers-note">
          {LAYERS.filter((l) => state.layers[l.id]).length} layers on
        </span>
      </div>
    </div>
  );
}

function CrosshairIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="6.5" />
      <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 3 8.5 4.8L12 12.6 3.5 7.8 12 3Z" />
      <path d="m4 11.6 8 4.6 8-4.6M4 15.4l8 4.6 8-4.6" />
    </svg>
  );
}

function CubeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.2 20 7.6v8.8L12 20.8 4 16.4V7.6Z" />
      <path d="M4 7.6 12 12l8-4.4M12 12v8.8" />
    </svg>
  );
}

function CompassIcon({ bearing }: { bearing: number }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `rotate(${-bearing}deg)` }}>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 18.4V5.6M8.8 8.8 12 5.6l3.2 3.2" />
    </svg>
  );
}

function LegendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h10M4 12h16M4 18h12" />
      <circle cx="18" cy="6" r="1.6" />
      <circle cx="18" cy="18" r="1.6" />
    </svg>
  );
}
