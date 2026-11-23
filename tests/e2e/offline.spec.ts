import { expect, test } from '@playwright/test';
import { openFieldnotes, searchAndOpen } from './helpers';

// The dev server deliberately registers no service worker, so this scenario can
// only run against the production preview (npm run build && npm run preview),
// which is what the config starts when BASE_URL is not supplied.
const previewPort = process.env.BASE_URL ? new URL(process.env.BASE_URL).port : '4173';
test.skip(previewPort !== '4173', 'offline scenario needs the production preview served with a service worker');

test.describe('Scenario F — connectivity loss', () => {
  test('cached shell, saved records and private notes survive offline', async ({ page, context }, testInfo) => {
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();

    await searchAndOpen(page, 'Hospitality House', /Tenderloin Self-Help Center/);
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
    await expect(page.getByText(/Bundled (places|records)/)).toBeVisible();

    await searchAndOpen(page, 'Hospitality House', /Tenderloin Self-Help Center/);
    await expect(page.locator('.inspector')).toBeVisible();
    await expect(page.locator('.inspector').getByRole('button', { name: 'Saved', exact: true })).toBeVisible();

    await openFieldnotes(page, testInfo.project.name);
    await expect(page.getByText(note)).toBeVisible();

    // A network-only feature must explain itself rather than fail silently.
    await page.getByRole('button', { name: 'Routes', exact: true }).first().click();
    await expect(page.getByText(/Route planning needs the routing service/)).toBeVisible();

    await context.setOffline(false);
  });
});
