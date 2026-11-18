import type { StyleSpecification } from 'maplibre-gl';
import green from '../data/basemap/green.json';
import water from '../data/basemap/water.json';
import coastline from '../data/basemap/coastline.json';
import rail from '../data/basemap/rail.json';
import basePoints from '../data/basemap/base-points.json';
import landmarks from '../data/basemap/landmarks.json';
import terrainMeta from '../data/terrain-meta.json';
import meta from '../data/meta.json';
import { PUBLIC_REALM_MAINTENANCE_KINDS } from '../domain/public-realm-maintenance';

/** The elevation extract's own bounds, so a request is never made for a tile we do not ship. */
const TERRAIN_BBOX = terrainMeta.bbox as [number, number, number, number];

/** The installed places' footprint. Beyond this boundary the basemap is intentionally absent. */
export const COVERAGE_BBOX = meta.footprint.bbox as [number, number, number, number];

export const THEME = {
  land: '#0D1317',
  water: '#061528',
  bayShelf: '#0A263D',
  bayShallow: '#103C58',
  green: '#153A22',
  greenEdge: '#2A6240',
  coast: '#22333D',
  coastGlow: '#7FB4C8',
  casing: '#070D10',
  arterial: '#35444D',
  major: '#2C3A42',
  secondary: '#26343B',
  local: '#202D34',
  path: '#2A3941',
  rail: '#334650',
  label: '#94A3AA',
  labelFaint: '#71828A',
  halo: '#080D10',
  ink: '#E9E5DC',
  accent: '#E0A458',
  route: '#7FD1C1',
  routeAlt: '#556B72',
  observation: '#E4C36A',
  saved: '#EAE6DC',
  selection: '#F4EFE4',
}

const empty = { type: 'FeatureCollection' as const, features: [] };

const FONT = ['Noto Sans Regular'];

const [COVERAGE_WEST, COVERAGE_SOUTH, COVERAGE_EAST, COVERAGE_NORTH] = COVERAGE_BBOX;
const coverage = {
  type: 'FeatureCollection' as const,
  features: [
    {
      type: 'Feature' as const,
      properties: { name: meta.footprint.name },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[
          [COVERAGE_WEST, COVERAGE_SOUTH],
          [COVERAGE_EAST, COVERAGE_SOUTH],
          [COVERAGE_EAST, COVERAGE_NORTH],
          [COVERAGE_WEST, COVERAGE_NORTH],
          [COVERAGE_WEST, COVERAGE_SOUTH],
        ]],
      },
    },
  ],
};

// MapLibre hands vector tile templates to the worker as Request objects, so this
// has to be absolute even though the page and style are same-origin.
const ROAD_TILES =
  typeof window === 'undefined'
    ? '/basemap/roads/{z}/{x}/{y}.pbf'
    : `${window.location.origin}/basemap/roads/{z}/{x}/{y}.pbf`;

export function buildStyle(): StyleSpecification {
  const style: StyleSpecification = {
    version: 8,
    name: 'Night Map — nocturne',
    glyphs: '/fonts/{fontstack}/{range}.pbf',
    sources: {
      // The extract is pre-tiled at build time (scripts/build-road-tiles.mjs).
      // Shipping done tiles keeps the 671 KB GeoJSON parse and tile index out of
      // the first render, which is what held the street grid back on slow phones.
      roads: {
        type: 'vector',
        tiles: [ROAD_TILES],
        minzoom: 13,
        maxzoom: 15,
      },
      coverage: { type: 'geojson', data: coverage as GeoJSON.FeatureCollection },
      green: { type: 'geojson', data: green as GeoJSON.FeatureCollection },
      water: { type: 'geojson', data: water as GeoJSON.FeatureCollection },
      coastline: { type: 'geojson', data: coastline as GeoJSON.FeatureCollection },
      rail: { type: 'geojson', data: rail as GeoJSON.FeatureCollection },
      labels: { type: 'geojson', data: basePoints as GeoJSON.FeatureCollection },
      landmarks: { type: 'geojson', data: landmarks as GeoJSON.FeatureCollection },
      satellite: {
        type: 'raster',
        tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 19,
        attribution: 'Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      },
      places: {
        type: 'geojson',
        data: empty,
        cluster: true,
        clusterRadius: 54,
        clusterMaxZoom: 15,
      },
      focus: { type: 'geojson', data: empty },
      stops: { type: 'geojson', data: empty },
      observations: { type: 'geojson', data: empty },
      external: { type: 'geojson', data: empty },
      route: { type: 'geojson', data: empty },
      routeStops: { type: 'geojson', data: empty },
      // Terrain and 3D geometry live outside the main bundle: see src/map/terrain.ts
      // and src/map/buildings.ts. Both are described in the layer drawer.
      terrain: {
        type: 'raster-dem',
        tiles: [terrainMeta.urlTemplate],
        tileSize: terrainMeta.tileSize,
        encoding: 'terrarium',
        minzoom: terrainMeta.minzoom,
        maxzoom: terrainMeta.maxzoom,
        bounds: [TERRAIN_BBOX[1], TERRAIN_BBOX[0], TERRAIN_BBOX[3], TERRAIN_BBOX[2]],
      },
      // MapLibre warns that one DEM source cannot serve both terrain and a
      // hillshade without costing quality, so the shading reads from its own
      // source over the same tiles — the browser fetches them once.
      terrainShade: {
        type: 'raster-dem',
        tiles: [terrainMeta.urlTemplate],
        tileSize: terrainMeta.tileSize,
        encoding: 'terrarium',
        minzoom: terrainMeta.minzoom,
        maxzoom: terrainMeta.maxzoom,
        bounds: [TERRAIN_BBOX[1], TERRAIN_BBOX[0], TERRAIN_BBOX[3], TERRAIN_BBOX[2]],
      },
      buildings: { type: 'geojson', data: empty },
      // Published incident snapshots. Empty until a layer is switched on, so a
      // user who never asks for them never pays for them. See src/map/incidents.ts.
      callsRecent: { type: 'geojson', data: empty },
      cases311: { type: 'geojson', data: empty },
      buildingRegistry: { type: 'geojson', data: empty },
      abandonedBuildings: { type: 'geojson', data: empty },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': THEME.land } },
      {
        id: 'satellite-raster',
        type: 'raster',
        source: 'satellite',
        layout: { visibility: 'none' },
        paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 },
      },
      {
        id: 'hillshade',
        type: 'hillshade',
        source: 'terrainShade',
        layout: { visibility: 'none' },
        paint: {
          'hillshade-exaggeration': 0.32,
          'hillshade-shadow-color': '#04080A',
          'hillshade-highlight-color': '#415158',
          'hillshade-accent-color': '#101A1F',
        },
      },
      {
        id: 'green-fill',
        type: 'fill',
        source: 'green',
        paint: { 'fill-color': THEME.green, 'fill-opacity': 1 },
      },
      {
        id: 'green-edge',
        type: 'line',
        source: 'green',
        paint: { 'line-color': THEME.greenEdge, 'line-width': 0.6 },
      },
      {
        id: 'water-fill',
        type: 'fill',
        source: 'water',
        paint: { 'fill-color': THEME.water, 'fill-opacity': 1 },
      },
      {
        // Broad soft bands on the water side of the shoreline suggest depth.
        // This is a reading aid, not a bathymetric measurement.
        id: 'bay-shelf',
        type: 'line',
        source: 'coastline',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': THEME.bayShelf,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 70, 14, 140, 18, 210],
          'line-offset': ['interpolate', ['linear'], ['zoom'], 10, 35, 14, 70, 18, 105],
          'line-blur': ['interpolate', ['linear'], ['zoom'], 10, 35, 14, 75, 18, 115],
          'line-opacity': 0.22,
        },
      },
      {
        id: 'bay-shallow',
        type: 'line',
        source: 'coastline',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': THEME.bayShallow,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 28, 14, 56, 18, 92],
          'line-offset': ['interpolate', ['linear'], ['zoom'], 10, 15, 14, 30, 18, 48],
          'line-blur': ['interpolate', ['linear'], ['zoom'], 10, 14, 14, 30, 18, 48],
          'line-opacity': 0.24,
        },
      },
      {
        id: 'coast-glow',
        type: 'line',
        source: 'coastline',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': THEME.coastGlow,
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 5, 14, 9, 18, 14],
          'line-blur': ['interpolate', ['linear'], ['zoom'], 11, 3, 14, 6, 18, 9],
          'line-opacity': 0.2,
        },
      },
      {
        id: 'coastline',
        type: 'line',
        source: 'coastline',
        paint: { 'line-color': THEME.coast, 'line-width': 1.1 },
      },
      {
        id: 'rail-line',
        type: 'line',
        source: 'rail',
        paint: {
          'line-color': THEME.rail,
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.7, 16, 1.6],
          'line-dasharray': [3, 2],
        },
      },
      {
        id: 'road-casing',
        type: 'line',
        source: 'roads',
        'source-layer': 'roads',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': THEME.casing,
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            11,
            ['match', ['get', 'class'], 'arterial', 2.4, 'major', 2, 'secondary', 1.7, 'local', 1.2, 0.9],
            16,
            ['match', ['get', 'class'], 'arterial', 12, 'major', 9.5, 'secondary', 7.5, 'local', 5.2, 2.4],
          ],
        },
      },
      {
        id: 'roads',
        type: 'line',
        source: 'roads',
        'source-layer': 'roads',
        filter: ['!=', ['get', 'class'], 'path'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': [
            'match',
            ['get', 'class'],
            'arterial',
            THEME.arterial,
            'major',
            THEME.major,
            'secondary',
            THEME.secondary,
            'service',
            THEME.local,
            THEME.local,
          ],
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            11,
            ['match', ['get', 'class'], 'arterial', 1.6, 'major', 1.2, 'secondary', 0.9, 'local', 0.55, 0.4],
            16,
            ['match', ['get', 'class'], 'arterial', 9.5, 'major', 7.2, 'secondary', 5.4, 'local', 3.4, 1.4],
          ],
        },
      },
      {
        id: 'paths',
        type: 'line',
        source: 'roads',
        'source-layer': 'roads',
        filter: ['==', ['get', 'class'], 'path'],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': THEME.path,
          'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 17, 1.8],
          'line-dasharray': [2, 2],
        },
      },
      {
        // The installed extract ends here. The glow and dashed line make the
        // boundary legible over both the dark basemap and satellite imagery.
        id: 'coverage-edge-glow',
        type: 'line',
        source: 'coverage',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': THEME.accent,
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 11, 16, 18],
          'line-blur': 6,
          'line-opacity': 0.22,
        },
      },
      {
        id: 'coverage-edge',
        type: 'line',
        source: 'coverage',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#F0C674',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 16, 2.5],
          'line-dasharray': [5, 3],
          'line-opacity': 0.9,
        },
      },
      {
        // Drawn before labels, routes and markers so tall geometry never hides them.
        id: 'buildings-3d',
        type: 'fill-extrusion',
        source: 'buildings',
        minzoom: 14.6,
        paint: {
          'fill-extrusion-color': [
            'interpolate',
            ['linear'],
            ['get', 'h'],
            3,
            '#141F25',
            18,
            '#1D2C33',
            60,
            '#28404A',
            150,
            '#365563',
            330,
            '#446B7B',
          ],
          'fill-extrusion-height': ['get', 'h'],
          'fill-extrusion-base': ['get', 'b'],
          'fill-extrusion-opacity': 0.9,
          'fill-extrusion-vertical-gradient': true,
        },
      },
      {
        id: 'street-labels',
        type: 'symbol',
        source: 'roads',
        'source-layer': 'roads',
        minzoom: 13.4,
        filter: ['all', ['has', 'name'], ['!=', ['get', 'name'], '']],
        layout: {
          visibility: 'none',
          'symbol-placement': 'line',
          'text-field': ['get', 'name'],
          'text-font': FONT,
          'text-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            13.5,
            ['match', ['get', 'class'], 'arterial', 10.5, 'major', 9.5, 8],
            17,
            ['match', ['get', 'class'], 'arterial', 14, 'major', 12.5, 11],
          ],
          'text-letter-spacing': 0.04,
          'symbol-spacing': 380,
          'text-padding': 4,
          'text-max-angle': 30,
        },
        paint: {
          'text-color': ['match', ['get', 'class'], 'arterial', '#A7B4BA', THEME.label],
          'text-halo-color': THEME.halo,
          'text-halo-width': 1.4,
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 13.4, 0.65, 15, 0.95],
        },
      },
      {
        id: 'hood-labels',
        type: 'symbol',
        source: 'labels',
        filter: ['==', ['get', 'kind'], 'neighbourhood'],
        minzoom: 11.6,
        layout: {
          visibility: 'none',
          'text-field': ['get', 'name'],
          'text-font': FONT,
          'text-size': ['interpolate', ['linear'], ['zoom'], 11.6, 10.5, 16, 13],
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.18,
          'text-padding': 8,
        },
        paint: {
          'text-color': THEME.labelFaint,
          'text-halo-color': THEME.halo,
          'text-halo-width': 1.6,
          'text-opacity': 0.75,
        },
      },
      {
        id: 'landmark-dots',
        type: 'circle',
        source: 'landmarks',
        minzoom: 13,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 3, 17, 6],
          'circle-color': '#2B2A26',
          'circle-stroke-color': '#9C8F7D',
          'circle-stroke-width': 1.4,
        },
      },
      {
        id: 'landmark-labels',
        type: 'symbol',
        source: 'landmarks',
        minzoom: 14.6,
        layout: {
          visibility: 'none',
          'text-field': ['get', 'name'],
          'text-font': FONT,
          'text-size': 11,
          'text-offset': [0, 1.1],
          'text-anchor': 'top',
          'text-max-width': 8,
        },
        paint: {
          'text-color': '#B3A793',
          'text-halo-color': THEME.halo,
          'text-halo-width': 1.5,
        },
      },
      {
        id: 'stops-dots',
        type: 'circle',
        source: 'stops',
        minzoom: 14,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 2.2, 18, 4.4],
          'circle-color': '#0E1519',
          'circle-stroke-color': '#8AA3B8',
          'circle-stroke-width': 1.5,
        },
      },
      {
        id: 'stops-labels',
        type: 'symbol',
        source: 'stops',
        // Street-level stop names are useful once the user zooms in, but drawing
        // hundreds of collision-tested labels while panning is needlessly costly.
        minzoom: 16.8,
        layout: {
          visibility: 'none',
          'text-field': ['get', 'name'],
          'text-font': FONT,
          'text-size': 10,
          'text-offset': [0, 0.9],
          'text-anchor': 'top',
          'text-max-width': 7,
        },
        paint: {
          'text-color': '#8FA6B4',
          'text-halo-color': THEME.halo,
          'text-halo-width': 1.3,
        },
      },
      {
        // The blinking ring sits under the dot, so the alert reads as one pulse
        // rather than a flickering marker. Its radius and opacity are animated
        // by MapView; nothing else in the style changes with time.
        id: 'calls-pulse',
        type: 'circle',
        source: 'callsRecent',
        minzoom: 11.8,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 10, 16, 15, 18, 19],
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': '#FF6F5A',
          'circle-stroke-width': 1.6,
          'circle-stroke-opacity': 0.5,
        },
      },
      {
        id: 'calls-recent',
        type: 'circle',
        source: 'callsRecent',
        minzoom: 11.8,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 4.2, 15, 6, 18, 8.5],
          'circle-color': [
            'match',
            ['get', 'bucket'],
            'fire_ems',
            '#E0653F',
            'traffic',
            '#B98450',
            'infrastructure',
            '#9E8B6A',
            '#D64F45',
          ],
          'circle-stroke-color': '#150A0A',
          'circle-stroke-width': 1.3,
          'circle-opacity': 0.92,
        },
      },
      {
        id: 'cases-311',
        type: 'circle',
        source: 'cases311',
        minzoom: 13.4,
        filter: ['!', ['in', ['get', 'kind'], ['literal', PUBLIC_REALM_MAINTENANCE_KINDS]]],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 13.4, 3, 18, 6],
          'circle-color': '#D8A657',
          'circle-stroke-color': '#1A1206',
          'circle-stroke-width': 1,
          'circle-opacity': 0.45,
        },
      },
      {
        id: 'maintenance-requests',
        type: 'circle',
        source: 'cases311',
        minzoom: 13.4,
        filter: ['in', ['get', 'kind'], ['literal', PUBLIC_REALM_MAINTENANCE_KINDS]],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 13.4, 4, 18, 7],
          'circle-color': [
            'match',
            ['get', 'kind'],
            'Streetlights', '#B8A5F2',
            'Street and Sidewalk Cleaning', '#8DB9D8',
            'Graffiti Public', '#A99AE8',
            'Blocked Street and Sidewalk', '#7EA8C7',
            'Litter Receptacle Maintenance', '#91BCD0',
            'Street Defect', '#84A9CE',
            'Sidewalk and Curb', '#759DBF',
            '#A9B7C8',
          ],
          'circle-stroke-color': '#101827',
          'circle-stroke-width': 1.6,
          'circle-opacity': 0.96,
        },
      },
      {
        id: 'building-registry-dots',
        type: 'circle',
        source: 'buildingRegistry',
        minzoom: 13.6,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 13.6, 3.4, 16.5, 6, 18, 8],
          'circle-color': [
            'match', ['get', 'status'],
            'reported_vacant', '#E0A458',
            'vacancy_history', '#B98A5A',
            'under_demolition', '#D96C4F',
            'demolition_history', '#9E7A5A',
            'under_construction', '#6E9AA8',
            'code_enforcement', '#C9B27A',
            '#8A8F86',
          ],
          'circle-stroke-color': '#100C08',
          'circle-stroke-width': 1.2,
          'circle-opacity': 0.9,
        },
      },
      {
        id: 'abandoned-glow',
        type: 'circle',
        source: 'abandonedBuildings',
        minzoom: 11.5,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11.5, 4, 14, 9, 17, 22],
          'circle-color': '#37D5FF',
          'circle-blur': 1,
          'circle-opacity': ['case', ['==', ['get', 'precision'], 'block_centroid'], 0.07, 0.15],
          'circle-pitch-alignment': 'map',
        },
      },
      {
        id: 'abandoned-ring',
        type: 'circle',
        source: 'abandonedBuildings',
        minzoom: 11.5,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11.5, 3, 14, 5, 17, 7.5],
          'circle-color': 'rgba(0, 0, 0, 0)',
          'circle-stroke-color': '#9CEFFF',
          'circle-stroke-width': 1.5,
          'circle-stroke-opacity': ['case', ['==', ['get', 'precision'], 'block_centroid'], 0.5, 0.95],
          'circle-pitch-alignment': 'map',
        },
      },
      {
        id: 'building-registry-labels',
        type: 'symbol',
        source: 'buildingRegistry',
        minzoom: 16.4,
        layout: {
          'text-field': ['get', 'address'],
          'text-font': FONT,
          'text-size': 10,
          'text-offset': [0, 0.9],
          'text-anchor': 'top',
          'text-max-width': 9,
        },
        paint: {
          'text-color': '#D8C7A6',
          'text-halo-color': THEME.halo,
          'text-halo-width': 1.3,
        },
      },
      {
        id: 'route-casing',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#08100F', 'line-width': 9, 'line-opacity': 0.85 },
      },
      {
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': THEME.route, 'line-width': 4 },
      },
      {
        id: 'route-stops',
        type: 'circle',
        source: 'routeStops',
        paint: {
          'circle-radius': 5.5,
          'circle-color': '#0D1317',
          'circle-stroke-color': THEME.route,
          'circle-stroke-width': 2,
        },
      },
      {
        id: 'cluster-halo',
        type: 'circle',
        source: 'places',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#101B20',
          'circle-radius': [
            'step',
            ['get', 'point_count'],
            17,
            5,
            20,
            15,
            24,
          ],
          'circle-stroke-color': '#3A4A53',
          'circle-stroke-width': 1.2,
          'circle-opacity': 0.96,
        },
      },
      {
        id: 'cluster-count',
        type: 'symbol',
        source: 'places',
        filter: ['has', 'point_count'],
        layout: {
          visibility: 'none',
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': FONT,
          'text-size': 12,
        },
        paint: { 'text-color': '#DEE4E2' },
      },
      {
        id: 'saved-rings',
        type: 'circle',
        source: 'places',
        filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'saved'], true]],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 18, 18, 21],
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': THEME.saved,
          'circle-stroke-width': 1.4,
          'circle-stroke-opacity': 0.8,
        },
      },
      {
        id: 'places-symbol',
        type: 'symbol',
        source: 'places',
        filter: ['!', ['has', 'point_count']],
        layout: {
          visibility: 'none',
          'icon-image': ['concat', 'marker-', ['get', 'category']],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.62, 16, 0.78, 18, 0.94],
          'icon-allow-overlap': true,
          'icon-ignore-placement': false,
        },
        paint: { 'icon-opacity': 1 },
      },
      {
        id: 'obs-symbol',
        type: 'symbol',
        source: 'observations',
        filter: ['!=', ['get', 'kind'], 'message'],
        layout: {
          'icon-image': 'marker-observation',
          'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.6, 18, 0.9],
          'icon-allow-overlap': true,
        },
      },
      {
        id: 'msg-halo',
        type: 'circle',
        source: 'observations',
        filter: ['==', ['get', 'kind'], 'message'],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 13, 18, 21],
          'circle-color': ['case', ['==', ['get', 'state'], 'nearby'], '#E0A458', '#64707C'],
          'circle-opacity': ['case', ['==', ['get', 'state'], 'nearby'], 0.24, 0.11],
          'circle-blur': 0.7,
        },
      },
      {
        id: 'msg-dot',
        type: 'circle',
        source: 'observations',
        filter: ['==', ['get', 'kind'], 'message'],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 5.5, 18, 8],
          'circle-color': ['case', ['==', ['get', 'state'], 'nearby'], '#F0C674', '#7A8590'],
          'circle-stroke-color': ['case', ['==', ['get', 'state'], 'nearby'], '#1A1206', '#10151A'],
          'circle-stroke-width': 1.8,
          'circle-opacity': ['case', ['==', ['get', 'state'], 'nearby'], 1, 0.72],
        },
      },
      {
        id: 'focus-halo',
        type: 'circle',
        source: 'focus',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 20, 18, 26],
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': THEME.selection,
          'circle-stroke-width': 2,
          'circle-stroke-opacity': 0.9,
        },
      },
      {
        id: 'focus-symbol',
        type: 'symbol',
        source: 'focus',
        layout: {
          'icon-image': ['concat', 'marker-', ['get', 'category']],
          'icon-size': 0.82,
          'icon-allow-overlap': true,
        },
      },
      {
        id: 'external-pin',
        type: 'circle',
        source: 'external',
        paint: {
          'circle-radius': 6,
          'circle-color': '#0D1317',
          'circle-stroke-color': THEME.accent,
          'circle-stroke-width': 2,
        },
      },
    ],
  };
  return style;
}

export const EMPTY_FC = empty;
