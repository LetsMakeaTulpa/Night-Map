/**
 * Types for incidents.mjs, so the TypeScript tests can assert the same rules the
 * build script enforces — especially the exclusions.
 */
export declare const COORD_PRECISION: number;
export declare const EXCLUDED_TYPE_PATTERNS: RegExp[];
export declare const DROPPED_FIELDS: string[];

export declare function snapCoordinate(value: unknown, precision?: number): number | null;
export declare function snapPoint(
  lon: unknown,
  lat: unknown,
  precision?: number,
): [number, number] | null;
export declare function isExcludedType(type: unknown): boolean;
export declare function bucketFor(type: unknown): 'fire_ems' | 'traffic' | 'police' | 'infrastructure' | 'other';
export declare function describeLag(newestIso: string | null, now?: Date): string;
export declare function toQuarterHour(iso: string): string | null;
export declare function summariseFeed(input: {
  id: string;
  name: string;
  rows?: number;
  newest?: string | null;
  oldest?: string | null;
  now?: Date;
  note?: string;
}): { id: string; name: string; rows: number; newest: string | null; oldest: string | null; lag: string; note: string };
