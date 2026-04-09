"""
Reclassify tickets stuck at category='ai_handling'.

Logic:
  - Abandoned  (< 2 customer messages) → SET category = NULL, tag 'abandoned'
  - Full convo (≥ 2 customer messages) → classify from transcript via Gemini Flash
                                         → SET category = <real category>

Usage:
    python scripts/reclassify_ai_handling.py [--dry-run]

--dry-run  prints what would change without writing to the DB.
"""

import os, json, argparse
from concurrent.futures import ThreadPoolExecutor, as_completed

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
from google import genai
from google.genai import types as genai_types

load_dotenv()

DATABASE_URL = os.environ["DATABASE_URL"]
_client      = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
MODEL        = "gemini-2.0-flash"
WORKERS      = 20
MIN_MESSAGES = 1   # minimum meaningful customer messages to attempt classification (0 = ghost session)

GREETING_ONLY = {"hi", "hello", "hey", "hi.", "hello.", "hey.", "hiya", "howdy", "yo", "sup"}

CATEGORIES = [
    "kyc_verification", "deposit_issue", "withdrawal_issue", "account_restriction",
    "trading_issue", "password_2fa_reset", "fee_inquiry", "general_product_question",
    "compliance_regulatory", "fraud_security", "account_closure", "referral_bonus",
    "technical_bug", "freedom_card", "other",
]

SYSTEM_PROMPT = (
    "You are a customer support ticket classifier for Bitazza Exchange and Freedom Platform "
    "(crypto exchange + Freedom Card product). "
    "You are given a full chat transcript between a customer and an AI support bot. "
    "Classify the customer's issue into EXACTLY ONE category: " + ", ".join(CATEGORIES) + ". "
    "Use 'other' only if genuinely none of the above fit. "
    "Respond ONLY with valid JSON: "
    '{"category":"...","subcategory":"2-5 word description of the specific issue"}'
)


def _db():
    return psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)


def fetch_ai_handling_tickets() -> list[dict]:
    """Return all tickets with category='ai_handling' plus their messages."""
    with _db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT
                t.id,
                t.status,
                COALESCE(
                    json_agg(
                        json_build_object('sender_type', m.sender_type, 'content', m.content)
                        ORDER BY m.created_at
                    ) FILTER (WHERE m.id IS NOT NULL),
                    '[]'::json
                ) AS messages
            FROM tickets t
            LEFT JOIN messages m ON m.ticket_id = t.id
              AND m.sender_type != 'internal_note'
            WHERE t.category = 'ai_handling'
            GROUP BY t.id
        """)
        return cur.fetchall()


def classify_from_transcript(messages: list[dict]) -> dict:
    """Call Gemini to classify a full conversation transcript."""
    role_map = {"customer": "Customer", "bot": "Bot", "agent": "Agent", "system": None}
    lines = []
    for m in messages:
        role = role_map.get(m["sender_type"], m["sender_type"])
        if role is None:
            continue  # skip system messages
        lines.append(f"{role}: {(m['content'] or '').strip()[:300]}")
    transcript = "\n".join(lines)
    try:
        cfg = genai_types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT, max_output_tokens=80
        )
        resp = _client.models.generate_content(model=MODEL, contents=transcript, config=cfg)
        text = resp.text.strip()
        if "```" in text:
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        return json.loads(text.strip())
    except Exception as e:
        return {"category": "other", "subcategory": f"classification_error: {e}"}


def apply_changes(ticket_id: str, new_category: str | None, abandoned: bool, dry_run: bool) -> None:
    if dry_run:
        return
    with _db() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE tickets SET category = %s WHERE id = %s",
            (new_category, ticket_id)
        )
        if abandoned:
            # Ensure 'abandoned' tag exists then attach it
            cur.execute(
                "INSERT INTO tags (id, name) VALUES (gen_random_uuid(), 'abandoned') ON CONFLICT (name) DO NOTHING"
            )
            cur.execute("SELECT id FROM tags WHERE name = 'abandoned'")
            tag_id = cur.fetchone()["id"]
            cur.execute(
                "INSERT INTO ticket_tags (ticket_id, tag_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                (ticket_id, tag_id)
            )
        conn.commit()


def process_ticket(ticket: dict, dry_run: bool) -> dict:
    tid      = ticket["id"]
    messages = ticket["messages"] if isinstance(ticket["messages"], list) else json.loads(ticket["messages"])
    customer_msgs = [m for m in messages if m["sender_type"] == "customer"]

    # Treat pure-greeting single messages the same as no message — not classifiable
    meaningful = [m for m in customer_msgs if (m["content"] or "").strip().lower() not in GREETING_ONLY]

    if len(meaningful) < MIN_MESSAGES:
        apply_changes(tid, None, abandoned=True, dry_run=dry_run)
        return {"id": tid, "action": "abandoned", "category": None}

    result = classify_from_transcript(messages)
    new_cat = result.get("category", "other")
    if new_cat not in CATEGORIES:
        new_cat = "other"
    apply_changes(tid, new_cat, abandoned=False, dry_run=dry_run)
    return {"id": tid, "action": "classified", "category": new_cat, "subcategory": result.get("subcategory", "")}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Print changes without writing to DB")
    args = parser.parse_args()

    tickets = fetch_ai_handling_tickets()
    print(f"Found {len(tickets)} tickets with category='ai_handling'")
    if not tickets:
        return

    to_abandon  = [t for t in tickets if len(
        [m for m in (t["messages"] if isinstance(t["messages"], list) else json.loads(t["messages"]))
         if m["sender_type"] == "customer"]
    ) < MIN_MESSAGES]
    to_classify = [t for t in tickets if t not in to_abandon]

    print(f"  → {len(to_abandon)} abandoned (< {MIN_MESSAGES} customer messages) → category=NULL + tag 'abandoned'")
    print(f"  → {len(to_classify)} full conversations → classify via Gemini")
    if args.dry_run:
        print("  [DRY RUN — no DB writes]")

    results     = []
    category_counts: dict[str, int] = {}

    # Process abandoned (no API call needed)
    for t in to_abandon:
        r = process_ticket(t, args.dry_run)
        results.append(r)

    # Classify full convos concurrently
    if to_classify:
        print(f"\nClassifying {len(to_classify)} tickets with {WORKERS} workers...")
        done = 0
        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            futures = {ex.submit(process_ticket, t, args.dry_run): t["id"] for t in to_classify}
            for f in as_completed(futures):
                r = f.result()
                results.append(r)
                done += 1
                if done % 20 == 0 or done == len(to_classify):
                    print(f"  {done}/{len(to_classify)} ({done*100//len(to_classify)}%)...")

    # Summary
    print("\n── RESULTS ──────────────────────────────────────")
    for r in results:
        cat = r["category"] or "NULL (abandoned)"
        category_counts[cat] = category_counts.get(cat, 0) + 1

    for cat, cnt in sorted(category_counts.items(), key=lambda x: -x[1]):
        print(f"  {cnt:4}  {cat}")

    classified = [r for r in results if r["action"] == "classified"]
    print(f"\nTotal: {len(results)}  |  Abandoned: {len(to_abandon)}  |  Classified: {len(classified)}")
    if args.dry_run:
        print("\n[DRY RUN] No changes written. Re-run without --dry-run to apply.")


if __name__ == "__main__":
    main()
