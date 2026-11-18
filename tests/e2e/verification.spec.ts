import { expect, test, type Page } from '@playwright/test';
import { isMobileProject, searchAndOpen } from './helpers';

/**
 * Scenario I — the verification workflow.
 *
 * Filing, structure checks, duplicate detection and queue visibility run on both
 * projects. Resolving a correction is a desktop research task, so that test is
 * desktop-only.
 */

const DETAIL = 'Front doors were chained shut at 8pm and a paper sign said closed for staffing.';

async function openPlace(page: Page, projectName: string, query: string, name: RegExp) {
  await searchAndOpen(page, query, name);
}

/** The form stays open when a report needs more information, so only toggle it when it is closed. */
async function openReportForm(page: Page) {
  const form = page.locator('.report-form');
  if ((await form.count()) === 0) {
    await page.locator('.inspector').getByRole('button', { name: 'Report' }).click();
  }
  await expect(form).toBeVisible();
}

async function openReview(page: Page, projectName: string) {
  if (isMobileProject(projectName)) {
    // Review is not on the phone bar; it lives in the header beside search.
    await page.getByRole('button', { name: /^Review/ }).click();
    await page.locator('.sheet-handle').click();
  } else {
    await page.getByRole('button', { name: 'Review', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'Review queue' })).toBeVisible();
}

test.describe('Scenario I — reports are checked, reviewed and logged', () => {
  test('a report is validated for structure and duplicates before it reaches the queue', async ({
    page,
  }, testInfo) => {
    const project = testInfo.project.name;
    await page.goto('/');
    await openPlace(page, project, 'GLIDE', /GLIDE Daily Free Meals/);
    const inspector = page.locator('.inspector');

    // Nothing is stored until the report says something.
    await openReportForm(page);
    await page.getByLabel('Report detail').fill('no');
    await page.getByRole('button', { name: 'Send to review queue' }).click();
    await expect(page.getByText(/Describe what you saw/)).toBeVisible();

    // A note too short to act on is stored with a visible "needs information" status.
    await page.getByLabel('Report detail').fill('shut');
    await page.getByRole('button', { name: 'Send to review queue' }).click();
    let receipt = page.locator('.report-receipt');
    await expect(receipt.getByText(/Needs information/)).toBeVisible();
    await expect(receipt.getByText(/at least 12 characters/)).toBeVisible();

    // A complete report passes validation and is queued.
    await openReportForm(page);
    await page.getByLabel('What is wrong?').selectOption('closed');
    await page.getByLabel('Report detail').fill(DETAIL);
    await page.getByRole('button', { name: 'Send to review queue' }).click();
    receipt = page.locator('.report-receipt');
    await expect(receipt.getByText(/Queued for review/)).toBeVisible();

    // The same issue at the same record is flagged as a duplicate candidate, not queued twice.
    await openReportForm(page);
    await page.getByLabel('What is wrong?').selectOption('closed');
    await page.getByLabel('Report detail').fill(`${DETAIL} Repeating in case the first one was missed.`);
    await page.getByRole('button', { name: 'Send to review queue' }).click();
    await expect(page.locator('.report-receipt').getByText(/Possible duplicate/)).toBeVisible();

    // The reviewer sees every report with its status, structure notes and provenance.
    await openReview(page, project);
    await expect(page.getByText(/no submission server/i).first()).toBeVisible();
    const queuedCard = page.locator('.report-card').filter({ has: page.getByText(DETAIL, { exact: true }) });
    await expect(queuedCard).toHaveCount(1);
    await expect(queuedCard.locator('.report-status')).toHaveText('Queued for review');
    await expect(queuedCard.getByText('kept on this device', { exact: true })).toBeVisible();
    await expect(
      page.locator('.report-card').filter({ hasText: 'at least 12 characters' }).locator('.report-status'),
    ).toHaveText('Needs information');
    await expect(
      page
        .locator('.report-card')
        .filter({ hasText: 'Repeating in case the first one was missed' })
        .locator('.report-status'),
    ).toHaveText('Possible duplicate');
  });

  test('a confirmed correction applies as a local override and stays traceable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'review resolution is a desktop research workflow');
    await page.goto('/');
    await openPlace(page, 'desktop', 'GLIDE', /GLIDE Daily Free Meals/);
    const inspector = page.locator('.inspector');

    await openReportForm(page);
    await page.getByLabel('What is wrong?').selectOption('closed');
    await page.getByLabel('Report detail').fill(DETAIL);
    await page.getByRole('button', { name: 'Send to review queue' }).click();
    await expect(page.locator('.report-receipt').getByText(/Queued for review/)).toBeVisible();

    // The reviewer confirms the report and applies a closure.
    await openReview(page, 'desktop');
    const card = page.locator('.report-card').filter({ has: page.getByText(DETAIL, { exact: true }) });
    await card.getByLabel(/^Resolution for /).selectOption('record_closure');
    await card.getByLabel(/^Review note for /).fill('Provider page confirms the closure. Recorded as a report, not a verified fact.');
    await card.getByRole('button', { name: 'Record resolution' }).click();
    // A resolved report leaves the "needs attention" filter, so widen the queue to see its new status.
    await page.getByRole('group', { name: 'Filter reports' }).getByRole('button', { name: 'All' }).click();
    await expect(card.locator('.report-status')).toHaveText('Resolved');

    // Step 7: the decision is traceable, with the value before and after it.
    const changeEntry = page.locator('.change-entry', { hasText: 'Closure reported' });
    await expect(changeEntry.first()).toBeVisible();
    await expect(changeEntry.first()).toContainText('status: active → temporarily_closed');
    await expect(changeEntry.first()).toContainText('applied as local override');
    await expect(page.locator('.override-list')).toContainText('temporarily closed');

    // The record reports the closure, and still shows the bundled evidence underneath it.
    await openPlace(page, 'desktop', 'GLIDE', /GLIDE Daily Free Meals/);
    const updated = page.locator('.inspector');
    await expect(updated.getByText('Closure reported on this device').first()).toBeVisible();
    await expect(updated.getByText('Open now not confirmed').first()).toBeVisible();
    await expect(updated.getByRole('heading', { name: 'Local correction on this device' })).toBeVisible();
    await updated.getByRole('tab', { name: /Evidence/ }).click();
    await expect(updated.getByText('Checked against provider page').first()).toBeVisible();
    await expect(updated.getByText('Closure reported').first()).toBeVisible();
    await expect(updated.getByText(/Source retrieved for this release/).first()).toBeVisible();

    // The user can take their own correction back off the record, and that is logged too.
    await openReview(page, 'desktop');
    await page.locator('.override-list').getByRole('button', { name: 'Remove override' }).click();
    await expect(page.locator('.override-list')).toHaveCount(0);
    await expect(page.locator('.change-entry', { hasText: 'Removed' }).first()).toBeVisible();

    await openPlace(page, 'desktop', 'GLIDE', /GLIDE Daily Free Meals/);
    const restored = page.locator('.inspector');
    // The bundled provider label is shown again; the old label survives only in the change log.
    await expect(restored.getByText('Closure reported on this device', { exact: true })).toHaveCount(0);
    await expect(restored.locator('.evidence-pill').first()).toHaveText('Checked against provider page');
    await expect(restored.getByText('Checked against provider page').first()).toBeVisible();
  });
});
