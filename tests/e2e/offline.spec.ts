import { expect, test } from '@playwright/test';

test.describe('Scenario F — connectivity loss', () => {
  test('cached shell, saved records and private notes survive offline', async ({ page, context }) => {
    test.skip(!process.env.BASE_URL, 'runs against the production build with a service worker');

    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();

    const search = page.getByLabel('Search Night Map');
    if (await page.getByRole('button', { name: 'Search', exact: true }).count()) {
      await page.getByRole('button', { name: 'Search', exact: true }).click();
    }
    await search.fill('Hospitality House');
    await page.locator('.search-hit').filter({ hasText: /Tenderloin Self-Help Center/ }).first().click();
    const inspector = page.locator('.inspector');
    const save = inspector.getByRole('button', { name: 'Save', exact: true });
    if (await save.count()) await save.click();

    const note = `Offline check ${Date.now()}`;
    await page.getByRole('button', { name: 'Add private note' }).click();
    await page.getByLabel(/What did you see/).fill(note);
    await page.getByRole('button', { name: 'Save private note' }).click();
    await expect(page.getByText(/Field note saved privately/)).toBeVisible();

    // Everything above is now cached by the service worker.
    await context.setOffline(true);
    await page.reload();

    await expect(page.getByText('Offline', { exact: true }).first()).toBeVisible();
    await expect(page.locator('.map-canvas')).toBeVisible();
    await expect(page.getByText(/Bundled records/)).toBeVisible();

    if (await page.getByRole('button', { name: 'Search', exact: true }).count()) {
      await page.getByRole('button', { name: 'Search', exact: true }).click();
    }
    await page.getByLabel('Search Night Map').fill('Hospitality House');
    await page.locator('.search-hit').filter({ hasText: /Tenderloin Self-Help Center/ }).first().click();
    await expect(page.locator('.inspector')).toBeVisible();
    await expect(page.locator('.inspector').getByRole('button', { name: 'Saved', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Notes', exact: true }).first().click();
    await expect(page.getByText(note)).toBeVisible();

    // A network-only feature must explain itself rather than fail silently.
    await page.getByRole('button', { name: 'Routes', exact: true }).first().click();
    await expect(page.getByText(/Route planning needs the routing service/)).toBeVisible();

    await context.setOffline(false);
  });
});
