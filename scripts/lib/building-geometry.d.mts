/**
 * Types for building-geometry.mjs, so the TypeScript test suite can import the
 * exact height rules the build script applies instead of restating them.
 */
export type Ring = [number, number][];

export interface HeightRule {
  height: number;
  minHeight: number;
  source: 'tag' | 'levels' | 'type' | 'default';
  grounded: boolean;
}

export declare const LEVEL_HEIGHT_M: number;
export declare const ROOF_M: number;
export declare const DEFAULT_HEIGHT_M: number;
export declare const MIN_HEIGHT_M: number;
export declare const MAX_HEIGHT_M: number;
export declare const MIN_FOOTPRINT_M2: number;
export declare const TYPE_HEIGHTS: [RegExp, number][];

export declare function simplify(points: Ring, tolerance: number): Ring;
export declare function ringAreaM2(ring: Ring): number;
export declare function centreOf(ring: Ring): [number, number];
export declare function parseLength(value: unknown): number | null;
export declare function heightFor(tags?: Record<string, unknown>): HeightRule;
