import { expect, test, type Page } from '@playwright/test';
import { openMap } from './helpers';

interface MapWindow {
  __nightmap?: {
    getCenter(): { lng: number; lat: number };
    isMoving(): boolean;
  };
}

async function centre(page: Page) {
  return page.evaluate(() => {
    const map = (window as unknown as MapWindow).__nightmap;
    return map ? { lng: map.getCenter().lng, lat: map.getCenter().lat } : null;
  });
}

async function expectCentreNear(page: Page, lng: number, lat: number) {
  await expect
    .poll(
      async () => {
        const current = await centre(page);
        return current ? Math.abs(current.lng - lng) + Math.abs(current.lat - lat) : 1;
      },
      { timeout: 30_000 },
    )
    .toBeLessThan(0.001);
}

test.describe('GPS follow', () => {
  test('the visible centre snaps onto each new fix and holds when released', async ({ page, context }) => {
    await context.setGeolocation({ latitude: 37.7775, longitude: -122.4135 });
    await openMap(page);

    const follow = page.getByRole('button', { name: 'Follow my GPS location' });
    await expect(follow).toHaveAttribute('aria-pressed', 'false');

    await follow.click();
    await expect(follow).toHaveAttribute('aria-pressed', 'true');
    await expectCentreNear(page, -122.4135, 37.7775);

    // Later readings move the map without another press: following is live,
    // not a single recentre.
    await context.setGeolocation({ latitude: 37.7795, longitude: -122.4165 });
    await expectCentreNear(page, -122.4165, 37.7795);
    await context.setGeolocation({ latitude: 37.7815, longitude: -122.4195 });
    await expectCentreNear(page, -122.4195, 37.7815);

    // Pressing again releases the map, so a new fix no longer moves it.
    await follow.click();
    await expect(follow).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => page.evaluate(() => Boolean((window as unknown as MapWindow).__nightmap?.isMoving()))).toBe(false);
    const held = (await centre(page))!;

    await context.setGeolocation({ latitude: 37.7865, longitude: -122.4235 });
    await page.waitForTimeout(1_500);
    const after = (await centre(page))!;
    expect(Math.abs(after.lng - held.lng) + Math.abs(after.lat - held.lat)).toBeLessThan(0.0005);
  });
});
