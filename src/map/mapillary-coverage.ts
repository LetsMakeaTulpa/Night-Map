import type { Map as MapLibreMap, VectorTileSource } from 'maplibre-gl';
import { mapillaryCoverageTileUrl } from '../services/mapillary';

export const MAPILLARY_COVERAGE_SOURCE = 'mapillaryCoverage';
export const MAPILLARY_COVERAGE_LINES = 'mapillary-coverage-lines';
export const MAPILLARY_COVERAGE_IMAGES = 'mapillary-coverage-images';

const LABELS_LAYER = 'street-labels';
const COVERAGE_COLOR = '#5FC9A8';

/**
 * Mount the public Mapillary coverage tiles. The source carries sequence lines
 * between z6 and z14 and individual image positions at z14, so the same layer
 * tells the truth at both neighbourhood and street zoom without fetching image
 * metadata or thumbnails.
 */
export function addMapillaryCoverage(map: MapLibreMap, token: string): void {
  const tiles = [mapillaryCoverageTileUrl(token)];
  const held = map.getSource(MAPILLARY_COVERAGE_SOURCE) as VectorTileSource | undefined;
  if (held) {
    held.setTiles(tiles);
  } else {
    map.addSource(MAPILLARY_COVERAGE_SOURCE, {
      type: 'vector',
      tiles,
      minzoom: 0,
      maxzoom: 14,
      attribution: '© Mapillary contributors',
    });
  }

  const before = map.getLayer(LABELS_LAYER) ? LABELS_LAYER : undefined;
  if (!map.getLayer(MAPILLARY_COVERAGE_LINES)) {
    map.addLayer(
      {
        id: MAPILLARY_COVERAGE_LINES,
        type: 'line',
        source: MAPILLARY_COVERAGE_SOURCE,
        'source-layer': 'sequence',
        minzoom: 11,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': COVERAGE_COLOR,
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.8, 14, 2.2, 18, 2.8],
          'line-opacity': 0.52,
        },
      },
      before,
    );
  }
  if (!map.getLayer(MAPILLARY_COVERAGE_IMAGES)) {
    map.addLayer(
      {
        id: MAPILLARY_COVERAGE_IMAGES,
        type: 'circle',
        source: MAPILLARY_COVERAGE_SOURCE,
        'source-layer': 'image',
        minzoom: 14,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 1.6, 18, 3],
          'circle-color': COVERAGE_COLOR,
          'circle-opacity': 0.55,
          'circle-stroke-color': '#06120F',
          'circle-stroke-width': 0.8,
        },
      },
      before,
    );
  }
}

export function removeMapillaryCoverage(map: MapLibreMap): void {
  for (const id of [MAPILLARY_COVERAGE_IMAGES, MAPILLARY_COVERAGE_LINES]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(MAPILLARY_COVERAGE_SOURCE)) map.removeSource(MAPILLARY_COVERAGE_SOURCE);
}
