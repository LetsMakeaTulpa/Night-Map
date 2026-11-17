import { describe, expect, it } from 'vitest';
import { messageMarkerState, MESSAGE_FIX_MAX_AGE_MS, MESSAGE_UNLOCK_RADIUS_M } from './messages';

const anchor = {
  geometry: { type: 'Point' as const, coordinates: [-122.4085, 37.7835] as [number, number] },
};

describe('private message location lock', () => {
  const now = Date.now();
  const fixAtAnchor = (overrides: Partial<{ accuracy: number; at: number }> = {}) => ({
    coordinates: anchor.geometry.coordinates,
    accuracy: 8,
    at: now,
    ...overrides,
  });

  it('unlocks only with a fresh, accurate fix inside the radius', () => {
    const state = messageMarkerState(anchor, fixAtAnchor());
    expect(state.state).toBe('nearby');
    expect(state.reason).toBeNull();
    expect(state.distanceM).toBeLessThan(1);
  });

  it('locks without a fix and distinguishes stale or imprecise fixes', () => {
    expect(messageMarkerState(anchor, null).reason).toBe('no_fix');
    expect(
      messageMarkerState(anchor, fixAtAnchor({ at: now - MESSAGE_FIX_MAX_AGE_MS - 1 }), now).reason,
    ).toBe('stale_fix');
    expect(messageMarkerState(anchor, fixAtAnchor({ accuracy: 45 }), now).reason).toBe('inaccurate_fix');
  });

  it('does not treat a future timestamp as fresh', () => {
    expect(messageMarkerState(anchor, fixAtAnchor({ at: now + 1 }), now).reason).toBe('stale_fix');
  });

  it('refuses a message with an unusable anchor instead of unlocking it', () => {
    const badAnchor = { geometry: { type: 'Point' as const, coordinates: [NaN, 37.7835] as [number, number] } };
    expect(messageMarkerState(badAnchor, fixAtAnchor(), now).reason).toBe('no_anchor');
  });

  it('locks when the fresh fix is outside the unlock radius', () => {
    const state = messageMarkerState(anchor, {
      coordinates: [-122.4095, 37.7835],
      accuracy: 8,
      at: now,
    });
    expect(state.state).toBe('locked');
    expect(state.reason).toBe('too_far');
    expect(state.distanceM).toBeGreaterThan(MESSAGE_UNLOCK_RADIUS_M);
  });

  it('refuses messages without a saved anchor', () => {
    expect(messageMarkerState({ geometry: null }, fixAtAnchor())).toEqual({
      state: 'locked',
      distanceM: null,
      reason: 'no_anchor',
    });
  });
});
