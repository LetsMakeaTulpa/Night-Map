import { expect, test, type Page } from '@playwright/test';
import { isMobileProject, openFieldnotes, searchAndOpen } from './helpers';

async function openNearby(page: Page, projectName: string) {
  if (isMobileProject(projectName)) {
    await page.getByRole('navigation', { name: 'Workspaces' }).getByRole('button', { name: 'Nearby' }).click();
    await page.locator('.sheet-handle').click();
  } else {
    await page.getByRole('button', { name: 'Nearby', exact: true }).click();
  }
}

test.describe('Scenario A — find a real, source-backed resource', () => {
  test('search, filter, select and inspect a record without an account', async ({ page }, testInfo) => {
    await page.goto('/');
    if (isMobileProject(testInfo.project.name)) {
      await expect(page.locator('.brand-name').first()).toBeVisible();
      await expect(page.getByText('No account', { exact: false }).first()).toBeVisible();
    } else {
      await expect(page.getByRole('complementary', { name: 'Workspaces' })).toBeVisible();
      await expect(page.getByRole('img', { name: /Online: network requests work/ })).toBeVisible();
    }

    // Category filtering is real: turning water off changes the result set.
    await openNearby(page, testInfo.project.name);
    const waterChip = page.locator('.filter-chip', { hasText: 'Water' });
    await waterChip.click();
    await expect(waterChip).toHaveAttribute('aria-pressed', 'false');
    await waterChip.click();
    await expect(waterChip).toHaveAttribute('aria-pressed', 'true');

    await searchAndOpen(page, 'GLIDE', /GLIDE Daily Free Meals/);
    const inspector = page.locator('.inspector');
    await expect(inspector.getByRole('heading', { name: /GLIDE Daily Free Meals/ })).toBeVisible();
    await expect(inspector.getByText('330 Ellis Street')).toBeVisible();
    await expect(inspector.getByText('Checked against provider page').first()).toBeVisible();
    await expect(inspector.getByText('No eligibility requirements stated')).toBeVisible();

    await inspector.getByRole('tab', { name: /Sources/ }).click();
    await expect(inspector.getByRole('link', { name: /GLIDE Daily Free Meals/ })).toHaveAttribute(
      'href',
      'https://www.glide.org/programs/daily-free-meals/',
    );
    await expect(inspector.getByText(/facts paraphrased|paraphrased/i).first()).toBeVisible();
  });
});

test.describe('Scenario B — evaluate uncertainty', () => {
  test('a months-old City row never claims to be open now, and offers a way to check', async ({
    page,
  }, testInfo) => {
    await page.goto('/');
    await openNearby(page, testInfo.project.name);
    await searchAndOpen(page, 'Boeddeker fountain', /Boeddeker Park - Drinking Fountain/);
    const inspector = page.locator('.inspector');
    await expect(inspector.getByText('Open now not confirmed').first()).toBeVisible();
    await expect(inspector.getByText('Open now, per published hours')).toHaveCount(0);
    await expect(inspector.getByText(/aging record/).first()).toBeVisible();
    const check = inspector.getByRole('link', { name: 'Check before going' });
    await expect(check).toHaveAttribute('href', /data\.sf(gov|\.gov)/);
  });
});

test.describe('Scenario C — plan a route, and recover when routing fails', () => {
  test('plans a real walking route, then shows an honest failure state', async ({ page }, testInfo) => {
    await page.goto('/');
    await searchAndOpen(page, 'GLIDE', /GLIDE Daily Free Meals/);
    const inspector = page.locator('.inspector');
    await inspector.getByRole('button', { name: 'GO' }).click();

    // The origin is opt-in: one explicit fix, held in memory for this session.
    const useLocation = page.locator('.route-panel').getByRole('button', { name: 'Use current location' });
    if (await useLocation.count()) await useLocation.first().click();
    await expect(page.getByText('Current location').first()).toBeVisible({ timeout: 20_000 });

    await expect(page.getByRole('heading', { name: /Plan the walk|Walking route|Route planned/ }).first()).toBeVisible();

    // A failed provider must not fabricate a path.
    await page.route('**/routed-foot/**', (route) => route.abort());
    await page.getByRole('button', { name: 'Find walking route' }).click();
    await expect(page.getByText('No walking route was produced').first()).toBeVisible();
    await expect(page.getByText('Straight-line distance:').first()).toBeVisible();
    await expect(page.getByText(/does not follow streets/).first()).toBeVisible();

    // With the provider reachable, the route comes back with real geometry.
    await page.unroute('**/routed-foot/**');
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.locator('.route-metrics')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Night Map does not know about lighting/)).toBeVisible();
    await expect(page.getByText(/does not score streets for safety/).first()).toBeVisible();
  });
});

test.describe('Scenario D — save and revisit', () => {
  test('a saved place survives a reload', async ({ page }, testInfo) => {
    await page.goto('/');
    await searchAndOpen(page, 'Curry Senior', /Curry Senior Center/);
    const inspector = page.locator('.inspector');
    const save = inspector.getByRole('button', { name: 'Save', exact: true });
    await save.click();
    await expect(inspector.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();

    await page.reload();
    await searchAndOpen(page, 'Curry Senior', /Curry Senior Center/);
    await expect(page.locator('.inspector').getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  });
});

test.describe('Scenario E — record and edit a private fieldnote', () => {
  test('saves privately, reopens for editing, and never publishes', async ({ page }, testInfo) => {
    const noteText = 'Water fountain running at 9pm; bottle filler working.';
    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET') requests.push(`${request.method()} ${request.url()} ${request.postData() ?? ''}`);
    });

    await page.goto('/');
    await searchAndOpen(page, 'GLIDE', /GLIDE Daily Free Meals/);
    const inspector = page.locator('.inspector');
    await inspector.getByRole('button', { name: 'Add private note' }).click();

    await page.getByRole('button', { name: 'Was open when I passed' }).click();
    await page.getByLabel(/What did you see/).fill(noteText);
    await expect(page.getByText('Private on this device')).toBeVisible();
    await page.getByRole('button', { name: 'Save private note' }).click();
    await expect(page.getByText(/Field note saved privately/)).toBeVisible();

    // Visible in the place's observation history and in the Notes workspace.
    await inspector.getByRole('tab', { name: /Observations/ }).click();
    await expect(inspector.getByText(noteText).first()).toBeVisible();
    await expect(inspector.getByText('Private').first()).toBeVisible();

    await openFieldnotes(page, testInfo.project.name);
    await expect(page.getByText(noteText).first()).toBeVisible();
    await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
    const textarea = page.getByLabel(/What did you see/);
    await textarea.fill(`${noteText} Rechecked later.`);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText(/Rechecked later/).first()).toBeVisible();

    await page.reload();
    await openFieldnotes(page, testInfo.project.name);
    await expect(page.getByText(/Rechecked later/).first()).toBeVisible();

    // Nothing was POSTed anywhere: the note stayed on the device.
    expect(requests.filter((r) => !r.startsWith('GET'))).toEqual([]);
  });
});

test.describe('Scenario G — desktop research workspace', () => {
  test('selection survives workspace changes and the command palette', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'desktop-only workflow');
    await page.goto('/');
    await searchAndOpen(page, 'Curry Senior', /Curry Senior Center/);
    const inspector = page.locator('.inspector');
    await expect(inspector.getByRole('heading', { name: /Curry Senior Center/ })).toBeVisible();
    await expect(page.locator('.float-panel.panel-right')).toBeVisible();
    await inspector.getByRole('tab', { name: /Sources/ }).click();
    await expect(inspector.getByText(/Provider website/)).toBeVisible();

    // Opening a research workspace must not discard the selected record.
    await page.getByRole('button', { name: 'Nearby', exact: true }).click();
    await expect(page.locator('.float-panel.panel-left')).toBeVisible();
    await expect(inspector.getByRole('heading', { name: /Curry Senior Center/ })).toBeVisible();
    await page.getByRole('button', { name: 'Close workspace' }).click();
    await expect(inspector.getByRole('heading', { name: /Curry Senior Center/ })).toBeVisible();

    // The command palette is additive, not the only way to work.
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(inspector.getByRole('heading', { name: /Curry Senior Center/ })).toBeVisible();
  });
});

test.describe('Scenario H — protect sensitive information', () => {
  test('a private observation is absent from public map results and cannot be published', async ({
    page,
  }, testInfo) => {
    await page.goto('/');
    await searchAndOpen(page, 'Hospitality House', /Tenderloin Self-Help Center/);
    const inspector = page.locator('.inspector');
    const secret = `Private access detail ${Date.now()}`;
    await inspector.getByRole('button', { name: 'Add private note' }).click();
    await page.getByRole('button', { name: 'Access issue' }).click();
    await page.getByLabel(/What did you see/).fill(secret);
    await expect(page.getByText('Private on this device')).toBeVisible();
    await expect(
      page.getByText('Group sharing and public publication are not implemented in this release.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Save private note' }).click();
    await expect(page.getByText(/Field note saved privately/)).toBeVisible();

    // The observation layer is off by default, so notes are not mapped publicly.
    await page.getByRole('button', { name: 'Layers', exact: true }).first().click();
    const layerRow = page.locator('.layer-item', { hasText: 'My field notes' });
    await expect(layerRow.locator('input[type=checkbox]')).not.toBeChecked();
    await expect(page.locator('.legend, .nearby-list').getByText(secret)).toHaveCount(0);
  });
});
