/**
 * Coverage detection runs against what a reader can actually see.
 *
 * `Map#getBounds()` describes the whole canvas, including the strip behind the
 * workspace panel, the inspector or a dock. A footprint that exists only under
 * one of those is not visible, so it must not silence the blank-map notice.
 */

export type CoverageBbox = readonly [west: number, south: number, east: number, north: number];
export type LonLat = readonly [lng: number, lat: number];

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The unobstructed part of the canvas, in pixels from its top-left corner. */
export interface Aperture {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type OverlayEdge = 'left' | 'right' | 'top' | 'bottom';

export interface ApertureOverlay {
  box: Box;
  /** The canvas edge the overlay hangs from, so its inset lands there. */
  edge: OverlayEdge;
}

export interface ApertureMeasurement {
  /** The unobstructed map area, or null when no map pixel is visible. */
  aperture: Aperture | null;
  /**
   * The canvas or the overlays leave no visible map at all. This is a layout
   * state, not an assertion that the camera is beyond the data boundary.
   */
  fullyHidden: boolean;
}

/**
 * Shrink the canvas by the overlays docked to its edges. Each overlay is
 * classified by the edge it belongs to rather than by its shape: a centred
 * bottom dock and a full-height side panel are both rectangles, but they hide
 * map from different edges.
 */
export function visibleAperture(
  canvas: Box,
  overlays: readonly ApertureOverlay[],
): ApertureMeasurement {
  const width = canvas.right - canvas.left;
  const height = canvas.bottom - canvas.top;
  // A zero-area canvas is fully hidden too: on a phone an expanded sheet can
  // take the whole map column, even though the sheet does not geometrically
  // overlap the canvas. Either way there is no map to describe.
  if (width <= 0 || height <= 0) return { aperture: null, fullyHidden: true };

  let left = 0;
  let top = 0;
  let right = width;
  let bottom = height;

  for (const { box, edge } of overlays) {
    if (
      box.right <= canvas.left ||
      box.left >= canvas.right ||
      box.bottom <= canvas.top ||
      box.top >= canvas.bottom
    ) {
      continue;
    }
    if (edge === 'left') left = Math.max(left, box.right - canvas.left);
    else if (edge === 'right') right = Math.min(right, box.left - canvas.left);
    else if (edge === 'top') top = Math.max(top, box.bottom - canvas.top);
    else bottom = Math.min(bottom, box.top - canvas.top);
  }

  if (right - left < 1 || bottom - top < 1) {
    return { aperture: null, fullyHidden: true };
  }
  return { aperture: { left, top, right, bottom }, fullyHidden: false };
}

function insideBbox([lng, lat]: LonLat, bbox: CoverageBbox) {
  const [west, south, east, north] = bbox;
  return lng >= west && lng <= east && lat >= south && lat <= north;
}

/** Ray casting; the ring may be any simple polygon, not only a rectangle. */
function insideRing(point: LonLat, ring: readonly LonLat[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (
      (yi > point[1]) !== (yj > point[1]) &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Degrees are small numbers, so an absolute epsilon avoids float noise only. */
const ORIENT_EPSILON = 1e-12;

function cross(a: LonLat, b: LonLat, c: LonLat) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsCross(a: LonLat, b: LonLat, c: LonLat, d: LonLat) {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return (
    ((abC > ORIENT_EPSILON && abD < -ORIENT_EPSILON) || (abC < -ORIENT_EPSILON && abD > ORIENT_EPSILON)) &&
    ((cdA > ORIENT_EPSILON && cdB < -ORIENT_EPSILON) || (cdA < -ORIENT_EPSILON && cdB > ORIENT_EPSILON))
  );
}

/**
 * True when any part of `bbox` falls inside the aperture described by its
 * unprojected corners. A level camera gives a lon/lat rectangle, but a tilted
 * or rotated camera gives a general quad, so the test stays polygon based.
 */
export function apertureShowsCoverage(corners: readonly LonLat[], bbox: CoverageBbox): boolean {
  if (corners.length < 3 || corners.some(([lng, lat]) => !Number.isFinite(lng) || !Number.isFinite(lat))) {
    return false;
  }
  if (corners.some((point) => insideBbox(point, bbox))) return true;

  const [west, south, east, north] = bbox;
  const rectangle: LonLat[] = [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
  ];
  // Covers the case where the extract sits wholly inside the aperture.
  if (rectangle.some((point) => insideRing(point, corners))) return true;

  for (let i = 0; i < corners.length; i += 1) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    for (let j = 0; j < rectangle.length; j += 1) {
      if (segmentsCross(a, b, rectangle[j], rectangle[(j + 1) % rectangle.length])) return true;
    }
  }
  return false;
}

export type CoverageView = 'outside' | 'partial' | 'inside';

/** Adds the layout state where no map pixel is visible at all. */
export type CoverageViewState = CoverageView | 'hidden';

/**
 * A bounded extract inside a convex rectangle is covered completely when all
 * four aperture corners are inside it. Anything that shows mapped ground but
 * reaches beyond the boundary is a partial edge, not the full outside state.
 */
export function coverageInAperture(corners: readonly LonLat[], bbox: CoverageBbox): CoverageView {
  if (!apertureShowsCoverage(corners, bbox)) return 'outside';
  return corners.every((point) => insideBbox(point, bbox)) ? 'inside' : 'partial';
}
