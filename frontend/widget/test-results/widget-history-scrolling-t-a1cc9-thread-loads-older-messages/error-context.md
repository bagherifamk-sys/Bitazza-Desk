# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: widget-history.spec.ts >> scrolling to top of history thread loads older messages
- Location: e2e/widget-history.spec.ts:123:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('text=Recent message 9')
Expected: visible
Timeout: 3000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 3000ms
  - waiting for locator('text=Recent message 9')

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - heading "CS Bot Widget — Dev Harness" [level=2] [ref=e2]
  - generic [ref=e3]:
    - generic [ref=e4]:
      - generic [ref=e5]:
        - generic [ref=e6]:
          - generic [ref=e7]: A
          - generic [ref=e8]:
            - generic [ref=e9]: Aria
            - generic [ref=e12]: Online — typically replies instantly
        - button "Close" [ref=e13] [cursor=pointer]:
          - img [ref=e14]
      - generic [ref=e16]:
        - generic [ref=e17]:
          - generic [ref=e20]: Previous conversations
          - generic [ref=e22]:
            - button "Password / 2FA Reset Resolved 2 days ago Password reset link sent." [active] [ref=e23] [cursor=pointer]:
              - generic [ref=e24]:
                - generic [ref=e25]:
                  - generic [ref=e26]: Password / 2FA Reset
                  - generic [ref=e27]: Resolved
                - generic [ref=e28]: 2 days ago
                - generic [ref=e29]: Password reset link sent.
              - img [ref=e30]
            - paragraph [ref=e33]: No messages
          - button "KYC / Verification Resolved Yesterday Your KYC has been approved." [ref=e35] [cursor=pointer]:
            - generic [ref=e36]:
              - generic [ref=e37]:
                - generic [ref=e38]: KYC / Verification
                - generic [ref=e39]: Resolved
              - generic [ref=e40]: Yesterday
              - generic [ref=e41]: Your KYC has been approved.
            - img [ref=e42]
          - generic [ref=e46]: New conversation
        - generic [ref=e48]:
          - generic [ref=e49]:
            - generic [ref=e50]: B
            - generic [ref=e51]: Bitazza Support
          - generic [ref=e52]:
            - text: "👋 Hi! How can I help you today? Please select your language:"
            - text: "👋 สวัสดีค่ะ! มีอะไรให้ช่วยได้บ้างคะ? กรุณาเลือกภาษา:"
          - generic [ref=e54]: 03:00 PM
        - generic [ref=e55]:
          - generic [ref=e56]:
            - generic [ref=e57]: B
            - generic [ref=e58]: Bitazza Support
          - generic [ref=e59]: "Please select the type of issue you need help with:"
          - generic [ref=e60]: 03:00 PM
        - generic [ref=e61]:
          - generic [ref=e62]: I need help with my KYC verification.
          - generic [ref=e63]: 03:00 PM
        - generic [ref=e64]:
          - generic [ref=e65]:
            - generic [ref=e66]: A
            - generic [ref=e67]: Aria
          - generic [ref=e68]: Hi, I'm Aria! 👋 Let me pull up your account details and I'll have an answer for you in just a moment.
          - generic [ref=e69]: 03:00 PM
        - generic [ref=e70]:
          - generic [ref=e71]:
            - generic [ref=e72]: A
            - generic [ref=e73]: Aria
          - generic [ref=e74]: How can I help you today?
          - generic [ref=e75]: 03:00 PM
      - generic [ref=e76]:
        - textbox "Type your message..." [ref=e77]
        - button "Send" [disabled] [ref=e78]:
          - img [ref=e79]
      - generic [ref=e81]: Powered by CS Bot
    - button "Open support chat" [ref=e83] [cursor=pointer]:
      - img [ref=e85]
```

# Test source

```ts
  65  |   await openWidget(page);
  66  |   await selectLanguage(page, 'en');
  67  |   await selectCategory(page, 'KYC');
  68  |   await page.click('[data-testid="prev-ticket-header"]');
  69  | 
  70  |   // History thread must not contain a send button or active input
  71  |   const historySection = page.locator('[data-testid="prev-conversations"]');
  72  |   await expect(historySection.locator('.csbot-input')).not.toBeVisible();
  73  |   await expect(historySection.locator('.csbot-send-btn')).not.toBeVisible();
  74  | });
  75  | 
  76  | test('current conversation starts below history', async ({ page }) => {
  77  |   await openWidget(page);
  78  |   await selectLanguage(page, 'en');
  79  |   await selectCategory(page, 'KYC');
  80  | 
  81  |   // Active input and send button should be in the main chat area, not in history
  82  |   await expect(page.locator('.csbot-input')).not.toBeDisabled();
  83  |   await expect(page.locator('.csbot-send-btn')).toBeVisible();
  84  | });
  85  | 
  86  | test('auto-scroll lands at current conversation bottom, not history top', async ({ page }) => {
  87  |   await openWidget(page);
  88  |   await selectLanguage(page, 'en');
  89  |   await selectCategory(page, 'KYC');
  90  | 
  91  |   // The bottom sentinel should be visible (widget scrolled to bottom)
  92  |   const messagesContainer = page.locator('.csbot-messages');
  93  |   const scrollTop = await messagesContainer.evaluate((el) => el.scrollTop);
  94  |   const scrollHeight = await messagesContainer.evaluate((el) => el.scrollHeight);
  95  |   const clientHeight = await messagesContainer.evaluate((el) => el.clientHeight);
  96  |   // Should be scrolled toward the bottom — the input and lang picker are visible
  97  |   // (scrollTop > 0 means it has scrolled past the very top)
  98  |   expect(scrollTop).toBeGreaterThan(0);
  99  | });
  100 | 
  101 | test('skeleton loader shown while history page is loading', async ({ page }) => {
  102 |   // Slow down history response to observe skeleton
  103 |   await page.route(`**/chat/history/${PREV_TICKET_1.id}**`, async (route) => {
  104 |     await new Promise((r) => setTimeout(r, 500));
  105 |     await route.fulfill({
  106 |       status: 200,
  107 |       contentType: 'application/json',
  108 |       body: JSON.stringify({ history: KYC_HISTORY, human_handling: false }),
  109 |     });
  110 |   });
  111 | 
  112 |   await openWidget(page);
  113 |   await selectLanguage(page, 'en');
  114 |   await selectCategory(page, 'KYC');
  115 |   await page.click('[data-testid="prev-ticket-header"]');
  116 | 
  117 |   // Skeleton should appear while loading
  118 |   await expect(page.locator('[data-testid="history-skeleton"]')).toBeVisible();
  119 |   // Then disappear after load
  120 |   await expect(page.locator('[data-testid="history-skeleton"]')).not.toBeVisible({ timeout: 3000 });
  121 | });
  122 | 
  123 | test('scrolling to top of history thread loads older messages', async ({ page }) => {
  124 |   const PAGE1_MSGS = Array.from({ length: 10 }, (_, i) => ({
  125 |     role: i % 2 === 0 ? 'user' : 'assistant',
  126 |     content: `Recent message ${i}`,
  127 |     created_at: PREV_TICKET_1.created_at + 1000 + i * 10,
  128 |   }));
  129 |   const PAGE2_MSGS = Array.from({ length: 5 }, (_, i) => ({
  130 |     role: i % 2 === 0 ? 'user' : 'assistant',
  131 |     content: `Older message ${i}`,
  132 |     created_at: PREV_TICKET_1.created_at + i * 10,
  133 |   }));
  134 | 
  135 |   // Register page-specific routes BEFORE the generic catch-all
  136 |   // page=2 must be registered first so it matches before page=1 catch-all
  137 |   await page.route(`**/chat/history/${PREV_TICKET_1.id}*page=2*`, (route) =>
  138 |     route.fulfill({
  139 |       status: 200,
  140 |       contentType: 'application/json',
  141 |       body: JSON.stringify({ history: PAGE2_MSGS, human_handling: false }),
  142 |     })
  143 |   );
  144 |   await page.route(`**/chat/history/${PREV_TICKET_1.id}*page=1*`, (route) =>
  145 |     route.fulfill({
  146 |       status: 200,
  147 |       contentType: 'application/json',
  148 |       body: JSON.stringify({ history: PAGE1_MSGS, human_handling: false }),
  149 |     })
  150 |   );
  151 |   // Fallback for unpaged requests
  152 |   await page.route(`**/chat/history/${PREV_TICKET_1.id}`, (route) =>
  153 |     route.fulfill({
  154 |       status: 200,
  155 |       contentType: 'application/json',
  156 |       body: JSON.stringify({ history: PAGE1_MSGS, human_handling: false }),
  157 |     })
  158 |   );
  159 | 
  160 |   await openWidget(page);
  161 |   await selectLanguage(page, 'en');
  162 |   await selectCategory(page, 'KYC');
  163 |   await page.click('[data-testid="prev-ticket-header"]');
  164 |   // Wait for page 1 to render
> 165 |   await expect(page.locator('text=Recent message 9')).toBeVisible({ timeout: 3000 });
      |                                                       ^ Error: expect(locator).toBeVisible() failed
  166 | 
  167 |   // Scroll to top of thread to trigger page 2 load
  168 |   await page.locator('[data-testid="prev-ticket-messages"]').evaluate((el) => {
  169 |     el.scrollTop = 0;
  170 |     el.dispatchEvent(new Event('scroll'));
  171 |   });
  172 | 
  173 |   await expect(page.locator('text=Older message 0')).toBeVisible({ timeout: 5000 });
  174 | });
  175 | 
  176 | test('multiple previous tickets are all shown', async ({ page }) => {
  177 |   await openWidget(page);
  178 |   await selectLanguage(page, 'en');
  179 |   await selectCategory(page, 'KYC');
  180 | 
  181 |   const tickets = page.locator('[data-testid="prev-ticket-header"]');
  182 |   await expect(tickets).toHaveCount(2);
  183 | });
  184 | 
  185 | test('customer_id is persisted to localStorage after widget loads', async ({ page }) => {
  186 |   await openWidget(page);
  187 |   const stored = await page.evaluate(() => localStorage.getItem('csbot_customer_id'));
  188 |   expect(stored).toBe(CUSTOMER_ID);
  189 | });
  190 | 
```