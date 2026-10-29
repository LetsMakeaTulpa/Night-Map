import { describe, expect, it } from 'vitest';
import { CIVIC_SOURCES } from './civic-source-catalog';

describe('civic source catalog', () => {
  it('has unique IDs and valid source links', () => {
    expect(new Set(CIVIC_SOURCES.map((s) => s.id)).size).toBe(CIVIC_SOURCES.length);
    for (const source of CIVIC_SOURCES) expect(source.url.startsWith('https://')).toBe(true);
  });

  it('distinguishes integrated snapshots from planned and access-controlled sources', () => {
    expect(CIVIC_SOURCES.find((s) => s.id === 'sf311-cases')?.status).toBe('integrated_snapshot');
    expect(CIVIC_SOURCES.find((s) => s.id === '511-transit-realtime')?.auth).toBe('api_key');
    expect(CIVIC_SOURCES.find((s) => s.id === 'nextdoor-public-content')?.status).toBe('access_requested');
  });

  it('requires coarse aggregation and caveats for safety-sensitive feeds', () => {
    const safety = CIVIC_SOURCES.filter((s) => ['dispatch', 'crime_reports', 'fire_ems', '311'].includes(s.domain));
    for (const source of safety) {
      expect(source.caveats.length).toBeGreaterThan(0);
      expect(source.use.length).toBeGreaterThan(0);
    }
  });
});
