import { expect, test, type Page } from '@playwright/test';
import { openMap } from './helpers';

interface CameraState {
  pitch: number;
  bearing: number;
}

async function camera(page: Page): Promise<CameraState> {
  return page.evaluate(() => {
    const map = (window as unknown as {
      __nightmap?: { getPitch(): number; getBearing(): number };
    }).__nightmap;
    return { pitch: map ? map.getPitch() : -1, bearing: map ? map.getBearing() : 0 };
  });
}

/** The readout is whole degrees; the renderer's own angle carries float noise. */
async function expectPitch(page: Page, expected: number) {
  await expect
    .poll(async () => Math.abs((await camera(page)).pitch - expected), { timeout: 15_000 })
    .toBeLessThan(0.01);
}

async function mapState(page: Page) {
  return page.evaluate(() => {
    const map = (window as unknown as {
      __nightmap?: {
        getTerrain(): unknown;
        getLayer(id: string): { visibility?: string } | undefined;
        querySourceFeatures(id: string): unknown[];
        getPaintProperty(id: string, name: string): unknown;
      };
    }).__nightmap;
    return {
      terrain: map?.getTerrain() ?? null,
      terrainSource: (map?.getTerrain() as { source?: string } | null)?.source ?? null,
      // Shading is the fine layer in a plan view and the coarse one when pitched.
      shading:
        map?.getLayer('hillshade-coarse')?.visibility === 'visible'
          ? 'coarse'
          : (map?.getLayer('hillshade')?.visibility ?? null),
      buildingsLayer: map?.getLayer('buildings-3d')?.visibility ?? null,
      buildingFeatures: map?.querySourceFeatures('buildings').length ?? 0,
      extrusion: JSON.stringify(map?.getPaintProperty('buildings-3d', 'fill-extrusion-height') ?? null),
    };
  });
}

async function toggleLayer(page: Page, name: RegExp) {
  await page.getByRole('button', { name: 'Layers', exact: true }).first().click();
  // The visible switch is the label's styled track; the input itself is hidden.
  await page.locator('.layer-item').filter({ hasText: name }).first().locator('.switch-track').click();
  await page.getByRole('button', { name: 'Close layers' }).click();
}

test.describe('Scenario J — see the city in three dimensions', () => {
  test('the camera tilts, turns and returns to a plan view', async ({ page }) => {
    await openMap(page);
    expect((await camera(page)).pitch).toBe(0);

    // Turning the map is a real gesture: control-drag is how MapLibre rotates,
    // and the app has to leave that handler switched on.
    const box = (await page.locator('.map-canvas').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
    await page.keyboard.down('Control');
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5 + 130, box.y + box.height * 0.4 + 60, { steps: 14 });
    await page.mouse.up();
    await page.keyboard.up('Control');
    await expect.poll(async () => Math.abs((await camera(page)).bearing)).toBeGreaterThan(2);

    // The 3D control tilts the camera and switches on the layers that carry height.
    await page.getByRole('button', { name: '3D view' }).click();
    await expect.poll(async () => (await camera(page)).pitch).toBeGreaterThan(40);
    await expect(page.getByText(/tilted \d+°/)).toBeVisible();
    const state = await mapState(page);
    expect(state.terrain).not.toBeNull();
    // The 3D control tilts to 55°, past the coarse-DEM threshold, so both the
    // mesh and the shading read the z13 tiles instead of four times as many.
    expect(state.terrainSource).toBe('terrainCoarse');
    expect(state.shading).toBe('coarse');
    expect(state.buildingsLayer).toBe('visible');

    // A tilted plan is not the only view, and leaving it is one action. A level
    // camera goes back to the fine shading.
    await page.getByRole('button', { name: 'Reset north and tilt' }).click();
    await expect.poll(async () => (await camera(page)).pitch).toBe(0);
    await expect.poll(async () => (await mapState(page)).shading).toBe('visible');
    await expect.poll(async () => (await mapState(page)).terrainSource).toBe('terrain');
    await expect.poll(async () => Math.abs((await camera(page)).bearing)).toBeLessThan(1);
    await expect(page.getByText(/tilted \d+°/)).toHaveCount(0);

    // Two presses inside one eased move must each advance a full step: the
    // second builds on the first step's target, not on the angle reached so far.
    await page.getByRole('button', { name: 'Tilt up' }).dblclick();
    await expect.poll(async () => (await camera(page)).pitch, { timeout: 15_000 }).toBeGreaterThan(19);
    await page.getByRole('button', { name: 'Tilt down' }).dblclick();
    await expect.poll(async () => (await camera(page)).pitch, { timeout: 15_000 }).toBeLessThan(1);
  });

  test('each tilt click is one step, the angle stops at its limits, and reset returns top-down', async ({ page }) => {
    await openMap(page);
    const tiltUp = page.getByRole('button', { name: 'Tilt up' });
    const tiltDown = page.getByRole('button', { name: 'Tilt down' });

    expect((await camera(page)).pitch).toBe(0);
    // Nothing can lower a top-down camera, and one step is always available.
    await expect(tiltDown).toBeDisabled();
    await expect(tiltUp).toBeEnabled();

    // Eight steps of 10° would reach 80°; the camera stops at the 78° limit
    // instead, and the control says so by switching itself off.
    for (const expected of [10, 20, 30, 40, 50, 60, 70, 78]) {
      await tiltUp.click();
      await expectPitch(page, expected);
    }
    await expect(tiltUp).toBeDisabled();
    await expect(tiltDown).toBeEnabled();
    // The goal timer that guarantees arrival must not change the angle when it
    // lands, and the step control must stay switched off at the limit.
    await page.waitForTimeout(1200);
    await expectPitch(page, 78);
    await expect(tiltUp).toBeDisabled();

    // Coming back down the same steps must not overshoot or undershoot zero.
    for (const expected of [68, 58, 48, 38, 28, 18, 8, 0]) {
      await tiltDown.click();
      await expectPitch(page, expected);
    }
    await expect(tiltDown).toBeDisabled();
    await expect(tiltUp).toBeEnabled();

    // Reset is the one-action way back to a plan view from any tilted angle.
    await tiltUp.click();
    await tiltUp.click();
    await expectPitch(page, 20);
    await page.getByRole('button', { name: 'Reset north and tilt' }).click();
    await expectPitch(page, 0);
    await expect.poll(async () => Math.abs((await camera(page)).bearing)).toBeLessThan(1);
    await expect(tiltDown).toBeDisabled();
    await expect(tiltUp).toBeEnabled();

    await tiltUp.click();
    await tiltUp.click();
    await expectPitch(page, 20);
    // Pressing Tilt up while the reset is still easing builds on the angle on
    // screen. The reset goal (0°) must not become the base: that would drop the
    // camera below the angle it had already reached before stepping up. Both
    // presses are issued in one page task so the step genuinely lands while the
    // reset is in flight; a separate Playwright click waits for actionability
    // long enough for the 700 ms ease to finish.
    const livePitch = await page.evaluate(() => {
      const controls = [...document.querySelectorAll<HTMLButtonElement>('button.map-control')];
      const byLabel = (label: string) => controls.find((button) => button.getAttribute('aria-label') === label);
      byLabel('Reset north and tilt')?.click();
      const live = (window as unknown as { __nightmap?: { getPitch(): number } }).__nightmap?.getPitch() ?? 0;
      byLabel('Tilt up')?.click();
      return live;
    });
    expect(livePitch).toBeGreaterThan(15);
    await expect
      .poll(async () => (await camera(page)).pitch, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(livePitch - 0.5);
    await expect.poll(async () => (await camera(page)).pitch, { timeout: 15_000 }).toBeGreaterThan(livePitch + 5);
    await expect.poll(async () => Math.abs((await camera(page)).bearing)).toBeLessThan(1);

    // The angle chip carries the same reset as one action. A tilt step that is
    // still in flight must not re-apply its target once the view is flat again.
    await tiltUp.click();
    await tiltUp.click();
    await tiltUp.click();
    await page.getByTestId('reset-camera').click();
    await expectPitch(page, 0);
    await expect.poll(async () => Math.abs((await camera(page)).bearing)).toBeLessThan(1);
    await expect(page.getByTestId('reset-camera')).toHaveCount(0);
    await page.waitForTimeout(1400);
    expect(Math.abs((await camera(page)).pitch)).toBeLessThan(0.5);
  });

  test('a drag takes over from a pending tilt and controls keep a manipulation touch action', async ({ page }) => {
    await openMap(page);
    const tiltUp = page.getByRole('button', { name: 'Tilt up' });
    // Rapid presses of the tilt pair must register as presses, never as a
    // double-tap zoom or a delayed click.
    expect(await tiltUp.evaluate((element) => getComputedStyle(element).touchAction)).toBe('manipulation');

    await tiltUp.click();
    // Take the camera over with a pitch drag before the step lands. The
    // guaranteed-arrival timer must not pull it back to the step's target.
    const box = (await page.locator('.map-canvas').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.5);
    await page.keyboard.down('Control');
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.5 + 140, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.up('Control');

    const dragged = (await camera(page)).pitch;
    expect(dragged).toBeLessThan(8);
    await page.waitForTimeout(1400);
    const settled = (await camera(page)).pitch;
    expect(settled).toBeLessThan(dragged + 1);
    expect(settled).toBeLessThan(5);
  });

  test('terrain relief and building geometry are fetched, and reported honestly', async ({ page }) => {
    const tiles: { url: string; status: number }[] = [];
    page.on('response', (response) => {
      const url = response.url();
      if (url.includes('/terrain/') || url.includes('/buildings/')) {
        tiles.push({ url, status: response.status() });
      }
    });

    await openMap(page);
    await page.evaluate(() => {
      const map = (window as unknown as { __nightmap?: { jumpTo(options: unknown): void } }).__nightmap;
      map?.jumpTo({ center: [-122.4145, 37.7875], zoom: 16.6 });
    });

    await toggleLayer(page, /Terrain shading/);
    await toggleLayer(page, /3D buildings/);

    await expect
      .poll(async () => (await mapState(page)).buildingFeatures, { timeout: 30_000 })
      .toBeGreaterThan(0);
    await expect(page.getByTestId('buildings-status')).toContainText(/loaded/);

    const served = tiles.filter((tile) => tile.status === 200).map((tile) => tile.url);
    expect(served.some((url) => url.includes('/terrain/'))).toBe(true);
    expect(served.some((url) => url.includes('/buildings/'))).toBe(true);

    // The map states what the vertical dimension is made of, including the
    // part of it that is estimated rather than measured.
    await page.getByRole('button', { name: 'Map legend' }).click();
    const legend = page.getByRole('dialog', { name: 'Map legend' });
    await expect(legend.getByText(/About the 3D view/)).toBeVisible();
    await expect(legend.getByText(/vertical scale with no exaggeration/)).toBeVisible();
    await expect(legend.getByText(/carry a height tag/)).toBeVisible();
    await expect(legend.getByText(/estimated from footprint type/)).toBeVisible();
  });

  test('the drawer describes the 3D sources without overselling them', async ({ page }) => {
    await openMap(page);
    await page.getByRole('button', { name: 'Layers', exact: true }).first().click();

    const terrainRow = page.locator('.layer-item').filter({ hasText: /Terrain shading/ }).first();
    await expect(terrainRow).toContainText(/7 m per pixel/);
    await expect(terrainRow).toContainText(/not kerbs, stairs/);
    await expect(terrainRow).toContainText('offline after first use');

    const buildingRow = page.locator('.layer-item').filter({ hasText: /3D buildings/ }).first();
    await expect(buildingRow).toContainText(/Most heights are estimated/);
    await expect(buildingRow).toContainText('from z14.6');

    const preset = page.locator('.preset', { hasText: '3D & terrain' });
    await expect(preset).toBeVisible();
    await preset.click();
    await expect(buildingRow.locator('input[type=checkbox]')).toBeChecked();
    await expect(terrainRow.locator('input[type=checkbox]')).toBeChecked();
  });
  test('satellite imagery is a separate base-map toggle', async ({ page }) => {
    const imagery: string[] = [];
    page.on('response', (response) => {
      if (response.url().includes('/World_Imagery/MapServer/tile/')) imagery.push(response.url());
    });
    await openMap(page);
    await page.getByRole('button', { name: 'Toggle satellite imagery' }).click();
    await expect.poll(async () => page.evaluate(() => {
      const map = (window as unknown as { __nightmap?: { getLayer(id: string): { visibility?: string } | undefined } }).__nightmap;
      return map?.getLayer('satellite-raster')?.visibility;
    })).toBe('visible');
    await expect.poll(() => imagery.length, { timeout: 30000 }).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Toggle satellite imagery' }).click();
    await expect.poll(async () => page.evaluate(() => {
      const map = (window as unknown as { __nightmap?: { getLayer(id: string): { visibility?: string } | undefined } }).__nightmap;
      return map?.getLayer('satellite-raster')?.visibility;
    })).toBe('none');
  });

  test('street-level imagery asks for a user token and keeps it session-only', async ({ page }) => {
    await openMap(page);
    await page.getByRole('button', { name: 'Street-level imagery' }).click();
    await expect(page.getByRole('dialog', { name: 'Mapillary street-level imagery' })).toBeVisible();
    await expect(page.getByLabel('Your Mapillary access token')).toBeVisible();
    await expect(page.getByText(/token stays in this panel's memory only/)).toBeVisible();
    await expect(page.locator('.street-viewer-credit')).toContainText('Imagery © Mapillary contributors');
  });

  test('map controls are visible and the overview map renders', async ({ page }) => {
    await openMap(page);
    for (const name of [
      '3D view',
      'Toggle satellite imagery',
      'Street-level imagery',
      'Reset north and tilt',
      'Follow my GPS location',
      'Layers',
      'Map legend',
    ]) {
      await expect(page.getByRole('button', { name, exact: true }).first()).toBeVisible();
    }
    await expect(page.locator('.mini-map-widget')).toBeVisible();
    await expect(page.locator('.mini-map-canvas canvas')).toBeVisible();

    type OverviewMap = {
      isStyleLoaded(): boolean;
      getLayer(id: string): unknown;
      queryRenderedFeatures(options: { layers: string[] }): unknown[];
      getStyle(): {
        layers: Array<{ id: string; paint?: Record<string, unknown> }>;
        sources: Record<string, { data?: { geometry?: { coordinates?: number[][][] } } }>;
      };
    };
    await expect
      .poll(() =>
        page.evaluate(() => {
          const overview = (window as unknown as { __nightmapOverview?: OverviewMap }).__nightmapOverview;
          if (!overview?.isStyleLoaded()) return false;
          return [
            'coverage-outside-dim',
            'coverage-footprint-fill',
            'coverage-footprint-line',
            'main-map-extent-fill',
            'main-map-extent-line',
          ].every((id) => Boolean(overview.getLayer(id)));
        }),
      )
      .toBe(true);

    const overviewLayers = await page.evaluate(() => {
      const overview = (window as unknown as { __nightmapOverview?: OverviewMap }).__nightmapOverview!;
      const style = overview.getStyle();
      const mask = style.sources['coverage-mask'].data?.geometry?.coordinates ?? [];
      return {
        order: style.layers
          .map((layer) => layer.id)
          .filter((id) => [
            'coverage-outside-dim',
            'coverage-footprint-fill',
            'coverage-footprint-line',
            'main-map-extent-fill',
            'main-map-extent-line',
          ].includes(id)),
        maskRings: mask.length,
        extractHole: mask[1],
        dim: style.layers.find((layer) => layer.id === 'coverage-outside-dim')?.paint,
      };
    });
    expect(overviewLayers.order).toEqual([
      'coverage-outside-dim',
      'coverage-footprint-fill',
      'coverage-footprint-line',
      'main-map-extent-fill',
      'main-map-extent-line',
    ]);
    expect(overviewLayers.maskRings).toBe(2);
    expect(overviewLayers.extractHole).toEqual([
      [-122.429, 37.7585],
      [-122.3905, 37.7585],
      [-122.3905, 37.7975],
      [-122.429, 37.7975],
      [-122.429, 37.7585],
    ]);
    expect(overviewLayers.dim).toMatchObject({
      'fill-color': '#050806',
      'fill-opacity': 0.62,
    });

    // The layers must actually paint, not merely exist in the style: the dim
    // mask and amber footprint are the visual explanation of blank main-map
    // ground.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const overview = (window as unknown as { __nightmapOverview?: OverviewMap }).__nightmapOverview!;
          return ['coverage-outside-dim', 'coverage-footprint-line'].every(
            (id) => overview.queryRenderedFeatures({ layers: [id] }).length > 0,
          );
        }),
      )
      .toBe(true);
  });

});
