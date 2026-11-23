import { expect, test } from '@playwright/test';
import { isMobileProject, openMap, openSearch, searchAndOpen } from './helpers';

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
    getPitch(): number;
    getCenter(): { lng: number; lat: number };
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
    // The footprint is the orientation aid while the boundary is off-screen;
    // normal-height phones keep it above the notice.
    await expect(page.locator('.mini-map-widget')).toBeVisible();
    const distance = notice.getByTestId('coverage-edge-distance');
    await expect(distance).toBeVisible();
    await expect(distance).toContainText('Nearest covered edge');
    await expect(distance).toContainText('west');
    expect(await notice.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);

    // The edge chip is gone outside the extract, so the notice itself is the
    // available route into the boundary panel.
    await expect(page.locator('.map-stage')).toHaveAttribute('data-coverage-view', 'outside');
    await expect(page.getByTestId('coverage-edge-chip')).toHaveCount(0);
    const details = notice.getByRole('button', { name: 'Details' });
    await expect(details).toBeVisible();
    await expect(details).toHaveAttribute('aria-controls', 'coverage-panel');
    await details.focus();
    await page.keyboard.press('Enter');
    const panel = page.getByTestId('coverage-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('What the boundary means');
    await expect(panel).toBeFocused();
    await expect(details).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(details).toHaveAttribute('aria-expanded', 'false');
    await expect(details).toBeFocused();
    await expect(notice).toBeVisible();

    // Closing from inside the panel also returns focus to the trigger.
    await details.click();
    await expect(panel).toBeFocused();
    await expect(details).toHaveAttribute('aria-expanded', 'true');
    await panel.getByRole('button', { name: 'Close coverage details' }).click();
    await expect(panel).toHaveCount(0);
    await expect(details).toBeFocused();
    await expect(details).toHaveAttribute('aria-expanded', 'false');

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

  test('separates outside coverage from no records in this view and can fit the records', async ({ page }, testInfo) => {
    await openMap(page);
    if (isMobileProject(testInfo.project.name)) {
      await page.getByRole('navigation', { name: 'Workspaces' }).getByRole('button', { name: 'Nearby' }).click();
      await page.locator('.sheet-handle').click();
    } else {
      await page.getByRole('button', { name: 'Nearby', exact: true }).click();
    }

    const filterStatus = page.getByTestId('filter-view-status');
    const mapStatus = page.getByTestId('map-view-status');
    const jump = (center: [number, number], zoom: number) =>
      page.evaluate(({ center, zoom }) => {
        const map = (window as unknown as MapWindow).__nightmap;
        map?.jumpTo({ center, zoom, pitch: 0, bearing: 0 });
      }, { center, zoom });

    // Outside coverage is its own explanation, not an empty-result message.
    await jump(OUTSIDE_EXTRACT, 16.2);
    await expect(page.getByTestId('coverage-notice')).toBeVisible({ timeout: 15_000 });
    await expect(filterStatus).toContainText('Outside coverage');
    await expect(filterStatus).not.toContainText('No records in this view');
    if (!isMobileProject(testInfo.project.name)) {
      await expect(mapStatus).toContainText('Outside coverage');
    }

    await filterStatus.getByRole('button', { name: 'Show all coverage' }).click();
    await expect(page.getByTestId('coverage-notice')).toHaveCount(0);
    await expect(filterStatus).not.toContainText('Outside coverage');

    // Chip counts are in-view counts and stay meaningful while a category is
    // switched off; the title still names the installed total.
    const waterCount = page.locator('.filter-chip', { hasText: 'Water' }).locator('.filter-count');
    await expect(waterCount).toHaveText(/[1-9]/);

    const activeChips = page.locator('.filter-chip[aria-pressed="true"]');
    await activeChips.evaluateAll((chips) => {
      for (const chip of chips) (chip as HTMLElement).click();
    });
    await expect(page.locator('.filter-chip[aria-pressed="true"]')).toHaveCount(0);
    await page.locator('.filter-chip', { hasText: 'Civic' }).click();
    await expect(filterStatus).toContainText('1 of 1 matching record in view');

    // An in-extract camera with no matching record is a view state, not the
    // coverage boundary.
    await jump([-122.398, 37.793], 17);
    await expect(filterStatus).toContainText('No records in this view', { timeout: 15_000 });
    await expect(filterStatus).toContainText('1 record matches the current filters elsewhere');
    await expect(page.locator('.filter-chip', { hasText: 'Civic' }).locator('.filter-count')).toHaveText('0');
    if (!isMobileProject(testInfo.project.name)) {
      await expect(mapStatus).toContainText('0 of 1');
      await expect(page.getByTestId('map-fit-records')).toBeVisible();
      await expect(page.getByTestId('map-fit-records')).toContainText('Zoom to 1 record');
    }

    await filterStatus.getByRole('button', { name: 'Zoom to 1 record' }).click();
    await expect(filterStatus).toContainText('1 of 1 matching record in view', { timeout: 15_000 });
    await expect(page.locator('.filter-chip', { hasText: 'Civic' }).locator('.filter-count')).toHaveText('1');
    if (!isMobileProject(testInfo.project.name)) {
      await expect(mapStatus).toContainText('1 of 1 place in view');
      await expect(page.getByTestId('map-fit-records')).toHaveCount(0);
    }
  });

  test('hints when tilt reaches far past the boundary and returns without moving first', async ({ page }) => {
    await openMap(page);

    // Inside the extract, looking east: the near corners stay covered while the
    // far edge of a steep view reaches well past the boundary.
    await page.evaluate(() => {
      const map = (window as unknown as MapWindow).__nightmap!;
      map.jumpTo({ center: [-122.3951, 37.778], zoom: 16.5, pitch: 60, bearing: 90 });
    });

    const hint = page.getByTestId('coverage-tilt-hint');
    await expect(hint).toBeVisible({ timeout: 15_000 });
    await expect(hint).toContainText('beyond the boundary');
    await expect(page.locator('.map-stage')).toHaveAttribute('data-coverage-view', 'partial');
    // The hint replaces the plain edge chip, so the two affordances never stack.
    await expect(page.getByTestId('coverage-edge-chip')).toHaveCount(0);
    expect(await hint.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);

    // Showing the hint is not a camera move: the reader keeps the view they set.
    const camera = await page.evaluate(() => {
      const map = (window as unknown as MapWindow).__nightmap!;
      const centre = map.getCenter();
      return { lng: centre.lng, lat: centre.lat, zoom: map.getZoom(), pitch: map.getPitch() };
    });
    expect(camera.lng).toBeCloseTo(-122.3951, 4);
    expect(camera.zoom).toBeCloseTo(16.5, 1);
    expect(camera.pitch).toBeCloseTo(60, 0);

    // Tilting back down clears the hint without any recovery click.
    await page.evaluate(() => {
      const map = (window as unknown as MapWindow).__nightmap!;
      map.jumpTo({ center: [-122.3951, 37.778], zoom: 16.5, pitch: 0, bearing: 90 });
    });
    await expect(hint).toHaveCount(0, { timeout: 15_000 });

    // The offered recovery is the same last-covered view used outside.
    await page.evaluate(() => {
      const map = (window as unknown as MapWindow).__nightmap!;
      map.jumpTo({ center: [-122.3951, 37.778], zoom: 16.5, pitch: 60, bearing: 90 });
    });
    await expect(hint).toBeVisible({ timeout: 15_000 });
    await hint.getByRole('button', { name: 'Return to coverage' }).click();
    await expect(hint).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator('.map-stage')).not.toHaveAttribute('data-coverage-view', 'partial');
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
    await expect(chip).toBeFocused();

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

  test('labels an outside search result and does not move the camera before confirmation', async ({ page }, testInfo) => {
    await page.route('https://photon.komoot.io/api/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({
          features: [
            {
              geometry: { coordinates: [-122.2712, 37.8044] },
              properties: { name: 'Oakland City Hall', city: 'Oakland' },
            },
          ],
        }),
      }),
    );
    await openMap(page);

    // Wider lookup is opt-in, so turn it on through the same control a reader uses.
    if (isMobileProject(testInfo.project.name)) {
      await page.getByRole('button', { name: 'Settings and privacy' }).click();
    } else {
      await page.keyboard.press('Control+k');
      await page.getByRole('button', { name: 'Open settings & privacy' }).click();
    }
    await page.getByLabel('Address search').selectOption('photon');
    await page.getByRole('button', { name: 'Close settings' }).click();

    const input = await openSearch(page);
    await input.fill('Oakland City Hall');
    await page.getByRole('button', { name: /Search the wider city/ }).click();

    const hit = page.locator('.search-hit').filter({ hasText: 'Oakland City Hall' }).first();
    await expect(hit).toContainText('Outside coverage');

    const before = await page.evaluate(() => {
      const centre = (window as unknown as MapWindow).__nightmap!.getCenter();
      return [centre.lng, centre.lat];
    });
    await hit.click();

    const warning = page.getByTestId('search-outside-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('Outside Night Map coverage');
    await expect(warning).toContainText('Nearest covered point');

    const after = await page.evaluate(() => {
      const centre = (window as unknown as MapWindow).__nightmap!.getCenter();
      return [centre.lng, centre.lat];
    });
    expect(after).toEqual(before);

    // Recovery is a real, covered camera target rather than a dismissal that
    // leaves the reader lost on the citywide view.
    await warning.getByRole('button', { name: 'Show nearest covered point' }).click();
    await expect(warning).toHaveCount(0);
    await expect
      .poll(async () => {
        return page.evaluate(() => {
          const centre = (window as unknown as MapWindow).__nightmap!.getCenter();
          return centre.lng > -122.392 && centre.lat > 37.797;
        });
      })
      .toBe(true);
    const covered = await page.evaluate(() => {
      const centre = (window as unknown as MapWindow).__nightmap!.getCenter();
      return [centre.lng, centre.lat];
    });
    expect(covered[0]).toBeLessThanOrEqual(COVERAGE_EAST);
    expect(covered[0]).toBeGreaterThan(-122.429);
    expect(covered[1]).toBeGreaterThan(37.7585);
    expect(covered[1]).toBeLessThanOrEqual(37.7975);
    await expect(page.getByText(/nearest covered point/).first()).toBeVisible();
  });

  test('labels an outside route origin and warns before contacting the provider', async ({ page, context }) => {
    // A fix beyond the extract makes the stop the route gate has to catch.
    await context.setGeolocation({ latitude: 37.74, longitude: -122.45 });
    await openMap(page);
    await searchAndOpen(page, 'GLIDE', /GLIDE Daily Free Meals/);
    await page.locator('.inspector').getByRole('button', { name: 'GO' }).click();

    const panel = page.locator('.route-panel');
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Use current location' }).click();
    await expect(panel.getByText('Current location').first()).toBeVisible({ timeout: 20_000 });
    await expect(panel.getByText('Outside coverage').first()).toBeVisible();

    let requests = 0;
    await page.route('**/routed-foot/**', (route) => {
      requests += 1;
      return route.abort();
    });

    await panel.getByRole('button', { name: 'Find walking route' }).click();
    const warning = page.getByTestId('route-outside-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('Route leaves Night Map coverage');
    await expect(warning).toContainText(/outside the extract/);
    await expect(panel.locator('.route-metrics')).toHaveCount(0);
    expect(requests).toBe(0);

    await warning.getByRole('button', { name: 'Cancel' }).click();
    await expect(warning).toHaveCount(0);
    await panel.getByRole('button', { name: 'Find walking route' }).click();
    await expect(warning).toBeVisible();
    expect(requests).toBe(0);

    await warning.getByRole('button', { name: 'Plan anyway' }).click();
    await expect(panel.getByText('No walking route was produced').first()).toBeVisible();
    await expect.poll(() => requests).toBe(1);
  });

  test('labels an outside route destination and warns before building or framing the route', async ({ page }, testInfo) => {
    // The phone sheet covers the canvas this test uses to place an outside pin.
    test.skip(isMobileProject(testInfo.project.name), 'The phone sheet covers the map-pick surface.');

    await openMap(page);
    await searchAndOpen(page, 'GLIDE', /GLIDE Daily Free Meals/);
    await page.locator('.inspector').getByRole('button', { name: 'GO' }).click();

    const panel = page.locator('.route-panel');
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Use current location' }).click();
    await expect(panel.getByText('Current location').first()).toBeVisible({ timeout: 20_000 });

    // Place the destination through the same map-pick affordance a reader uses.
    await panel.getByRole('button', { name: 'Or add a pin on the map' }).click();
    const canvas = await page.locator('.map-canvas').boundingBox();
    expect(canvas).not.toBeNull();
    await page.evaluate((center) => {
      (window as unknown as MapWindow).__nightmap?.jumpTo({
        center,
        zoom: 16.2,
        pitch: 0,
        bearing: 0,
      });
    }, OUTSIDE_EXTRACT);
    await page.waitForTimeout(250);
    await page.mouse.click(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2);

    const outsideStop = panel.locator('.stop-list .tag.outside');
    await expect(outsideStop).toBeVisible();
    await expect(outsideStop).toContainText('Outside coverage');

    let requests = 0;
    await page.route('**/routed-foot/**', (route) => {
      requests += 1;
      return route.abort();
    });

    await panel.getByRole('button', { name: 'Find walking route' }).click();
    const warning = page.getByTestId('route-outside-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(/stop \d/);
    await expect(warning).toContainText('from the nearest covered point');
    await expect(warning).toContainText('camera may move over blank ground');
    await expect(panel.locator('.route-metrics')).toHaveCount(0);
    expect(requests).toBe(0);

    await warning.getByRole('button', { name: 'Cancel' }).click();
    await expect(warning).toHaveCount(0);
    expect(requests).toBe(0);
  });

  test('calls a fully covered phone map a layout state and can reveal it', async ({ page }, testInfo) => {
    test.skip(!isMobileProject(testInfo.project.name), 'Only the phone sheet can take the whole map column.');
    await openMap(page);
    await page.getByRole('button', { name: 'Nearby', exact: true }).click();
    await page.getByRole('button', { name: /Drag to resize panel/ }).press('Enter');

    const hidden = page.getByTestId('map-hidden-notice');
    await expect(hidden).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.map-stage')).toHaveAttribute('data-blank-state', 'covered');
    await expect(page.getByTestId('coverage-notice')).toHaveCount(0);

    await hidden.getByRole('button', { name: 'Close panels' }).click();
    await expect(hidden).toHaveCount(0);
  });

  test('keeps an outside camera behind the phone sheet as a layout state', async ({ page }, testInfo) => {
    test.skip(!isMobileProject(testInfo.project.name), 'Only the phone sheet can take the whole map column.');
    await openMap(page);
    await page.evaluate((center) => {
      (window as unknown as MapWindow).__nightmap?.jumpTo({
        center,
        zoom: 16.2,
        pitch: 0,
        bearing: 0,
      });
    }, OUTSIDE_EXTRACT);
    await expect(page.getByTestId('coverage-notice')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Nearby', exact: true }).click();
    await page.getByRole('button', { name: /Drag to resize panel/ }).press('Enter');

    const hidden = page.getByTestId('map-hidden-notice');
    await expect(hidden).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.map-stage')).toHaveAttribute('data-blank-state', 'covered');
    await expect(page.getByTestId('coverage-notice')).toHaveCount(0);

    await hidden.getByRole('button', { name: 'Close panels' }).click();
    await expect(hidden).toHaveCount(0);
    await expect(page.getByTestId('coverage-notice')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.map-stage')).toHaveAttribute('data-blank-state', 'outside');
  });

  test('puts empty layers ahead of the outside boundary and returns to the boundary after recovery', async ({ page }) => {
    await openMap(page);
    await page.evaluate((center) => {
      (window as unknown as MapWindow).__nightmap?.jumpTo({
        center,
        zoom: 16.2,
        pitch: 0,
        bearing: 0,
      });
    }, OUTSIDE_EXTRACT);
    await expect(page.getByTestId('coverage-notice')).toBeVisible({ timeout: 15_000 });

    await page.locator('.map-control[aria-label="Layers"]').click();
    const drawer = page.locator('.drawer[aria-label="Map layers"]');
    await expect(drawer).toBeVisible();
    await drawer.locator('input[type="checkbox"]').evaluateAll((inputs) => {
      for (const input of inputs) {
        if ((input as HTMLInputElement).checked) (input as HTMLInputElement).click();
      }
    });
    await drawer.getByRole('button', { name: 'Close layers' }).click();

    // The blank map is a layer choice first. "Show all coverage" would not put
    // a single feature back on the canvas, so the boundary notice must wait.
    const empty = page.getByTestId('map-empty-layers');
    await expect(empty).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.map-stage')).toHaveAttribute('data-blank-state', 'empty-layers');
    await expect(page.getByTestId('coverage-notice')).toHaveCount(0);

    await empty.getByRole('button', { name: 'Show essentials' }).click();
    await expect(empty).toHaveCount(0);
    await expect(page.getByTestId('coverage-notice')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.map-stage')).toHaveAttribute('data-blank-state', 'outside');
  });

  test('names empty layers and restores essentials', async ({ page }) => {
    await openMap(page);
    await page.locator('.map-control[aria-label="Layers"]').click();

    const drawer = page.locator('.drawer[aria-label="Map layers"]');
    await expect(drawer).toBeVisible();
    await drawer.locator('input[type="checkbox"]').evaluateAll((inputs) => {
      for (const input of inputs) {
        if ((input as HTMLInputElement).checked) (input as HTMLInputElement).click();
      }
    });
    await drawer.getByRole('button', { name: 'Close layers' }).click();

    const empty = page.getByTestId('map-empty-layers');
    await expect(empty).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.map-stage')).toHaveAttribute('data-blank-state', 'empty-layers');
    await expect(page.getByTestId('coverage-notice')).toHaveCount(0);

    await empty.getByRole('button', { name: 'Show essentials' }).click();
    await expect(empty).toHaveCount(0);
    await expect(page.locator('.map-stage')).toHaveAttribute('data-blank-state', 'none');
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
      await expect(page.locator('.map-stage')).toHaveAttribute('data-blank-state', 'failed-tiles');
      await expect(failure).toContainText('not the edge of Night Map coverage');
      const distance = failure.getByTestId('basemap-edge-distance');
      await expect(distance).toBeVisible();
      await expect(distance).toContainText('Nearest covered edge');
      await expect(distance).toContainText(/\b(west|east|north|south)\b/);
      await expect(failure.getByRole('button', { name: 'Retry tiles' })).toBeVisible();

      const details = failure.getByRole('button', { name: 'Details' });
      await expect(details).toHaveAttribute('aria-controls', 'coverage-panel');
      await details.click();
      const panel = page.getByTestId('coverage-panel');
      await expect(panel).toBeVisible();
      await expect(panel).toContainText('What the boundary means');
      await expect(details).toHaveAttribute('aria-expanded', 'true');
      await panel.getByRole('button', { name: 'Close coverage details' }).click();
      await expect(panel).toHaveCount(0);
      await expect(details).toHaveAttribute('aria-expanded', 'false');

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
      await failure.getByRole('button', { name: 'Retry tiles' }).click();
      await expect(page.locator('.map-loading')).toHaveCount(0, { timeout: 30_000 });
      await expect(page.getByTestId('basemap-failure')).toHaveCount(0);
      await expect(page.locator('.map-stage')).toHaveAttribute('data-basemap-state', 'ready');
    });

    test('keeps an offline tile miss distinct and retries on reconnection', async ({ page }) => {
      let failTiles = true;
      await page.route('**/basemap/roads/**', (route) =>
        failTiles ? route.abort('failed') : route.continue(),
      );
      // Keep app assets on the local server while reporting no connection to
      // the map, so the offline tile path can be exercised deterministically.
      await page.addInitScript(() => {
        const scope = window as unknown as { __nightmapOnline?: boolean };
        scope.__nightmapOnline = false;
        Object.defineProperty(Object.getPrototypeOf(window.navigator), 'onLine', {
          configurable: true,
          get: () => Boolean(scope.__nightmapOnline),
        });
      });
      await page.goto('/');

      const failure = page.getByTestId('basemap-failure');
      await expect(failure).toBeVisible({ timeout: 20_000 });
      await expect(failure).toHaveAttribute('data-cause', 'offline');
      await expect(page.locator('.map-stage')).toHaveAttribute('data-blank-state', 'offline-tiles');
      await expect(failure).toContainText('Street map not cached');
      await expect(failure).toContainText('not the edge of Night Map coverage');
      await expect(failure.getByRole('button', { name: 'Waiting for connection' })).toBeDisabled();
      await expect(failure.getByTestId('offline-retry-note')).toContainText('retry automatically');
      await expect(page.locator('.map-stage')).toHaveAttribute('data-blank-state', 'offline-tiles');

      failTiles = false;
      await page.evaluate(() => {
        const scope = window as unknown as { __nightmapOnline?: boolean };
        scope.__nightmapOnline = true;
        window.dispatchEvent(new Event('online'));
      });

      await expect(failure).toHaveCount(0, { timeout: 30_000 });
      await expect(page.locator('.map-stage')).toHaveAttribute('data-basemap-state', 'ready', {
        timeout: 30_000,
      });
    });
  });

  test('attributes coverage behind a workspace panel to the layout, not the boundary', async ({ page }, testInfo) => {
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

    // The whole canvas touches the extract, but none of it shows beside the
    // panel. That is a covered layout, never the outside-coverage boundary.
    const hidden = page.getByTestId('map-hidden-notice');
    await expect(hidden).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.map-stage')).toHaveAttribute('data-blank-state', 'covered');
    await expect(page.getByTestId('coverage-notice')).toHaveCount(0);

    await hidden.getByRole('button', { name: 'Close panels' }).click();
    await expect(hidden).toHaveCount(0);
    await expect(page.getByTestId('coverage-notice')).toHaveCount(0);
    await expect(page.locator('.map-stage')).toHaveAttribute('data-coverage-view', 'partial');
  });
});
