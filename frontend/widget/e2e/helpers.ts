/**
 * Shared mock API helpers for widget E2E tests.
 *
 * All tests intercept fetch() calls via page.route() so no real backend is needed.
 * Call setupMockApi() at the start of each test to register all route mocks.
 * Individual tests can override specific routes with page.route() after this call.
 */
import type { Page } from '@playwright/test';

export const CONV_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
export const TICKET_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
export const CUSTOMER_ID = 'cccccccc-0000-0000-0000-000000000001';

export const PREV_TICKET_1 = {
  id: 'dddddddd-0000-0000-0000-000000000001',
  category: 'kyc_verification',
  status: 'Closed_Resolved',
  created_at: Math.floor(Date.now() / 1000) - 86400, // yesterday
  last_message: 'Your KYC has been approved.',
  last_message_at: Math.floor(Date.now() / 1000) - 86000,
};

export const PREV_TICKET_2 = {
  id: 'eeeeeeee-0000-0000-0000-000000000002',
  category: 'password_2fa_reset',
  status: 'Closed_Resolved',
  created_at: Math.floor(Date.now() / 1000) - 172800, // 2 days ago
  last_message: 'Password reset link sent.',
  last_message_at: Math.floor(Date.now() / 1000) - 170000,
};

export const KYC_HISTORY = [
  { role: 'user', content: 'I need to verify my KYC', created_at: PREV_TICKET_1.created_at + 100 },
  { role: 'assistant', content: 'Please upload your ID document.', created_at: PREV_TICKET_1.created_at + 200 },
  { role: 'user', content: 'Done, uploaded.', created_at: PREV_TICKET_1.created_at + 300 },
  { role: 'assistant', content: 'Your KYC has been approved.', created_at: PREV_TICKET_1.created_at + 400 },
];

/**
 * Register all default mock API routes for a returning user with history.
 * Individual tests override specific routes after calling this.
 */
export async function setupMockApiReturningUser(page: Page) {
  // POST /chat/start
  await page.route('**/chat/start', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        conversation_id: CONV_ID,
        ticket_id: TICKET_ID,
        customer_id: CUSTOMER_ID,
        agent_name: 'Aria',
        agent_avatar: 'A',
        agent_avatar_url: null,
      }),
    })
  );

  // GET /chat/open-ticket → no open ticket (clean start)
  await page.route('**/chat/open-ticket', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ticket: null }),
    })
  );

  // GET /chat/customer-tickets
  await page.route('**/chat/customer-tickets**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tickets: [PREV_TICKET_1, PREV_TICKET_2] }),
    })
  );

  // GET /chat/history/:id — current conversation (empty)
  await page.route(`**/chat/history/${CONV_ID}**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ history: [], human_handling: false }),
    })
  );

  // GET /chat/history/:id — previous KYC ticket (paginated and unpaged)
  // Using RegExp so query-string requests (?page=1&limit=10) are matched reliably.
  await page.route(
    new RegExp(`/chat/history/${PREV_TICKET_1.id}`),
    (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ history: KYC_HISTORY, human_handling: false }),
    })
  );

  // GET /chat/history/:id — previous password ticket
  await page.route(
    new RegExp(`/chat/history/${PREV_TICKET_2.id}`),
    (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ history: [], human_handling: false }),
    })
  );

  // POST /chat/set-category
  await page.route('**/chat/set-category', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ agent_name: 'Aria', agent_avatar: 'A', agent_avatar_url: null }),
    })
  );

  // POST /chat/message
  await page.route('**/chat/message', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        reply: 'How can I help you today?',
        language: 'en',
        escalated: false,
        ticket_id: TICKET_ID,
        agent_name: 'Aria',
        agent_avatar: 'A',
        agent_avatar_url: null,
        offer_resolution: false,
        upgraded_category: null,
        transition_message: null,
      }),
    })
  );

  // POST /mock/auth/token (dev harness)
  await page.route('**/mock/auth/token', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token: 'mock-jwt-token' }),
    })
  );
}

/**
 * New user setup — no previous tickets, no open ticket.
 */
export async function setupMockApiNewUser(page: Page) {
  await setupMockApiReturningUser(page);

  // Override: no previous tickets
  await page.route('**/chat/customer-tickets**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tickets: [] }),
    })
  );
}

/**
 * Setup with an open (in-progress) ticket from a previous session.
 */
export async function setupMockApiWithOpenTicket(page: Page) {
  await setupMockApiReturningUser(page);

  const openTicket = {
    ...PREV_TICKET_1,
    status: 'Open_Live',
    category: 'account_restriction',
  };

  await page.route('**/chat/open-ticket', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ticket: openTicket }),
    })
  );
}

/**
 * Open the widget by navigating to / and clicking the launcher.
 * If already on /, skips navigation to preserve localStorage state.
 */
export async function openWidget(page: Page) {
  const url = page.url();
  if (!url || url === 'about:blank' || !url.includes('localhost')) {
    await page.goto('/');
  }
  await page.waitForSelector('[aria-label="Open support chat"], .csbot-launcher', { timeout: 5000 });
  await page.click('[aria-label="Open support chat"], .csbot-launcher');
  await page.waitForSelector('.csbot-window', { timeout: 5000 });
}

/** Select language in the widget. */
export async function selectLanguage(page: Page, lang: 'en' | 'th') {
  const label = lang === 'en' ? '🇬🇧 English' : '🇹🇭 ภาษาไทย';
  await page.click(`button:has-text("${label}")`);
}

/** Select an issue category. Waits for the input to unlock after the auto-send completes. */
export async function selectCategory(page: Page, categoryText: string) {
  await page.click(`button:has-text("${categoryText}")`);
  // awaitingFirstReply locks the input until the opening auto-send API call resolves.
  await page.waitForSelector('.csbot-input:not([disabled])', { timeout: 10000 });
}

/**
 * Inject a permanent customer_id into localStorage.
 * Requires the page to already be on the app origin (call after page.goto).
 */
export async function injectCustomerId(page: Page, customerId = CUSTOMER_ID) {
  await page.evaluate((id) => {
    localStorage.setItem('csbot_customer_id', id);
  }, customerId);
}
