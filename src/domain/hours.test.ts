import { describe, expect, it } from 'vitest';
import { isOpenAt, sanFranciscoParts, summarizeHours } from './hours';
import type { HoursSpec } from './types';

// All fixtures are built with explicit UTC instants that correspond to known
// San Francisco local times (PDT = UTC-7, PST = UTC-8).
const weekly: HoursSpec = {
  kind: 'weekly',
  days: [0, 1, 2, 3, 4, 5, 6],
  opens: '08:00',
  closes: '20:00',
  daysKnown: true,
};

describe('San Francisco wall clock', () => {
  it('reads the local weekday and minute regardless of the host timezone', () => {
    // 2026-10-24T15:30:00Z = Saturday 08:30 in San Francisco (PDT).
    const parts = sanFranciscoParts(new Date('2026-10-24T15:30:00Z'));
    expect(parts.day).toBe(6);
    expect(parts.minutes).toBe(8 * 60 + 30);
  });
});

describe('isOpenAt', () => {
  it('returns open inside a simple daily window', () => {
    expect(isOpenAt(weekly, new Date('2026-10-24T17:00:00Z'))).toBe(true); // 10:00 local
  });

  it('returns closed outside the window', () => {
    expect(isOpenAt(weekly, new Date('2026-10-24T07:00:00Z'))).toBe(false); // 00:00 local
  });

  it('handles a window that crosses midnight', () => {
    const overnight: HoursSpec = {
      kind: 'weekly',
      days: [1, 2, 3, 4, 5],
      opens: '22:00',
      closes: '06:00',
      daysKnown: true,
    };
    // Tuesday 23:30 local = Wednesday 06:30 UTC.
    expect(isOpenAt(overnight, new Date('2026-10-28T06:30:00Z'))).toBe(true);
    // Wednesday 03:00 local is the tail of Tuesday's window.
    expect(isOpenAt(overnight, new Date('2026-10-28T10:00:00Z'))).toBe(true);
    // Wednesday 12:00 local is closed.
    expect(isOpenAt(overnight, new Date('2026-10-28T19:00:00Z'))).toBe(false);
  });

  it('respects per-day schedules and returns null without hours', () => {
    const byDay: HoursSpec = {
      kind: 'weekly_by_day',
      days: {
        0: { opens: '12:00', closes: '18:00' },
        6: { opens: '10:00', closes: '18:00' },
      },
      daysKnown: true,
    };
    // Sunday 13:00 local.
    expect(isOpenAt(byDay, new Date('2026-10-25T20:00:00Z'))).toBe(true);
    // Saturday 09:00 local, before opening.
    expect(isOpenAt(byDay, new Date('2026-10-24T16:00:00Z'))).toBe(false);
    expect(isOpenAt(null, new Date())).toBeNull();
  });

  it('treats 24-hour services as always open', () => {
    expect(isOpenAt({ kind: 'always' }, new Date('2026-01-01T09:00:00Z'))).toBe(true);
  });
});

describe('summarizeHours', () => {
  it('groups weekdays and flags unknown day information', () => {
    const weekdays: HoursSpec = {
      kind: 'weekly',
      days: [1, 2, 3, 4, 5],
      opens: '09:00',
      closes: '17:00',
      daysKnown: true,
    };
    expect(summarizeHours(weekdays)?.lines[0]).toEqual({ days: 'Mon – Fri', time: '9am – 5pm' });
    const unknownDays: HoursSpec = {
      kind: 'weekly',
      days: [0, 1, 2, 3, 4, 5, 6],
      opens: '09:00',
      closes: '17:00',
      daysKnown: false,
      rawDays: 'Close Time: 5pm',
    };
    expect(summarizeHours(unknownDays)?.complete).toBe(false);
    expect(summarizeHours(unknownDays)?.note).toContain('Close Time: 5pm');
  });
});
