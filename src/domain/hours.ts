import type { HoursSpec } from './types';

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const toMinutes = (clock: string) => {
  const [h, m] = clock.split(':').map(Number);
  return h * 60 + m;
};

/** Wall-clock parts for San Francisco, independent of the device timezone. */
export function sanFranciscoParts(date: Date): { day: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
  return { day: day < 0 ? 0 : day, minutes: (hour % 24) * 60 + minute };
}

/** Returns true/false when the hours are known, null when they cannot decide. */
export function isOpenAt(hours: HoursSpec | null, date: Date): boolean | null {
  if (!hours) return null;
  if (hours.kind === 'always') return true;
  const { day, minutes } = sanFranciscoParts(date);

  if (hours.kind === 'weekly') {
    const open = toMinutes(hours.opens);
    const close = toMinutes(hours.closes);
    if (close > open) {
      return hours.days.includes(day) && minutes >= open && minutes < close;
    }
    // Window crosses midnight: today's evening, or the tail of yesterday's window.
    const yesterday = (day + 6) % 7;
    return (
      (hours.days.includes(day) && minutes >= open) ||
      (hours.days.includes(yesterday) && minutes < close)
    );
  }

  const today = hours.days[day];
  if (today) {
    const open = toMinutes(today.opens);
    const close = toMinutes(today.closes);
    if (close > open) return minutes >= open && minutes < close;
    if (minutes >= open) return true;
  }
  const yesterdayWindow = hours.days[(day + 6) % 7];
  if (yesterdayWindow) {
    const open = toMinutes(yesterdayWindow.opens);
    const close = toMinutes(yesterdayWindow.closes);
    if (close <= open && minutes < close) return true;
  }
  // Early morning spillover from a window listed on yesterday only.
  return false;
}

const show = (clock: string) => {
  const [h, m] = clock.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, '0')}${suffix}`;
};

export interface HoursSummary {
  lines: { days: string; time: string }[];
  note: string | null;
  complete: boolean;
}

export function summarizeHours(hours: HoursSpec | null): HoursSummary | null {
  if (!hours) return null;
  if (hours.kind === 'always') {
    return { lines: [{ days: 'Every day', time: '24 hours' }], note: hours.note ?? null, complete: true };
  }
  if (hours.kind === 'weekly') {
    const days = hours.daysKnown ? groupDays(hours.days) : 'Days not stated in source';
    return {
      lines: [{ days, time: `${show(hours.opens)} – ${show(hours.closes)}` }],
      note: hours.daysKnown
        ? null
        : `The source gives hours but not weekdays${hours.rawDays ? ` (raw value: “${hours.rawDays}”)` : ''}.`,
      complete: hours.daysKnown,
    };
  }
  const lines = Object.keys(hours.days)
    .map(Number)
    .sort()
    .map((d) => ({
      days: DAY_SHORT[d],
      time: `${show(hours.days[d].opens)} – ${show(hours.days[d].closes)}`,
    }));
  return { lines, note: null, complete: lines.length > 0 };
}

function groupDays(days: number[]): string {
  if (days.length === 7) return 'Every day';
  if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return 'Mon – Fri';
  if (days.length === 2 && days.includes(0) && days.includes(6)) return 'Weekends';
  return [...days].sort().map((d) => DAY_SHORT[d]).join(', ');
}

/** "Closes 8pm" style hint used on cards; never asserts current availability. */
export function nextBoundary(hours: HoursSpec | null, date: Date): string | null {
  if (!hours || hours.kind === 'always') return null;
  const open = isOpenAt(hours, date);
  if (open === null) return null;
  const { day, minutes } = sanFranciscoParts(date);
  if (hours.kind === 'weekly') {
    return open ? `Closes ${show(hours.closes)}` : `Opens ${show(hours.opens)}`;
  }
  if (open) {
    const today = hours.days[day];
    return today ? `Closes ${show(today.closes)}` : null;
  }
  const today = hours.days[day];
  if (today && minutes < toMinutes(today.opens)) return `Opens ${show(today.opens)}`;
  const tomorrow = hours.days[(day + 1) % 7];
  return tomorrow ? `Opens ${show(tomorrow.opens)} tomorrow` : 'Closed today';
}
