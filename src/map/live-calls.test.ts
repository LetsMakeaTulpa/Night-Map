import { describe, expect, it } from 'vitest';
import { sanitizeCallRows } from './live-calls';

const base = {
  received_datetime: '2026-11-14T20:49:55.000',
  call_type_final_desc: 'TRAFFIC COLLISION',
  priority_final: 'B',
  agency: 'Police',
  onview_flag: 'N',
  sensitive_call: false,
  intersection_name: '14TH ST \\ MISSION ST',
  analysis_neighborhood: 'Mission',
  police_district: 'MISSION',
  intersection_point: { coordinates: [-122.419981512, 37.768273653] as [number, number] },
};

describe('live dispatched calls', () => {
  it('keeps an ordinary place-based call, snapped to the public precision', () => {
    const result = sanitizeCallRows([base]);
    expect(result.collection.features).toHaveLength(1);
    const [feature] = result.collection.features;
    expect(feature.properties.kind).toBe('TRAFFIC COLLISION');
    expect(feature.properties.where).toBe('14TH ST \\ MISSION ST');
    expect(feature.geometry.coordinates[0]).toBeCloseTo(-122.42, 4);
    expect(result.newest).toBe(base.received_datetime);
  });

  it('drops City-withheld sensitive calls without counting them as plotted', () => {
    const result = sanitizeCallRows([{ ...base, sensitive_call: true }]);
    expect(result.collection.features).toHaveLength(0);
    expect(result.dropped.sensitive).toBe(1);
  });

  it('drops categories that describe a person rather than a place', () => {
    const result = sanitizeCallRows([
      { ...base, call_type_final_desc: 'ENCAMPMENT' },
      { ...base, call_type_final_desc: 'WELFARE CHECK' },
      { ...base, call_type_final_desc: 'MENTAL HEALTH' },
      { ...base, call_type_final_desc: 'SUSPICIOUS PERSON' },
      { ...base, call_type_final_desc: 'ASSAULT / BATTERY' },
    ]);
    expect(result.collection.features).toHaveLength(0);
    expect(result.dropped.excluded).toBe(5);
  });

  it('never plots a call outside the app footprint or without a point', () => {
    const result = sanitizeCallRows([
      { ...base, intersection_point: { coordinates: [-122.5, 37.7] } },
      { ...base, intersection_point: undefined },
    ]);
    expect(result.collection.features).toHaveLength(0);
    expect(result.dropped.outside).toBe(1);
    expect(result.dropped.noPoint).toBe(1);
  });
});
