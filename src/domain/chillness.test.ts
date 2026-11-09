import { describe, expect, it } from 'vitest';
import { calculateChillnessScore, chillnessLabel } from './chillness';

describe('chillness score', () => {
  const now = new Date('2026-10-28T12:00:00Z');

  it('requires at least three observed factors', () => {
    expect(calculateChillnessScore({ factors: { quiet: 5, seating: 4 }, observedAt: '2026-10-28T10:00:00Z', contributorType: 'self' }, now)).toBeNull();
  });

  it('normalizes the weights of the factors that were actually answered', () => {
    const score = calculateChillnessScore({ factors: { quiet: 5, seating: 5, shelter: 5 }, observedAt: '2026-10-28T10:00:00Z', contributorType: 'self' }, now);
    expect(score?.score).toBe(100);
    expect(score?.answeredFactors).toBe(3);
    expect(score?.freshness).toBe('recent');
  });

  it('does not treat missing factors as zero', () => {
    const score = calculateChillnessScore({ factors: { quiet: 1, seating: 1, shelter: 1 }, observedAt: '2026-10-28T10:00:00Z', contributorType: 'self' }, now);
    expect(score?.score).toBe(0);
  });

  it('labels the score in plain language', () => {
    expect(chillnessLabel(85)).toBe('Very chill');
    expect(chillnessLabel(55)).toBe('Mixed');
    expect(chillnessLabel(10)).toBe('Not very chill');
  });
});
