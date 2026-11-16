import { describe, expect, it } from 'vitest';
import type { PlaceView } from '../state/selectors';
import { circlePolygon, vicinityViews, viewsWithinRadius } from './poi-vicinity';

const CENTER: [number, number] = [-122.4085, 37.7835];

function view(
  id: string,
  category: PlaceView['place']['category'],
  coordinates: [number, number],
  { saved = false, tone = 'official' as PlaceView['evidence']['tone'] } = {},
): PlaceView {
  return {
    place: { id, name: id, category, geometry: { type: 'Point', coordinates } },
    evidence: { tone },
    saved,
  } as unknown as PlaceView;
}

describe('POI vicinity', () => {
  it('keeps every record inside the radius', () => {
    const near = view('near', 'popos', [CENTER[0] + 0.002, CENTER[1]]);
    const far = view('far', 'popos', [CENTER[0] + 0.01, CENTER[1]]);

    expect(viewsWithinRadius([near, far], CENTER, 600)).toEqual([near]);
  });

  it('adds only the ranked essentials beyond the radius', () => {
    const insideA = view('inside-a', 'popos', [CENTER[0] + 0.001, CENTER[1]]);
    const insideB = view('inside-b', 'civic', [CENTER[0], CENTER[1] + 0.001]);
    const farPopos = Array.from({ length: 11 }, (_, index) =>
      view(`far-popos-${index}`, 'popos', [CENTER[0] + 0.02 + index * 0.0001, CENTER[1]]),
    );
    const farWater = view('far-water', 'water', [CENTER[0] + 0.03, CENTER[1]]);
    const farSaved = view('far-saved', 'popos', [CENTER[0] + 0.04, CENTER[1]], { saved: true });

    const shown = vicinityViews(
      [insideA, ...farPopos, farWater, insideB, farSaved],
      CENTER,
      600,
      10,
    );
    const ids = shown.map((entry) => entry.place.id);

    expect(shown).toHaveLength(12);
    expect(ids.slice(0, 4)).toEqual(['inside-a', 'inside-b', 'far-saved', 'far-water']);
    expect(ids).not.toContain('far-popos-10');
  });

  it('can hide everything outside the radius', () => {
    const inside = view('inside', 'water', [CENTER[0], CENTER[1]]);
    const outside = view('outside', 'water', [CENTER[0] + 0.02, CENTER[1]], { saved: true });

    expect(vicinityViews([inside, outside], CENTER, 600, 0)).toEqual([inside]);
  });

  it('draws a closed ring around the centre', () => {
    const ring = circlePolygon(CENTER, 600, 16).geometry.coordinates[0];

    expect(ring).toHaveLength(17);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });
});
