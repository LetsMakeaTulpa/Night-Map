/**
 * Every Door-style field checks: a place is confirmed by standing in front of
 * it, and the confirmation ages out so a stale check is never mistaken for a
 * current one. Checks are private observations, not edits to any City record.
 */
import type { Observation } from './types';

export const SURVEY_CHECK_DAYS = 14;
const WINDOW_MS = SURVEY_CHECK_DAYS * 86400_000;

/** The newest on-site confirmation per place. Only `resource_present` counts. */
export function latestPlaceChecks(observations: Observation[]): Map<string, string> {
  const latest = new Map<string, string>();
  for (const observation of observations) {
    if (observation.type !== 'resource_present' || !observation.placeId) continue;
    const previous = latest.get(observation.placeId);
    if (!previous || observation.observedAt > previous) {
      latest.set(observation.placeId, observation.observedAt);
    }
  }
  return latest;
}

/** A confirmation is current for two weeks, matching the check-date convention. */
export function isFreshCheck(observedAt: string | undefined, now = Date.now()): boolean {
  if (!observedAt) return false;
  const then = new Date(observedAt).getTime();
  if (!Number.isFinite(then)) return false;
  const age = now - then;
  return age >= 0 && age <= WINDOW_MS;
}

/** Counts how many of the given places have a current confirmation. */
export function freshCheckCount(checkByPlace: Map<string, string>, placeIds: string[], now = Date.now()): number {
  return placeIds.filter((id) => isFreshCheck(checkByPlace.get(id), now)).length;
}
