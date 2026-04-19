"""
Seed default workflows into the workflows table.

These represent the current implicit agent behavior as editable graphs
in the AI Studio. All are inserted as drafts (published=false) so they
have zero effect on live traffic until explicitly published.

Run once:
    python scripts/seed_default_workflows.py
"""
import json
import uuid
import psycopg2
import psycopg2.extras
from config import settings

conn = psycopg2.connect(settings.DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
cur  = conn.cursor()

# ── Skip if already seeded ────────────────────────────────────────────────────
cur.execute("SELECT name FROM workflows WHERE name = 'Default AI Response'")
if cur.fetchone():
    print("Default workflows already seeded — skipping.")
    conn.close()
    exit(0)


def wf(name, channel, category, nodes, edges):
    """Insert one workflow draft."""
    wid = str(uuid.uuid4())
    cur.execute(
        """
        INSERT INTO workflows
          (id, name, trigger_channel, trigger_category, nodes_json, edges_json,
           published, created_by)
        VALUES (%s, %s, %s, %s, %s, %s, false, null)
        """,
        (wid, name, channel, category, json.dumps(nodes), json.dumps(edges)),
    )
    print(f"  ✓  {name!r}  [{channel} / {category}]")
    return wid


def node(nid, kind, label, x, y, **cfg):
    return {
        "id":       nid,
        "type":     kind,
        "position": {"x": x, "y": y},
        "data":     {"label": label, **cfg},
    }


def edge(eid, src, tgt, handle=None):
    e = {"id": eid, "source": src, "target": tgt}
    if handle:
        e["sourceHandle"] = handle
    return e


print("Seeding default workflows…")

# ── 1. Default AI Response ────────────────────────────────────────────────────
# Catches anything with no more-specific workflow.
# ai_reply → condition(escalated) → True: escalate / False: wait_for_reply → ai_reply (loop)
wf(
    name="Default AI Response",
    channel="any", category="any",
    nodes=[
        node("n1", "ai_reply",       "AI Response",    300, 60),
        node("n2", "condition",      "Escalated?",     300, 200,
             variable="escalated", operator="==", value="true"),
        node("n3", "escalate",       "Escalate",       140, 360,
             reason="AI flagged escalation"),
        node("n4", "wait_for_reply", "Wait for Reply", 460, 360),
    ],
    edges=[
        edge("e1", "n1", "n2"),
        edge("e2", "n2", "n3", handle="true"),
        edge("e3", "n2", "n4", handle="false"),
        edge("e4", "n4", "n1"),   # loop: after customer replies, AI handles again
    ],
)

# ── 2. KYC Verification ───────────────────────────────────────────────────────
# Branches on KYC status, then on rejection reason for the rejected path.
#
# approved     → confirm full access + resolve
# not_started  → step-by-step submission instructions → wait → AI follow-up
# pending      → AI reply (KYC overlay explains typical timeline) → maybe escalate
# rejected     → branch on rejection_reason:
#                  blurry_photo      → specific re-submission instructions → wait → AI
#                  name_mismatch     → specific re-submission instructions → wait → AI
#                  expired/other     → AI reply with full context → maybe escalate
#
# Field names: get_kyc_status() returns {"status":..., "rejection_reason":...}
# stored under variable "account" (store_as="account")
wf(
    name="KYC Verification",
    channel="any", category="kyc_verification",
    nodes=[
        # Fetch KYC data
        node("n1",  "account_lookup",  "Fetch KYC Status",      300,   60,
             tool="kyc_status", store_as="account"),

        # Branch 1: approved?
        node("n2",  "condition",       "KYC Approved?",          300,  200,
             variable="account.status", operator="==", value="approved"),
        node("n3",  "send_reply",      "Approved Message",       100,  360,
             text="Great news — your KYC verification is approved and your account has full access. Is there anything else I can help you with?"),
        node("n4",  "resolve_ticket",  "Resolve",                100,  500,
             send_csat=True),

        # Branch 2: not started?
        node("n5",  "condition",       "Not Started?",           500,  360,
             variable="account.status", operator="==", value="not_started"),
        node("n6",  "send_reply",      "Submission Instructions", 300,  520,
             text="It looks like your KYC verification hasn't been started yet. Here's how to complete it:\n\n1. Log in to your account and go to **Settings → Identity Verification**\n2. Prepare a government-issued ID (passport or national ID card)\n3. Take a clear, well-lit photo — make sure all corners are visible and text is sharp\n4. Upload the photo and complete the selfie step\n5. Submit — review typically takes 1–2 business days\n\nLet me know if you run into any issues!"),
        node("n7",  "wait_for_reply",  "Wait for Reply",         300,  680),
        node("n8",  "ai_reply",        "AI Follow-up",           300,  820),
        node("n9",  "condition",       "Escalated?",             300,  960,
             variable="escalated", operator="==", value="true"),
        node("n10", "escalate",        "Escalate to KYC",        140, 1100,
             reason="KYC requires human review", team="kyc"),
        node("n11", "wait_for_reply",  "Continue",               460, 1100),

        # Branch 3: pending?
        node("n12", "condition",       "Pending?",               700,  520,
             variable="account.status", operator="==", value="pending"),
        node("n13", "ai_reply",        "AI — Pending",           600,  680),
        node("n14", "condition",       "Escalated?",             600,  820,
             variable="escalated", operator="==", value="true"),
        node("n15", "escalate",        "Escalate to KYC",        460,  960,
             reason="Pending KYC needs human review", team="kyc"),
        node("n16", "wait_for_reply",  "Wait",                   740,  960),

        # Branch 4: rejected — branch on rejection reason
        # blurry_photo?
        node("n17", "condition",       "Blurry Photo?",          900,  520,
             variable="account.rejection_reason", operator="==", value="blurry_photo"),
        node("n18", "send_reply",      "Blurry Photo Fix",       780,  680,
             text="Your document was rejected because the photo was too blurry or unclear. To fix this:\n\n• Use your phone camera in good lighting (natural light works best)\n• Keep the document flat on a dark surface\n• Make sure all four corners are fully visible\n• Avoid glare — don't use flash\n• Take the photo from directly above, not at an angle\n\nOnce you have a clear photo, resubmit through **Settings → Identity Verification**. Let me know if you need further help!"),
        node("n19", "wait_for_reply",  "Wait",                   780,  840),
        node("n20", "ai_reply",        "AI Follow-up",           780,  980),
        node("n21", "condition",       "Escalated?",             780, 1120,
             variable="escalated", operator="==", value="true"),
        node("n22", "escalate",        "Escalate to KYC",        640, 1260,
             reason="KYC rejection follow-up needs human", team="kyc"),
        node("n23", "wait_for_reply",  "Continue",               920, 1260),

        # name_mismatch?
        node("n24", "condition",       "Name Mismatch?",        1100,  680,
             variable="account.rejection_reason", operator="==", value="name_mismatch"),
        node("n25", "send_reply",      "Name Mismatch Fix",     1000,  840,
             text="Your document was rejected because the name on your ID doesn't match the name registered on your account. To resolve this:\n\n• If your account name has a typo, contact us to correct it before resubmitting\n• Make sure you're submitting an ID that shows your legal name exactly as registered\n• Nicknames or shortened names are not accepted\n\nPlease reply with your account email and the name shown on your ID so we can check for any mismatch. Our team may need to verify this manually."),
        node("n26", "wait_for_reply",  "Wait",                  1000, 1000),
        node("n27", "ai_reply",        "AI Follow-up",          1000, 1140),
        node("n28", "condition",       "Escalated?",            1000, 1280,
             variable="escalated", operator="==", value="true"),
        node("n29", "escalate",        "Escalate to KYC",        860, 1420,
             reason="Name mismatch requires manual review", team="kyc"),
        node("n30", "wait_for_reply",  "Continue",              1140, 1420),

        # expired/other rejection → AI with full context
        node("n31", "ai_reply",        "AI — Rejection",        1200,  840),
        node("n32", "condition",       "Escalated?",            1200,  980,
             variable="escalated", operator="==", value="true"),
        node("n33", "escalate",        "Escalate to KYC",       1060, 1120,
             reason="KYC rejection needs human review", team="kyc"),
        node("n34", "wait_for_reply",  "Continue",              1340, 1120),
    ],
    edges=[
        # account_lookup → approved branch
        edge("e1",  "n1",  "n2"),
        # approved=true → send approved + resolve
        edge("e2",  "n2",  "n3",  handle="true"),
        edge("e3",  "n3",  "n4"),
        # approved=false → not_started branch
        edge("e4",  "n2",  "n5",  handle="false"),
        # not_started=true → instructions → wait → ai → escalation check
        edge("e5",  "n5",  "n6",  handle="true"),
        edge("e6",  "n6",  "n7"),
        edge("e7",  "n7",  "n8"),
        edge("e8",  "n8",  "n9"),
        edge("e9",  "n9",  "n10", handle="true"),
        edge("e10", "n9",  "n11", handle="false"),
        edge("e11", "n11", "n8"),   # loop back to AI after next reply
        # not_started=false → pending branch
        edge("e12", "n5",  "n12", handle="false"),
        # pending=true → ai + escalation check
        edge("e13", "n12", "n13", handle="true"),
        edge("e14", "n13", "n14"),
        edge("e15", "n14", "n15", handle="true"),
        edge("e16", "n14", "n16", handle="false"),
        edge("e17", "n16", "n13"),  # loop back to AI after next reply
        # pending=false → rejected path → blurry_photo branch
        edge("e18", "n12", "n17", handle="false"),
        # blurry_photo=true → send fix + wait → ai + escalation check
        edge("e19", "n17", "n18", handle="true"),
        edge("e20", "n18", "n19"),
        edge("e21", "n19", "n20"),
        edge("e22", "n20", "n21"),
        edge("e23", "n21", "n22", handle="true"),
        edge("e24", "n21", "n23", handle="false"),
        edge("e25", "n23", "n20"),  # loop
        # blurry_photo=false → name_mismatch branch
        edge("e26", "n17", "n24", handle="false"),
        # name_mismatch=true → send fix + wait → ai + escalation check
        edge("e27", "n24", "n25", handle="true"),
        edge("e28", "n25", "n26"),
        edge("e29", "n26", "n27"),
        edge("e30", "n27", "n28"),
        edge("e31", "n28", "n29", handle="true"),
        edge("e32", "n28", "n30", handle="false"),
        edge("e33", "n30", "n27"),  # loop
        # name_mismatch=false → expired/other → AI with full context
        edge("e34", "n24", "n31", handle="false"),
        edge("e35", "n31", "n32"),
        edge("e36", "n32", "n33", handle="true"),
        edge("e37", "n32", "n34", handle="false"),
        edge("e38", "n34", "n31"),  # loop
    ],
)

# ── 3. Account Restriction ────────────────────────────────────────────────────
# Branches on restriction type BEFORE letting AI respond.
# AML / compliance holds → escalate immediately (AI must not explain these).
# Other restrictions → AI reply with full account context.
#
# get_account_restrictions() returns:
#   has_restrictions: bool
#   trading_block_reason: str|null  (e.g. "aml_hold", "suspicious_login", "trade_restriction")
wf(
    name="Account Restriction",
    channel="any", category="account_restriction",
    nodes=[
        node("n1", "account_lookup", "Fetch Restrictions", 300,  60,
             tool="restrictions", store_as="account"),

        # AML / compliance? Cannot explain to customer — escalate immediately.
        node("n2", "condition",      "AML Hold?",          300, 200,
             variable="account.trading_block_reason", operator="contains", value="aml"),
        node("n3", "send_reply",     "AML Acknowledge",    120, 360,
             text="I can see there's a hold on your account. For compliance and security reasons, I'm not able to discuss the details in this chat, but I'm connecting you with our compliance team right now. They will contact you directly and explain the next steps."),
        node("n4", "escalate",       "Escalate — AML",     120, 500,
             reason="AML / compliance hold — do not explain to customer", team="compliance"),

        # Suspicious login freeze?
        node("n5", "condition",      "Suspicious Login?",  500, 360,
             variable="account.trading_block_reason", operator="contains", value="suspicious"),
        node("n6", "send_reply",     "Security Freeze",    380, 520,
             text="Your account has been temporarily frozen as a security precaution due to unusual login activity. This is to protect your funds. Our security team has been notified and will review your account. You may receive an email shortly to verify your identity and restore access."),
        node("n7", "escalate",       "Escalate — Security", 380, 660,
             reason="Suspicious login freeze requires security team review", team="security"),

        # All other restrictions → AI with full account context
        node("n8", "ai_reply",       "AI Response",        620, 520),
        node("n9", "condition",      "Escalated?",         620, 660,
             variable="escalated", operator="==", value="true"),
        node("n10", "escalate",      "Escalate",           480, 800,
             reason="Account restriction requires manual review"),
        node("n11", "wait_for_reply","Wait for Reply",     760, 800),
    ],
    edges=[
        edge("e1", "n1",  "n2"),
        edge("e2", "n2",  "n3",  handle="true"),
        edge("e3", "n3",  "n4"),
        edge("e4", "n2",  "n5",  handle="false"),
        edge("e5", "n5",  "n6",  handle="true"),
        edge("e6", "n6",  "n7"),
        edge("e7", "n5",  "n8",  handle="false"),
        edge("e8", "n8",  "n9"),
        edge("e9", "n9",  "n10", handle="true"),
        edge("e10","n9",  "n11", handle="false"),
        edge("e11","n11", "n8"),  # loop: continue conversation with AI
    ],
)

# ── 4. Password / 2FA Reset ───────────────────────────────────────────────────
# Key distinction: does the customer still have access to their 2FA device?
#
# Has 2FA device  → standard password reset instructions → wait → AI follow-up
# No 2FA device   → identity verification case → route to KYC team
# Email not arriving → troubleshooting path
wf(
    name="Password / 2FA Reset",
    channel="any", category="password_2fa_reset",
    nodes=[
        # First: determine the situation
        node("n1", "ai_reply",       "Clarify Situation",  300,  60,
             # AI asks: do you still have access to your 2FA device?
             # The KYC overlay gives it the right context to branch the conversation.
             ),

        node("n2", "condition",      "Needs 2FA Recovery?", 300, 200,
             # AI sets needs_human=True when user says they lost their phone/2FA device.
             # That path needs identity verification — route to KYC team.
             variable="escalated", operator="==", value="true"),

        # Escalate: lost 2FA device → identity verification → KYC team
        node("n3", "escalate",       "Escalate — Lost 2FA", 120, 360,
             reason="Lost 2FA device requires identity verification", team="kyc"),

        # Standard flow: has device, needs password reset or email issue
        node("n4", "send_reply",     "Reset Instructions",  480, 360,
             text="Here's how to reset your password:\n\n1. Go to the login page and click **Forgot Password**\n2. Enter your registered email address\n3. Check your inbox (and spam folder) for a reset link — it expires in 15 minutes\n4. Click the link and set a new password\n\nIf you're not receiving the email after 5 minutes, let me know and I'll help troubleshoot."),
        node("n5", "wait_for_reply", "Wait for Reply",      480, 520),
        node("n6", "ai_reply",       "AI Follow-up",        480, 660),
        node("n7", "condition",      "Escalated?",          480, 800,
             variable="escalated", operator="==", value="true"),
        node("n8", "escalate",       "Escalate",            340, 940,
             reason="Password/2FA reset requires identity verification", team="kyc"),
        node("n9", "wait_for_reply", "Continue",            620, 940),
    ],
    edges=[
        edge("e1", "n1", "n2"),
        edge("e2", "n2", "n3", handle="true"),   # escalated (lost 2FA) → KYC team
        edge("e3", "n2", "n4", handle="false"),  # not escalated → standard instructions
        edge("e4", "n4", "n5"),
        edge("e5", "n5", "n6"),
        edge("e6", "n6", "n7"),
        edge("e7", "n7", "n8", handle="true"),
        edge("e8", "n7", "n9", handle="false"),
        edge("e9", "n9", "n6"),  # loop: continue with AI
    ],
)

# ── 5. Withdrawal Issue ───────────────────────────────────────────────────────
# Fetches transaction status (not balance/limits — that was wrong).
# Branches on the root cause BEFORE AI reply.
#
# Wrong network / address → urgent, potentially irreversible → escalate immediately
# KYC not approved blocking withdrawal → route to KYC path
# Withdrawal limit exceeded → AI can explain, no escalation needed
# Pending / stuck → AI reply with transaction context → maybe escalate to finance
#
# get_withdrawal_status() returns {"status": "pending|completed|failed|on_hold|stub", ...}
# get_kyc_status() returns {"status": "approved|pending|rejected|not_started", ...}
wf(
    name="Withdrawal Issue",
    channel="any", category="withdrawal_issue",
    nodes=[
        # Fetch transaction status and KYC status for full picture
        node("n1",  "account_lookup", "Fetch Transaction",   300,  60,
             tool="transactions", store_as="account"),
        node("n2",  "account_lookup", "Fetch KYC",           300, 200,
             tool="kyc_status", store_as="kyc"),

        # KYC not approved blocking withdrawal?
        node("n3",  "condition",      "KYC Blocking?",       300, 340,
             variable="kyc.status", operator="!=", value="approved"),
        node("n4",  "send_reply",     "KYC Blocking Reply",  120, 500,
             text="Your withdrawal is blocked because your KYC verification is not yet complete or approved. Withdrawals require a fully verified account.\n\nPlease complete your identity verification first — go to **Settings → Identity Verification**. Once approved, withdrawals will be available. Would you like help with the KYC process?"),
        node("n5",  "wait_for_reply", "Wait",                120, 660),
        node("n6",  "ai_reply",       "AI — KYC Follow-up",  120, 800),
        node("n7",  "condition",      "Escalated?",          120, 940,
             variable="escalated", operator="==", value="true"),
        node("n8",  "escalate",       "Escalate — KYC",      -40, 1080,
             reason="KYC blocking withdrawal — needs human review", team="kyc"),
        node("n9",  "wait_for_reply", "Continue",            280, 1080),

        # Wrong network / irreversible send → escalate immediately
        node("n10", "condition",      "On Hold?",            500, 500,
             variable="account.status", operator="==", value="on_hold"),
        node("n11", "send_reply",     "On Hold — Urgent",    500, 660,
             text="Your withdrawal appears to be on hold. This can happen when our risk system flags a potential issue with the destination address or network. I'm escalating this to our finance team immediately — they will review it urgently and contact you. Please do not attempt to resend the transaction."),
        node("n12", "escalate",       "Escalate — Finance",  500, 820,
             reason="Withdrawal on hold — possible wrong network or address", team="finance"),

        # Everything else → AI reply with full context → maybe escalate
        node("n13", "ai_reply",       "AI Response",         700, 500),
        node("n14", "condition",      "Escalated?",          700, 640,
             variable="escalated", operator="==", value="true"),
        node("n15", "escalate",       "Escalate — Finance",  560, 780,
             reason="Withdrawal issue requires finance team review", team="finance"),
        node("n16", "wait_for_reply", "Wait for Reply",      840, 780),
    ],
    edges=[
        edge("e1",  "n1",  "n2"),
        edge("e2",  "n2",  "n3"),
        # KYC blocking → send explanation + wait + AI follow-up
        edge("e3",  "n3",  "n4",  handle="true"),
        edge("e4",  "n4",  "n5"),
        edge("e5",  "n5",  "n6"),
        edge("e6",  "n6",  "n7"),
        edge("e7",  "n7",  "n8",  handle="true"),
        edge("e8",  "n7",  "n9",  handle="false"),
        edge("e9",  "n9",  "n6"),   # loop
        # KYC OK → check if on hold
        edge("e10", "n3",  "n10", handle="false"),
        edge("e11", "n10", "n11", handle="true"),
        edge("e12", "n11", "n12"),
        # Not on hold → AI handles with context
        edge("e13", "n10", "n13", handle="false"),
        edge("e14", "n13", "n14"),
        edge("e15", "n14", "n15", handle="true"),
        edge("e16", "n14", "n16", handle="false"),
        edge("e17", "n16", "n13"),  # loop
    ],
)

# ── 6. Fraud / Security Alert ─────────────────────────────────────────────────
# Always escalate — do not let AI handle fraud reports alone.
# Correct as designed. No changes.
wf(
    name="Fraud / Security Alert",
    channel="any", category="fraud_security",
    nodes=[
        node("n1", "send_reply", "Acknowledge",  300, 60,
             text="Thank you for reporting this security concern. I'm escalating this immediately to our security team who will investigate and contact you shortly. Please do not share any additional sensitive information in this chat."),
        node("n2", "escalate",   "Escalate",     300, 220,
             reason="Fraud / security report — requires immediate human review", team="cs"),
    ],
    edges=[
        edge("e1", "n1", "n2"),
    ],
)

conn.commit()
conn.close()
print(f"\nDone — 6 default workflows seeded as drafts.")
print("Open AI Studio on :3003 to view and publish them.")
