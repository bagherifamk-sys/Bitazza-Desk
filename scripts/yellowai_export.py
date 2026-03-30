"""
Yellow.ai CSV Import Script
Reads a manually exported Yellow.ai CSV → data/yellowai_tickets.json

How to export from Yellow.ai dashboard:
  1. Go to Insights → Data Explorer (or Conversation Logs)
  2. Set date range to all time
  3. Export as CSV
  4. Place the file at: data/yellowai_export.csv

Usage: python scripts/yellowai_export.py [--file data/yellowai_export.csv]
"""

import csv, json, argparse
from pathlib import Path


# Map common Yellow.ai CSV column names → our schema
# Adjust COLUMN_MAP if your export uses different headers
COLUMN_MAP = {
    "session_id":     ["session_id", "sessionId", "Session ID", "conversation_id"],
    "intent":         ["intent", "Intent", "flow", "Flow"],
    "first_message":  ["first_message", "userMessage", "User Message", "message", "Message"],
    "full_transcript":["transcript", "Transcript", "conversation", "Conversation"],
    "status":         ["status", "Status", "session_status"],
    "language":       ["language", "Language", "lang"],
    "created_at":     ["created_at", "createdAt", "Start Time", "startTime", "date"],
    "tags":           ["tags", "Tags", "label", "Label"],
}


def resolve(row: dict, field: str) -> str:
    for col in COLUMN_MAP[field]:
        if col in row and row[col]:
            return str(row[col]).strip()
    return ""


def normalize(row: dict, idx: int) -> dict:
    first_msg = resolve(row, "first_message")
    transcript = resolve(row, "full_transcript")

    convos = []
    if transcript:
        # Basic transcript splitting — adjust delimiter if needed
        for line in transcript.split("\n")[:10]:
            line = line.strip()
            if line:
                incoming = not line.lower().startswith(("bot:", "agent:", "assistant:"))
                convos.append({"body_text": line[:300], "incoming": incoming, "created_at": ""})

    return {
        "id": resolve(row, "session_id") or f"ya_{idx}",
        "subject": resolve(row, "intent") or first_msg[:80],
        "description": first_msg[:1000],
        "status": resolve(row, "status"),
        "priority": None,
        "tags": [t.strip() for t in resolve(row, "tags").split(",") if t.strip()],
        "category": None,
        "sub_category": None,
        "created_at": resolve(row, "created_at"),
        "conversations": convos,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", default="data/yellowai_export.csv")
    args = parser.parse_args()

    csv_path = Path(args.file)
    if not csv_path.exists():
        print(f"ERROR: {csv_path} not found.")
        print("Export from Yellow.ai: Insights → Data Explorer → Export CSV")
        print(f"Then place the file at: {csv_path}")
        return

    tickets = []
    with csv_path.open(encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        print(f"CSV columns detected: {reader.fieldnames}")
        for i, row in enumerate(reader):
            tickets.append(normalize(row, i))

    out = Path("data/yellowai_tickets.json")
    out.write_text(json.dumps(tickets, ensure_ascii=False, indent=2))
    print(f"Done. {len(tickets)} Yellow.ai conversations → {out}")
    print("Run: python scripts/classify_tickets.py --source yellowai")


if __name__ == "__main__":
    main()
