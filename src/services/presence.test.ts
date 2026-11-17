import { describe, expect, it } from 'vitest';
import { MESSAGE_FIX_MAX_AGE_MS, MESSAGE_MAX_ACCURACY_M } from '../domain/messages';
import { PresenceError, requirePresence, validateGeolocationPosition } from './presence';

const position = (overrides: Partial<{ accuracy: number; timestamp: number }> = {}) => ({
  coords: { latitude: 37.7835, longitude: -122.4085, accuracy: overrides.accuracy ?? 8 },
  timestamp: overrides.timestamp ?? 1_000_000,
});

describe('fresh GPS validation', () => {
  it('accepts a fresh, accurate fix', () => {
    const fix = validateGeolocationPosition(position(), 1_000_000);
    expect(fix.coordinates).toEqual([-122.4085, 37.7835]);
    expect(fix.accuracyM).toBe(8);
  });

  it('rejects a stale fix even when the browser returned one', () => {
    try {
      validateGeolocationPosition(
        position({ timestamp: 1_000_000 - MESSAGE_FIX_MAX_AGE_MS - 1 }),
        1_000_000,
      );
      throw new Error('expected a stale-fix rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(PresenceError);
      expect((error as PresenceError).code).toBe('stale_fix');
    }
  });

  it('rejects a future timestamp instead of treating it as fresh', () => {
    try {
      validateGeolocationPosition(position({ timestamp: 1_000_001 }), 1_000_000);
      throw new Error('expected a stale-fix rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(PresenceError);
      expect((error as PresenceError).code).toBe('stale_fix');
    }
  });

  it('rejects an unusable message anchor before requesting a fix', async () => {
    try {
      await requirePresence([NaN, 37.7835]);
      throw new Error('expected a no-anchor rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(PresenceError);
      expect((error as PresenceError).code).toBe('no_anchor');
    }
  });

  it('rejects an imprecise fix', () => {
    try {
      validateGeolocationPosition(position({ accuracy: MESSAGE_MAX_ACCURACY_M + 1 }), 1_000_000);
      throw new Error('expected an inaccurate-fix rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(PresenceError);
      expect((error as PresenceError).code).toBe('inaccurate_fix');
    }
  });
});
