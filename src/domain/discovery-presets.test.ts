import { describe, expect, it } from 'vitest';
import type { Filters } from './types';
import { isQuickViewActive, quickViewPatch } from './discovery-presets';

const baseline: Filters = {
  categories: [], openNow: false, freeOnly: false, verifiedOnly: false,
  maxWalkMinutes: 0, nearTransit: false, accessibleOnly: false,
  afterDark: false, query: '',
};

describe('discovery quick views', () => {
  it('applies the same scene categories that its active indicator recognizes', () => {
    const filters = { ...baseline, ...quickViewPatch('scenes') };
    expect(isQuickViewActive(filters, 'scenes')).toBe(true);
    expect(filters.categories).toContain('abandoned');
    expect(filters.categories).toContain('hangout');
    expect(filters.categories).toContain('mutual_aid');
    expect(filters.categories).not.toContain('history');
  });

  it('keeps practical public-space resources in the scenes view', () => {
    const categories = quickViewPatch('scenes').categories ?? [];
    for (const category of ['popos', 'passage', 'food', 'water', 'bathroom', 'civic', 'nightlife', 'counterculture']) {
      expect(categories).toContain(category);
    }
  });

  it('does not report a quick view active when another condition is enabled', () => {
    const filters = { ...baseline, ...quickViewPatch('scenes'), freeOnly: true };
    expect(isQuickViewActive(filters, 'scenes')).toBe(false);
  });

  it('distinguishes the after-dark preset from ordinary POPOS filtering', () => {
    const filters = { ...baseline, ...quickViewPatch('after-dark') };
    expect(isQuickViewActive(filters, 'after-dark')).toBe(true);
    expect(isQuickViewActive({ ...filters, afterDark: false }, 'after-dark')).toBe(false);
  });

  it('resets conditions that would silently narrow a curated view', () => {
    const patch = quickViewPatch('scenes');
    expect(patch).toMatchObject({ openNow: false, freeOnly: false, verifiedOnly: false, maxWalkMinutes: 0, nearTransit: false, accessibleOnly: false, afterDark: false });
  });
});
