import { useEffect, useRef, useState } from 'react';
import maplibregl, { type Map as MapLibreMap, type MapGeoJSONFeature } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { buildStyle, EMPTY_FC } from './style';
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
import {
  ageInWords,
  INCIDENT_LAYER,
  INCIDENT_PULSE_LAYER,
  INCIDENT_SOURCE,
  cachedIncidentFeed,
  feedSummary,
  incidentCounts,
  loadIncidentFeed,
  type IncidentFeed,
  type IncidentFeature,
} from './incidents';
import { IncidentCard } from '../features/incidents/IncidentCard';
import { StreetLevelViewer } from './StreetLevelViewer';

interface MapViewProps {
  views: PlaceView[];
  onOpenLayers: () => void;
}

const MAP_PADDING = () => {
  const desktop = window.innerWidth >= 1000;
  return { top: 76, bottom: desktop ? 76 : 240, left: desktop ? 348 : 24, right: desktop ? 424 : 24 };
};

const TERRAIN_SOURCE_ID = 'terrain';
/** Terrain displacement uses the elevation model at its actual vertical scale. */
const TERRAIN_EXAGGERATION = 1.0;
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

export function MapView({ views, onOpenLayers }: MapViewProps) {
  const { state, actions } = useStore();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
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
  const [streetLevelOpen, setStreetLevelOpen] = useState(false);
  const [streetLevelCoordinates, setStreetLevelCoordinates] = useState<[number, number]>([-122.4085, 37.7835]);
  const locationMarker = useRef<maplibregl.Marker | null>(null);
  const selectedPlace = state.selectedPlaceId
    ? dataset.placeById.get(state.selectedPlaceId) ?? (state.selectedPlaceId.startsWith('private:')
        ? (() => {
            const observation = state.observations.find((item) => `private:${item.id}` === state.selectedPlaceId);
            if (!observation?.geometry) return null;
            const category = observation.type === 'passage_discovery' ? 'passage'
              : observation.type === 'popos_observation' ? 'popos'
                : observation.type === 'entrance_observation' || observation.type === 'stairs_ramp_observation' ? 'pedestrian_connection'
                  : observation.type === 'research_lead' ? 'research_lead' : 'urban_clue';
            return { id: state.selectedPlaceId, name: observation.placeName ?? 'Private field observation', category, geometry: observation.geometry } as { id: string; name: string; category: typeof CATEGORIES[number]['id']; geometry: { type: 'Point'; coordinates: [number, number] } };
          })()
        : null)
    : null;
  const selectedStop = state.selectedStopId
    ? dataset.data.transit.find((s) => s.id === state.selectedStopId)
    : null;

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

  // Layer visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const set = (ids: string[], visible: boolean) => {
      for (const id of ids) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    };
    const satelliteOn = Boolean(state.layers.satellite);
    set(['satellite-raster'], satelliteOn);
    set(['road-casing', 'roads', 'paths'], state.layers.streets);
    set(['street-labels'], state.layers['street-labels']);
    set(['green-fill', 'green-edge'], state.layers.parks && !satelliteOn);
    set(['water-fill', 'coastline'], !satelliteOn);
    set(['hood-labels'], state.layers.neighbourhoods);
    set(['rail-line'], state.layers['transit-lines']);
    set(['stops-dots', 'stops-labels'], state.layers['transit-stops']);
    set(['landmark-dots', 'landmark-labels'], state.layers.landmarks);
    set(['hillshade'], state.layers.terrain);
    set([BUILDINGS_LAYER_ID], state.layers['buildings-3d']);
    set(['places-symbol', 'cluster-halo', 'cluster-count'], state.layers.resources);
    set(['saved-rings'], state.layers.saved);
    set(['obs-symbol'], state.layers.observations);
    set([INCIDENT_PULSE_LAYER, INCIDENT_LAYER.calls], Boolean(state.layers['calls-recent']));
    set([INCIDENT_LAYER.cases311], Boolean(state.layers['cases-311']));
    set(['maintenance-requests'], Boolean(state.layers.maintenance || state.layers['cases-311']));

    if (map.getLayer('landmark-dots')) {
      map.setPaintProperty('landmark-dots', 'circle-opacity', state.layerOpacity.landmarks ?? 0.75);
      map.setPaintProperty('landmark-labels', 'text-opacity', state.layerOpacity.landmarks ?? 0.75);
    }
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

  // Reported activity: two published City snapshots, fetched only when their
  // layer is switched on. Nothing is requested behind the user's back.
  const callsOn = Boolean(state.layers['calls-recent']);
  const cases311On = Boolean(state.layers['cases-311']);
  const maintenanceOn = Boolean(state.layers.maintenance);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const wanted: IncidentFeed[] = [];
    if (callsOn) wanted.push('calls');
    if (cases311On || maintenanceOn) wanted.push('cases311');
    if (wanted.length === 0) {
      setIncidentIssue(null);
      setIncidentCard(null);
      return;
    }
    // A feed already in memory is drawn immediately, so toggling a layer off and
    // on again never flashes an empty map.
    for (const feed of wanted) {
      const held = cachedIncidentFeed(feed);
      if (held) {
        (map.getSource(INCIDENT_SOURCE[feed]) as maplibregl.GeoJSONSource | undefined)?.setData(
          held as unknown as GeoJSON.FeatureCollection,
        );
      }
    }
    let cancelled = false;
    const load = async () => {
      for (const feed of wanted) {
        if (cachedIncidentFeed(feed)) continue;
        try {
          const collection = await loadIncidentFeed(feed);
          if (cancelled) return;
          (map.getSource(INCIDENT_SOURCE[feed]) as maplibregl.GeoJSONSource | undefined)?.setData(
            collection as unknown as GeoJSON.FeatureCollection,
          );
        } catch (err) {
          if (!cancelled) {
            setIncidentIssue(
              `${feed === 'calls' ? 'Dispatched calls' : '311 cases'} unavailable offline — ${(err as Error).message}`,
            );
          }
        }
      }
      if (!cancelled) setIncidentCountsState(incidentCounts());
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [callsOn, cases311On, maintenanceOn, ready]);

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

  // Click handling
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const handleClick = (event: maplibregl.MapMouseEvent) => {
      if (state.route.picking) return; // handled by a dedicated listener below
      const incidentLayers = [INCIDENT_LAYER.calls, INCIDENT_LAYER.cases311, 'maintenance-requests'].filter((id) => map.getLayer(id));
      const hits = map.queryRenderedFeatures(event.point, {
        layers: ['places-symbol', 'stops-dots', 'landmark-dots', ...incidentLayers].filter((id) =>
          map.getLayer(id),
        ),
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
      const landmarkHit = hits.find((h) => h.layer.id === 'landmark-dots');
      const markerHit = placeHit ?? stopHit ?? landmarkHit ?? null;
      const incidentHit = nearestOf(incidentLayers);

      if (incidentHit && (!markerHit || distanceToTap(incidentHit) < distanceToTap(markerHit))) {
        const geometry = incidentHit.geometry as GeoJSON.Point;
        setIncidentCard({
          feed: incidentHit.layer.id === INCIDENT_LAYER.calls ? 'calls' : 'cases311',
          properties: incidentHit.properties as unknown as IncidentFeature['properties'],
          coordinates: [geometry.coordinates[0], geometry.coordinates[1]],
        });
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
      if (landmarkHit) {
        const match = dataset.data.places.find(
          (p) => p.category === 'history' && p.name === landmarkHit.properties?.name,
        );
        if (match) actions.selectPlace(match.id);
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
          'landmark-dots',
          'cluster-halo',
          INCIDENT_LAYER.calls,
          INCIDENT_LAYER.cases311,
          'maintenance-requests',
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
  }, [ready, state.route.picking, actions]);

  // Fly to a selected place and account for the panels.
  const lastFocus = useRef<string | null>(null);
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
  }, [state.userLocation, ready]);

  const recenter = () => {
    const map = mapRef.current;
    if (!map) return;
    const center = state.userLocation?.coordinates ?? [-122.4085, 37.7835];
    map.easeTo({ center, zoom: state.userLocation ? 16 : 14.1, padding: MAP_PADDING(), duration: 600 });
  };

  const stopCount = views.length;
  const is3d = camera.pitch > 4;

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
      '3D view on. Terrain relief is rendered at true vertical scale (×1); building heights come from OpenStreetMap tags where available and are estimated elsewhere.',
    );
  };

  const resetNorth = () => moveCamera({ pitch: 0, bearing: 0 });

  const openStreetLevel = () => {
    const centre = mapRef.current?.getCenter();
    if (centre) setStreetLevelCoordinates([centre.lng, centre.lat]);
    setStreetLevelOpen(true);
  };

  return (
    <div className="map-stage">
      <div ref={containerRef} className="map-canvas" role="application" aria-label="Night Map of central San Francisco" />

      {streetLevelOpen && (
        <StreetLevelViewer
          coordinates={streetLevelCoordinates}
          onClose={() => setStreetLevelOpen(false)}
        />
      )}

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
          <span className="map-scale-note is-alert" data-testid="calls-status">
            {incidentCountsState.calls > 0
              ? `${incidentCountsState.calls} dispatched calls · published snapshot, newest ${ageInWords(feedSummary('calls').newest)}`
              : (incidentIssue ?? 'Loading dispatched calls…')}
          </span>
        )}
        {cases311On && (
          <span className="map-scale-note" data-testid="cases311-status">
            {incidentCountsState.cases311 > 0
              ? `${incidentCountsState.cases311} 311 cases · published snapshot, newest ${ageInWords(feedSummary('cases311').newest)}`
              : (incidentIssue ?? 'Loading 311 cases…')}
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
      </div>

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
          className={`map-control ${state.layers.satellite ? 'is-active' : ''}`}
          onClick={() => actions.setLayer('satellite', !state.layers.satellite)}
          aria-pressed={Boolean(state.layers.satellite)}
          aria-label="Toggle satellite imagery"
          title="Toggle satellite / aerial imagery"
        >
          <SatelliteIcon />
        </button>
        <button
          type="button"
          className="map-control"
          onClick={openStreetLevel}
          aria-label="Street-level imagery"
          title="Find Mapillary street-level imagery near map centre"
        >
          <StreetViewIcon />
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
          className="map-control"
          onClick={() => void actions.useCurrentLocation()}
          aria-label="Use current location"
          title="Use current location"
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
        <div className="map-control-group">
          <button type="button" className="map-control" onClick={() => mapRef.current?.zoomIn()} aria-label="Zoom in">
            +
          </button>
          <button type="button" className="map-control" onClick={() => mapRef.current?.zoomOut()} aria-label="Zoom out">
            −
          </button>
        </div>
      </div>

      <button type="button" className="map-recenter" onClick={recenter}>
        <CrosshairIcon />
        <span>Recenter</span>
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
              <span className="legend-shape legend-stop" />
              <span>Muni stop</span>
            </li>
            <li>
              <span className="legend-shape legend-history" />
              <span>Historic feature</span>
            </li>
            {callsOn && (
              <li>
                <span className="legend-shape legend-call" />
                <span>Reported dispatched call</span>
              </li>
            )}
            {(cases311On || maintenanceOn) && (
              <li>
                <span className="legend-shape legend-311" />
                <span>Recent 311 request</span>
              </li>
            )}
            {maintenanceOn && (
              <li>
                <span className="legend-shape" style={{ background: '#A99AE8', borderRadius: '50%' }} />
                <span>Public-realm maintenance request</span>
              </li>
            )}
          </ul>
          {(callsOn || cases311On || maintenanceOn) && (
            <div className="legend-3d" data-testid="legend-incidents">
              <h4>About reported activity</h4>
              <ul>
                <li>
                  These are published City records, not a live feed. Dispatched calls come from the City’s
                  real-time CAD extract, which only publishes calls that have already closed, treats the City’s
                  withheld sensitive calls as absent, and places each record at an intersection or block rather
                  than a door.
                </li>
                <li>
                  311 cases come from the nightly service-request dataset and are often already resolved by the
                  time they are read here. The public-realm maintenance view filters exact service categories; a request
                  does not prove a defect, outage, ongoing condition or personal danger.
                </li>
                <li>
                  Categories that describe a person — encampments, welfare checks, medical and crisis calls, and
                  anything else about someone’s body, housing or state of mind — are removed before the file is
                  written, as are addresses, narratives and notes. Around 40 m of position is all that is kept.
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
                    Relief comes from a public-domain elevation model at about 7 m per pixel, rendered at ×
                    {TERRAIN_EXAGGERATION} vertical scale with no exaggeration. It shows broad hills and slopes; it cannot show kerbs,
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

function SatelliteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4h6v6H4zM14 14h6v6h-6zM10 7h4M17 10v4M7 10v4h7M10 17h4" />
      <path d="m3 15 4-4M17 7l4-4" />
    </svg>
  );
}

function StreetViewIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0M12 11.5v4M9.5 15.5h5" />
      <path d="M3 8.5h2M19 8.5h2" />
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
