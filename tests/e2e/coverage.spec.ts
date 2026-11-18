import { expect, test } from '@playwright/test';
import { isMobileProject, openMap } from './helpers';

/** East of the installed extract; the whole viewport is outside at this zoom. */
const OUTSIDE_EXTRACT: [number, number] = [-122.352, 37.78];
/** A latitude inside the extract's north/south span. */
const COVERAGE_LAT = 37.778;

const COVERAGE_EAST = -122.3905;

type MapWindow = {
  __nightmap?: {
    getLayer(id: string): { type?: string; source?: string } | undefined;
    getLayoutProperty(layer: string, property: string): unknown;
    isStyleLoaded(): boolean;
    getContainer(): HTMLElement;
    getZoom(): number;
    jumpTo(options: { center: [number, number]; zoom: number; pitch: number; bearing: number }): void;
    project(coordinates: [number, number]): { x: number; y: number };
    unproject(point: [number, number]): { lng: number; lat: number };
    queryRenderedFeatures(options: { layers: string[] }): unknown[];
  };
};

test.describe('Coverage boundary and outside notice', () => {
  test('keeps the boundary layer, shows the outside notice, and returns to coverage', async ({ page }) => {
    await openMap(page);

    await expect
      .poll(async () =>
        page.evaluate(() => {
          const map = (window as unknown as MapWindow).__nightmap;
          return Boolean(map?.isStyleLoaded() && map.getLayer('coverage-edge'));
        }),
      )
      .toBe(true);

    const boundary = await page.evaluate(() => {
      const map = (window as unknown as MapWindow).__nightmap;
      const layer = map?.getLayer('coverage-edge');
      return layer
        ? {
            type: layer.type ?? null,
            source: layer.source ?? null,
            visibility: map?.getLayoutProperty('coverage-edge', 'visibility') ?? 'visible',
          }
        : null;
    });
    expect(boundary).toEqual({ type: 'line', source: 'coverage', visibility: 'visible' });

    const initialZoom = await page.evaluate(
      () => (window as unknown as MapWindow).__nightmap!.getZoom(),
    );

    const jumpOutside = () =>
      page.evaluate((center) => {
        const map = (window as unknown as MapWindow).__nightmap;
        map?.jumpTo({ center, zoom: 16.2, pitch: 0, bearing: 0 });
      }, OUTSIDE_EXTRACT);

    await jumpOutside();

    const notice = page.getByTestId('coverage-notice');
    await expect(notice).toBeVisible({ timeout: 15_000 });
    await expect(notice).toContainText('Outside Night Map coverage');
    expect(await notice.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);

    // Return restores the street-scale view that last showed coverage instead
    // of fitting the whole extract.
    const returnButton = notice.getByRole('button', { name: 'Return to coverage' });
    await expect(returnButton).toBeVisible();
    await returnButton.click();

    await expect(notice).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as MapWindow).__nightmap!.getZoom()))
      .toBeCloseTo(initialZoom, 0);

    // Showing all coverage is a separate, deliberate citywide fit.
    await jumpOutside();
    await expect(notice).toBeVisible({ timeout: 15_000 });
    const showAll = notice.getByRole('button', { name: 'Show all coverage' });
    await expect(showAll).toBeVisible();
    await showAll.click();

    await expect(notice).toHaveCount(0);
    const allZoom = await page.evaluate(() => (window as unknown as MapWindow).__nightmap!.getZoom());
    expect(allZoom).toBeLessThan(initialZoom - 0.5);
  });

  test('shows the edge chip, mask and boundary labels only while the view is partial', async ({ page }) => {
    await openMap(page);

    await page.evaluate(
      ({ east, lat }) => {
        const map = (window as unknown as MapWindow).__nightmap!;
        map.jumpTo({ center: [east, lat], zoom: 16.2, pitch: 0, bearing: 0 });
      },
      { east: COVERAGE_EAST, lat: COVERAGE_LAT },
    );

    const chip = page.getByTestId('coverage-edge-chip');
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await expect(chip).toContainText('Edge of coverage');
    await expect(page.getByTestId('coverage-notice')).toHaveCount(0);
    await expect(page.locator('.map-stage')).toHaveAttribute('data-coverage-view', 'partial');

    // The amber line itself is a target: tapping the edge at screen centre
    // opens the compact coverage panel.
    const panel = page.getByTestId('coverage-panel');
    const canvasBox = await page.locator('.map-canvas').boundingBox();
    expect(canvasBox).not.toBeNull();
    await page.mouse.click(canvasBox!.x + canvasBox!.width / 2, canvasBox!.y + canvasBox!.height / 2);
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel).toContainText('What the boundary means');
    await expect(panel).toContainText('Cited sources');
    await expect(panel).toContainText('Data dates');
    await expect(panel).toContainText('Layer and zoom limits');
    await expect(panel).toContainText('z11.4–18.5');
    await expect(panel).toContainText('What is excluded');
    await expect(panel).toContainText('Person-targeting reports are excluded');
    await expect(panel.locator('.coverage-panel-map-canvas .maplibregl-canvas')).toBeVisible({
      timeout: 10_000,
    });
    await panel.getByRole('button', { name: 'Close coverage details' }).click();
    await expect(panel).toHaveCount(0);

    // The chip is the same affordance in a fixed, always-tappable position.
    await chip.click();
    await expect(panel).toBeVisible();
    await expect(chip).toHaveAttribute('aria-expanded', 'true');
    await panel.getByRole('button', { name: 'Close coverage details' }).click();
    await expect(panel).toHaveCount(0);
    await expect(chip).toHaveAttribute('aria-expanded', 'false');

    await expect
      .poll(async () =>
        page.evaluate(() => {
          const map = (window as unknown as MapWindow).__nightmap!;
          return {
            mask: map.getLayoutProperty('outside-mask', 'visibility') ?? 'visible',
            labels: map.getLayoutProperty('coverage-edge-label', 'visibility') ?? 'visible',
          };
        }),
      )
      .toEqual({ mask: 'visible', labels: 'visible' });

    await expect
      .poll(async () =>
        page.evaluate(() => {
          const map = (window as unknown as MapWindow).__nightmap!;
          return {
            maskPainted: map.queryRenderedFeatures({ layers: ['outside-mask'] }).length > 0,
            labelPainted: map.queryRenderedFeatures({ layers: ['coverage-edge-label'] }).length > 0,
          };
        }),
      )
      .toEqual({ maskPainted: true, labelPainted: true });

    await page.evaluate((center) => {
      const map = (window as unknown as MapWindow).__nightmap;
      map?.jumpTo({ center, zoom: 16.2, pitch: 0, bearing: 0 });
    }, OUTSIDE_EXTRACT);

    await expect(page.getByTestId('coverage-notice')).toBeVisible({ timeout: 15_000 });
    await expect(chip).toHaveCount(0);
    await expect(page.locator('.map-stage')).toHaveAttribute('data-coverage-view', 'outside');
  });

  test.describe('Basemap failure', () => {
    // Keep tile requests visible to the test router instead of letting the
    // service worker answer them from its cache.
    test.use({ serviceWorkers: 'block' });

    test('separates a tile failure from outside coverage and retries', async ({ page }) => {
      let failTiles = true;
      await page.route('**/basemap/roads/**', (route) =>
        failTiles ? route.abort('failed') : route.continue(),
      );

      await page.goto('/');
      await expect(page.locator('.map-canvas')).toBeVisible();

      const failure = page.getByTestId('basemap-failure');
      await expect(failure).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('.map-stage')).toHaveAttribute('data-basemap-state', 'failed');
      await expect(failure).toContainText('not the edge of Night Map coverage');
      await expect(failure.getByRole('button', { name: 'Retry basemap' })).toBeVisible();

      await page.evaluate((center) => {
        const map = (window as unknown as MapWindow).__nightmap;
        map?.jumpTo({ center, zoom: 16.2, pitch: 0, bearing: 0 });
      }, OUTSIDE_EXTRACT);
      // Give the moveend coverage check a frame, then confirm the outside
      // notice has not been layered on top of the failed basemap.
      await page.waitForTimeout(300);
      await expect(page.getByTestId('coverage-notice')).toHaveCount(0);
      await expect(page.getByTestId('coverage-edge-chip')).toHaveCount(0);

      failTiles = false;
      await failure.getByRole('button', { name: 'Retry basemap' }).click();
      await expect(page.locator('.map-loading')).toHaveCount(0, { timeout: 30_000 });
      await expect(page.getByTestId('basemap-failure')).toHaveCount(0);
      await expect(page.locator('.map-stage')).toHaveAttribute('data-basemap-state', 'ready');
    });
  });

  test('shows the notice when coverage is visible only behind the workspace panel', async ({ page }, testInfo) => {
    // The phone sheet takes its height out of the map column instead of
    // floating over the canvas, so there is no phone equivalent of this case.
    test.skip(isMobileProject(testInfo.project.name), 'No panel covers the phone map canvas.');

    await openMap(page);
    await page.getByRole('button', { name: 'Nearby', exact: true }).click();

    const panel = page.locator('.panel-left');
    await expect(panel).toBeVisible();
    const panelBox = await panel.boundingBox();
    expect(panelBox).not.toBeNull();

    await page.evaluate(
      ({ east, lat, targetX }) => {
        const map = (window as unknown as MapWindow).__nightmap!;
        map.jumpTo({ center: [east, lat], zoom: 16.2, pitch: 0, bearing: 0 });
        // The extract's eastern edge now sits at the canvas centre. Move the
        // camera west by twice that offset so the edge lands on targetX, deep
        // behind the open panel, and every visible pixel to its right is blank.
        const edge = map.project([east, lat]);
        const centre = map.unproject([edge.x * 2 - targetX, edge.y]);
        map.jumpTo({ center: [centre.lng, centre.lat] });
      },
      { east: COVERAGE_EAST, lat: COVERAGE_LAT, targetX: Math.round(panelBox!.x + panelBox!.width / 2) },
    );

    const edgeX = await page.evaluate(({ east, lat }) => {
      const map = (window as unknown as MapWindow).__nightmap!;
      return map.project([east, lat]).x;
    }, { east: COVERAGE_EAST, lat: COVERAGE_LAT });
    expect(edgeX).toBeGreaterThan(panelBox!.x);
    expect(edgeX).toBeLessThan(panelBox!.x + panelBox!.width);

    // The whole-canvas bounds still touch the extract, but none of it shows in
    // the strip between the panels, so the blank-map notice must appear.
    const notice = page.getByTestId('coverage-notice');
    await expect(notice).toBeVisible({ timeout: 15_000 });

    // Closing the panel reveals the boundary without moving the camera, and the
    // notice has to clear itself.
    await page.getByRole('button', { name: 'Close workspace' }).click();
    await expect(notice).toHaveCount(0);
  });
});
