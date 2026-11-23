import { expect, test, type Page } from '@playwright/test';
import { openMap } from './helpers';

interface Pose {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

type MapWindow = {
  __nightmap?: {
    getCenter(): { lng: number; lat: number };
    getZoom(): number;
    getPitch(): number;
    getBearing(): number;
    getLayer(id: string): { visibility?: string } | undefined;
    jumpTo(options: unknown): void;
  };
};

const CAMERA_A: Pose = { center: [-122.41, 37.78], zoom: 16.4, pitch: 0, bearing: 0 };
const CAMERA_B: Pose = { center: [-122.42, 37.79], zoom: 14.8, pitch: 40, bearing: 25 };

async function jump(page: Page, pose: Pose) {
  await page.evaluate((next) => {
    (window as unknown as MapWindow).__nightmap?.jumpTo(next);
  }, pose);
  await expect
    .poll(async () => {
      const live = await camera(page);
      return [live.zoom, live.pitch, live.bearing].map((value) => round(value, 1));
    })
    .toEqual([round(pose.zoom, 1), round(pose.pitch, 1), round(pose.bearing, 1)]);
  // The store learns the camera on moveend; give that render a beat before saving.
  await page.waitForTimeout(300);
}

/** toFixed also turns -0 into 0, which the camera can report after a rotation. */
function round(value: number, places: number): number {
  return Number(value.toFixed(places));
}

async function camera(page: Page): Promise<Pose> {
  return page.evaluate(() => {
    const map = (window as unknown as MapWindow).__nightmap!;
    const centre = map.getCenter();
    return { center: [centre.lng, centre.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
  });
}

async function expectCamera(page: Page, pose: Pose) {
  await expect
    .poll(async () => {
      const live = await camera(page);
      return [live.center[0], live.center[1], live.zoom, live.pitch, live.bearing].map((value) =>
        round(value, 3),
      );
    })
    .toEqual([round(pose.center[0], 3), round(pose.center[1], 3), pose.zoom, pose.pitch, pose.bearing]);
}

async function openLayers(page: Page) {
  await page.getByRole('button', { name: 'Layers', exact: true }).first().click();
}

async function closeLayers(page: Page) {
  await page.getByRole('button', { name: 'Close layers' }).click();
}

async function saveView(page: Page, name: string) {
  await openLayers(page);
  await page.getByLabel('Name for this layer view').fill(name);
  await page.getByRole('button', { name: 'Save view' }).click();
  await expect(page.getByRole('button', { name: `Apply “${name}”` })).toBeVisible();
  await closeLayers(page);
}

test('saved views restore their camera, and older views without one leave it alone', async ({ page }) => {
  await openMap(page);

  // A view saved from a level camera records that framing.
  await jump(page, CAMERA_A);
  await saveView(page, 'Camera A');

  // Moving away and recalling the view brings the camera back.
  await jump(page, CAMERA_B);
  await openLayers(page);
  await page.getByRole('button', { name: 'Apply “Camera A”' }).click();
  await closeLayers(page);
  await expectCamera(page, CAMERA_A);

  // A second view saved with satellite on and a tilted camera.
  await openLayers(page);
  await page.locator('.layer-item').filter({ hasText: /Satellite/ }).first().locator('.switch-track').click();
  await closeLayers(page);
  await saveView(page, 'Legacy');

  // Strip the camera the way a record written before this field existed looks.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('night-map');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const records = await new Promise<Array<{ id: string; name: string; camera?: unknown }>>(
          (resolve, reject) => {
            const tx = db.transaction('layerViews', 'readonly');
            const all = tx.objectStore('layerViews').getAll();
            all.onsuccess = () => resolve(all.result as Array<{ id: string; name: string }>);
            all.onerror = () => reject(all.error);
          },
        );
        db.close();
        return records.filter((record) => record.name === 'Legacy').length;
      }),
    )
    .toBe(1);

  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('night-map');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('layerViews', 'readwrite');
      const store = tx.objectStore('layerViews');
      const all = store.getAll();
      all.onsuccess = () => {
        const record = (all.result as Array<{ name: string; camera?: unknown }>).find(
          (entry) => entry.name === 'Legacy',
        );
        if (record) {
          delete record.camera;
          store.put(record);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });

  // Reload so the stored record is read back from storage.
  await openMap(page);
  await jump(page, CAMERA_B);

  await openLayers(page);
  await page.getByRole('button', { name: 'Apply “Legacy”' }).click();
  await closeLayers(page);

  // Its layer toggles apply…
  await expect
    .poll(async () =>
      page.evaluate(() => (window as unknown as MapWindow).__nightmap?.getLayer('satellite-raster')?.visibility),
    )
    .toBe('visible');

  // …and the camera stays exactly where the reader left it.
  await page.waitForTimeout(1200);
  await expectCamera(page, CAMERA_B);
});
