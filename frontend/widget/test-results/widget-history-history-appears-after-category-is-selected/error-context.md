# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: widget-history.spec.ts >> history appears after category is selected
- Location: e2e/widget-history.spec.ts:29:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('[aria-label="Open support chat"], .csbot-launcher')
    - locator resolved to <button aria-label="Open support chat" class="csbot-fab relative w-14 h-14 rounded-full flex items-center justify-center text-white">…</button>
  - attempting click action
    - waiting for element to be visible, enabled and stable
    - element is visible, enabled and stable
    - scrolling into view if needed
    - done scrolling
    - performing click action

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - heading "CS Bot Widget — Dev Harness" [level=2] [ref=e2]
  - button "Open support chat" [ref=e5] [cursor=pointer]:
    - img [ref=e7]
```

# Test source

```ts
  91  |       contentType: 'application/json',
  92  |       body: JSON.stringify({ history: KYC_HISTORY, human_handling: false }),
  93  |     })
  94  |   );
  95  | 
  96  |   // GET /chat/history/:id — previous password ticket
  97  |   await page.route(`**/chat/history/${PREV_TICKET_2.id}**`, (route) =>
  98  |     route.fulfill({
  99  |       status: 200,
  100 |       contentType: 'application/json',
  101 |       body: JSON.stringify({ history: [], human_handling: false }),
  102 |     })
  103 |   );
  104 | 
  105 |   // POST /chat/set-category
  106 |   await page.route('**/chat/set-category', (route) =>
  107 |     route.fulfill({
  108 |       status: 200,
  109 |       contentType: 'application/json',
  110 |       body: JSON.stringify({ agent_name: 'Aria', agent_avatar: 'A', agent_avatar_url: null }),
  111 |     })
  112 |   );
  113 | 
  114 |   // POST /chat/message
  115 |   await page.route('**/chat/message', (route) =>
  116 |     route.fulfill({
  117 |       status: 200,
  118 |       contentType: 'application/json',
  119 |       body: JSON.stringify({
  120 |         reply: 'How can I help you today?',
  121 |         language: 'en',
  122 |         escalated: false,
  123 |         ticket_id: TICKET_ID,
  124 |         agent_name: 'Aria',
  125 |         agent_avatar: 'A',
  126 |         agent_avatar_url: null,
  127 |         offer_resolution: false,
  128 |         upgraded_category: null,
  129 |         transition_message: null,
  130 |       }),
  131 |     })
  132 |   );
  133 | 
  134 |   // POST /mock/auth/token (dev harness)
  135 |   await page.route('**/mock/auth/token', (route) =>
  136 |     route.fulfill({
  137 |       status: 200,
  138 |       contentType: 'application/json',
  139 |       body: JSON.stringify({ token: 'mock-jwt-token' }),
  140 |     })
  141 |   );
  142 | }
  143 | 
  144 | /**
  145 |  * New user setup — no previous tickets, no open ticket.
  146 |  */
  147 | export async function setupMockApiNewUser(page: Page) {
  148 |   await setupMockApiReturningUser(page);
  149 | 
  150 |   // Override: no previous tickets
  151 |   await page.route('**/chat/customer-tickets**', (route) =>
  152 |     route.fulfill({
  153 |       status: 200,
  154 |       contentType: 'application/json',
  155 |       body: JSON.stringify({ tickets: [] }),
  156 |     })
  157 |   );
  158 | }
  159 | 
  160 | /**
  161 |  * Setup with an open (in-progress) ticket from a previous session.
  162 |  */
  163 | export async function setupMockApiWithOpenTicket(page: Page) {
  164 |   await setupMockApiReturningUser(page);
  165 | 
  166 |   const openTicket = {
  167 |     ...PREV_TICKET_1,
  168 |     status: 'Open_Live',
  169 |     category: 'account_restriction',
  170 |   };
  171 | 
  172 |   await page.route('**/chat/open-ticket', (route) =>
  173 |     route.fulfill({
  174 |       status: 200,
  175 |       contentType: 'application/json',
  176 |       body: JSON.stringify({ ticket: openTicket }),
  177 |     })
  178 |   );
  179 | }
  180 | 
  181 | /**
  182 |  * Open the widget by navigating to / and clicking the launcher.
  183 |  * If already on /, skips navigation to preserve localStorage state.
  184 |  */
  185 | export async function openWidget(page: Page) {
  186 |   const url = page.url();
  187 |   if (!url || url === 'about:blank' || !url.includes('localhost')) {
  188 |     await page.goto('/');
  189 |   }
  190 |   await page.waitForSelector('[aria-label="Open support chat"], .csbot-launcher', { timeout: 5000 });
> 191 |   await page.click('[aria-label="Open support chat"], .csbot-launcher');
      |              ^ Error: page.click: Test timeout of 30000ms exceeded.
  192 |   await page.waitForSelector('.csbot-window', { timeout: 5000 });
  193 | }
  194 | 
  195 | /** Select language in the widget. */
  196 | export async function selectLanguage(page: Page, lang: 'en' | 'th') {
  197 |   const label = lang === 'en' ? '🇬🇧 English' : '🇹🇭 ภาษาไทย';
  198 |   await page.click(`button:has-text("${label}")`);
  199 | }
  200 | 
  201 | /** Select an issue category. Waits for the input to unlock after the auto-send completes. */
  202 | export async function selectCategory(page: Page, categoryText: string) {
  203 |   await page.click(`button:has-text("${categoryText}")`);
  204 |   // awaitingFirstReply locks the input until the opening auto-send API call resolves.
  205 |   await page.waitForSelector('.csbot-input:not([disabled])', { timeout: 10000 });
  206 | }
  207 | 
  208 | /**
  209 |  * Inject a permanent customer_id into localStorage.
  210 |  * Requires the page to already be on the app origin (call after page.goto).
  211 |  */
  212 | export async function injectCustomerId(page: Page, customerId = CUSTOMER_ID) {
  213 |   await page.evaluate((id) => {
  214 |     localStorage.setItem('csbot_customer_id', id);
  215 |   }, customerId);
  216 | }
  217 | 
```