/**
 * E2E: New user experience — no history, standard lang/category flow.
 * These tests assert that the feature addition does NOT change anything
 * for a user who has no previous tickets.
 */
import { test, expect } from '@playwright/test';
import { openWidget, selectLanguage, selectCategory, setupMockApiNewUser } from './helpers';

test.beforeEach(async ({ page }) => {
  await setupMockApiNewUser(page);
  // No customer_id in localStorage — truly new user
  // Must navigate first so localStorage is accessible (not about:blank)
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
});

test('widget opens and shows greeting with lang picker', async ({ page }) => {
  await openWidget(page);
  await expect(page.locator('.csbot-messages')).toContainText('Hi!');
  await expect(page.locator('button:has-text("🇬🇧 English")')).toBeVisible();
  await expect(page.locator('button:has-text("🇹🇭 ภาษาไทย")')).toBeVisible();
});

test('no history section shown for new user', async ({ page }) => {
  await openWidget(page);
  await selectLanguage(page, 'en');
  await expect(page.locator('[data-testid="prev-conversations"]')).not.toBeVisible();
  await expect(page.locator('text=Previous conversations')).not.toBeVisible();
});

test('lang picker leads to category picker', async ({ page }) => {
  await openWidget(page);
  await selectLanguage(page, 'en');
  await expect(page.locator('[data-testid="category-picker"]')).toBeVisible();
});

test('input is disabled until category is selected', async ({ page }) => {
  await openWidget(page);
  await selectLanguage(page, 'en');
  await expect(page.locator('.csbot-input')).toBeDisabled();
});

test('selecting category enables input and starts chat', async ({ page }) => {
  await openWidget(page);
  await selectLanguage(page, 'en');
  await selectCategory(page, 'KYC');
  await expect(page.locator('.csbot-input')).not.toBeDisabled();
});

test('no open-ticket banner shown for new user', async ({ page }) => {
  await openWidget(page);
  await selectLanguage(page, 'en');
  await expect(page.locator('[data-testid="open-ticket-banner"]')).not.toBeVisible();
});

test('Thai language flow works end-to-end', async ({ page }) => {
  await openWidget(page);
  await selectLanguage(page, 'th');
  await expect(page.locator('[data-testid="category-picker"]')).toBeVisible();
  await expect(page.locator('.csbot-input')).toHaveAttribute('placeholder', /เลือกประเภท/);
});

test('close button dismisses widget', async ({ page }) => {
  await openWidget(page);
  await page.click('[aria-label="Close"]');
  await expect(page.locator('.csbot-window')).not.toBeVisible();
});
