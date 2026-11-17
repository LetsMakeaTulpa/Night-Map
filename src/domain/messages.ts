import type { Observation } from './types';
import { haversineMeters } from './geo';

/** A message is only accepted from a fresh, reasonably precise GPS fix. */
export const MESSAGE_FIX_MAX_AGE_MS = 15_000;
export const MESSAGE_MAX_ACCURACY_M = 30;
export const MESSAGE_UNLOCK_RADIUS_M = 30;

export interface MessageFix {
  coordinates: [number, number];
  accuracy: number;
  at: number;
}

export type MessageLockReason =
  | 'no_anchor'
  | 'no_fix'
  | 'stale_fix'
  | 'inaccurate_fix'
  | 'too_far';

export interface MessageMarkerState {
  state: 'locked' | 'nearby';
  distanceM: number | null;
  reason: MessageLockReason | null;
}

export function isValidCoordinates(coordinates: unknown): coordinates is [number, number] {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return false;
  const [longitude, latitude] = coordinates;
  return (
    Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    Math.abs(longitude) <= 180 &&
    Math.abs(latitude) <= 90
  );
}

/** A fix counts only after it was taken and before the freshness window ends. */
export function isFixFresh(fix: Pick<MessageFix, 'at'>, now = Date.now()): boolean {
  const age = now - fix.at;
  return Number.isFinite(age) && age >= 0 && age <= MESSAGE_FIX_MAX_AGE_MS;
}

export function isFixAccurate(fix: Pick<MessageFix, 'accuracy'>): boolean {
  return Number.isFinite(fix.accuracy) && fix.accuracy > 0 && fix.accuracy <= MESSAGE_MAX_ACCURACY_M;
}

/**
 * Decide whether a message may be opened. A cached or imprecise fix never
 * unlocks one; it must be fresh and within the same radius used for editing.
 */
export function messageMarkerState(
  message: Pick<Observation, 'geometry'>,
  fix: MessageFix | null,
  now = Date.now(),
): MessageMarkerState {
  if (!message.geometry || !isValidCoordinates(message.geometry.coordinates)) {
    return { state: 'locked', distanceM: null, reason: 'no_anchor' };
  }
  if (!fix || !isValidCoordinates(fix.coordinates)) {
    return { state: 'locked', distanceM: null, reason: 'no_fix' };
  }

  const distanceM = haversineMeters(message.geometry.coordinates, fix.coordinates);

  if (!isFixAccurate(fix)) {
    return { state: 'locked', distanceM, reason: 'inaccurate_fix' };
  }
  if (!isFixFresh(fix, now)) {
    return { state: 'locked', distanceM, reason: 'stale_fix' };
  }
  if (distanceM > MESSAGE_UNLOCK_RADIUS_M) {
    return { state: 'locked', distanceM, reason: 'too_far' };
  }

  return { state: 'nearby', distanceM, reason: null };
}
