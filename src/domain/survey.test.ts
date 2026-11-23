import { describe, expect, it } from 'vitest';
import { freshCheckCount, isFreshCheck, latestPlaceChecks, SURVEY_CHECK_DAYS } from './survey';
import type { Observation } from './types';

const observation = (over: Partial<Observation>): Observation => ({
  id: 'obs:1',
  placeId: 'place:1',
  placeName: 'A place',
  geometry: null,
  type: 'resource_present',
  note: 'Confirmed on site.',
  observedAt: '2026-11-01T12:00:00.000Z',
  recordedAt: '2026-11-01T12:00:00.000Z',
  photo: null,
  visibility: 'private',
  verificationStatus: 'unverified',
  updatedAt: '2026-11-01T12:00:00.000Z',
  ...over,
});

describe('nearby survey checks', () => {
  it('keeps the newest confirmation per place and ignores other note types', () => {
    const checks = latestPlaceChecks([
      observation({ id: 'a', observedAt: '2026-11-01T12:00:00.000Z' }),
      observation({ id: 'b', observedAt: '2026-11-10T12:00:00.000Z' }),
      observation({ id: 'c', placeId: 'place:2', observedAt: '2026-11-11T12:00:00.000Z' }),
      observation({ id: 'd', type: 'resource_not_found', observedAt: '2026-11-12T12:00:00.000Z' }),
    ]);
    expect(checks.get('place:1')).toBe('2026-11-10T12:00:00.000Z');
    expect(checks.get('place:2')).toBe('2026-11-11T12:00:00.000Z');
  });

  it('expires a check after the two-week window and rejects invalid dates', () => {
    const now = new Date('2026-11-15T12:00:00.000Z').getTime();
    expect(SURVEY_CHECK_DAYS).toBe(14);
    expect(isFreshCheck('2026-11-01T12:00:00.000Z', now)).toBe(true);
    expect(isFreshCheck('2026-10-01T12:00:00.000Z', now)).toBe(false);
    expect(isFreshCheck('not a date', now)).toBe(false);
    expect(isFreshCheck(undefined, now)).toBe(false);
  });

  it('counts only current checks among the listed places', () => {
    const now = new Date('2026-11-15T12:00:00.000Z').getTime();
    const checks = new Map([
      ['place:1', '2026-11-10T12:00:00.000Z'],
      ['place:2', '2026-09-01T12:00:00.000Z'],
    ]);
    expect(freshCheckCount(checks, ['place:1', 'place:2', 'place:3'], now)).toBe(1);
  });
});
