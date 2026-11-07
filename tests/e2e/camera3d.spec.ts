import { expect, test, type Page } from '@playwright/test';

interface CameraState {
  pitch: number;
  bearing: number;
}

async function openMap(page: Page) {
  await page.goto('/');
  await expect(page.locator('.map-canvas')).toBeVisible();
  await page.waitForFunction(
    () => Boolean((window as unknown as { __nightmap?: unknown }).__nightmap),
    undefined,
    { timeout: 30_000 },
  );
}

async function camera(page: Page): Promise<CameraState> {
  return page.evaluate(() => {
    const map = (window as unknown as {
      __nightmap?: { getPitch(): number; getBearing(): number };
    }).__nightmap;
    return { pitch: map ? map.getPitch() : -1, bearing: map ? map.getBearing() : 0 };
  });
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
      hillshade: map?.getLayer('hillshade')?.visibility ?? null,
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
    expect(state.hillshade).toBe('visible');
    expect(state.buildingsLayer).toBe('visible');

    // A tilted plan is not the only view, and leaving it is one action.
    await page.getByRole('button', { name: 'Reset north and tilt' }).click();
    await expect.poll(async () => (await camera(page)).pitch).toBe(0);
    await expect.poll(async () => Math.abs((await camera(page)).bearing)).toBeLessThan(1);
    await expect(page.getByText(/tilted \d+°/)).toHaveCount(0);
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
    await expect(terrainRow).toContainText(/cannot show kerbs, stairs/);
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
    await expect(page.locator('.street-viewer-canvas')).toBeVisible();
  });

});
