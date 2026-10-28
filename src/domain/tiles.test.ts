import { describe, expect, it } from 'vitest';
import { lonToTileX, tileKeysForBbox, tileKeysForView, metersPerPixel, tileRangeForBbox } from './tiles';

describe('web-mercator tiles', () => {
  it('places the footprint on the tiles the extract ships', () => {
    expect(lonToTileX(-122.4275, 14)).toBe(2620);
    expect(lonToTileX(-122.3905, 14)).toBe(2621);
  });

  it('enumerates a contiguous grid for a bounding box', () => {
    const bbox: [number, number, number, number] = [37.7585, -122.4275, 37.7975, -122.3905];
    const keys = tileKeysForBbox(bbox, 14);
    const range = tileRangeForBbox(bbox, 14);
    expect(keys.length).toBe((range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1));
    expect(keys).toContain('14/2620/6331');
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('selects only the tiles a view touches, and only ones that exist', () => {
    const view = { west: -122.424, south: 37.786, east: -122.416, north: 37.792 };
    expect(tileKeysForView(view, 14, ['14/2620/6331', '14/2621/6333'])).toEqual(['14/2620/6331']);
    expect(tileKeysForView(view, 14, [])).toEqual([]);
  });

  it('reports ground resolution so tile weight can be described', () => {
    expect(metersPerPixel(37.78, 14)).toBeCloseTo(7.6, 0);
  });
});
