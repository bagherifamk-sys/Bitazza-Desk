"""
Ticket Analysis & Ranking Script
Reads classified_tickets.json → prints ranked report + saves analysis.csv
Usage: python scripts/analyze_categories.py
"""

import json, csv
from pathlib import Path
from collections import Counter, defaultdict


def main():
    data = json.loads(Path("data/classified_tickets.json").read_text())
    total = len(data)

    # --- Category counts ---
    cat_counter = Counter(t["category"] for t in data)
    lang_counter = Counter(t.get("language", "unknown") for t in data)
    account_specific = sum(1 for t in data if t.get("account_specific"))
    product_counter = Counter(t.get("product", "unknown") for t in data)

    # --- Subcategory breakdown per category ---
    subcats = defaultdict(Counter)
    for t in data:
        subcats[t["category"]][t.get("subcategory", "")] += 1

    # --- Resolution type per category ---
    resolutions = defaultdict(Counter)
    for t in data:
        resolutions[t["category"]][t.get("resolution_type", "")] += 1

    # --- Print ranked report ---
    print(f"\n{'='*60}")
    print(f"TICKET CLASSIFICATION REPORT — {total} total tickets")
    print(f"{'='*60}")
    print(f"Languages: {dict(lang_counter)}")
    print(f"Products: {dict(product_counter)}")
    print(f"Account-specific tickets: {account_specific} ({account_specific/total*100:.1f}%)")
    print(f"\n{'RANK':<6}{'CATEGORY':<30}{'COUNT':<8}{'%':<8}TOP SUBCATEGORIES")
    print("-"*80)

    rows = []
    for rank, (cat, count) in enumerate(cat_counter.most_common(), 1):
        pct = count / total * 100
        top_subs = ", ".join(f"{s}({n})" for s, n in subcats[cat].most_common(3))
        print(f"{rank:<6}{cat:<30}{count:<8}{pct:<8.1f}{top_subs}")
        rows.append({
            "rank": rank,
            "category": cat,
            "count": count,
            "pct": round(pct, 1),
            "top_subcategories": top_subs,
            "resolution_breakdown": str(dict(resolutions[cat])),
        })

    print(f"\n{'='*60}")
    print("PHASE 1 RECOMMENDATION")
    print("Top categories by volume (implement these first):")
    cumulative = 0
    for row in rows:
        cumulative += row["pct"]
        marker = " ← PHASE 1" if cumulative <= 80 else ""
        print(f"  {row['rank']}. {row['category']} ({row['pct']}%){marker}")
        if cumulative > 80:
            break

    # --- Save CSV ---
    out_csv = Path("data/analysis.csv")
    with out_csv.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)

    print(f"\nFull analysis saved to {out_csv}")


if __name__ == "__main__":
    main()
