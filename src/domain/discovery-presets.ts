import type { CategoryId, Filters } from './types';

export type QuickViewId = 'essentials' | 'after-dark' | 'connections' | 'scenes';

/** Stable order for the chip row; counts and labels are keyed off the same ids. */
export const QUICK_VIEW_IDS: readonly QuickViewId[] = [
  'essentials',
  'after-dark',
  'connections',
  'scenes',
];

/**
 * Quick views are curated filter states, not assertions about access, hours,
 * safety or current availability. Keep their definitions in one place so the
 * button state and applied filters cannot drift apart.
 */
export const QUICK_VIEWS: Record<
  QuickViewId,
  { label: string; categories: CategoryId[]; afterDark?: boolean }
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
  };
}

export function isQuickViewActive(filters: Filters, preset: QuickViewId): boolean {
  const view = QUICK_VIEWS[preset];
  const neutral = !filters.openNow && !filters.freeOnly && !filters.verifiedOnly
    && filters.maxWalkMinutes === 0 && !filters.nearTransit && !filters.accessibleOnly
    && !filters.query.trim();
  const selected = [...filters.categories].sort().join('|');
  const expected = [...view.categories].sort().join('|');
  return neutral && selected === expected && filters.afterDark === (view.afterDark ?? false);
}
