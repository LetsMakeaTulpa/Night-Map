import { haversineMeters } from '../domain/geo';
import {
  isFixFresh,
  isValidCoordinates,
  MESSAGE_MAX_ACCURACY_M,
  MESSAGE_UNLOCK_RADIUS_M,
} from '../domain/messages';

export type PresenceErrorCode =
  | 'unsupported'
  | 'insecure'
  | 'denied'
  | 'unavailable'
  | 'timeout'
  | 'stale_fix'
  | 'inaccurate_fix'
  | 'no_anchor'
  | 'too_far';

export class PresenceError extends Error {
  readonly code: PresenceErrorCode;

  constructor(code: PresenceErrorCode, message: string) {
    super(message);
    this.name = 'PresenceError';
    this.code = code;
  }
}

export interface PresenceFix {
  coordinates: [number, number];
  accuracyM: number;
  verifiedAt: string;
  timestamp: number;
  /** Set only when checking an existing message anchor. */
  locationDistanceM?: number;
}

interface RawPosition {
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number;
  };
  timestamp: number;
}

/**
 * Validate a browser geolocation result. `maximumAge: 0` is advisory in some
 * browsers, so the timestamp is checked here as well as at the call site.
 */
export function validateGeolocationPosition(position: RawPosition, now = Date.now()): PresenceFix {
  const { latitude, longitude, accuracy } = position.coords;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    throw new PresenceError('unavailable', 'The device returned an invalid position.');
  }

  if (!Number.isFinite(accuracy) || accuracy <= 0 || accuracy > MESSAGE_MAX_ACCURACY_M) {
    const shown = Number.isFinite(accuracy) ? `±${Math.round(accuracy)} m` : 'unknown accuracy';
    throw new PresenceError(
      'inaccurate_fix',
      `GPS accuracy is ${shown}; a fix within ±${MESSAGE_MAX_ACCURACY_M} m is required. Move into the open and try again.`,
    );
  }

  const timestamp = Number(position.timestamp);
  if (!Number.isFinite(timestamp) || !isFixFresh({ at: timestamp }, now)) {
    throw new PresenceError(
      'stale_fix',
      'The GPS fix is stale. Turn on GPS lock and try again from where you are standing.',
    );
  }

  return {
    coordinates: [longitude, latitude],
    accuracyM: accuracy,
    verifiedAt: new Date(now).toISOString(),
    timestamp,
  };
}

/** Always request a new fix; never accept the location already held in state. */
export function getFreshFix(): Promise<PresenceFix> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.reject(
      new PresenceError('unsupported', 'This browser does not expose location. A message cannot be placed.'),
    );
  }
  if (typeof window === 'undefined' || !window.isSecureContext) {
    return Promise.reject(
      new PresenceError('insecure', 'Location needs a secure (https or localhost) context.'),
    );
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        try {
          resolve(validateGeolocationPosition(position));
        } catch (error) {
          reject(error);
        }
      },
      (error) => {
        if (error.code === 1) {
          reject(new PresenceError('denied', 'Location permission was denied. Messages cannot be placed or edited.'));
        } else if (error.code === 3) {
          reject(
            new PresenceError(
              'timeout',
              'No GPS fix arrived in time. Move into the open, turn on GPS lock, and try again.',
            ),
          );
        } else {
          reject(new PresenceError('unavailable', 'The device could not determine its location.'));
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
  });
}

/**
 * Require a fresh fix. When an anchor is supplied, the fix must also be within
 * the message unlock radius. This is the only gate used by create, edit and
 * delete; the UI cannot bypass it.
 */
export async function requirePresence(anchor?: [number, number]): Promise<PresenceFix> {
  if (anchor && !isValidCoordinates(anchor)) {
    throw new PresenceError(
      'no_anchor',
      'This message has no usable saved location, so its location lock cannot be checked.',
    );
  }
  const fix = await getFreshFix();
  if (!anchor) return fix;

  const distanceM = haversineMeters(anchor, fix.coordinates);
  if (distanceM > MESSAGE_UNLOCK_RADIUS_M) {
    throw new PresenceError(
      'too_far',
      `You are ${Math.round(distanceM)} m from this message. Move within ${MESSAGE_UNLOCK_RADIUS_M} m and try again.`,
    );
  }

  return { ...fix, locationDistanceM: distanceM };
}
