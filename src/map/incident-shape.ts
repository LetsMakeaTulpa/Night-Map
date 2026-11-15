/**
 * Shared feature shape and bucketing for incident feeds. Kept separate from
 * incidents.ts so the runtime live client can use it without pulling in the
 * snapshot metadata.
 */
export interface IncidentFeature {
  type: 'Feature';
  properties: {
    kind: string;
    bucket: string;
    at: string;
    subtype?: string | null;
    where?: string | null;
    agency?: string | null;
    priority?: string | null;
    disposition?: string | null;
    status?: string | null;
    neighbourhood?: string | null;
    district?: string | null;
    seenByOfficer?: boolean;
  };
  geometry: { type: 'Point'; coordinates: [number, number] };
}

export interface IncidentCollection {
  type: 'FeatureCollection';
  features: IncidentFeature[];
}

const BUCKETS: [RegExp, string][] = [
  [/fire|medic|ems|rescue/i, 'fire_ems'],
  [/traffic|collision|accident|parking|vehicle|tow/i, 'traffic'],
  [/police|law enforcement|sheriff|disturbance|alarm|suspicious|noise/i, 'police'],
  [/water|sewer|street|sidewalk|tree|graffiti|litter|streetlight|light|pothole|sign/i, 'infrastructure'],
];

export function bucketForIncident(kind: string): string {
  const text = String(kind ?? '');
  for (const [pattern, bucket] of BUCKETS) {
    if (pattern.test(text)) return bucket;
  }
  return 'other';
}
