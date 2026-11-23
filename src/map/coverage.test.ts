import { describe, expect, it } from 'vitest';
import { nearestCoveredEdge } from './coverage';

/** The installed Downtown · SoMa · Tenderloin extract. */
const BBOX = [-122.429, 37.7585, -122.3905, 37.7975] as const;

describe('nearestCoveredEdge', () => {
  it('points west from a point beyond the eastern edge', () => {
    const info = nearestCoveredEdge([-122.35, 37.78], BBOX);

    expect(info).not.toBeNull();
    expect(info!.direction).toBe('west');
    expect(info!.point[0]).toBeCloseTo(-122.3905, 6);
    expect(info!.point[1]).toBeCloseTo(37.78, 6);
    expect(info!.distanceMeters).toBeGreaterThan(1_000);
  });

  it('points north from a point outside the southern edge', () => {
    const info = nearestCoveredEdge([-122.41, 37.74], BBOX);

    expect(info!.direction).toBe('north');
    expect(info!.point[1]).toBeCloseTo(37.7585, 6);
  });

  it('points east from a point beyond the western edge', () => {
    const info = nearestCoveredEdge([-122.45, 37.78], BBOX);

    expect(info!.direction).toBe('east');
    expect(info!.point[0]).toBeCloseTo(-122.429, 6);
  });

  it('points west from an inside point closest to the western edge', () => {
    const info = nearestCoveredEdge([-122.4285, 37.78], BBOX);

    expect(info!.direction).toBe('west');
    expect(info!.point[0]).toBeCloseTo(-122.429, 6);
  });

  it('points north from an inside point closest to the northern edge', () => {
    const info = nearestCoveredEdge([-122.4085, 37.795], BBOX);

    expect(info!.direction).toBe('north');
    expect(info!.point[1]).toBeCloseTo(37.7975, 6);
  });

  it('rejects a point without finite coordinates', () => {
    expect(nearestCoveredEdge([Number.NaN, 37.78], BBOX)).toBeNull();
  });
});
