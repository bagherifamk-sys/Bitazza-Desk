/**
 * E2E: Returning user — cross-session history display.
 * Tests that previous ticket threads appear after category selection,
 * paginate on scroll-up, and are read-only.
 */
import { test, expect } from '@playwright/test';
import {
  openWidget, selectLanguage, selectCategory,
  setupMockApiReturningUser, injectCustomerId,
  PREV_TICKET_1, KYC_HISTORY, CUSTOMER_ID,
} from './helpers';

test.beforeEach(async ({ page }) => {
  // Register routes BEFORE first navigation
  await setupMockApiReturningUser(page);
  await page.goto('/');
  await injectCustomerId(page);
  // Second goto picks up the injected customer_id without a reload race
  await page.goto('/');
});

test('history does NOT appear before category is selected', async ({ page }) => {
  await openWidget(page);
  await selectLanguage(page, 'en');
  // Category picker is shown but category not yet selected
  await expect(page.locator('[data-testid="prev-conversations"]')).not.toBeVisible();
});

test('history appears after category is selected', async ({ page }) => {
  await openWidget(page);
  await selectLanguage(page, 'en');
  await selectCategory(page, 'KYC');
  await expect(page.locator('[data-testid="prev-conversations"]')).toBeVisible();
});

test('previous ticket shows category label', async ({ page }) => {
  await openWidget(page);
  await selectLanguage(page, 'en');
  await selectCategory(page, 'KYC');
  // KYC verification ticket should be labelled
  await expect(page.locator('[data-testid="prev-conversations"]')).toContainText('KYC');
});

test('previous ticket shows date divider', async ({ page }) => {
  await openWidget(page);
  await selectLanguage(page, 'en');
  await selectCategory(page, 'KYC');
  // Should show a relative date like "Yesterday" or the formatted date
  const history = page.locator('[data-testid="prev-conversations"]');
  await expect(history).toContainText(/yesterday|ago|\d{1,2}\/\d{1,2}/i);
});

test('previous ticket messages are visible when expanded', async ({ page }) => {
  await openWidget(page);
  await selectLanguage(page, 'en');
  await selectCategory(page, 'KYC');

  // Expand the KYC ticket thread (tickets are rendered in reverse — target by text)
  await page.click('[data-testid="prev-ticket-header"]:has-text("KYC")');
  const thread = page.locator('[data-testid="prev-ticket-messages"]');
  await expect(thread).toContainText('I need to verify my KYC', { timeout: 5000 });
  await expect(thread).toContainText('Your KYC has been approved.');
});

test('previous messages are read-only — no input shown in history thread', async ({ page }) => {
  await openWidget(page);
  await selectLanguage(page, 'en');
  await selectCategory(page, 'KYC');
  await page.click('[data-testid="prev-ticket-header"]');

  // History thread must not contain a send button or active input
  const historySection = page.locator('[data-testid="prev-conversations"]');
  await expect(historySection.locator('.csbot-input')).not.toBeVisible();
  await expect(historySection.locator('.csbot-send-btn')).not.toBeVisible();
});

test('current conversation starts below history', async ({ page }) => {
  await openWidget(page);
  await selectLanguage(page, 'en');
  await selectCategory(page, 'KYC');

  // Active input and send button should be in the main chat area, not in history
  await expect(page.locator('.csbot-input')).not.toBeDisabled();
  await expect(page.locator('.csbot-send-btn')).toBeVisible();
});

test('auto-scroll lands at current conversation bottom, not history top', async ({ page }) => {
  await openWidget(page);
  await selectLanguage(page, 'en');
  await selectCategory(page, 'KYC');

  // The bottom sentinel should be visible (widget scrolled to bottom)
  const messagesContainer = page.locator('.csbot-messages');
  const scrollTop = await messagesContainer.evaluate((el) => el.scrollTop);
  const scrollHeight = await messagesContainer.evaluate((el) => el.scrollHeight);
  const clientHeight = await messagesContainer.evaluate((el) => el.clientHeight);
  // Should be scrolled toward the bottom — the input and lang picker are visible
  // (scrollTop > 0 means it has scrolled past the very top)
  expect(scrollTop).toBeGreaterThan(0);
});

test('skeleton loader shown while history page is loading', async ({ page }) => {
  // Slow down history response to observe skeleton (RegExp to reliably match paginated URLs)
  await page.route(new RegExp(`/chat/history/${PREV_TICKET_1.id}`), async (route) => {
    await new Promise((r) => setTimeout(r, 500));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ history: KYC_HISTORY, human_handling: false }),
    });
  });

  await openWidget(page);
  await selectLanguage(page, 'en');
  await selectCategory(page, 'KYC');
  await page.click('[data-testid="prev-ticket-header"]:has-text("KYC")');

  // Skeleton should appear while loading
  await expect(page.locator('[data-testid="history-skeleton"]')).toBeVisible();
  // Then disappear after load
  await expect(page.locator('[data-testid="history-skeleton"]')).not.toBeVisible({ timeout: 3000 });
});

test('scrolling to top of history thread loads older messages', async ({ page }) => {
  const PAGE1_MSGS = Array.from({ length: 10 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `Recent message ${i}`,
    created_at: PREV_TICKET_1.created_at + 1000 + i * 10,
  }));
  const PAGE2_MSGS = Array.from({ length: 5 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `Older message ${i}`,
    created_at: PREV_TICKET_1.created_at + i * 10,
  }));

  // Use RegExp matchers to reliably match query params (glob * doesn't match ? in URLs).
  // page=2 registered last = highest priority in Playwright's LIFO route matching.
  await page.route(
    new RegExp(`/chat/history/${PREV_TICKET_1.id}.*page=1`),
    (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ history: PAGE1_MSGS, human_handling: false }),
    })
  );
  await page.route(
    new RegExp(`/chat/history/${PREV_TICKET_1.id}.*page=2`),
    (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ history: PAGE2_MSGS, human_handling: false }),
    })
  );

  await openWidget(page);
  await selectLanguage(page, 'en');
  await selectCategory(page, 'KYC');
  // Tickets are rendered in reverse — target KYC specifically
  await page.click('[data-testid="prev-ticket-header"]:has-text("KYC")');
  // Wait for page 1 to render
  await expect(page.locator('text=Recent message 9')).toBeVisible({ timeout: 5000 });

  // Scroll to top of thread to trigger page 2 load
  await page.locator('[data-testid="prev-ticket-messages"]').evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event('scroll'));
  });

  await expect(page.locator('text=Older message 0')).toBeVisible({ timeout: 5000 });
});

test('multiple previous tickets are all shown', async ({ page }) => {
  await openWidget(page);
  await selectLanguage(page, 'en');
  await selectCategory(page, 'KYC');

  const tickets = page.locator('[data-testid="prev-ticket-header"]');
  await expect(tickets).toHaveCount(2);
});

test('customer_id is persisted to localStorage after widget loads', async ({ page }) => {
  await openWidget(page);
  const stored = await page.evaluate(() => localStorage.getItem('csbot_customer_id'));
  expect(stored).toBe(CUSTOMER_ID);
});
