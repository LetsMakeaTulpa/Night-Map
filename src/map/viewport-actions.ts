/**
 * Filters live in the Nearby workspace while the camera belongs to MapView.
 * These cues let a filter status ask the map to frame matching records without
 * moving camera code out of the map.
 */
export const FIT_RECORDS_EVENT = 'nightmap:fit-records';
export const FIT_COVERAGE_EVENT = 'nightmap:fit-coverage';

export function requestFitRecords(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(FIT_RECORDS_EVENT));
}

export function requestFitCoverage(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(FIT_COVERAGE_EVENT));
}
