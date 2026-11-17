import type { LayerDefinition } from '../domain/types';

/**
 * Every visible map element is a registered layer with metadata: source, update
 * cadence, offline availability and minimum zoom.
 */
export const LAYERS: (LayerDefinition & { defaultOpacity?: number })[] = [
  {
    id: 'streets',
    name: 'Streets & pedestrian network',
    description: 'Road, footway and steps geometry from a bundled OpenStreetMap extract.',
    group: 'base',
    sourceIds: ['src:osm-basemap'],
    defaultVisible: true,
    offline: 'bundled',
  },
  {
    id: 'street-labels',
    name: 'Street names',
    description: 'Street name labels, visible from neighbourhood zoom downward.',
    group: 'base',
    sourceIds: ['src:osm-basemap'],
    defaultVisible: true,
    offline: 'bundled',
  },
  {
    id: 'parks',
    name: 'Parks & open space',
    description: 'Named parks, gardens, playgrounds and green space.',
    group: 'base',
    sourceIds: ['src:osm-basemap'],
    defaultVisible: true,
    offline: 'bundled',
  },
  {
    id: 'neighbourhoods',
    name: 'Neighbourhood names',
    description: 'Neighbourhood and quarter labels for orientation.',
    group: 'base',
    sourceIds: ['src:osm-basemap'],
    defaultVisible: true,
    offline: 'bundled',
  },
  {
    id: 'satellite',
    name: 'Satellite / aerial imagery',
    description:
      'Esri World Imagery raster basemap. Capture dates and resolution vary by location; network connection required.',
    group: 'base',
    sourceIds: [],
    defaultVisible: false,
    offline: 'requires_network',
  },
  {
    id: 'terrain',
    name: 'Terrain shading',
    description:
      'Public-domain elevation model at about 7 m per pixel, rendered at true vertical scale (×1, no exaggeration). It shows broad hills and slopes, not kerbs, stairs or walkable grades.',
    group: 'base',
    sourceIds: ['src:aws-terrain-tiles'],
    defaultVisible: false,
    offline: 'cached_on_demand',
    defaultOpacity: 0.32,
  },
  {
    id: 'buildings-3d',
    name: '3D buildings',
    description:
      'Extruded OpenStreetMap footprints, fetched tile by tile at street zoom. Most heights are estimated from storey counts or footprint type; only some are tagged.',
    group: 'base',
    sourceIds: ['src:osm-buildings'],
    defaultVisible: false,
    offline: 'cached_on_demand',
    minZoom: 14.6,
  },
  {
    id: 'transit-lines',
    name: 'Rail & metro lines',
    description: 'Rail, light rail and subway alignments. Not a service-frequency map.',
    group: 'transit',
    sourceIds: ['src:osm-basemap'],
    defaultVisible: false,
    offline: 'bundled',
  },
  {
    id: 'transit-stops',
    name: 'Muni stops',
    description: 'Stop locations from the SFMTA inventory. Not live arrivals.',
    group: 'transit',
    sourceIds: ['src:sfgov-muni-stops'],
    defaultVisible: true,
    offline: 'bundled',
    minZoom: 14,
  },
  {
    id: 'resources',
    name: 'Resources & facilities',
    description: 'Food, water, restrooms, shelter, services, medical, civic and transport places.',
    group: 'resources',
    sourceIds: ['src:sfgov-water-assets', 'src:glide-meals', 'src:stanthonys-dining', 'src:sfpl-main', 'src:hospitality-house', 'src:ucsf-hyde', 'src:curry-senior'],
    defaultVisible: true,
    offline: 'bundled',
    minZoom: 11,
  },
  {
    id: 'saved',
    name: 'Saved places',
    description: 'Places you saved on this device. Private to this browser.',
    group: 'personal',
    sourceIds: [],
    defaultVisible: true,
    offline: 'bundled',
  },
  {
    id: 'observations',
    name: 'My field notes',
    description: 'Private observations you recorded on this device. Never published.',
    group: 'personal',
    sourceIds: [],
    defaultVisible: false,
    offline: 'bundled',
  },
  {
    id: 'private-messages',
    name: 'Private messages',
    description:
      'Location-locked messages left on this device. Gold marks one that is nearby; grey marks one that is locked until you return with a fresh GPS fix.',
    group: 'personal',
    sourceIds: [],
    defaultVisible: true,
    offline: 'bundled',
  },
  {
    id: 'calls-recent',
    name: 'Dispatched calls (live, 10-min delay)',
    description:
      'Police, fire and other dispatched calls from the City’s CAD extract, refreshed every two minutes while this layer is on. The City delays it ten minutes and withholds sensitive calls; open calls are absent and there is no audio. Falls back to the bundled snapshot offline.',
    group: 'context',
    sourceIds: ['src:sfgov-calls-realtime'],
    defaultVisible: false,
    offline: 'cached_on_demand',
    minZoom: 12,
  },
  {
    id: 'maintenance',
    name: 'Public-realm maintenance reports',
    description:
      'A filtered view of public 311 requests for streetlights, street/sidewalk cleaning, public graffiti, litter receptacles, street defects and blocked public ways. These are requests, not verified defects or a danger score; the nightly snapshot is capped by service type.',
    group: 'context',
    sourceIds: ['src:sfgov-cases311'],
    defaultVisible: false,
    offline: 'cached_on_demand',
    minZoom: 13.4,
  },
  {
    id: 'cases-311',
    name: '311 service requests (7 days)',
    description:
      'Recent 311 service requests from the City nightly snapshot. Requests may already be resolved or scheduled, the snapshot is capped by service type, and categories describing a person rather than a place are excluded before publication.',
    group: 'context',
    sourceIds: ['src:sfgov-cases311'],
    defaultVisible: false,
    offline: 'cached_on_demand',
    minZoom: 13.4,
  },
  {
    id: 'abandoned-buildings',
    name: 'Abandoned & vacant buildings',
    description:
      'Parcels with a City complaint or notice describing a vacant, abandoned or derelict condition, marked with a blue glow. Only parcels the City placed on the map are plotted; dossiers with no published point stay in the Buildings table. A marker is a record, not a confirmed empty building.',
    group: 'context',
    sourceIds: ['src:sfgov-dbi-complaints', 'src:sfgov-dbi-novs'],
    defaultVisible: true,
    offline: 'cached_on_demand',
    minZoom: 11.5,
  },
  {
    id: 'building-registry',
    name: 'Building registry dossiers',
    description:
      'Parcels with a DBI complaint, notice of violation or demolition record describing a vacant, abandoned or derelict condition. A dot is a parcel with City records, not a confirmed empty building; 2,043 dossiers have no position and are table-only, and 64 are placed at a labelled block centroid.',
    group: 'context',
    sourceIds: ['src:sfgov-dbi-complaints', 'src:sfgov-dbi-permits', 'src:sfgov-dbi-novs'],
    defaultVisible: false,
    offline: 'cached_on_demand',
    minZoom: 13.6,
  },
  {
    id: 'mapillary-coverage',
    name: 'Mapillary photo coverage',
    description:
      'Street-level photo sequences and image positions contributed to Mapillary. Crowd-sourced and incomplete, sometimes years old; use it to see where photos exist before opening Street-level imagery. Needs a free Mapillary client token and a network connection.',
    group: 'context',
    sourceIds: [],
    defaultVisible: false,
    offline: 'requires_network',
    minZoom: 11.4,
  },
];

export const LAYER_BY_ID = new Map(LAYERS.map((l) => [l.id, l]));

export const LAYER_PRESETS = [
  {
    id: 'essentials',
    name: 'Essentials',
    description: 'Streets, parks, neighbourhood names and resource markers.',
  },
  {
    id: 'resources',
    name: 'Resources',
    description: 'Adds Muni stops to the essentials for trip planning.',
  },
  {
    id: 'transit',
    name: 'Transit',
    description: 'Muni stops and rail alignments with minimal resource clutter.',
  },
  {
    id: 'notes',
    name: 'My field notes',
    description: 'Your private observations and saved places, with resource context.',
  },
  {
    id: 'threed',
    name: '3D & terrain',
    description: 'Relief shading and extruded buildings with street detail. Pair it with the 3D control to tilt the camera.',
  },
  {
    id: 'incidents',
    name: 'Reported activity',
    description:
      'Recent dispatched calls and 311 requests as published snapshots, with no live feed and nothing that names a person.',
  },
  {
    id: 'scenes-hideaways',
    name: 'Scenes & hideaways',
    description: 'Public spaces, POPOS, food and mutual aid, plus curated DIY and music-scene records when verified. No history layer.',
  },
  {
    id: 'vacant',
    name: 'Building registry',
    description:
      'Parcel dossiers from DBI records over extruded footprints. A dot marks a parcel with records, not a building that is empty today.',
  },
] as const;

export type LayerPresetId = (typeof LAYER_PRESETS)[number]['id'];
