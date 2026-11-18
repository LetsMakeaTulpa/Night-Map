import { expect, type Page } from '@playwright/test';

export const isMobileProject = (projectName: string) => projectName === 'mobile';

/** Open the search panel from the control the current layout actually exposes. */
export async function openSearch(page: Page) {
  const visibleInput = page.locator('.searchbar input[aria-label="Search Night Map"]:visible').first();
  if ((await visibleInput.count()) === 0) {
    await page.getByRole('button', { name: 'Search', exact: true }).first().click();
  }
  const input = page.locator('.searchbar input[aria-label="Search Night Map"]:visible').first();
  await expect(input).toBeVisible();
  await input.fill('');
  return input;
}

export async function searchAndOpen(page: Page, query: string, name: RegExp) {
  const input = await openSearch(page);
  await input.fill(query);
  const hit = page.locator('.search-hit').filter({ hasText: name }).first();
  await hit.waitFor({ state: 'visible' });
  await hit.click();
  await expect(page.locator('.inspector')).toBeVisible();
}

/** Wait for the production map and its renderer, not the dev server. */
export async function openMap(page: Page) {
  await page.goto('/');
  await expect(page.locator('.map-canvas')).toBeVisible();
  await expect(page.locator('.map-loading')).toHaveCount(0, { timeout: 30_000 });
  await page.waitForFunction(
    () => Boolean((window as unknown as { __nightmap?: unknown }).__nightmap),
    undefined,
    { timeout: 30_000 },
  );
}

/** Fieldnotes moved behind the Field map workspace; the phone uses its header entry. */
export async function openFieldnotes(page: Page, projectName: string) {
  if (isMobileProject(projectName)) {
    await page.getByRole('button', { name: 'Field map and notes' }).click();
  } else {
    await page.getByRole('button', { name: 'Field map', exact: true }).click();
  }
}
