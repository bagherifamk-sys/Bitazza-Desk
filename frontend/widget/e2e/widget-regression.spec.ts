/**
 * E2E: Regression tests — existing UX flows must be completely unaffected
 * by the cross-session history feature.
 */
import { test, expect } from '@playwright/test';
import {
  openWidget, selectLanguage, selectCategory,
  setupMockApiNewUser, setupMockApiReturningUser,
  injectCustomerId, CONV_ID, TICKET_ID,
} from './helpers';

// ---------------------------------------------------------------------------
// Session resume (< 3h session still alive)
// ---------------------------------------------------------------------------

test('existing session resumes without showing lang/category picker', async ({ page }) => {
  await setupMockApiNewUser(page);
  await page.goto('/');

  // Inject a live session (< 3h old) into localStorage
  await page.goto('/');
  await page.evaluate((convId) => {
    localStorage.setItem('csbot_session', JSON.stringify({
      id: convId,
      ts: Date.now() - 60_000, // 1 minute ago
      lang: 'en',
      category: 'kyc_verification',
    }));
  }, CONV_ID);

  // Mock history for the live session
  await page.route(`**/chat/history/${CONV_ID}**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        history: [
          { role: 'user', content: 'What is my KYC status?', created_at: Math.floor(Date.now() / 1000) - 60 },
          { role: 'assistant', content: 'Your KYC is pending.', created_at: Math.floor(Date.now() / 1000) - 55 },
        ],
        human_handling: false,
      }),
    })
  );

  await openWidget(page);

  // Lang picker must NOT appear
  await expect(page.locator('button:has-text("🇬🇧 English")')).not.toBeVisible();
  // Category picker must NOT appear
  await expect(page.locator('[data-testid="category-picker"]')).not.toBeVisible();
  // Previous session messages must be shown
  await expect(page.locator('.csbot-messages')).toContainText('Your KYC is pending.');
});

// ---------------------------------------------------------------------------
// Standard send/receive
// ---------------------------------------------------------------------------

test('sending a message shows user bubble and bot reply', async ({ page }) => {
  await setupMockApiNewUser(page);
  await openWidget(page);
  await selectLanguage(page, 'en');
  await selectCategory(page, 'KYC');

  await page.fill('.csbot-input', 'What is my KYC status?');
  await page.click('.csbot-send-btn');

  await expect(page.locator('.csbot-messages')).toContainText('What is my KYC status?');
  await expect(page.locator('.csbot-messages')).toContainText('How can I help you today?');
});

test('Enter key sends message', async ({ page }) => {
  await setupMockApiNewUser(page);
  await openWidget(page);
  await selectLanguage(page, 'en');
  await selectCategory(page, 'KYC');

  await page.fill('.csbot-input', 'Hello');
  await page.keyboard.press('Enter');
  await expect(page.locator('.csbot-messages')).toContainText('Hello');
});

test('empty message is not sent — send button stays disabled', async ({ page }) => {
  await setupMockApiNewUser(page);
  await openWidget(page);
  await selectLanguage(page, 'en');
  await selectCategory(page, 'KYC');

  // Input is empty — send button must be disabled
  await expect(page.locator('.csbot-send-btn')).toBeDisabled();
  // Typing then clearing also disables it
  await page.fill('.csbot-input', 'hello');
  await expect(page.locator('.csbot-send-btn')).not.toBeDisabled();
  await page.fill('.csbot-input', '');
  await expect(page.locator('.csbot-send-btn')).toBeDisabled();
});

// ---------------------------------------------------------------------------
// Escalation banner
// ---------------------------------------------------------------------------

test('escalation banner appears when human agent connects', async ({ page }) => {
  await setupMockApiNewUser(page);

  // Override /chat/message to return escalated=true
  await page.route('**/chat/message', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        reply: 'Connecting you to an agent...',
        language: 'en',
        escalated: true,
        ticket_id: TICKET_ID,
        agent_name: null,
        agent_avatar: null,
        agent_avatar_url: null,
        offer_resolution: false,
        upgraded_category: null,
        transition_message: null,
      }),
    })
  );

  await openWidget(page);
  await selectLanguage(page, 'en');
  await selectCategory(page, 'KYC');
  await page.fill('.csbot-input', 'I need a human');
  await page.click('.csbot-send-btn');

  await expect(page.locator('.csbot-escalation-banner')).toBeVisible({ timeout: 10000 });
});

// ---------------------------------------------------------------------------
// CSAT flow
// ---------------------------------------------------------------------------

test('CSAT stars appear after resolution offered and accepted', async ({ page }) => {
  await setupMockApiNewUser(page);

  // Override /chat/message to offer resolution
  await page.route('**/chat/message', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        reply: 'Was that helpful?',
        language: 'en',
        escalated: false,
        ticket_id: TICKET_ID,
        agent_name: 'Aria',
        agent_avatar: 'A',
        agent_avatar_url: null,
        offer_resolution: true,
        upgraded_category: null,
        transition_message: null,
      }),
    })
  );

  // Mock CSAT endpoint
  await page.route('**/chat/csat', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  );

  await openWidget(page);
  await selectLanguage(page, 'en');
  await selectCategory(page, 'KYC');
  await page.fill('.csbot-input', 'Thank you');
  await page.click('.csbot-send-btn');

  // Click "Yes, resolved" — wait for it to appear after async bot reply
  await page.waitForSelector('button:has-text("Yes, resolved")', { timeout: 10000 });
  await page.click('button:has-text("Yes, resolved")');
  // CSAT stars should appear
  await expect(page.locator('button[aria-label="3 star"]')).toBeVisible();
});

// ---------------------------------------------------------------------------
// Error retry
// ---------------------------------------------------------------------------

test('error retry bubble appears on failed message send', async ({ page }) => {
  await setupMockApiNewUser(page);

  // Override to fail
  await page.route('**/chat/message', (route) => route.fulfill({ status: 500 }));

  await openWidget(page);
  await selectLanguage(page, 'en');
  await selectCategory(page, 'KYC');
  await page.fill('.csbot-input', 'Hello');
  await page.click('.csbot-send-btn');

  await expect(page.locator('text=Failed to send')).toBeVisible();
});

// ---------------------------------------------------------------------------
// Header rendering
// ---------------------------------------------------------------------------

test('header renders with bot name and online status', async ({ page }) => {
  await setupMockApiNewUser(page);
  await openWidget(page);
  await selectLanguage(page, 'en');
  await selectCategory(page, 'KYC');

  const header = page.locator('.csbot-header');
  await expect(header).toBeVisible();
  await expect(header).toContainText('Aria');
  await expect(header).toContainText('Online');
});

test('footer branding is visible', async ({ page }) => {
  await setupMockApiNewUser(page);
  await openWidget(page);
  await expect(page.locator('.csbot-footer')).toContainText('CS Bot');
});
