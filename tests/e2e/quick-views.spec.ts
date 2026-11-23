import { expect, test, type Page } from '@playwright/test';
import { isMobileProject, openMap } from './helpers';

type MapWindow = {
  __nightmap?: {
    jumpTo(options: unknown): void;
    getZoom(): number;
  };
};

async function openNearby(page: Page, projectName: string) {
  if (isMobileProject(projectName)) {
    await page.getByRole('navigation', { name: 'Workspaces' }).getByRole('button', { name: 'Nearby' }).click();
    await page.locator('.sheet-handle').click();
    return;
  }
  await page.getByRole('button', { name: 'Nearby', exact: true }).click();
}

test('quick views show match counts and an empty view offers a fit to matches', async ({ page }, testInfo) => {
  await openMap(page);
  await openNearby(page, testInfo.project.name);

  // Every quick view states what pressing it would show.
  for (const id of ['essentials', 'after-dark', 'connections', 'scenes', 'still-running']) {
    await expect(page.getByTestId(`quick-view-count-${id}`)).toHaveText(/^\d+$/);
  }

  // A preset with few records: applying it and moving to a quiet corner leaves
  // the view empty even though the preset matches records elsewhere.
  await page.getByTestId('quick-view-after-dark').click();
  await expect(page.getByTestId('quick-view-after-dark')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => {
    (window as unknown as MapWindow).__nightmap?.jumpTo({
      center: [-122.42, 37.765],
      zoom: 18,
      pitch: 0,
      bearing: 0,
    });
  });

  await expect
    .poll(async () => (await page.getByTestId('quick-view-count-after-dark').innerText()).trim())
    .toBe('0');

  const empty = page.getByTestId('quick-view-empty');
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('outside this view');
  // The generic in-view row would duplicate this action; it stands down.
  await expect(page.getByTestId('filter-view-status')).toHaveCount(0);

  const zoomBefore = await page.evaluate(() => (window as unknown as MapWindow).__nightmap!.getZoom());
  await empty.getByRole('button', { name: /Fit to \d+ match/ }).click();

  await expect
    .poll(async () => Number((await page.getByTestId('quick-view-count-after-dark').innerText()).trim()))
    .toBeGreaterThan(0);
  await expect(empty).toHaveCount(0);
  const zoomAfter = await page.evaluate(() => (window as unknown as MapWindow).__nightmap!.getZoom());
  expect(zoomAfter).not.toBeCloseTo(zoomBefore, 1);
});

test('Still running narrows the stop layer and a stop opens scheduled service', async ({ page }, testInfo) => {
  test.skip(isMobileProject(testInfo.project.name), 'the sheet covers the stop layer on a phone');
  await openMap(page);
  await openNearby(page, testInfo.project.name);

  const chip = page.getByTestId('quick-view-still-running');
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  expect(Number((await page.getByTestId('quick-view-count-still-running').innerText()).trim())).toBeGreaterThan(0);

  // Click a rendered stop dot, then read the scheduled service card it opens.
  const target = await page.evaluate(() => {
    const map = (window as unknown as { __nightmap?: {
      queryRenderedFeatures(query: unknown): { geometry: { coordinates: [number, number] } }[];
      project(coordinates: [number, number]): { x: number; y: number };
      getContainer(): HTMLElement;
    } }).__nightmap;
    const features = map?.queryRenderedFeatures({ layers: ['stops-dots'] }) ?? [];
    if (!map || features.length === 0) return null;
    const point = map.project(features[0].geometry.coordinates);
    const rect = map.getContainer().getBoundingClientRect();
    return { x: rect.left + point.x, y: rect.top + point.y };
  });
  expect(target).not.toBeNull();
  if (!target) return;

  await page.mouse.click(target.x, target.y);
  await expect(page.getByTestId('stop-card')).toBeVisible();
  await expect(page.getByTestId('stop-scheduled')).toContainText('Scheduled data');
  await expect(page.getByTestId('stop-scheduled')).toContainText('Not live');
});
