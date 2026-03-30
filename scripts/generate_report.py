"""
Comprehensive Phase 0 Analysis Report.
Generates a full markdown report from classified ticket data.
Usage: python scripts/generate_report.py
Output: data/phase0_report.md
"""
import json, csv
from pathlib import Path
from collections import Counter, defaultdict
from datetime import datetime


def main():
    classified = json.loads(Path("data/classified_tickets.json").read_text())

    # Try to load yellowai data too if available
    sources = {"freshdesk": [], "yellowai": []}
    for t in classified:
        src = t.get("source", "freshdesk")
        sources[src].append(t)

    total = len(classified)
    fd_count = len(sources["freshdesk"])
    ya_count = len(sources["yellowai"])

    cat_counter = Counter(t["category"] for t in classified)
    lang_counter = Counter(t.get("language", "unknown") for t in classified)
    product_counter = Counter(t.get("product", "unknown") for t in classified)
    account_specific = sum(1 for t in classified if t.get("account_specific"))
    resolution_counter = Counter(t.get("resolution_type", "unknown") for t in classified)

    subcats = defaultdict(Counter)
    for t in classified:
        subcats[t["category"]][t.get("subcategory", "")] += 1

    # Per-product category breakdown
    product_cats = defaultdict(Counter)
    for t in classified:
        product_cats[t.get("product", "unknown")][t["category"]] += 1

    lines = []
    lines.append("# CS Bot — Phase 0 Ticket Classification Report")
    lines.append(f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    lines.append(f"**Status:** {'Freshdesk only' if ya_count == 0 else 'Freshdesk + Yellow.ai'}")
    lines.append("")

    lines.append("---")
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append(f"| Metric | Value |")
    lines.append(f"|---|---|")
    lines.append(f"| Total tickets analysed | {total:,} |")
    lines.append(f"| Freshdesk tickets | {fd_count:,} |")
    lines.append(f"| Yellow.ai tickets | {ya_count:,} {'(pending export)' if ya_count == 0 else ''} |")
    lines.append(f"| Account-specific tickets | {account_specific:,} ({account_specific/total*100:.1f}%) |")
    lines.append(f"| Thai language | {lang_counter.get('th',0):,} ({lang_counter.get('th',0)/total*100:.1f}%) |")
    lines.append(f"| English language | {lang_counter.get('en',0):,} ({lang_counter.get('en',0)/total*100:.1f}%) |")
    lines.append(f"| Bitazza product | {product_counter.get('bitazza',0):,} ({product_counter.get('bitazza',0)/total*100:.1f}%) |")
    lines.append(f"| Freedom product | {product_counter.get('freedom',0):,} ({product_counter.get('freedom',0)/total*100:.1f}%) |")
    lines.append(f"| Both products | {product_counter.get('both',0):,} ({product_counter.get('both',0)/total*100:.1f}%) |")
    lines.append("")

    lines.append("---")
    lines.append("")
    lines.append("## Category Rankings")
    lines.append("")
    lines.append("| Rank | Category | Count | % | Top Subcategories | Phase |")
    lines.append("|---|---|---|---|---|---|")

    cumulative = 0
    rows = []
    for rank, (cat, count) in enumerate(cat_counter.most_common(), 1):
        pct = count / total * 100
        cumulative += pct
        phase = "Phase 1" if cumulative <= 75 else ("Phase 2" if cumulative <= 90 else "Phase 3+")
        top_subs = " · ".join(f"{s} ({n})" for s, n in subcats[cat].most_common(3) if s)
        lines.append(f"| {rank} | **{cat}** | {count} | {pct:.1f}% | {top_subs} | {phase} |")
        rows.append({"rank": rank, "category": cat, "count": count, "pct": pct, "phase": phase})

    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## Resolution Type Breakdown")
    lines.append("")
    lines.append("| Resolution Type | Count | % |")
    lines.append("|---|---|---|")
    for rt, cnt in resolution_counter.most_common():
        lines.append(f"| {rt} | {cnt} | {cnt/total*100:.1f}% |")

    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## Product Breakdown")
    lines.append("")
    lines.append("### Bitazza top issues")
    lines.append("")
    lines.append("| Category | Count |")
    lines.append("|---|---|")
    for cat, cnt in product_cats["bitazza"].most_common(8):
        lines.append(f"| {cat} | {cnt} |")

    lines.append("")
    lines.append("### Freedom top issues")
    lines.append("")
    lines.append("| Category | Count |")
    lines.append("|---|---|")
    for cat, cnt in product_cats["freedom"].most_common(8):
        lines.append(f"| {cat} | {cnt} |")

    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## Phase 1 Bot Scope (Data-Driven)")
    lines.append("")
    lines.append("Based on ticket volume, Phase 1 must handle:")
    lines.append("")

    phase1 = [r for r in rows if r["phase"] == "Phase 1" and r["category"] not in ("other", "spam")]
    coverage = sum(r["pct"] for r in phase1)
    for r in phase1:
        top3 = " · ".join(f"{s}" for s, _ in subcats[r["category"]].most_common(3) if s)
        lines.append(f"- **{r['category']}** ({r['pct']:.1f}%) — {top3}")

    lines.append("")
    lines.append(f"**Coverage:** Top {len(phase1)} categories = **{coverage:.1f}%** of all real support volume")
    lines.append("")
    lines.append("### Critical constraints for Phase 1 implementation")
    lines.append("")
    lines.append(f"1. **{account_specific/total*100:.0f}% of tickets are account-specific** — live account API integration is mandatory from day one")
    lines.append(f"2. **{lang_counter.get('th',0)/total*100:.0f}% Thai language** — Thai prompts and responses are required, not optional")
    lines.append(f"3. **Freedom Card is 3.6% of volume** — separate knowledge base section needed for card shipping, reissue, activation")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## Key Tags from Freshdesk (Classification Signals)")
    lines.append("")

    # Re-load raw tickets for tags
    raw_path = Path("data/freshdesk_tickets.json")
    if raw_path.exists():
        raw = json.loads(raw_path.read_text())
        all_tags = []
        for t in raw:
            all_tags.extend(t.get("tags", []))
        tag_counter = Counter(all_tags)
        lines.append("| Tag | Count | Maps to Category |")
        lines.append("|---|---|---|")
        tag_category_map = {
            "Unlock Account": "account_restriction",
            "Abandoned Chat": "other/noise",
            "Verify Withdraw": "withdrawal_issue",
            "Upgrade KYC": "kyc_verification",
            "Reset 2FA": "password_2fa_reset",
            "KYC issues/problems": "kyc_verification",
            "Follow up": "other/noise",
            "Facebook comments": "other/noise",
            "Crypto Withdrawal": "withdrawal_issue",
            "Unable to generate wallet": "technical_bug",
            "KYC/EDD": "kyc_verification",
            "Freedom card shipping": "freedom_card",
            "Crypto Deposit/Not receive": "deposit_issue",
            "Change phone number": "account_restriction",
            "Bug report": "technical_bug",
            "Fiat Deposit SLA": "deposit_issue",
            "Freedom card/Shipping": "freedom_card",
            "Fiat Withdrawal SLA": "withdrawal_issue",
        }
        for tag, cnt in tag_counter.most_common(18):
            cat_hint = tag_category_map.get(tag, "—")
            lines.append(f"| {tag} | {cnt} | {cat_hint} |")

    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## Next Steps")
    lines.append("")
    lines.append("- [ ] Export Yellow.ai tickets (go to Insights → Data Explorer → Export CSV)")
    lines.append("- [ ] Classify Yellow.ai tickets: `python scripts/classify_tickets.py --source yellowai`")
    lines.append("- [ ] Re-run this report after Yellow.ai data is added")
    lines.append("- [ ] Download ChromaDB embedding model (run ingestion once network allows)")
    lines.append("- [ ] Ingest classified tickets: `PYTHONPATH=. python ingestion/freshdesk_ingester.py`")
    lines.append("- [ ] Build Freedom/Bitazza internal account APIs for KYC, withdrawal, restriction lookups")
    lines.append("- [ ] Start React chat widget")

    report = "\n".join(lines)
    out = Path("data/phase0_report.md")
    out.write_text(report)
    print(report)
    print(f"\n\nSaved to {out}")


if __name__ == "__main__":
    main()
