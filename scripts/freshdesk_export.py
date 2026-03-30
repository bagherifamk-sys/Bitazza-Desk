"""
Freshdesk Export Script
Pulls all tickets via Freshdesk API → data/freshdesk_tickets.json
Skips per-ticket conversation fetch (too slow) — description_text is sufficient for classification.
Usage: python scripts/freshdesk_export.py
"""

import os, json, time, sys
from pathlib import Path
import requests
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.environ["FRESHDESK_API_KEY"]
SUBDOMAIN = os.environ["FRESHDESK_SUBDOMAIN"]
BASE_URL = f"https://{SUBDOMAIN}/api/v2"
AUTH = (API_KEY, "X")
OUT_FILE = Path("data/freshdesk_tickets.json")


def get(endpoint: str, params: dict = {}) -> list | dict:
    resp = requests.get(f"{BASE_URL}/{endpoint}", auth=AUTH, params=params, timeout=30)
    if resp.status_code == 429:
        retry_after = int(resp.headers.get("Retry-After", 60))
        print(f"  Rate limited — waiting {retry_after}s...", flush=True)
        time.sleep(retry_after)
        return get(endpoint, params)
    resp.raise_for_status()
    return resp.json()


def fetch_all_tickets() -> list[dict]:
    tickets = []
    page = 1
    while True:
        print(f"  Fetching page {page} ({len(tickets)} tickets so far)...", flush=True)
        batch = get("tickets", {"page": page, "per_page": 100, "include": "description"})
        if not batch:
            break
        tickets.extend(batch)
        page += 1
        time.sleep(0.5)
    return tickets


def main():
    OUT_FILE.parent.mkdir(exist_ok=True)
    print("Fetching Freshdesk tickets...", flush=True)
    tickets = fetch_all_tickets()
    print(f"Fetched {len(tickets)} tickets. Saving...", flush=True)

    results = []
    for t in tickets:
        results.append({
            "id": t.get("id"),
            "subject": t.get("subject", ""),
            "description": (t.get("description_text") or "")[:1000],
            "status": t.get("status"),
            "priority": t.get("priority"),
            "tags": t.get("tags", []),
            "category": t.get("category"),
            "sub_category": t.get("sub_category"),
            "created_at": t.get("created_at"),
            "conversations": [],  # populated separately if needed
        })

    OUT_FILE.write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(f"\nDone. {len(results)} tickets saved to {OUT_FILE}", flush=True)


if __name__ == "__main__":
    main()
