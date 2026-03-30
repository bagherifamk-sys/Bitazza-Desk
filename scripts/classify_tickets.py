"""
Ticket Classification Script
Classifies each ticket using Gemini Flash → data/classified_tickets.json
Uses concurrent threads for speed (20 workers).
Usage: python scripts/classify_tickets.py [--source freshdesk|yellowai|all]
"""

import os, json, argparse
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from google import genai
from google.genai import types as genai_types
from dotenv import load_dotenv

load_dotenv()

_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
MODEL = "gemini-2.0-flash"
WORKERS = 20  # concurrent API calls

CATEGORIES = [
    "kyc_verification", "deposit_issue", "withdrawal_issue", "account_restriction",
    "trading_issue", "password_2fa_reset", "fee_inquiry", "general_product_question",
    "compliance_regulatory", "fraud_security", "account_closure", "referral_bonus",
    "technical_bug", "freedom_card", "other",
]

SYSTEM_PROMPT = (
    "You are a customer support ticket classifier for Bitazza Exchange and Freedom Platform (crypto exchange + Freedom Card product). "
    "Classify into EXACTLY ONE category: " + ", ".join(CATEGORIES) + ". "
    "Use 'freedom_card' for Freedom Card shipping, activation, reissue, or card management issues. "
    "Tags (if provided) are the most reliable signal — use them first. "
    "Also determine subcategory (2-5 words), resolution_type (resolved_by_info|resolved_by_action|escalated|unresolved|spam), "
    "language (en|th|other), account_specific (true if needs user account lookup), "
    "product (bitazza|freedom|both). "
    'Respond ONLY with valid JSON: {"category":"...","subcategory":"...","resolution_type":"...","language":"...","account_specific":true/false,"product":"..."}'
)


def classify(ticket: dict) -> dict:
    tags = ticket.get("tags", [])
    tags_str = f"\nTags: {', '.join(tags)}" if tags else ""
    content = f"Subject: {ticket.get('subject','')}{tags_str}\nDescription: {(ticket.get('description','') or '')[:400]}"
    try:
        config = genai_types.GenerateContentConfig(system_instruction=SYSTEM_PROMPT, max_output_tokens=120)
        response = _client.models.generate_content(model=MODEL, contents=content, config=config)
        text = response.text.strip()
        # Strip markdown code fences if present
        if "```" in text:
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        return json.loads(text.strip())
    except Exception:
        return {"category": "other", "subcategory": "error", "resolution_type": "unresolved", "language": "other", "account_specific": False, "product": "unknown"}


def load_existing(out_path: Path) -> set:
    """Return set of already-classified ticket IDs to avoid re-burning API credits."""
    if not out_path.exists():
        return set()
    try:
        existing = json.loads(out_path.read_text())
        return {t["id"] for t in existing if t.get("id") is not None}
    except Exception:
        return set()


def process_file(input_path: Path, source_label: str, already_classified: set) -> list[dict]:
    tickets = json.loads(input_path.read_text())
    new_tickets = [t for t in tickets if t.get("id") not in already_classified]
    skipped = len(tickets) - len(new_tickets)
    if skipped:
        print(f"  Skipping {skipped} already-classified {source_label} tickets.", flush=True)
    if not new_tickets:
        return []

    total = len(new_tickets)
    # WARNING: Each ticket costs ~1 Haiku API call. Only new/unclassified tickets are processed.
    print(f"Classifying {total} new {source_label} tickets with {WORKERS} workers...", flush=True)

    results = [None] * total
    completed = 0

    def classify_indexed(args):
        i, t = args
        return i, {
            "id": t.get("id"),
            "source": source_label,
            "subject": t.get("subject", ""),
            **classify(t),
        }

    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {executor.submit(classify_indexed, (i, t)): i for i, t in enumerate(new_tickets)}
        for future in as_completed(futures):
            i, result = future.result()
            results[i] = result
            completed += 1
            if completed % 100 == 0 or completed == total:
                print(f"  {completed}/{total} ({completed*100//total}%)...", flush=True)

    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="all", choices=["freshdesk", "yellowai", "all"])
    args = parser.parse_args()

    Path("data").mkdir(exist_ok=True)
    out = Path("data/classified_tickets.json")

    # Load existing results; only process tickets not already classified
    existing_ids = load_existing(out)
    existing_results = json.loads(out.read_text()) if out.exists() else []
    if existing_ids:
        print(f"Found {len(existing_ids)} already-classified tickets — will skip these.")

    new_results = []

    if args.source in ("freshdesk", "all"):
        fd_path = Path("data/freshdesk_tickets.json")
        if fd_path.exists():
            new_results.extend(process_file(fd_path, "freshdesk", existing_ids))
        else:
            print("WARNING: data/freshdesk_tickets.json not found — run freshdesk_export.py first")

    if args.source in ("yellowai", "all"):
        ya_path = Path("data/yellowai_tickets.json")
        if ya_path.exists():
            new_results.extend(process_file(ya_path, "yellowai", existing_ids))
        else:
            print("WARNING: data/yellowai_tickets.json not found — run yellowai_export.py first")

    if not new_results:
        print(f"\nNothing to do — all tickets already classified ({len(existing_ids)} total).")
        return

    all_results = existing_results + new_results
    out.write_text(json.dumps(all_results, ensure_ascii=False, indent=2))
    print(f"\nDone. {len(new_results)} new tickets classified → {out} ({len(all_results)} total)")


if __name__ == "__main__":
    main()
