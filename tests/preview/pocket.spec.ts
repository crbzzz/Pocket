import { test, expect } from '@playwright/test';
test('delegate, review, restore and approve a demo PR', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Good things start here.' })).toBeVisible();
  await page.screenshot({ path: 'docs/images/projects-desktop.png', fullPage: true });
  await page.getByRole('link').filter({ hasText: 'Butterfly' }).click();
  await expect(page.getByRole('heading', { name: 'What’s on your mind?' })).toBeVisible();
  await page
    .getByLabel('Task for Pocket')
    .fill('Make the dashboard responsive. Keep the backend unchanged.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Pocket is working')).toBeVisible();
  await expect(page.getByText('Ready for your review', { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await page.getByRole('button', { name: 'Review changes' }).click();
  await expect(
    page.locator('summary').filter({ hasText: 'src/components/sidebar.tsx' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Create PR', exact: true }).click();
  await page.getByRole('button', { name: 'Approve & create PR', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('No GitHub changes were made');
  await page.getByRole('button', { name: 'View Save' }).click();
  await page.getByRole('button', { name: 'Restore', exact: true }).first().click();
  await page.getByRole('button', { name: 'Restore Save', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Save selected');
});
test('mobile navigation, model selection and project search', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Good things start here.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/images/projects-mobile.png', fullPage: true });
  await page.getByLabel('Search projects').fill('Atlas');
  await expect(page.getByRole('heading', { name: 'Atlas', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Butterfly', exact: true })).toHaveCount(0);
  await page.locator('#mobile-nav').getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Default model').selectOption('fast');
  await page.locator('#mobile-nav').getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('fast');
  await page.locator('#mobile-nav').getByRole('button', { name: 'Agents', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A little work in motion.' })).toBeVisible();
});
