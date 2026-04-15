# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: widget-new-user.spec.ts >> no history section shown for new user
- Location: e2e/widget-new-user.spec.ts:24:1

# Error details

```
Test timeout of 30000ms exceeded.
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - heading "CS Bot Widget — Dev Harness" [level=2] [ref=e2]
  - generic [ref=e3]:
    - generic [ref=e4]:
      - generic [ref=e5]:
        - generic [ref=e6]:
          - img [ref=e8]
          - generic [ref=e10]:
            - generic [ref=e11]: Support
            - generic [ref=e14]: Online — typically replies instantly
        - button "Close" [ref=e15] [cursor=pointer]:
          - img [ref=e16]
      - generic [ref=e18]:
        - generic [ref=e19]:
          - generic [ref=e20]:
            - generic [ref=e21]: B
            - generic [ref=e22]: Bitazza Support
          - generic [ref=e23]:
            - text: "👋 Hi! How can I help you today? Please select your language:"
            - text: "👋 สวัสดีค่ะ! มีอะไรให้ช่วยได้บ้างคะ? กรุณาเลือกภาษา:"
          - generic [ref=e25]: 02:59 PM
        - generic [ref=e26]:
          - generic [ref=e27]:
            - generic [ref=e28]: B
            - generic [ref=e29]: Bitazza Support
          - generic [ref=e30]: "Please select the type of issue you need help with:"
          - generic [ref=e31]: 02:59 PM
        - generic [ref=e32]:
          - generic [ref=e33]:
            - button "🪪 KYC / Verification" [ref=e34] [cursor=pointer]:
              - generic [ref=e35]: 🪪
              - generic [ref=e36]: KYC / Verification
            - button "🔒 Account Restricted" [ref=e37] [cursor=pointer]:
              - generic [ref=e38]: 🔒
              - generic [ref=e39]: Account Restricted
          - generic [ref=e40]:
            - button "🔑 Password / 2FA Reset" [ref=e41] [cursor=pointer]:
              - generic [ref=e42]: 🔑
              - generic [ref=e43]: Password / 2FA Reset
            - button "🛡️ Fraud / Security" [ref=e44] [cursor=pointer]:
              - generic [ref=e45]: 🛡️
              - generic [ref=e46]: Fraud / Security
          - generic [ref=e47]:
            - button "💸 Withdrawal Issue" [ref=e48] [cursor=pointer]:
              - generic [ref=e49]: 💸
              - generic [ref=e50]: Withdrawal Issue
            - button "💬 Other" [ref=e51] [cursor=pointer]:
              - generic [ref=e52]: 💬
              - generic [ref=e53]: Other
      - generic [ref=e54]:
        - textbox "Select an issue type above" [disabled] [ref=e55]
        - button "Send" [disabled] [ref=e56]:
          - img [ref=e57]
      - generic [ref=e59]: Powered by CS Bot
    - button "Open support chat" [ref=e61] [cursor=pointer]:
      - img [ref=e63]
```