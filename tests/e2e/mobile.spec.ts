import { expect, test } from '@playwright/test';

test.describe('mobile field use', () => {
  test('map-first layout with a draggable sheet and quick capture', async ({ page }) => {
    test.skip(test.info().project.name !== 'mobile', 'mobile-only interaction spec');
    await page.goto('/');
    await expect(page.locator('.map-canvas')).toBeVisible();
    await expect(page.locator('.sheet')).toHaveClass(/sheet-collapsed/);
    await expect(page.getByRole('navigation', { name: 'Workspaces' })).toBeVisible();

    const heightBefore = (await page.locator('.sheet').boundingBox())!.height;

    await page.getByRole('navigation', { name: 'Workspaces' }).getByRole('button', { name: 'Nearby' }).click();
    await expect(page.locator('.nearby-row').first()).toBeVisible();
    await expect(page.locator('.sheet')).toHaveClass(/sheet-peek/);

    // Wait for the collapsed → peek height transition so the handle is at its final position.
    await page.locator('.sheet').evaluate(async (el) => {
      await Promise.all(el.getAnimations().map((animation) => animation.finished.catch(() => {})));
    });

    // Drag the handle upward; the sheet snaps to an expanded state.
    const handle = page.locator('.sheet-handle');
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, 80, { steps: 12 });
    await page.mouse.up();
    await expect(page.locator('.sheet')).toHaveClass(/sheet-expanded/);
    const heightAfter = (await page.locator('.sheet').boundingBox())!.height;
    expect(heightAfter).toBeGreaterThan(heightBefore);

    // The phone bar no longer carries a Map entry, so the way back to the map is the
    // sheet handle, which collapses from the keyboard as well as by dragging.
    await page.locator('.sheet-handle').press('Enter');
    await expect(page.locator('.sheet')).toHaveClass(/sheet-collapsed/);

    // One-hand convenience: the floating capture button opens a prefilled composer.
    await page.getByRole('button', { name: 'Quick field note' }).click();
    await expect(page.getByRole('heading', { name: 'Pinned observation at map centre' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Search opens over the map and can be dismissed without losing the map.
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Night Map search panel' })).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('.map-canvas')).toBeVisible();

    // Touch targets for the core map controls carry accessible names.
    for (const name of ['Use current location', 'Layers', 'Map legend', 'Zoom in', 'Zoom out']) {
      await expect(page.getByRole('button', { name, exact: true }).first()).toBeVisible();
    }

    // Map, Notes and Review are gone from the phone bar, and the feed tabs sit at the end.
    const nav = page.getByRole('navigation', { name: 'Workspaces' });
    await expect(nav.getByRole('button', { name: 'Map', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('button', { name: 'Notes', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('button', { name: 'Review', exact: true })).toHaveCount(0);
    expect(await nav.locator('button').allInnerTexts()).toEqual(['Nearby', 'Routes', 'Atlas', 'CCTV', 'Radio']);

    // They are status panels, not players: each states what does not exist.
    await nav.getByRole('button', { name: 'CCTV' }).click();
    await expect(page.getByText('No live feed')).toBeVisible();
    await nav.getByRole('button', { name: 'Radio' }).click();
    await expect(page.getByText('No public audio')).toBeVisible();
    await expect(page.getByText(/encrypted since 2021/)).toBeVisible();

    // Review left the bar as well and keeps a header button beside search.
    await page.getByRole('button', { name: /^Review/ }).click();
    await expect(page.getByRole('heading', { name: 'Review queue' })).toBeVisible();

    // Notes are still reachable: they moved to the header rather than disappearing.
    await page.getByRole('button', { name: 'My notes' }).click();
    await expect(page.getByText('No public audio')).toHaveCount(0);
  });
});
