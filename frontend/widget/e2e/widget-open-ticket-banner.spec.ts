/**
 * E2E: Open ticket banner — shown after lang selection when a previous
 * ticket is still Open_Live or Escalated.
 */
import { test, expect } from '@playwright/test';
import {
  openWidget, selectLanguage,
  setupMockApiWithOpenTicket, setupMockApiReturningUser,
  injectCustomerId, PREV_TICKET_1,
} from './helpers';

test.beforeEach(async ({ page }) => {
  // Register base routes (with open ticket) before navigation so mock/auth/token works
  await setupMockApiWithOpenTicket(page);
  await page.goto('/');
  await injectCustomerId(page);
  // Second goto picks up the injected customer_id without a reload race
  await page.goto('/');
});

test('banner appears after lang selection when open ticket exists', async ({ page }) => {
  await openWidget(page);
  await selectLanguage(page, 'en');
  await expect(page.locator('[data-testid="open-ticket-banner"]')).toBeVisible();
});

test('banner shows ticket category', async ({ page }) => {
  await openWidget(page);
  await selectLanguage(page, 'en');
  await expect(page.locator('[data-testid="open-ticket-banner"]')).toContainText(/account|restriction/i);
});

test('banner shows ticket age', async ({ page }) => {
  await openWidget(page);
  await selectLanguage(page, 'en');
  await expect(page.locator('[data-testid="open-ticket-banner"]')).toContainText(/ago|yesterday/i);
});

test('banner has Continue and Start New buttons', async ({ page }) => {
  await openWidget(page);
  await selectLanguage(page, 'en');
  await expect(page.locator('[data-testid="continue-ticket-btn"]')).toBeVisible();
  await expect(page.locator('[data-testid="start-new-btn"]')).toBeVisible();
});

test('"Start new" dismisses banner and shows category picker', async ({ page }) => {
  await openWidget(page);
  await selectLanguage(page, 'en');
  await page.click('[data-testid="start-new-btn"]');
  await expect(page.locator('[data-testid="open-ticket-banner"]')).not.toBeVisible();
  await expect(page.locator('[data-testid="category-picker"]')).toBeVisible();
});

test('"Continue it" resumes open ticket and skips category picker', async ({ page }) => {
  // Override history for the open ticket with actual messages
  await page.route(`**/chat/history/${PREV_TICKET_1.id}**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        history: [
          { role: 'user', content: 'I need help with my account', created_at: Date.now() / 1000 - 100 },
          { role: 'assistant', content: 'Sure, let me check your account.', created_at: Date.now() / 1000 - 90 },
        ],
        human_handling: false,
      }),
    })
  );

  await openWidget(page);
  await selectLanguage(page, 'en');
  await page.click('[data-testid="continue-ticket-btn"]');

  await expect(page.locator('[data-testid="category-picker"]')).not.toBeVisible();
  await expect(page.locator('.csbot-messages')).toContainText('I need help with my account');
  await expect(page.locator('.csbot-input')).not.toBeDisabled();
});

test('banner does NOT appear when no open ticket exists', async ({ page }) => {
  // Override open-ticket to return null for this test
  await page.route('**/chat/open-ticket', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ticket: null }),
    })
  );
  await openWidget(page);
  await selectLanguage(page, 'en');
  await expect(page.locator('[data-testid="open-ticket-banner"]')).not.toBeVisible();
  await expect(page.locator('[data-testid="category-picker"]')).toBeVisible({ timeout: 5000 });
});

test('banner does NOT appear for new user', async ({ page }) => {
  // Clear customer_id so widget treats this as a new user
  await page.evaluate(() => localStorage.removeItem('csbot_customer_id'));
  await openWidget(page);
  await selectLanguage(page, 'en');
  await expect(page.locator('[data-testid="open-ticket-banner"]')).not.toBeVisible();
});
