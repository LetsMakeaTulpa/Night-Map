import { expect, test, type Page } from '@playwright/test';

interface FeedPayload {
  features: { properties: { kind: string }; geometry: { coordinates: [number, number] } }[];
}

interface TappedFeature {
  kind: string;
  lat: number;
  lon: number;
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

async function toggleLayer(page: Page, name: RegExp) {
  await page.getByRole('button', { name: 'Layers', exact: true }).first().click();
  await page.locator('.layer-item').filter({ hasText: name }).first().locator('.switch-track').click();
  await page.getByRole('button', { name: 'Close layers' }).click();
}

/**
 * Clicks a feature the renderer can actually hit, and returns its kind. The
 * feature is chosen with the renderer's own hit test, so a miss is a real
 * failure rather than a flaky click at an empty pixel.
 */
async function clickIncident(page: Page, feed: 'calls' | 'cases311'): Promise<TappedFeature> {
  const response = await page.request.get(`/incidents/${feed}.json`);
  const payload = (await response.json()) as FeedPayload;
  const target = await page.evaluate(
    ({ features, feed }) => {
      const map = (
        window as unknown as {
          __nightmap?: {
            getCanvas(): HTMLCanvasElement;
            project(coordinates: [number, number]): { x: number; y: number };
            queryRenderedFeatures(point: [number, number], options: { layers: string[] }): unknown[];
          };
        }
      ).__nightmap;
      if (!map) return null;
      const layerId = feed === 'calls' ? 'calls-recent' : 'cases-311';
      const rect = map.getCanvas().getBoundingClientRect();
      const distance = (point: { x: number; y: number }) =>
        Math.abs(point.x - rect.width / 2) + Math.abs(point.y - rect.height / 2);
      const candidates = features
        .map((feature) => {
          const point = map.project(feature.geometry.coordinates);
          return {
            kind: feature.properties.kind,
            lat: feature.geometry.coordinates[1],
            lon: feature.geometry.coordinates[0],
            x: point.x,
            y: point.y,
          };
        })
        // Stay clear of the status strip at the top and the bottom sheet on a phone.
        .filter((point) => point.x > 40 && point.y > 110 && point.x < rect.width - 40 && point.y < rect.height - 150)
        .sort((a, b) => distance(a) - distance(b))
        .slice(0, 250);
      for (const candidate of candidates) {
        if (map.queryRenderedFeatures([candidate.x, candidate.y], { layers: [layerId] }).length > 0) {
          return { ...candidate, left: rect.left, top: rect.top };
        }
      }
      return null;
    },
    { features: payload.features, feed },
  );
  expect(target, `no rendered ${feed} feature could be clicked`).not.toBeNull();
  await page.mouse.click(target!.left + target!.x, target!.top + target!.y);
  return { kind: target!.kind, lat: target!.lat, lon: target!.lon };
}

test.describe('Scenario K — reported activity, honestly labelled', () => {
  test('calls load only when asked, blink, and open a card that states its limits', async ({ page }) => {
    const fetched: string[] = [];
    page.on('request', (request) => {
      // Only the data files: the module path /src/features/incidents/ also contains
      // the word, and counting a component import would be a false positive.
      if (/\/incidents\/[a-z0-9]+\.json$/.test(request.url())) fetched.push(request.url());
    });

    await openMap(page);
    // Nothing is fetched behind the user's back: the layer is off by default.
    expect(fetched).toEqual([]);

    await toggleLayer(page, /Dispatched calls/);
    await expect.poll(() => fetched.length, { timeout: 30_000 }).toBeGreaterThan(0);
    await expect(page.getByTestId('calls-status')).toContainText(/dispatched calls/);
    await expect(page.getByTestId('calls-status')).toContainText(/published snapshot/);

    // The alert pulse is really animated, not a static ring with a nice name.
    const samples = await page.evaluate(async () => {
      const map = (
        window as unknown as {
          __nightmap?: { getPaintProperty(layer: string, name: string): unknown };
        }
      ).__nightmap;
      const seen: string[] = [];
      for (let i = 0; i < 6; i += 1) {
        seen.push(String(map?.getPaintProperty('calls-pulse', 'circle-stroke-opacity')));
        await new Promise((resolve) => setTimeout(resolve, 420));
      }
      return seen;
    });
    expect(new Set(samples).size).toBeGreaterThan(1);

    await page.getByRole('button', { name: 'Map legend' }).click();
    const legend = page.getByRole('dialog', { name: 'Map legend' });
    await expect(legend.getByText(/These are published City records, not a live feed/)).toBeVisible();
    await expect(legend.getByText(/already closed/)).toBeVisible();
    await expect(legend.getByText(/Around 40 m of position is all that is kept/)).toBeVisible();
    await page.getByRole('button', { name: 'Map legend' }).click();

    const tapped = await clickIncident(page, 'calls');
    const card = page.getByTestId('incident-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Dispatched call');
    // Several calls can share one snapped position, so the card is checked
    // against the place that was tapped, not against one exact record.
    await expect(card).toContainText(`${tapped.lat.toFixed(4)}, ${tapped.lon.toFixed(4)}`);
    await expect(card).toContainText(/not live 911/);
    await expect(card).toContainText(/snapped to about 40 m/);
    await expect(card).toContainText(/street addresses and free-text details are not stored/);
  });

  test('311 requests load on their own layer and any plotted feature can be routed to', async ({ page }) => {
    await openMap(page);
    await toggleLayer(page, /311 service requests/);
    await expect(page.getByTestId('cases311-status')).toContainText(/311 cases/);
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const map = (
              window as unknown as { __nightmap?: { querySourceFeatures(id: string): unknown[] } }
            ).__nightmap;
            return map?.querySourceFeatures('cases311').length ?? 0;
          }),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);

    const tapped = await clickIncident(page, 'cases311');
    const card = page.getByTestId('incident-card');
    await expect(card).toContainText('311 request');
    await expect(card).toContainText(`${tapped.lat.toFixed(4)}, ${tapped.lon.toFixed(4)}`);

    // Routing is for what is on the map, not only for place records: the card
    // hands the feature to the route planner as a stop.
    await card.getByTestId('incident-route').click();
    await expect(card).toBeHidden();
    const stop = page.locator('.stop-row').filter({ hasText: tapped.lon.toFixed(4) }).first();
    await expect(stop).toBeVisible();
    await expect(stop).toContainText(tapped.lat.toFixed(4));
  });

  test('the drawer states what these layers are, and the preset is named plainly', async ({ page }) => {
    await openMap(page);
    await page.getByRole('button', { name: 'Layers', exact: true }).first().click();

    const callsRow = page.locator('.layer-item').filter({ hasText: /Dispatched calls/ }).first();
    await expect(callsRow).toContainText(/A snapshot, not a live feed/);
    await expect(callsRow).toContainText(/no audio/);
    await expect(callsRow).toContainText(/withheld sensitive calls are absent/);
    await expect(callsRow).toContainText('offline after first use');

    const casesRow = page.locator('.layer-item').filter({ hasText: /311 service requests/ }).first();
    await expect(casesRow).toContainText(/excluded before publication/);

    await page.locator('.preset', { hasText: 'Reported activity' }).click();
    await expect(callsRow.locator('input[type=checkbox]')).toBeChecked();
    await expect(casesRow.locator('input[type=checkbox]')).toBeChecked();
  });
});
