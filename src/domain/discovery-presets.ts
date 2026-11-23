import type { CategoryId, Filters } from './types';

export type QuickViewId = 'essentials' | 'after-dark' | 'connections' | 'scenes' | 'still-running';

/** Stable order for the chip row; counts and labels are keyed off the same ids. */
export const QUICK_VIEW_IDS: readonly QuickViewId[] = [
  'essentials',
  'after-dark',
  'connections',
  'scenes',
  'still-running',
];

/**
 * Quick views are curated filter states, not assertions about access, hours,
 * safety or current availability. Keep their definitions in one place so the
 * button state and applied filters cannot drift apart.
 */
export const QUICK_VIEWS: Record<
  QuickViewId,
  { label: string; categories: CategoryId[]; afterDark?: boolean; overnightStops?: boolean }
> = {
  essentials: {
    label: 'Essentials',
    categories: ['food', 'water', 'bathroom', 'shelter', 'services', 'medical', 'transit', 'civic'],
  },
  'after-dark': { label: 'After-dark POPOS', categories: ['popos'], afterDark: true },
  connections: { label: 'Transit & connections', categories: ['transit', 'pedestrian_connection'] },
  scenes: {
    label: 'Scenes & hideaways',
    categories: [
      'popos', 'hangout', 'abandoned', 'passage', 'mutual_aid', 'food',
      'bathroom', 'water', 'civic', 'nightlife', 'counterculture',
    ],
  },
  // A transit view rather than a place list: it hides places and keeps only the
  // stops with a scheduled departure after 22:00. It makes no claim that the
  // service will run on time, or that waiting at a stop is safe.
  'still-running': {
    label: 'Still running',
    categories: [],
    overnightStops: true,
  },
};

export function quickViewPatch(preset: QuickViewId): Partial<Filters> {
  const view = QUICK_VIEWS[preset];
  return {
    categories: [...view.categories],
    openNow: false,
    freeOnly: false,
    verifiedOnly: false,
    maxWalkMinutes: 0,
    nearTransit: false,
    accessibleOnly: false,
    afterDark: view.afterDark ?? false,
    overnightStops: view.overnightStops ?? false,
  };
}

export function isQuickViewActive(filters: Filters, preset: QuickViewId): boolean {
  const view = QUICK_VIEWS[preset];
  const neutral = !filters.openNow && !filters.freeOnly && !filters.verifiedOnly
    && filters.maxWalkMinutes === 0 && !filters.nearTransit && !filters.accessibleOnly
    && !filters.query.trim();
  const selected = [...filters.categories].sort().join('|');
  const expected = [...view.categories].sort().join('|');
  return (
    neutral &&
    selected === expected &&
    filters.afterDark === (view.afterDark ?? false) &&
    filters.overnightStops === (view.overnightStops ?? false)
  );
}
