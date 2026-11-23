import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HEIGHT_M,
  LEVEL_HEIGHT_M,
  heightFor,
  parseLength,
  ringAreaM2,
  simplify,
} from '../../scripts/lib/building-geometry.mjs';

// These rules are what stands between a viewer and a fictional skyline, so they
// are tested against the exact module the build script runs.

describe('parseLength', () => {
  it('reads the forms OpenStreetMap actually uses', () => {
    expect(parseLength('12')).toBe(12);
    expect(parseLength('12 m')).toBe(12);
    expect(parseLength('12.5 m')).toBe(12.5);
    expect(parseLength('12,5')).toBe(12.5);
    expect(parseLength('40 ft')).toBeCloseTo(12.192, 3);
    expect(parseLength("45'")).toBeCloseTo(13.716, 3);
  });

  it('refuses anything it cannot read instead of guessing', () => {
    expect(parseLength(undefined)).toBeNull();
    expect(parseLength(null)).toBeNull();
    expect(parseLength('')).toBeNull();
    expect(parseLength('tall')).toBeNull();
    expect(parseLength('0')).toBeNull();
    expect(parseLength('-4')).toBeNull();
  });
});

describe('heightFor', () => {
  it('prefers a tagged height and does not call it an estimate', () => {
    const rule = heightFor({ building: 'office', height: '88', 'building:levels': '30' });
    expect(rule.height).toBe(88);
    expect(rule.source).toBe('tag');
    expect(rule.grounded).toBe(true);
  });

  it('falls back to storeys with a roof allowance', () => {
    const rule = heightFor({ building: 'apartments', 'building:levels': '4' });
    expect(rule.height).toBeCloseTo(4 * LEVEL_HEIGHT_M + 0.4, 5);
    expect(rule.source).toBe('levels');
    expect(rule.grounded).toBe(true);
  });

  it('marks a footprint-type default as a guess', () => {
    const garage = heightFor({ building: 'garages' });
    expect(garage.height).toBe(3);
    expect(garage.source).toBe('type');
    expect(garage.grounded).toBe(false);

    const unmapped = heightFor({ building: 'something_unmapped' });
    expect(unmapped.height).toBe(DEFAULT_HEIGHT_M);
    expect(unmapped.source).toBe('default');
  });

  it('keeps a building part above the ground it starts from', () => {
    const rule = heightFor({ 'building:part': 'yes', height: '40', min_height: '12' });
    expect(rule.height).toBe(40);
    expect(rule.minHeight).toBe(12);
  });

  it('drops a base that would swallow its own top', () => {
    expect(heightFor({ height: '10', min_height: '30' }).minHeight).toBe(0);
  });

  it('clamps absurd tags rather than letting one value dwarf the city', () => {
    expect(heightFor({ height: '9000' }).height).toBe(330);
    expect(heightFor({ height: '0.5' }).height).toBe(2.5);
  });
});

describe('ringAreaM2', () => {
  it('measures a city block in square metres', () => {
    const ring: [number, number][] = [
      [-122.41, 37.785],
      [-122.4091, 37.785],
      [-122.4091, 37.7859],
      [-122.41, 37.7859],
      [-122.41, 37.785],
    ];
    const area = ringAreaM2(ring);
    expect(area).toBeGreaterThan(7000);
    expect(area).toBeLessThan(8600);
  });

  it('returns nothing for a ring that cannot have area', () => {
    expect(ringAreaM2([[0, 0], [1, 1]])).toBe(0);
  });
});

describe('simplify', () => {
  it('keeps the ends and drops a point a straight line already covers', () => {
    const line: [number, number][] = [[0, 0], [0.0001, 0.0000005], [0.0002, 0]];
    expect(simplify(line, 0.00002)).toEqual([[0, 0], [0.0002, 0]]);
  });
});
