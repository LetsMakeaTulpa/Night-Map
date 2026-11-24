import { useEffect, useRef, useState } from 'react';
import maplibregl, { type Map as MapLibreMap, type MapGeoJSONFeature } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { buildStyle, COVERAGE_BBOX, EMPTY_FC } from './style';
import { coverageInAperture, visibleAperture, type ApertureOverlay, type CoverageViewState } from './aperture';
import { nearestCoveredEdge, outsideCoverageInfo, pointInCoverage, type NearestCoveredEdgeInfo } from './coverage';
import { FIT_COVERAGE_EVENT, FIT_RECORDS_EVENT } from './viewport-actions';
import { buildMarkerImages, buildLocationDot } from './icons';
import { useStore } from '../state/store';
import { CATEGORIES, SWATCH } from '../domain/categories';
import { isFixFresh, MESSAGE_UNLOCK_RADIUS_M, messageMarkerState } from '../domain/messages';
import { formatDistance } from '../domain/geo';
import { formatDate } from '../domain/status';
import { dataset } from '../data';
import buildingRegistryMeta from '../data/building-registry-meta.json';
import { viewsInBounds, type PlaceView } from '../state/selectors';
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
import { StopCard } from '../features/transit/StopCard';
import { hasOvernightService } from '../data/transit-service';
import { useOnline } from '../features/ui';
import { cachedBuildingRegistry, loadBuildingRegistry } from '../data/building-registry';
import { buildingFilterLabel, buildingMatchesFilter } from '../domain/buildings';
import { cachedAbandonedBuildings, loadAbandonedBuildings } from '../data/abandoned-buildings';
import type { AbandonedBuildingFile, BuildingRegistry } from '../domain/types';

interface MapViewProps {
  views: PlaceView[];
  onOpenLayers: () => void;
}

export interface MapLiveCounts {
  calls: number;
  cases311: number;
  registry: number;
  abandoned: number;
}

type BasemapFailureCause = 'webgl' | 'style' | 'tiles' | 'offline';

interface BasemapFailure {
  cause: BasemapFailureCause;
  detail?: string;
}

type BasemapState = 'loading' | 'ready' | 'failed';

/** The one reason the map currently has no usable picture. */
type BlankMapState =
  | 'none'
  | 'loading'
  | 'outside'
  | 'covered'
  | 'empty-layers'
  | 'failed-tiles'
  | 'offline-tiles'
  | 'failed-style'
  | 'failed-webgl';

const BLANK_FAILURE_STATE: Record<BasemapFailureCause, BlankMapState> = {
  webgl: 'failed-webgl',
  style: 'failed-style',
  tiles: 'failed-tiles',
  offline: 'offline-tiles',
};

/**
 * A basemap that has not painted a road frame by now is treated as failed, not
 * as still loading. The overlay explains the cause instead of leaving a blank
 * map under an endless spinner, and Retry below rebuilds it.
 */
const BASEMAP_FAILURE_TIMEOUT_MS = 8_000;

/** The camera cannot zoom past the bundled street extract's useful range. */
const MAP_MIN_ZOOM = 11.4;
const MAP_MAX_ZOOM = 18.5;
const MAX_PITCH = 78;
const TILT_STEP = 10;
/** A tilted view only needs the boundary hint once it is this far out. */
const TILT_EDGE_PITCH = 15;
const TILT_EDGE_OVERSHOOT_M = 500;

interface CameraGoal {
  fromPitch: number;
  pitch: number;
  bearing: number;
  /** A tilt step asked for this angle, so the next step compounds on it. */
  step: boolean;
}

/** True while the camera still sits inside the sweep a camera goal asked for. */
function goalInFlight(goal: CameraGoal | null, livePitch: number): goal is CameraGoal {
  if (!goal) return false;
  return (
    livePitch >= Math.min(goal.fromPitch, goal.pitch) - 1 &&
    livePitch <= Math.max(goal.fromPitch, goal.pitch) + 1
  );
}

/**
 * Consecutive tilt steps compound on each other. Any other camera move — the 3D
 * preset, the compass, returning to coverage — starts the next step from the
 * angle the reader can actually see, so pressing Tilt up during a return to plan
 * view cannot snap the map back down to a shallow angle.
 */
function tiltBasePitch(livePitch: number, goal: CameraGoal | null): number {
  return goalInFlight(goal, livePitch) && goal.step ? goal.pitch : livePitch;
}

const SOURCE_RETRIEVED_DATES = [...new Set(dataset.data.sources.map((source) => source.retrievedAt))].sort();
const SOURCE_RETRIEVED_RANGE =
  SOURCE_RETRIEVED_DATES.length > 1
    ? `${formatDate(SOURCE_RETRIEVED_DATES[0])} – ${formatDate(SOURCE_RETRIEVED_DATES[SOURCE_RETRIEVED_DATES.length - 1])}`
    : formatDate(SOURCE_RETRIEVED_DATES[0]);

const BASEMAP_FAILURE_COPY: Record<BasemapFailureCause, { title: string; body: string }> = {
  offline: {
    title: 'Street map not cached',
    body: 'You are offline and the street tiles for this view are not stored on this device yet. This is a connection failure, not the edge of Night Map coverage.',
  },
  tiles: {
    title: 'Street tiles did not load',
    body: 'The basemap tiles could not be fetched, so the street grid is missing. This is a tile load failure, not the edge of Night Map coverage.',
  },
  style: {
    title: 'Map style did not load',
    body: 'The map style could not be read, so no streets can be drawn. This is a style failure, not the edge of Night Map coverage.',
  },
  webgl: {
    title: 'The map renderer could not start',
    body: 'This browser could not start the WebGL map canvas. This is a rendering failure, not the edge of Night Map coverage.',
  },
};

const MAP_PADDING = () => {
  const desktop = window.innerWidth >= 1000;
  return { top: 76, bottom: desktop ? 76 : 240, left: desktop ? 348 : 24, right: desktop ? 424 : 24 };
};

const TERRAIN_SOURCE_ID = 'terrain';
const COARSE_TERRAIN_SOURCE_ID = 'terrainCoarse';
/** Terrain displacement uses the elevation model at its actual vertical scale. */
const TERRAIN_EXAGGERATION = 1.0;
const PITCH_3D = 55;
const SHADE_LAYER_ID = 'hillshade';
const COARSE_SHADE_LAYER_ID = 'hillshade-coarse';
/**
 * Past this pitch the visible ground spans kilometres, so both the terrain mesh
 * and the hillshade read the coarse DEM (z13): a handful of tiles instead of
 * four times as many fine ones.
 */
const COARSE_DEM_PITCH = 50;
/** How often a followed camera re-checks that it is still centred on the fix. */
const GPS_SNAP_INTERVAL_MS = 4_000;
/** Below this the camera is treated as already centred, so it does not twitch. */
const GPS_SNAP_MIN_MOVE_M = 3;

/**
 * Surfaces that sit above the canvas and hide map rather than merely decorate
 * it. Each is pinned to the edge it grows from, so its inset takes area off
 * that edge only.
 */
const COVERAGE_OCCLUDERS: ReadonlyArray<{ selector: string; edge: ApertureOverlay['edge'] }> = [
  { selector: '.side-rail', edge: 'left' },
  { selector: '.panel-left', edge: 'left' },
  { selector: '.panel-right', edge: 'right' },
  { selector: '.bottom-bar', edge: 'bottom' },
  { selector: '.mobile-top', edge: 'top' },
  { selector: '.sheet', edge: 'bottom' },
  { selector: '.mobile-nav', edge: 'bottom' },
];

/** Layers that can paint above the always-present land and water fill. */
const MAP_CONTENT_LAYER_IDS = [
  'streets',
  'street-labels',
  'parks',
  'neighbourhoods',
  'satellite',
  'terrain',
  'buildings-3d',
  'transit-lines',
  'transit-stops',
  'resources',
  'saved',
  'observations',
  'private-messages',
  'calls-recent',
  'maintenance',
  'cases-311',
  'abandoned-buildings',
  'building-registry',
  'landmarks',
] as const;

/** Pixel distance from a tap to a line segment in the projected map. */
function distanceToSegment(
  point: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

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
  const overviewContainerRef = useRef<HTMLDivElement | null>(null);
  const overviewMapRef = useRef<MapLibreMap | null>(null);
  const coveragePanelRef = useRef<HTMLElement | null>(null);
  const coveragePanelContainerRef = useRef<HTMLDivElement | null>(null);
  const coveragePanelMapRef = useRef<MapLibreMap | null>(null);
  /** The Details control that opened the panel, so focus can return to it. */
  const coverageDetailsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const coveragePanelWasOpen = useRef(false);
  const online = useOnline();
  const [ready, setReady] = useState(false);
  // Distinguishes "the style parsed" from "there is a street grid to look at."
  // The overlay stays up until the roads source is loaded and a road frame has
  // actually painted, not merely until the source reports loaded.
  const [basemapReady, setBasemapReady] = useState(false);
  const basemapReadyRef = useRef(false);
  const [basemapFailure, setBasemapFailure] = useState<BasemapFailure | null>(null);
  const [mapAttempt, setMapAttempt] = useState(0);
  const [coverageView, setCoverageView] = useState<CoverageViewState>('inside');
  const [nearestEdge, setNearestEdge] = useState<NearestCoveredEdgeInfo | null>(null);
  /** How far the furthest visible corner reaches beyond the extract, in metres. */
  const [tiltOvershoot, setTiltOvershoot] = useState(0);
  /** The view includes sky, so its top corners no longer describe the ground. */
  const [skyVisible, setSkyVisible] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [legendOpen, setLegendOpen] = useState(false);
  const [coveragePanelOpen, setCoveragePanelOpen] = useState(false);
  const [camera, setCamera] = useState({ pitch: 0, bearing: 0 });
  const [buildingsState, setBuildingsState] = useState({ loaded: 0, failed: 0 });
  const [registryState, setRegistryState] = useState<{ loaded: number; error: string | null }>({ loaded: 0, error: null });
  const [abandonedState, setAbandonedState] = useState<{ loaded: number; error: string | null }>({ loaded: 0, error: null });
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
  const gpsFollowStarted = useRef(false);
  /** The last camera whose visible aperture still contained mapped ground. */
  const lastCoveredCamera = useRef<{
    center: [number, number];
    zoom: number;
    bearing: number;
    pitch: number;
    padding: ReturnType<MapLibreMap['getPadding']>;
  } | null>(null);
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
        // Start at pedestrian scale: streets and building footprints are the
        // primary navigation surface, not a neighbourhood overview.
        zoom: 16.2,
        minZoom: MAP_MIN_ZOOM,
        maxZoom: MAP_MAX_ZOOM,
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
        maxPitch: MAX_PITCH,
        antialias: true,
        // Retina phones at 3× render four times the pixels of a 1× canvas. A 2×
        // backing store keeps labels sharp while cutting fill-rate on first paint.
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        fadeDuration: 0,
      });
    } catch (err) {
      setBasemapFailure({ cause: 'webgl', detail: (err as Error).message });
      return;
    }
    mapRef.current = map;
    let styleLoaded = false;
    let failed = false;
    let failureTimer = 0;
    let coverageFrame = 0;
    const stopFailureTimer = () => {
      if (failureTimer) window.clearTimeout(failureTimer);
      failureTimer = 0;
    };
    const failBasemap = (cause: BasemapFailureCause, detail?: string) => {
      if (failed || mapRef.current !== map) return;
      failed = true;
      stopFailureTimer();
      basemapReadyRef.current = false;
      setBasemapReady(false);
      setBasemapFailure({ cause, detail });
    };
    const diagnoseFailure = () => {
      failureTimer = 0;
      if (basemapReadyRef.current || failed) return;
      if (!navigator.onLine) failBasemap('offline');
      else if (!styleLoaded) failBasemap('style');
      else failBasemap('tiles');
    };
    // `isSourceLoaded` can turn true after every tile request has failed, so the
    // basemap only counts as ready once a road line has actually painted.
    const roadsArePainted = () => {
      try {
        return Boolean(map.getLayer('roads')) && map.queryRenderedFeatures({ layers: ['roads'] }).length > 0;
      } catch {
        return false;
      }
    };
    const markBasemapReady = () => {
      if (basemapReadyRef.current || mapRef.current !== map) return;
      if (!styleLoaded || !roadsArePainted()) return;
      basemapReadyRef.current = true;
      failed = false;
      stopFailureTimer();
      setBasemapFailure(null);
      setBasemapReady(true);
    };
    failureTimer = window.setTimeout(diagnoseFailure, BASEMAP_FAILURE_TIMEOUT_MS);
    const updateCoverage = () => {
      coverageFrame = 0;
      if (mapRef.current !== map) return;
      // Filters still need a camera view to count records in, even when a
      // panel hides every pixel of the map. The full canvas is the fallback;
      // the layout notice, not the boundary, explains the hidden map.
      const setViewportFromCanvas = () => {
        const bounds = map.getBounds();
        actions.setViewportBounds([
          bounds.getWest(),
          bounds.getSouth(),
          bounds.getEast(),
          bounds.getNorth(),
        ]);
      };
      // The notice is for a viewport with no mapped ground in it. `getBounds()`
      // includes the canvas behind the workspace panel, the inspector and the
      // phone dock, so measure the aperture a reader can actually see first:
      // coverage that only exists under a panel must not silence the notice.
      const canvas = map.getContainer().getBoundingClientRect();
      const overlays: ApertureOverlay[] = [];
      for (const { selector, edge } of COVERAGE_OCCLUDERS) {
        for (const element of document.querySelectorAll<HTMLElement>(selector)) {
          overlays.push({ box: element.getBoundingClientRect(), edge });
        }
      }
      const mapCentre = map.getCenter();
      setNearestEdge(nearestCoveredEdge([mapCentre.lng, mapCentre.lat], COVERAGE_BBOX));
      const measurement = visibleAperture(canvas, overlays);
      if (measurement.fullyHidden) {
        // A panel or the phone sheet left no visible map. Sampling the hidden
        // canvas used to report "outside coverage" even though the camera had
        // not moved, so keep the last covered view and let the layout notice
        // explain what happened.
        setViewportFromCanvas();
        setCoverageView('hidden');
        setTiltOvershoot(0);
        setSkyVisible(false);
        return;
      }
      if (!measurement.aperture) return;
      const aperture = measurement.aperture;
      const points: Array<[number, number]> = [
        [aperture.left, aperture.top],
        [aperture.right, aperture.top],
        [aperture.right, aperture.bottom],
        [aperture.left, aperture.bottom],
      ];
      const corners = points.map((point) => {
        const position = map.unproject(point);
        return [position.lng, position.lat] as const;
      });
      const view = coverageInAperture(corners, COVERAGE_BBOX);
      // A camera pitched far enough to include sky cannot place its top
      // corners: unprojection mirrors them behind the camera and the quad
      // flips. The map's horizon-aware bounds still describe the ground on
      // screen, so the tilt hint measures against those instead of the quad.
      const bearingRad = (map.getBearing() * Math.PI) / 180;
      const topMidLng = (corners[0][0] + corners[1][0]) / 2;
      const topMidLat = (corners[0][1] + corners[1][1]) / 2;
      const bottomMidLng = (corners[3][0] + corners[2][0]) / 2;
      const bottomMidLat = (corners[3][1] + corners[2][1]) / 2;
      const showsSky =
        (topMidLng - bottomMidLng) * Math.sin(bearingRad) +
          (topMidLat - bottomMidLat) * Math.cos(bearingRad) <
        0;
      const mapBounds = map.getBounds();
      const reach: ReadonlyArray<readonly [number, number]> = showsSky
        ? [
            [mapBounds.getWest(), mapBounds.getSouth()],
            [mapBounds.getEast(), mapBounds.getSouth()],
            [mapBounds.getEast(), mapBounds.getNorth()],
            [mapBounds.getWest(), mapBounds.getNorth()],
          ]
        : corners;
      // The far edge of a tilted view is where the boundary stops mattering, so
      // measure the furthest visible corner past the extract.
      const overshoot = reach.reduce((furthest, corner) => {
        const outside = outsideCoverageInfo(corner, COVERAGE_BBOX);
        return outside ? Math.max(furthest, outside.distanceMeters) : furthest;
      }, 0);
      // Rounded so the readout is stable across small pans.
      setTiltOvershoot(Math.round(overshoot / 100) * 100);
      setSkyVisible(showsSky);
      // A blank visible aperture is not proof that the camera left the data
      // area. When panels cover the only mapped ground, the full canvas still
      // contains coverage, so this is a layout state rather than the boundary.
      const canvasCorners = (
        [
          [0, 0],
          [canvas.width, 0],
          [canvas.width, canvas.height],
          [0, canvas.height],
        ] as Array<[number, number]>
      ).map((point) => {
        const position = map.unproject(point);
        return [position.lng, position.lat] as const;
      });
      if (view === 'outside' && coverageInAperture(canvasCorners, COVERAGE_BBOX) !== 'outside') {
        setViewportFromCanvas();
        setCoverageView('hidden');
        setTiltOvershoot(0);
        setSkyVisible(false);
        return;
      }
      const lngs = corners.map((corner) => corner[0]);
      const lats = corners.map((corner) => corner[1]);
      actions.setViewportBounds([
        Math.min(...lngs),
        Math.min(...lats),
        Math.max(...lngs),
        Math.max(...lats),
      ]);
      // A tilted camera that reaches far past the boundary is the view the
      // reader wants to leave, so it must not become its own recovery target.
      const tiltReachesBeyond =
        map.getPitch() >= TILT_EDGE_PITCH && overshoot >= TILT_EDGE_OVERSHOOT_M;
      if ((view === 'inside' || view === 'partial') && !tiltReachesBeyond && basemapReadyRef.current) {
        // Keep the view that still had mapped ground in it. Return should put
        // the reader back where they left off, not fit the whole extract.
        const centre = map.getCenter();
        lastCoveredCamera.current = {
          center: [centre.lng, centre.lat],
          zoom: map.getZoom(),
          bearing: map.getBearing(),
          pitch: map.getPitch(),
          padding: map.getPadding(),
        };
      }
      setCoverageView(view);
    };
    const scheduleCoverage = () => {
      if (coverageFrame) return;
      coverageFrame = window.requestAnimationFrame(updateCoverage);
    };
    map.on('moveend', scheduleCoverage);
    map.on('resize', scheduleCoverage);
    // Panels open and close, and the phone sheet resizes, without moving the
    // camera. Re-measure the aperture when the layout changes as well.
    const layoutChanges = new MutationObserver(scheduleCoverage);
    const app = map.getContainer().closest('.app');
    if (app) {
      layoutChanges.observe(app, { attributes: true, attributeFilter: ['class', 'style'], subtree: true });
    }
    const layoutResizes = new ResizeObserver(scheduleCoverage);
    layoutResizes.observe(map.getContainer());
    updateCoverage();
    // Development hooks are also exposed to an automated browser so the
    // Playwright suite can exercise the built production preview with the same
    // renderer. Ordinary visitors never receive this handle.
    if (import.meta.env.DEV || navigator.webdriver) {
      (window as unknown as { __nightmap?: MapLibreMap }).__nightmap = map;
    }
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
      styleLoaded = true;
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
        failBasemap('style', (err as Error).message);
      }
    };
    map.on('style.load', setup);
    map.on('load', setup);
    map.once('idle', setup);

    map.on('error', (event) => {
      const message = (event.error as Error | undefined)?.message ?? 'Map failed to render';
      const sourceId = (event as { sourceId?: string }).sourceId;
      console.info('[night-map] map event error', message, sourceId ?? '');
      // Glyph and satellite errors are noisy but not fatal. A WebGL context
      // problem is: the canvas can no longer draw anything.
      if (/webgl|context/i.test(message)) failBasemap('webgl', message);
      // Elevation tiles are fetched on demand, so the first offline attempt can
      // legitimately fail. Say so instead of showing a flat map as if it were real.
      if (sourceId === TERRAIN_SOURCE_ID) setTerrainTilesMissing(true);
      console.warn('[night-map] map error', message);
    });
    map.on('sourcedata', (event) => {
      const detail = event as { sourceId?: string; isSourceLoaded?: boolean };
      if (detail.sourceId === 'roads' && detail.isSourceLoaded) {
        if (!basemapReadyRef.current) {
          // A source-loaded event can arrive before the first frame that contains
          // the new line geometry. Hold the opaque loading layer until MapLibre
          // has actually painted road lines, so neither a half-drawn grid nor a
          // failed tile range is mistaken for a ready basemap.
          map.triggerRepaint();
          map.once('render', markBasemapReady);
        }
      }
      if (detail.sourceId === TERRAIN_SOURCE_ID && detail.isSourceLoaded) setTerrainTilesMissing(false);
      if (detail.sourceId === BUILDINGS_SOURCE_ID && detail.isSourceLoaded) setTerrainTilesMissing(false);
    });
    map.on('idle', markBasemapReady);

    return () => {
      map.off('moveend', scheduleCoverage);
      map.off('resize', scheduleCoverage);
      layoutChanges.disconnect();
      layoutResizes.disconnect();
      if (coverageFrame) window.cancelAnimationFrame(coverageFrame);
      stopFailureTimer();
      map.off('idle', markBasemapReady);
      map.remove();
      mapRef.current = null;
    };
  }, [mapAttempt]);


  // Small orientation map: a separate, lightweight basemap that also shows the
  // installed extract, so blank main-map ground reads as "beyond the boundary"
  // rather than "failed tiles". Clicking it recentres the primary map.
  useEffect(() => {
    const main = mapRef.current;
    const container = overviewContainerRef.current;
    if (!ready || !basemapReady || !main || !container || overviewMapRef.current) return;

    const [coverWest, coverSouth, coverEast, coverNorth] = COVERAGE_BBOX;
    const footprintRing: Array<[number, number]> = [
      [coverWest, coverSouth],
      [coverEast, coverSouth],
      [coverEast, coverNorth],
      [coverWest, coverNorth],
      [coverWest, coverSouth],
    ];
    // A world-sized fill with the extract cut out dims every area the main map
    // cannot draw. The hole winds opposite the exterior so the fill renders.
    const outsideRing: Array<[number, number]> = [
      [-180, -85],
      [180, -85],
      [180, 85],
      [-180, 85],
      [-180, -85],
    ];

    let active = true;
    const overview = new maplibregl.Map({
      container,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: main.getCenter(),
      zoom: 10.7,
      minZoom: 9,
      maxZoom: 12.5,
      attributionControl: false,
      interactive: true,
      scrollZoom: false,
      boxZoom: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      keyboard: false,
      doubleClickZoom: false,
    });
    overviewMapRef.current = overview;
    if (import.meta.env.DEV || navigator.webdriver) {
      (window as unknown as { __nightmapOverview?: MapLibreMap }).__nightmapOverview = overview;
    }

    const syncExtent = () => {
      if (!active || !overview.isStyleLoaded()) return;
      const source = overview.getSource('main-map-extent') as maplibregl.GeoJSONSource | undefined;
      if (!source) return;
      const bounds = main.getBounds();
      const west = bounds.getWest();
      const east = bounds.getEast();
      const south = bounds.getSouth();
      const north = bounds.getNorth();
      source.setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [west, south], [east, south], [east, north], [west, north], [west, south],
            ]],
          },
        }],
      });
      overview.setCenter(main.getCenter());
    };

    overview.once('load', () => {
      if (!active) return;
      overview.addSource('coverage-mask', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [outsideRing, footprintRing] },
        },
      });
      overview.addSource('coverage-footprint', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [footprintRing] },
        },
      });
      overview.addSource('main-map-extent', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      // Paint order: dim outside, mark the extract, then the live viewport on
      // top so the current view is never hidden by the boundary treatment.
      overview.addLayer({
        id: 'coverage-outside-dim',
        type: 'fill',
        source: 'coverage-mask',
        paint: { 'fill-color': '#050806', 'fill-opacity': 0.62, 'fill-antialias': false },
      });
      overview.addLayer({
        id: 'coverage-footprint-fill',
        type: 'fill',
        source: 'coverage-footprint',
        paint: { 'fill-color': '#E0A458', 'fill-opacity': 0.1 },
      });
      overview.addLayer({
        id: 'coverage-footprint-line',
        type: 'line',
        source: 'coverage-footprint',
        paint: { 'line-color': '#F0C674', 'line-width': 1.5, 'line-dasharray': [3, 2] },
      });
      overview.addLayer({
        id: 'main-map-extent-fill',
        type: 'fill',
        source: 'main-map-extent',
        paint: { 'fill-color': '#F2EDE2', 'fill-opacity': 0.12 },
      });
      overview.addLayer({
        id: 'main-map-extent-line',
        type: 'line',
        source: 'main-map-extent',
        paint: { 'line-color': '#F2EDE2', 'line-width': 1.8 },
      });
      syncExtent();
    });

    const onMiniMapClick = (event: maplibregl.MapMouseEvent) => {
      main.easeTo({
        center: [event.lngLat.lng, event.lngLat.lat],
        zoom: Math.max(14, main.getZoom()),
        duration: 450,
      });
    };
    const onEnter = () => { overview.getCanvas().style.cursor = 'crosshair'; };
    const onLeave = () => { overview.getCanvas().style.cursor = ''; };

    // The overview is a second WebGL map. Re-centring it during a pan makes the
    // main map fight another GL context for every frame, so the extent catches
    // up once the camera settles instead of chasing it.
    main.on('moveend', syncExtent);
    overview.on('click', onMiniMapClick);
    overview.on('mouseenter', onEnter);
    overview.on('mouseleave', onLeave);

    return () => {
      active = false;
      main.off('moveend', syncExtent);
      overview.off('click', onMiniMapClick);
      overview.off('mouseenter', onEnter);
      overview.off('mouseleave', onLeave);
      overview.remove();
      overviewMapRef.current = null;
      const testWindow = window as unknown as { __nightmapOverview?: MapLibreMap };
      if (testWindow.__nightmapOverview === overview) delete testWindow.__nightmapOverview;
    };
  }, [ready, basemapReady]);

  // A compact orientation map for the coverage panel. It is built only while
  // the panel is open, so the third WebGL context is not paid for by readers
  // who never ask what the boundary means.
  useEffect(() => {
    if (!coveragePanelOpen) return;
    const container = coveragePanelContainerRef.current;
    const main = mapRef.current;
    if (!container || !main) return;
    const [west, south, east, north] = COVERAGE_BBOX;
    let mini: MapLibreMap;
    try {
      mini = new maplibregl.Map({
        container,
        style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
        bounds: [
          [west - 0.012, south - 0.008],
          [east + 0.012, north + 0.008],
        ],
        fitBoundsOptions: { padding: 8 },
        attributionControl: false,
        interactive: false,
        fadeDuration: 0,
        pixelRatio: 1,
      });
    } catch {
      return;
    }
    coveragePanelMapRef.current = mini;
    let active = true;
    mini.once('load', () => {
      if (!active) return;
      const view = main.getBounds();
      mini.addSource('coverage-extract', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'Polygon',
                coordinates: [[
                  [west, south], [east, south], [east, north], [west, north], [west, south],
                ]],
              },
            },
          ],
        },
      });
      mini.addLayer({
        id: 'coverage-extract-fill',
        type: 'fill',
        source: 'coverage-extract',
        paint: { 'fill-color': '#E0A458', 'fill-opacity': 0.14 },
      });
      mini.addLayer({
        id: 'coverage-extract-line',
        type: 'line',
        source: 'coverage-extract',
        paint: { 'line-color': '#F0C674', 'line-width': 1.8, 'line-dasharray': [4, 2] },
      });
      mini.addSource('coverage-view', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'Polygon',
                coordinates: [[
                  [view.getWest(), view.getSouth()],
                  [view.getEast(), view.getSouth()],
                  [view.getEast(), view.getNorth()],
                  [view.getWest(), view.getNorth()],
                  [view.getWest(), view.getSouth()],
                ]],
              },
            },
          ],
        },
      });
      mini.addLayer({
        id: 'coverage-view-line',
        type: 'line',
        source: 'coverage-view',
        paint: { 'line-color': '#E9E5DC', 'line-width': 1.2, 'line-opacity': 0.8 },
      });
    });
    return () => {
      active = false;
      coveragePanelMapRef.current = null;
      mini.remove();
    };
  }, [coveragePanelOpen]);

  // Escape closes the coverage panel like the other map overlays.
  useEffect(() => {
    if (!coveragePanelOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCoveragePanelOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [coveragePanelOpen]);

  // Details opens a dialog: move focus into it so the panel is not left after
  // the trigger in the tab order. Closing returns focus to that trigger. A
  // boundary tap has no Details trigger, so it keeps the canvas focus it had.
  useEffect(() => {
    if (coveragePanelOpen) {
      coveragePanelWasOpen.current = true;
      if (coverageDetailsTriggerRef.current) coveragePanelRef.current?.focus();
      return;
    }
    if (!coveragePanelWasOpen.current) return;
    coveragePanelWasOpen.current = false;
    const trigger = coverageDetailsTriggerRef.current;
    coverageDetailsTriggerRef.current = null;
    if (trigger?.isConnected) trigger.focus();
  }, [coveragePanelOpen]);

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
    // The Still running view narrows the stop layer to stops with a scheduled
    // departure inside the 22:00–05:00 window. The source keeps every stop's
    // geometry; only the rendered set changes, and nothing is hidden silently:
    // the chip's count says how many stops are showing.
    const visibleStops = state.filters.overnightStops
      ? dataset.data.transit.filter((stop) => hasOvernightService(stop.id))
      : dataset.data.transit;
    fc?.setData({
      type: 'FeatureCollection',
      features: visibleStops.map((stop) => ({
        type: 'Feature' as const,
        properties: { id: stop.id, name: stop.name },
        geometry: stop.geometry,
      })),
    });
  }, [ready, state.filters.overnightStops]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource('observations') as maplibregl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: state.observations
        .filter((o) => o.geometry)
        .map((o) => {
          const message = o.kind === 'message' ? messageMarkerState(o, state.userLocation, clock) : null;
          return {
            type: 'Feature' as const,
            properties: {
              id: o.id,
              type: o.type,
              kind: o.kind ?? 'fieldnote',
              state: message?.state ?? null,
              distanceM: message?.distanceM ?? null,
            },
            geometry: o.geometry!,
          };
        }),
    });
  }, [state.observations, state.userLocation, clock, ready]);

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
              properties: {
                label: state.selectedExternal.label,
                note: state.selectedExternal.note ?? '',
              },
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
    // The label pass is deliberately held back until the road grid has painted:
    // its glyph layout is the most expensive part of first render, and it must
    // never keep the street network behind a loading screen.
    set(['street-labels'], state.layers['street-labels'] && basemapReady);
    set(['green-fill', 'green-edge'], state.layers.parks && !satelliteOn);
    set(['water-fill', 'bay-shelf', 'bay-shallow', 'coast-glow', 'coastline'], !satelliteOn);
    // Symbol/label passes are held until the roads are painted. Glyph shaping
    // and collision are the most expensive part of a first frame on a slow
    // phone; circles and lines can appear immediately without holding the grid.
    set(['hood-labels'], state.layers.neighbourhoods && basemapReady);
    set(['rail-line'], state.layers['transit-lines']);
    set(['stops-dots'], state.layers['transit-stops']);
    set(['stops-labels'], state.layers['transit-stops'] && basemapReady);
    set(['landmark-dots'], state.layers.landmarks);
    set(['landmark-labels'], state.layers.landmarks && basemapReady);
    // Shading is the pitch-dependent part of the DEM budget. Swapping layers
    // (rather than sources) is the public MapLibre route, and only the visible
    // layer's tiles are requested.
    const syncShading = () => {
      const coarse = map.getPitch() >= COARSE_DEM_PITCH;
      set([SHADE_LAYER_ID], state.layers.terrain && !coarse);
      set([COARSE_SHADE_LAYER_ID], state.layers.terrain && coarse);
    };
    syncShading();
    map.on('moveend', syncShading);
    map.on('pitchend', syncShading);
    set([BUILDINGS_LAYER_ID], state.layers['buildings-3d']);
    set(['cluster-halo'], state.layers.resources);
    set(['places-symbol', 'cluster-count'], state.layers.resources && basemapReady);
    set(['saved-rings'], state.layers.saved);
    set(['obs-symbol'], state.layers.observations);
    set(['msg-halo', 'msg-dot'], state.layers['private-messages']);
    set([INCIDENT_PULSE_LAYER, INCIDENT_LAYER.calls], Boolean(state.layers['calls-recent']));
    set([INCIDENT_LAYER.cases311], Boolean(state.layers['cases-311']));
    set(['maintenance-requests'], Boolean(state.layers.maintenance || state.layers['cases-311']));
    set(['building-registry-dots', 'building-registry-labels'], Boolean(state.layers['building-registry']));
    set(['abandoned-glow', 'abandoned-ring'], Boolean(state.layers['abandoned-buildings']));

    if (map.getLayer('landmark-dots')) {
      map.setPaintProperty('landmark-dots', 'circle-opacity', state.layerOpacity.landmarks ?? 0.75);
      map.setPaintProperty('landmark-labels', 'text-opacity', state.layerOpacity.landmarks ?? 0.75);
    }
    for (const layer of [SHADE_LAYER_ID, COARSE_SHADE_LAYER_ID]) {
      if (map.getLayer(layer)) {
        map.setPaintProperty(layer, 'hillshade-exaggeration', state.layerOpacity.terrain ?? 0.32);
      }
    }

    // Street names are the most expensive part of a redraw: every frame the
    // label engine re-runs collision against hundreds of candidates. They are
    // static while the camera is being dragged, so skip that work and restore
    // them as soon as the gesture ends.
    const hideStreetLabels = () => {
      if (state.layers['street-labels'] && map.getLayer('street-labels')) {
        map.setLayoutProperty('street-labels', 'visibility', 'none');
      }
    };
    const restoreStreetLabels = () => {
      if (map.getLayer('street-labels')) {
        map.setLayoutProperty(
          'street-labels',
          'visibility',
          state.layers['street-labels'] ? 'visible' : 'none',
        );
      }
    };
    map.on('dragstart', hideStreetLabels);
    map.on('dragend', restoreStreetLabels);

    return () => {
      map.off('dragstart', hideStreetLabels);
      map.off('dragend', restoreStreetLabels);
      map.off('moveend', syncShading);
      map.off('pitchend', syncShading);
    };
  }, [state.layers, state.layerOpacity, ready, basemapReady]);

  // The outside mask and the repeated boundary label explain a partial view.
  // They are switched together with the coverage view rather than with the
  // ordinary layer drawer, because they describe where the map ends.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const maskVisible = basemapReady && coverageView === 'partial';
    const labelsVisible = basemapReady && (coverageView === 'partial' || coverageView === 'outside');
    if (map.getLayer('outside-mask')) {
      map.setLayoutProperty('outside-mask', 'visibility', maskVisible ? 'visible' : 'none');
    }
    if (map.getLayer('coverage-edge-label')) {
      map.setLayoutProperty('coverage-edge-label', 'visibility', labelsVisible ? 'visible' : 'none');
    }
  }, [coverageView, basemapReady, ready]);

  // Building registry points. The full registry is fetched only when the layer
  // is switched on, then kept in memory and by the service worker.
  const registryOn = Boolean(state.layers['building-registry']);
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
    const apply = (registry: BuildingRegistry) => {
      if (cancelled) return;
      const features = registry.dossiers
        .filter((dossier) => dossier.coordinates && buildingMatchesFilter(dossier.status, state.buildingFilter))
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
  }, [registryOn, ready, state.buildingFilter]);

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

  // Saved views record the camera, so the map reports where it settled after
  // every move. The store ignores repeats, so this does not churn on pans that
  // end where they started.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const sync = () => {
      const centre = map.getCenter();
      actions.setViewportCamera({
        center: [centre.lng, centre.lat],
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing(),
      });
    };
    sync();
    map.on('moveend', sync);
    return () => {
      map.off('moveend', sync);
    };
    // The action only writes through setState; re-binding on every store change
    // would add and remove a listener on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Terrain is a real displacement of the map surface, so it is switched on
  // explicitly and switched off completely — never left half-applied. The mesh
  // reads the fine DEM on a level camera and the coarse one once the ground on
  // screen spans kilometres, so a tilted view costs a handful of tiles.
  const terrainOn = Boolean(state.layers.terrain);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const sync = () => {
      const active = map.getTerrain();
      if (!terrainOn) {
        if (active) map.setTerrain(null);
        return;
      }
      const wantedSource =
        map.getPitch() >= COARSE_DEM_PITCH ? COARSE_TERRAIN_SOURCE_ID : TERRAIN_SOURCE_ID;
      if (active?.source !== wantedSource) {
        map.setTerrain({ source: wantedSource, exaggeration: TERRAIN_EXAGGERATION });
      }
    };
    sync();
    map.on('moveend', sync);
    map.on('pitchend', sync);
    return () => {
      map.off('moveend', sync);
      map.off('pitchend', sync);
    };
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
      // The amber boundary is a thin line, and renderer feature queries can be
      // empty while a freshly moved camera is still settling. Measure the tap
      // against the projected boundary instead: the whole edge, including its
      // glow and repeated label, becomes a usable target at any bearing or tilt.
      const [coverageWest, coverageSouth, coverageEast, coverageNorth] = COVERAGE_BBOX;
      const boundaryCorners = [
        map.project([coverageWest, coverageSouth]),
        map.project([coverageEast, coverageSouth]),
        map.project([coverageEast, coverageNorth]),
        map.project([coverageWest, coverageNorth]),
      ];
      const boundaryHit = boundaryCorners.some(
        (corner, index) =>
          distanceToSegment(event.point, corner, boundaryCorners[(index + 1) % boundaryCorners.length]) <= 10,
      );
      const incidentLayers = [INCIDENT_LAYER.calls, INCIDENT_LAYER.cases311, 'maintenance-requests'].filter((id) => map.getLayer(id));
      const hits = map.queryRenderedFeatures(event.point, {
        layers: ['places-symbol', 'stops-dots', 'landmark-dots', 'building-registry-dots', 'msg-halo', 'msg-dot', ...incidentLayers].filter((id) =>
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
      const buildingHit = hits.find((h) => h.layer.id === 'building-registry-dots');
      const messageHit = nearestOf(['msg-halo', 'msg-dot']);
      const markerHit = placeHit ?? stopHit ?? landmarkHit ?? buildingHit ?? messageHit ?? null;
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
      if (messageHit) {
        const id = String(messageHit.properties?.id ?? '');
        const message = state.observations.find((entry) => entry.id === id);
        if (!message) return;
        const marker = messageMarkerState(message, state.userLocation, clock);
        if (marker.state === 'nearby') {
          actions.selectObservation(id);
        } else if (marker.reason === 'too_far' && marker.distanceM !== null) {
          actions.notify(
            `Private message locked · ${formatDistance(marker.distanceM, state.settings.units)} away. Move within ${MESSAGE_UNLOCK_RADIUS_M} m and refresh GPS to read it.`,
            'warn',
          );
        } else {
          actions.notify(
            'Private message locked. Turn on GPS lock and get a fresh, accurate fix to read it.',
            'warn',
          );
        }
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
      if (buildingHit) {
        const id = String(buildingHit.properties?.id ?? '');
        if (id) actions.selectBuilding(id);
        return;
      }
      if (boundaryHit) {
        coverageDetailsTriggerRef.current = null;
        setCoveragePanelOpen(true);
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
    map.on('click', handlePick);
    return () => {
      map.off('click', handleClick);
      map.off('click', handlePick);
    };
  }, [ready, state.route.picking, actions, clock]);

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
    const outside = outsideCoverageInfo(coordinates, COVERAGE_BBOX);
    if (outside) {
      // Selecting a record beyond the extract must not drop the camera onto the
      // intentionally blank basemap. The record still opens and is labelled.
      actions.notify(
        `${selectedPlace?.name ?? selectedStop?.name ?? 'This point'} is outside Night Map coverage, ${formatDistance(outside.distanceMeters, state.settings.units)} from the nearest covered point. The camera stayed inside the amber boundary.`,
        'warn',
      );
      return;
    }
    map.easeTo({
      center: coordinates,
      zoom: Math.max(map.getZoom(), 16),
      padding: MAP_PADDING(),
      duration: 700,
    });
  }, [selectedPlace, selectedStop, ready, actions, state.settings.units]);

  // Search results that are not place records still move the camera, but only
  // after the result has been accepted. Outside-coverage results are replaced
  // by their nearest covered point before they reach the store.
  const lastExternalFocus = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const external = state.selectedExternal;
    if (!external) {
      lastExternalFocus.current = null;
      return;
    }
    const key = `${external.label}:${external.coordinates.join(',')}`;
    if (key === lastExternalFocus.current) return;
    lastExternalFocus.current = key;
    const outside = outsideCoverageInfo(external.coordinates, COVERAGE_BBOX);
    if (outside) {
      actions.notify(
        `${external.label} is outside Night Map coverage, ${formatDistance(outside.distanceMeters, state.settings.units)} from the nearest covered point. The camera stayed inside the amber boundary.`,
        'warn',
      );
      return;
    }
    map.easeTo({
      center: external.coordinates,
      zoom: Math.min(MAP_MAX_ZOOM, Math.max(map.getZoom(), 16)),
      padding: MAP_PADDING(),
      duration: 700,
    });
  }, [state.selectedExternal, ready, actions, state.settings.units]);

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

  // While GPS lock is on, the visible centre snaps onto the latest fix on every
  // new reading, and again on a timer: browsers deliver watch fixes unevenly,
  // so without the timer a walker could stay centred on a minutes-old point.
  // The first follow also moves to street zoom; later snaps keep the reader's
  // zoom and angle, and a snap is skipped when the centre is already there.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!state.gpsLocked) {
      gpsFollowStarted.current = false;
      return;
    }
    const location = state.userLocation;
    if (!location || !isFixFresh(location)) return;
    const target = location.coordinates;
    const snap = () => {
      const firstFollow = !gpsFollowStarted.current;
      gpsFollowStarted.current = true;
      if (!firstFollow && map.getCenter().distanceTo(new maplibregl.LngLat(target[0], target[1])) < GPS_SNAP_MIN_MOVE_M) {
        return;
      }
      map.easeTo({
        center: target,
        ...(firstFollow ? { zoom: Math.max(map.getZoom(), 16) } : {}),
        padding: MAP_PADDING(),
        duration: firstFollow ? 700 : 400,
      });
    };
    snap();
    const timer = window.setInterval(snap, GPS_SNAP_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [ready, state.gpsLocked, state.userLocation]);

  // Panning is an explicit request to stop following. Releasing the lock also
  // stops the watch, matching the settings label and the lock toast.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const onDragStart = () => {
      if (state.gpsLocked) actions.stopGpsLock();
    };
    map.on('dragstart', onDragStart);
    return () => {
      map.off('dragstart', onDragStart);
    };
  }, [ready, state.gpsLocked, actions]);

  /**
   * A single fix leaves the map behind as soon as the reader moves, so this
   * control starts the live lock: the map snaps onto every later fix until it
   * is dragged or the control is pressed again.
   */
  const realignToGps = () => {
    if (state.gpsLocked) {
      actions.stopGpsLock();
      return;
    }
    actions.startGpsLock();
  };

  const stopCount = views.length;
  const inViewCount = viewsInBounds(views, state.viewportBounds).length;
  const fitTargetCount = views.filter((view) =>
    pointInCoverage(view.place.geometry.coordinates, COVERAGE_BBOX),
  ).length;
  const is3d = camera.pitch > 4;

  /**
   * Camera moves that are guaranteed to arrive. An eased move is only as
   * reliable as the frame callbacks driving it, and a phone that stalls them —
   * backgrounded tab, battery saver, a GPU hiccup — would leave the 3D control
   * looking broken. So the target is re-applied once if the ease did not finish.
   */
  const cameraRequest = useRef(0);
  /**
   * The camera goal still in flight: the pitch it started from, the pitch and
   * bearing it asked for, and whether a tilt step asked for it. map.getPitch()
   * measures an ease that is still running, so two quick presses would both
   * start from the same half-raised angle. Carrying the bearing keeps a
   * rotation that is under way: a tilt press must not freeze the compass
   * halfway back to north.
   */
  const pendingCamera = useRef<CameraGoal | null>(null);
  const moveCamera = (target: { pitch: number; bearing?: number }, step = false) => {
    const map = mapRef.current;
    if (!map) return;
    const request = ++cameraRequest.current;
    const bearing = target.bearing ?? map.getBearing();
    pendingCamera.current = {
      fromPitch: Math.round(map.getPitch()),
      pitch: target.pitch,
      bearing,
      step,
    };
    map.easeTo({ pitch: target.pitch, bearing, duration: 700, padding: MAP_PADDING() });
    window.setTimeout(() => {
      if (cameraRequest.current !== request) return;
      const live = mapRef.current;
      if (!live) return;
      if (Math.abs(live.getPitch() - target.pitch) > 0.5) live.setPitch(target.pitch);
      if (Math.abs(live.getBearing() - bearing) > 0.5) live.setBearing(bearing);
      // The move has landed. A later step starts from the camera itself, so a
      // stale goal cannot revive after the reader has dragged the map.
      pendingCamera.current = null;
    }, 1100);
  };

  // A drag takes over from a goal that is still being applied; without this the
  // guaranteed-arrival timer above would pull the map back under the finger.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const cancel = () => {
      cameraRequest.current += 1;
      pendingCamera.current = null;
    };
    map.on('dragstart', cancel);
    return () => {
      map.off('dragstart', cancel);
    };
  }, [ready]);

  // Recalling a saved view that carries a camera restores that framing once per
  // recall. The request counter retires any tilt step still in flight, so the
  // restored view cannot be pulled back by a late arrival timer.
  useEffect(() => {
    const map = mapRef.current;
    const restore = state.cameraRestore;
    if (!map || !ready || !restore) return;
    cameraRequest.current += 1;
    pendingCamera.current = null;
    map.easeTo({
      center: restore.pose.center,
      zoom: restore.pose.zoom,
      pitch: restore.pose.pitch,
      bearing: restore.pose.bearing,
      duration: 700,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.cameraRestore, ready]);

  /**
   * One action back to a level view facing north. A tilt step that has not
   * landed yet must not re-apply its angle afterwards, so its request is
   * retired and its goal cleared before the reset goal is installed.
   */
  const resetView = () => {
    cameraRequest.current += 1;
    pendingCamera.current = null;
    moveCamera({ pitch: 0, bearing: 0 });
  };

  const toggle3d = () => {
    const map = mapRef.current;
    if (!map) return;
    if (is3d) {
      resetView();
      return;
    }
    // Tilting only looks three-dimensional with the two layers that carry the
    // third dimension, so they are switched on together — and named out loud.
    if (!state.layers.terrain) actions.setLayer('terrain', true);
    if (!state.layers['buildings-3d']) actions.setLayer('buildings-3d', true);
    moveCamera({ pitch: PITCH_3D }, true);
    actions.notify(
      '3D view on. Terrain relief is rendered at true vertical scale (×1); building heights come from OpenStreetMap tags where available and are estimated elsewhere.',
    );
  };

  const resetNorth = () => resetView();

  /** Tilt without a modifier gesture: a trackpad or right-click drag is not discoverable. */
  const tiltBy = (delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    const live = Math.round(map.getPitch());
    const goal = pendingCamera.current;
    const pitch = Math.max(0, Math.min(MAX_PITCH, tiltBasePitch(live, goal) + delta));
    if (pitch === live) return;
    // Carry an unfinished rotation with the tilt; otherwise keep the current bearing.
    moveCamera({ pitch, bearing: goalInFlight(goal, live) ? goal.bearing : map.getBearing() }, true);
  };

  /** Where a step starts: the goal of an unfinished step, else the live angle. */
  const tiltBase = tiltBasePitch(camera.pitch, pendingCamera.current);

  const openStreetLevel = () => {
    const centre = mapRef.current?.getCenter();
    if (centre) setStreetLevelCoordinates([centre.lng, centre.lat]);
    setStreetLevelOpen(true);
  };

  const returnToCoverage = () => {
    const map = mapRef.current;
    if (!map) return;
    const saved = lastCoveredCamera.current;
    if (saved) {
      // Restore the exact view that last showed mapped ground, including its
      // zoom and the panel-aware padding it was framed with. A tilt compensation
      // still in flight must not land on top of the restored camera.
      cameraRequest.current += 1;
      pendingCamera.current = {
        fromPitch: Math.round(map.getPitch()),
        pitch: saved.pitch,
        bearing: saved.bearing,
        step: false,
      };
      map.setPadding(saved.padding);
      map.easeTo({
        center: saved.center,
        zoom: saved.zoom,
        bearing: saved.bearing,
        pitch: saved.pitch,
        duration: 700,
      });
      return;
    }
    cameraRequest.current += 1;
    pendingCamera.current = null;
    // No covered view has been recorded yet: land on the nearest point inside
    // the extract at the current zoom instead of zooming out to the whole city.
    const centre = map.getCenter();
    const [west, south, east, north] = COVERAGE_BBOX;
    map.easeTo({
      center: [
        Math.min(east, Math.max(west, centre.lng)),
        Math.min(north, Math.max(south, centre.lat)),
      ],
      zoom: map.getZoom(),
      duration: 700,
    });
  };

  const toggleCoveragePanel = (trigger: HTMLButtonElement) => {
    if (coveragePanelOpen) {
      setCoveragePanelOpen(false);
      return;
    }
    coverageDetailsTriggerRef.current = trigger;
    setCoveragePanelOpen(true);
  };

  const retryBasemap = () => {
    basemapReadyRef.current = false;
    setBasemapReady(false);
    setReady(false);
    setBasemapFailure(null);
    setCoveragePanelOpen(false);
    setMapAttempt((attempt) => attempt + 1);
  };

  // An offline tile miss has a recovery action the reader cannot perform by
  // pressing a disabled button. Rebuild as soon as the connection returns.
  useEffect(() => {
    if (!online || basemapFailure?.cause !== 'offline') return;
    retryBasemap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, basemapFailure]);

  const revealMap = () => {
    setCoveragePanelOpen(false);
    actions.selectPlace(null);
    actions.selectStop(null);
    actions.selectBuilding(null);
    actions.setWorkspace('map');
    actions.setSheet('dismissed');
  };

  const showAllCoverage = () => {
    const map = mapRef.current;
    if (!map) return;
    setCoveragePanelOpen(false);
    // A previous fly-to can leave camera padding taller than the phone's map
    // area, which makes fitBounds compute no camera at all. Start clean.
    map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    map.fitBounds(COVERAGE_BBOX, {
      padding: 24,
      maxZoom: 14.8,
      duration: 700,
    });
  };

  /**
   * Frame the records that pass the current filters. Private observations are
   * allowed only when they sit inside the extract: fitting to an outside point
   * would trade a filter notice for a blank basemap.
   */
  const fitToRecords = () => {
    const map = mapRef.current;
    if (!map) return;
    const points = views
      .filter((view) => pointInCoverage(view.place.geometry.coordinates, COVERAGE_BBOX))
      .map((view) => view.place.geometry.coordinates);
    if (points.length === 0) {
      showAllCoverage();
      return;
    }
    setCoveragePanelOpen(false);
    map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    if (points.length === 1) {
      map.easeTo({ center: points[0], zoom: Math.max(map.getZoom(), 15), duration: 700 });
      return;
    }
    const lngs = points.map((point) => point[0]);
    const lats = points.map((point) => point[1]);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: MAP_PADDING(), maxZoom: 15.5, duration: 700 },
    );
  };

  useEffect(() => {
    const onFitRecords = () => fitToRecords();
    const onFitCoverage = () => showAllCoverage();
    window.addEventListener(FIT_RECORDS_EVENT, onFitRecords);
    window.addEventListener(FIT_COVERAGE_EVENT, onFitCoverage);
    return () => {
      window.removeEventListener(FIT_RECORDS_EVENT, onFitRecords);
      window.removeEventListener(FIT_COVERAGE_EVENT, onFitCoverage);
    };
    // The filter cue only needs to re-bind when the matching record set moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views]);

  const nearestEdgeLabel = nearestEdge
    ? `${formatDistance(nearestEdge.distanceMeters, state.settings.units)} ${nearestEdge.direction}`
    : null;
  const basemapState: BasemapState = basemapReady ? 'ready' : basemapFailure ? 'failed' : 'loading';
  const showMapHidden = basemapState === 'ready' && coverageView === 'hidden';
  const allMapLayersOff = MAP_CONTENT_LAYER_IDS.every((id) => !state.layers[id]);
  // An empty layer set is a layer choice before it is a boundary state: even an
  // outside camera would still be blank after fitting the extract, so recovery
  // must start by restoring a layer. The boundary notice returns afterwards.
  const showEmptyLayers = basemapState === 'ready' && !showMapHidden && allMapLayersOff;
  const showCoverageNotice =
    basemapState === 'ready' && coverageView === 'outside' && !showEmptyLayers;
  const showCoverageEdge =
    basemapState === 'ready' && coverageView === 'partial' && !showEmptyLayers;
  // Tilting stretches the visible aperture over ground past the extract, so the
  // partial edge is no longer the whole story. This hint names the angle and
  // offers the same return, but never moves the camera on its own.
  // The aperture model still calls a sky-filled view 'inside', so that case
  // counts as reaching past the boundary as well.
  const showTiltEdgeHint =
    basemapState === 'ready' &&
    !showEmptyLayers &&
    (coverageView === 'partial' || (skyVisible && coverageView === 'inside')) &&
    camera.pitch >= TILT_EDGE_PITCH &&
    tiltOvershoot >= TILT_EDGE_OVERSHOOT_M;
  const showNoRecordsInView =
    basemapState === 'ready' &&
    state.viewportBounds !== null &&
    coverageView !== 'outside' &&
    coverageView !== 'hidden' &&
    !showEmptyLayers &&
    stopCount > 0 &&
    inViewCount === 0;
  const blankState: BlankMapState =
    basemapState === 'loading'
      ? 'loading'
      : basemapFailure
        ? BLANK_FAILURE_STATE[basemapFailure.cause]
        : showMapHidden
          ? 'covered'
          : showEmptyLayers
            ? 'empty-layers'
            : showCoverageNotice
              ? 'outside'
              : 'none';

  return (
    <div
      className={`map-stage ${basemapReady ? 'has-minimap' : ''} ${showCoverageNotice || showTiltEdgeHint ? 'has-coverage-notice' : ''} ${showMapHidden ? 'has-hidden-map' : ''} ${showEmptyLayers ? 'has-empty-layers' : ''} ${coveragePanelOpen ? 'has-coverage-panel' : ''}`}
      aria-busy={basemapState === 'loading'}
      data-basemap-state={basemapState}
      data-blank-state={blankState}
      data-coverage-view={coverageView}
    >
      <div ref={containerRef} className="map-canvas" role="application" aria-label="Night Map of central San Francisco" />

      {basemapState === 'loading' && (
        <div className="map-loading" role="status" aria-live="polite">
          <div className="map-loading-card">
            <p className="map-loading-eyebrow">Night Map · San Francisco</p>
            <h2>Charting the streets</h2>
            <p>The basemap and street network are still loading. The map will appear when the road grid is ready.</p>
            <span className="map-loading-bar" aria-hidden="true">
              <span />
            </span>
          </div>
        </div>
      )}

      {basemapReady && (
        <section className="mini-map-widget" aria-label="Map overview">
          <div className="mini-map-heading" title="Amber outline: mapped extract. White box: current map view.">
            <span>Overview</span><span>Amber = mapped extract</span>
          </div>
          <div
            ref={overviewContainerRef}
            className="mini-map-canvas"
            aria-label="Clickable overview map with the mapped extract and current view"
          />
        </section>
      )}

      {streetLevelOpen && (
        <StreetLevelViewer
          coordinates={streetLevelCoordinates}
          onClose={() => setStreetLevelOpen(false)}
        />
      )}

      {basemapFailure && (
        <div
          className="map-failed"
          role="alert"
          data-testid="basemap-failure"
          data-cause={basemapFailure.cause}
        >
          <div className="map-failed-card">
            <p className="map-loading-eyebrow">Night Map · basemap unavailable</p>
            <h3>{BASEMAP_FAILURE_COPY[basemapFailure.cause].title}</h3>
            <p>{BASEMAP_FAILURE_COPY[basemapFailure.cause].body}</p>
            <p className="map-failed-note">Search, placed lists, saved places and private notes still work.</p>
            {nearestEdgeLabel && (
              <p className="map-failed-distance" data-testid="basemap-edge-distance">
                Nearest covered edge: <strong>{nearestEdgeLabel}</strong>.
              </p>
            )}
            {basemapFailure.detail && <p className="map-failed-detail">{basemapFailure.detail}</p>}
            <div className="button-row">
              <button
                type="button"
                className="button small"
                onClick={retryBasemap}
                disabled={basemapFailure.cause === 'offline' && !online}
                data-testid="basemap-retry"
              >
                {basemapFailure.cause === 'offline'
                  ? online
                    ? 'Retry tiles'
                    : 'Waiting for connection'
                  : basemapFailure.cause === 'tiles'
                    ? 'Retry tiles'
                    : 'Retry map'}
              </button>
              <button
                type="button"
                className="button ghost small"
                aria-haspopup="dialog"
                aria-expanded={coveragePanelOpen}
                aria-controls="coverage-panel"
                onClick={(event) => toggleCoveragePanel(event.currentTarget)}
                data-testid="basemap-details"
              >
                Details
              </button>
            </div>
            {basemapFailure.cause === 'offline' && (
              <p className="map-failed-note" data-testid="offline-retry-note">
                {online
                  ? 'Connection is back. Retrying the street tiles now.'
                  : 'Night Map will retry automatically when the connection returns.'}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="map-topline">
        <span className="map-scale-note is-count" data-testid="map-view-status">
          {coverageView === 'outside'
            ? `Outside coverage · 0 of ${stopCount} in view`
            : coverageView === 'hidden'
              ? 'Map hidden behind panels'
              : state.viewportBounds
                ? `${inViewCount} of ${stopCount} ${stopCount === 1 ? 'place' : 'places'} in view`
                : `${stopCount} ${stopCount === 1 ? 'place' : 'places'} in this filter`}
        </span>
        {showNoRecordsInView && (
          <button
            type="button"
            className="map-scale-note map-view-action"
            onClick={fitTargetCount > 0 ? fitToRecords : showAllCoverage}
            data-testid={fitTargetCount > 0 ? 'map-fit-records' : 'map-show-coverage'}
          >
            {fitTargetCount > 0
              ? `No records in this view · Zoom to ${fitTargetCount} ${fitTargetCount === 1 ? 'record' : 'records'}`
              : 'No records in this view · Show coverage'}
          </button>
        )}
        {is3d && (
          <>
            <span className="map-scale-note is-3d">
              tilted {camera.pitch}° · facing {camera.bearing === 0 ? 'north' : `${camera.bearing}°`}
            </span>
            <button
              type="button"
              className="map-scale-note map-view-action"
              onClick={resetView}
              title="Return to a flat view facing north"
              aria-label="Reset to flat and north"
              data-testid="reset-camera"
            >
              Flat &amp; north
            </button>
          </>
        )}
        {buildingsOn && (
          <span className="map-scale-note" data-testid="buildings-status">
            {buildingsState.loaded > 0
              ? `3D buildings: ${buildingsState.loaded} loaded`
              : `3D buildings load at street zoom (z${BUILDINGS_MIN_ZOOM})`}
          </span>
        )}
        {registryOn && (
          <span className="map-scale-note" data-testid="registry-status">
            {registryState.error
              ? `Building registry unavailable — ${registryState.error}`
              : `${registryState.loaded} parcel dossiers with a mapped position${state.buildingFilter === 'all' ? '' : ` · ${buildingFilterLabel(state.buildingFilter)}`}`}
          </span>
        )}
        {abandonedOn && (
          <span className="map-scale-note" data-testid="abandoned-status">
            {abandonedState.error
              ? `Vacancy markers unavailable — ${abandonedState.error}`
              : `${abandonedState.loaded} vacancy/abandonment parcels`}
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

      {showMapHidden && (
        <div className="map-hidden-notice" role="status" data-testid="map-hidden-notice">
          <span className="map-hidden-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M4 5.5h6.5v13H4zM13.5 5.5H20v13h-6.5z" />
              <path d="m10.5 9 2.5 3-2.5 3" />
            </svg>
          </span>
          <span className="map-hidden-copy">
            <strong>Close a panel to see the map</strong>
            <span>
              The mapped area is behind the open panels right now. Nothing moved, and this is not the edge of
              coverage.
            </span>
          </span>
          <div className="map-hidden-actions">
            <button type="button" className="button small" onClick={revealMap}>
              Close panels
            </button>
          </div>
        </div>
      )}

      {showEmptyLayers && (
        <div className="map-hidden-notice is-empty-layers" role="status" data-testid="map-empty-layers">
          <span className="map-hidden-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="m12 3 9 5-9 5-9-5 9-5Z" />
              <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
            </svg>
          </span>
          <span className="map-hidden-copy">
            <strong>No map layers are on</strong>
            <span>
              Every layer is switched off, so the map shows only its background. This is a layer choice, not the
              edge of coverage.
            </span>
          </span>
          <div className="map-hidden-actions">
            <button type="button" className="button small" onClick={() => actions.applyPreset('essentials')}>
              Show essentials
            </button>
            <button type="button" className="button ghost small" onClick={onOpenLayers}>
              Choose layers
            </button>
          </div>
        </div>
      )}

      {showCoverageEdge && !showTiltEdgeHint && (
        <button
          type="button"
          className={`coverage-edge-chip ${coveragePanelOpen ? 'is-open' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={coveragePanelOpen}
          onClick={(event) => toggleCoveragePanel(event.currentTarget)}
          data-testid="coverage-edge-chip"
        >
          <span className="coverage-edge-dash" aria-hidden="true" />
          Edge of coverage
          <span className="coverage-edge-more">Details</span>
        </button>
      )}

      {showTiltEdgeHint && (
        <div className="coverage-notice coverage-tilt-notice" role="status" data-testid="coverage-tilt-hint">
          <span className="coverage-notice-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M4 16.5 12 6l8 10.5" />
              <path d="M3 20h18" />
            </svg>
          </span>
          <span className="coverage-notice-copy">
            <strong>Tilt is showing ground beyond the boundary</strong>
            <span className="coverage-notice-body">
              This {Math.round(camera.pitch)}° view reaches{' '}
              <strong>{formatDistance(tiltOvershoot, state.settings.units)}</strong> past the mapped extract.
              The ground outside the amber boundary is intentionally unmapped.
            </span>
          </span>
          <div className="coverage-notice-actions">
            <button
              type="button"
              className="button ghost small"
              aria-haspopup="dialog"
              aria-expanded={coveragePanelOpen}
              aria-controls="coverage-panel"
              onClick={(event) => toggleCoveragePanel(event.currentTarget)}
              data-testid="coverage-tilt-details"
            >
              Details
            </button>
            <button
              type="button"
              className="button small"
              aria-label="Return to coverage"
              onClick={returnToCoverage}
              data-testid="coverage-tilt-return"
            >
              <span className="coverage-return-full">Return to coverage</span>
              <span className="coverage-return-compact">Return</span>
            </button>
          </div>
        </div>
      )}

      {showCoverageNotice && (
        <div className="coverage-notice" role="status" data-testid="coverage-notice">
          <span className="coverage-notice-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M4 7.5 9 4l6 3.5L20 4v12.5L15 20l-6-3.5L4 20V7.5Z" />
              <path d="M9 4v12.5M15 7.5V20" />
            </svg>
          </span>
          <span className="coverage-notice-copy">
            <strong>Outside Night Map coverage</strong>
            <span className="coverage-notice-body">
              Central San Francisco only. Beyond the amber dashed boundary is intentionally unmapped.
            </span>
            {nearestEdgeLabel && (
              <span className="coverage-notice-distance" data-testid="coverage-edge-distance">
                Nearest covered edge: <strong>{nearestEdgeLabel}</strong>
              </span>
            )}
          </span>
          <div className="coverage-notice-actions">
            <button
              type="button"
              className="button ghost small"
              aria-haspopup="dialog"
              aria-expanded={coveragePanelOpen}
              aria-controls="coverage-panel"
              onClick={(event) => toggleCoveragePanel(event.currentTarget)}
              data-testid="coverage-notice-details"
            >
              Details
            </button>
            <button
              type="button"
              className="button ghost small"
              aria-label="Show all coverage"
              title="Fit the whole central-San Francisco extract"
              onClick={showAllCoverage}
            >
              <span className="coverage-all-full">Show all coverage</span>
              <span className="coverage-all-compact">Show all</span>
            </button>
            <button
              type="button"
              className="button small"
              aria-label="Return to coverage"
              onClick={returnToCoverage}
            >
              <span className="coverage-return-full">Return to coverage</span>
              <span className="coverage-return-compact">Return</span>
            </button>
          </div>
        </div>
      )}

      {coveragePanelOpen && (
        <section
          ref={coveragePanelRef}
          id="coverage-panel"
          className="coverage-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="coverage-panel-title"
          tabIndex={-1}
          data-testid="coverage-panel"
        >
          <div className="coverage-panel-head">
            <div>
              <p className="eyebrow">Night Map · coverage</p>
              <h3 id="coverage-panel-title">What the boundary means</h3>
            </div>
            <button
              type="button"
              className="icon-button close"
              aria-label="Close coverage details"
              onClick={() => setCoveragePanelOpen(false)}
            >
              ×
            </button>
          </div>

          <div className="coverage-panel-map" data-testid="coverage-panel-minimap">
            <div
              ref={coveragePanelContainerRef}
              className="coverage-panel-map-canvas"
              role="img"
              aria-label="Bundled central San Francisco extract with the current map view outlined"
            />
            <p className="coverage-panel-map-key">
              <span className="coverage-key-extract" aria-hidden="true" /> bundled extract
              <span className="coverage-key-view" aria-hidden="true" /> current view
            </p>
          </div>

          <dl className="coverage-facts">
            <div><dt>Places</dt><dd>{dataset.data.meta.counts.places}</dd></div>
            <div><dt>Resource records</dt><dd>{dataset.data.meta.counts.resources}</dd></div>
            <div><dt>Transit stops</dt><dd>{dataset.data.transit.length}</dd></div>
            <div><dt>Cited sources</dt><dd>{dataset.data.sources.length}</dd></div>
          </dl>

          <section className="coverage-section">
            <h4>Data dates</h4>
            <dl className="coverage-rows">
              <div><dt>Core extract built</dt><dd>{formatDate(dataset.data.meta.generatedAt)}</dd></div>
              <div><dt>Sources retrieved</dt><dd>{SOURCE_RETRIEVED_RANGE}</dd></div>
              <div>
                <dt>Building records</dt>
                <dd>newest {formatDate(buildingRegistryMeta.newestRecordAt)} · compiled {formatDate(buildingRegistryMeta.generatedAt)}</dd>
              </div>
            </dl>
          </section>

          <section className="coverage-section">
            <h4>Layer and zoom limits</h4>
            <ul className="coverage-list">
              <li>
                <strong>Zoom z{MAP_MIN_ZOOM}–{MAP_MAX_ZOOM}.</strong> Tilt up to {MAX_PITCH}°; the camera cannot zoom
                beyond that range.
              </li>
              <li>
                <strong>Basemap layers.</strong> Streets, paths, parks, water, coastline, rail and landmarks draw
                throughout. 3D buildings start at z{BUILDINGS_MIN_ZOOM}; stop names at z16.8.
              </li>
              <li>
                <strong>Optional layers.</strong> Satellite, terrain, transit, reported activity and building records
                stay inside the same boundary.
              </li>
            </ul>
          </section>

          <section className="coverage-section">
            <h4>What is excluded</h4>
            <ul className="coverage-list">
              <li>
                <strong>Not citywide or complete.</strong> {dataset.data.meta.footprint.note} An empty category means
                no installed record, not that nothing exists.
              </li>
              <li>
                <strong>No live availability.</strong> A listed facility may be closed, unstocked or inaccessible;
                inventory presence is not a field check.
              </li>
              <li>
                <strong>Person-targeting reports are excluded.</strong> Encampment, welfare, medical and crisis
                categories, narratives and exact addresses are removed; positions are coarse.
              </li>
              <li>
                <strong>Nothing beyond the amber line.</strong> The basemap and records stop at the boundary by design.
              </li>
            </ul>
          </section>

          <div className="coverage-panel-actions">
            <button type="button" className="button small" onClick={showAllCoverage}>
              Show all coverage
            </button>
            <button type="button" className="button ghost small" onClick={() => setCoveragePanelOpen(false)}>
              Close
            </button>
          </div>
        </section>
      )}

      <div className="map-controls" aria-label="Map controls">
        <button
          type="button"
          className={`map-control ${is3d ? 'is-active' : ''}`}
          onClick={toggle3d}
          aria-pressed={is3d}
          aria-label="3D view"
          title={`Tilt the map and show terrain and buildings. Use Tilt up / Tilt down, or drag with two fingers / control-drag (max ${MAX_PITCH}°).`}
        >
          <CubeIcon />
        </button>
        <div className="map-control-group" role="group" aria-label="View angle">
          <button
            type="button"
            className="map-control"
            onClick={() => tiltBy(TILT_STEP)}
            aria-label="Tilt up"
            title={`Raise the camera angle by ${TILT_STEP}° (max ${MAX_PITCH}°)`}
            disabled={tiltBase >= MAX_PITCH}
          >
            <TiltUpIcon />
          </button>
          <button
            type="button"
            className="map-control"
            onClick={() => tiltBy(-TILT_STEP)}
            aria-label="Tilt down"
            title={`Lower the camera angle by ${TILT_STEP}°`}
            disabled={tiltBase <= 0}
          >
            <TiltDownIcon />
          </button>
        </div>
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
          className={`map-control ${state.gpsLocked ? 'is-active' : ''}`}
          onClick={realignToGps}
          aria-pressed={state.gpsLocked}
          aria-label="Follow my GPS location"
          title="Keep the map centred on every new GPS fix; drag the map or press again to stop"
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
                  These are published City reports, not a live feed. Dispatched calls come from the City’s
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
            Counts are places installed in this release, not everything that exists. Colour is never the only cue:
            every marker also has a symbol, and every category is named. The amber dashed line marks the edge of the
            bundled central-SF extract; beyond it the basemap is intentionally blank.
          </p>
        </div>
      )}

      {selectedStop && <StopCard stop={selectedStop} onClose={() => actions.selectStop(null)} />}

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

function TiltUpIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 17.5h16M12 14.5V4M7.5 8.5 12 4l4.5 4.5" />
    </svg>
  );
}

function TiltDownIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 17.5h16M12 4v10.5M7.5 10 12 14.5l4.5-4.5" />
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
