"""
Deep re-classification of 'other' category tickets.
Tries harder to find the real intent, or confirms as noise.
Usage: python scripts/reclassify_other.py
Output: data/other_analysis.json + prints reclassified counts
"""
import os, json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import anthropic
from dotenv import load_dotenv

load_dotenv()

client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
MODEL = "claude-haiku-4-5-20251001"
WORKERS = 20

CATEGORIES = [
    "kyc_verification", "deposit_issue", "withdrawal_issue", "account_restriction",
    "trading_issue", "password_2fa_reset", "fee_inquiry", "general_product_question",
    "compliance_regulatory", "fraud_security", "account_closure", "referral_bonus",
    "technical_bug", "noise",  # noise = empty/spam/missed-call/bot-interaction
]

NOISE_SUBCATS = [
    "missed_call_notification", "empty_ticket", "unclear_message",
    "bot_interaction", "system_notification", "partnership_inquiry",
    "advertisement_inquiry", "greeting_only", "follow_up_no_context",
]

SYSTEM_PROMPT = (
    "You are classifying borderline or unclear customer support tickets for Bitazza crypto exchange. "
    "These tickets were previously unclassifiable. Try harder to detect the real intent. "
    "If the ticket is genuinely empty, a missed phone call, spam, bot interaction, or partnership pitch — classify as 'noise'. "
    "Otherwise classify into the most fitting category.\n"
    "Categories: " + ", ".join(CATEGORIES) + "\n"
    "Also identify: noise_type (if noise): one of: " + ", ".join(NOISE_SUBCATS) + "\n"
    "Respond ONLY with valid JSON: "
    '{"category":"...","subcategory":"...","noise_type":"...or null","confidence":"high|medium|low"}'
)


def reclassify(ticket: dict) -> dict:
    subject = ticket.get("subject", "")
    orig_sub = ticket.get("subcategory", "")
    content = f"Subject: {subject}\nOriginal subcategory: {orig_sub}"
    try:
        msg = client.messages.create(
            model=MODEL, max_tokens=120, system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": content}],
        )
        text = msg.content[0].text.strip()
        if "```" in text:
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        result = json.loads(text.strip())
        return {**ticket, **result, "reclassified": True}
    except Exception as e:
        return {**ticket, "reclassify_error": str(e)}


def main():
    data = json.loads(Path("data/classified_tickets.json").read_text())
    others = [t for t in data if t.get("category") == "other"]
    print(f"Re-classifying {len(others)} 'other' tickets...", flush=True)

    results = [None] * len(others)
    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {executor.submit(reclassify, t): i for i, t in enumerate(others)}
        done = 0
        for future in as_completed(futures):
            i = futures[future]
            results[i] = future.result()
            done += 1
            if done % 50 == 0 or done == len(others):
                print(f"  {done}/{len(others)}...", flush=True)

    # Save full results
    Path("data/other_analysis.json").write_text(json.dumps(results, ensure_ascii=False, indent=2))

    # Summary
    print("\n--- RE-CLASSIFICATION SUMMARY ---")
    cats = {}
    noise_types = {}
    rescued = []
    for r in results:
        cat = r.get("category", "unknown")
        cats[cat] = cats.get(cat, 0) + 1
        if cat == "noise":
            nt = r.get("noise_type") or "unknown"
            noise_types[nt] = noise_types.get(nt, 0) + 1
        else:
            rescued.append(r)

    print(f"\nTotal re-classified: {len(results)}")
    for k, v in sorted(cats.items(), key=lambda x: -x[1]):
        print(f"  {v:4}  {k}")

    print(f"\nNoise breakdown:")
    for k, v in sorted(noise_types.items(), key=lambda x: -x[1]):
        print(f"  {v:4}  {k}")

    print(f"\nRescued as real support tickets: {len(rescued)}")
    if rescued:
        print("  Examples:")
        for r in rescued[:10]:
            print(f"    [{r.get('category')}] {r.get('subject','')[:70]}")

    # Optionally merge rescued tickets back into classified_tickets.json
    if rescued:
        print(f"\nMerging {len(rescued)} rescued tickets back into classified_tickets.json...")
        id_map = {r["id"]: r for r in rescued}
        updated = []
        for t in data:
            if t["id"] in id_map:
                updated.append(id_map[t["id"]])
            else:
                updated.append(t)
        Path("data/classified_tickets.json").write_text(json.dumps(updated, ensure_ascii=False, indent=2))
        print("Done. Re-run analyze_categories.py to see updated totals.")


if __name__ == "__main__":
    main()
