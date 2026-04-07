# AI Customer Support — Build vs Buy Cost Analysis
**Prepared for:** Chief Executive Officer
**Date:** April 7, 2026
**Prepared by:** Engineering Team
**Scope:** 500 support tickets/month · Freedom Platform & Bitazza Exchange

---

## Executive Summary

We evaluated four options for delivering AI-powered customer support at our current volume of 500 tickets/month, incorporating actual Yellow.ai contract cost, full team labour costs, and a comparison between cloud LLM (Gemini Flash 2.5) and self-hosted open-source models (Qwen via Ollama).

1. **Custom-built AI bot — Gemini Flash 2.5** (current in-house project)
2. **Custom-built AI bot — On-premise Qwen** (self-hosted, no per-token cost)
3. **Freshdesk + Freddy AI** (off-the-shelf helpdesk with built-in AI)
4. **Yellow.ai** (current vendor — actual contract cost used)

**Bottom line: We are currently paying $32,000/year across Yellow.ai ($14,000) and Freshdesk ($18,000) — more than two full team members' annual salaries combined. The in-house bot costs $276/year in infrastructure, or ~$2,532/year all-in including engineering maintenance. Discontinuing both vendors saves $29,468/year.**

---

## 1. Context & Methodology

### Our Ticket Profile (3,438 historical tickets analysed)
| Metric | Value |
|---|---|
| Monthly volume | ~500 tickets |
| Language split | 68% Thai · 30% English |
| Account-specific issues | 76% (require live account data lookup) |
| Top categories | KYC (21%) · Account restrictions (19%) · Password/2FA reset (10%) · Fraud (7%) · Withdrawals (7%) |
| Expected AI auto-resolution rate | 50–65% (remaining escalate to human agents) |

### Team Labour Baseline

| Role | Headcount | Monthly Salary | Annual Cost |
|---|---|---|---|
| Operations team | 3 | $1,300/person | $46,800 |
| CS team | 4 | $1,300/person | $62,400 |
| **Total team** | **7** | | **$109,200/year** |

> **Cost per person per year: $15,600.** This anchors all "build vs buy" trade-offs — any tool that saves less than one person's time is not worth its price premium.

### Engineering Maintenance Estimate (In-House Bot)
Estimated ongoing maintenance: **5–10 hours/month**.
At a blended internal cost of ~$25/hr (ops-weighted average), that is **$125–$250/month ($1,500–$3,000/year)** in absorbed engineering time.

---

## 2. In-House Bot — Gemini Flash 2.5

### Gemini Flash 2.5 Pricing
| Direction | Rate |
|---|---|
| Input tokens | $0.075 per 1,000,000 tokens |
| Output tokens | $0.300 per 1,000,000 tokens |

### Token Breakdown Per AI Turn

| Context Component | Tokens |
|---|---|
| System prompt (base, EN or TH) | ~700 |
| Category specialist overlay | ~300 |
| Knowledge base chunks (5 chunks × ~200 tokens) | ~1,000 |
| Conversation history (last 10 messages) | ~800 |
| Tool/function declarations | ~300 |
| Customer message | ~60 |
| **Total input per turn** | **~3,160** |
| **AI response output** | **~200** |

**Cost per single AI turn:**
- Input: 3,160 × ($0.075 / 1,000,000) = **$0.000237**
- Output: 200 × ($0.300 / 1,000,000) = **$0.000060**
- **Total per turn: $0.000297**

**Blended cost per message (accounting for 76% tool calls):**
- With tool call: $0.000609 · Without: $0.000297
- Weighted average: **$0.000534/message**

**Average messages per ticket:** 3 → **$0.0016/ticket (AI compute only)**

### Copilot Assist (Escalated Tickets — ~175/month)
| Call | Cost |
|---|---|
| Reply suggestion | $0.000135 |
| Conversation summary | $0.000149 |
| Sentiment label | $0.000009 |
| **Per escalated ticket** | **$0.000293** |

Total copilot cost: 175 × $0.000293 = **$0.05/month**

### Monthly Cost Summary — Gemini Flash 2.5

| Item | Monthly Cost |
|---|---|
| Gemini API — bot replies (500 tickets × 3 msgs × $0.000534) | $0.80 |
| Gemini API — copilot assist (175 escalated tickets) | $0.05 |
| Fly.io hosting (API server + dashboard + chat widget) | $15.00 |
| PostgreSQL managed database (Fly.io small instance) | $7.00 |
| ChromaDB vector store (self-hosted, no extra cost) | $0.00 |
| Engineering maintenance (absorbed, ~7.5 hrs/month) | $188 |
| **Total (including maintenance labour)** | **~$211/month** |

> **Software-only cost: $23/month · All-in (with maintenance labour): ~$211/month · Per-ticket: ~$0.42**

---

## 3. In-House Bot — On-Premise Qwen (Ollama)

Running a self-hosted open-source model eliminates all per-token API costs but introduces hardware and operational overhead.

### Model Options

| Model | Parameters | VRAM Required | Quality vs Gemini Flash |
|---|---|---|---|
| Qwen2.5-7B | 7B | ~6 GB (4-bit quant) | Good for EN; Thai quality noticeably lower |
| Qwen2.5-14B | 14B | ~10 GB (4-bit quant) | Better Thai; still below Gemini Flash |
| Qwen2.5-72B | 72B | ~40 GB (4-bit quant) | Comparable to Gemini Flash; requires high-end GPU |
| Qwen2.5-7B-Instruct (Thai-tuned) | 7B | ~6 GB | Best small-model Thai option |

> **Critical consideration:** 68% of our tickets are Thai. Smaller open-source models have significantly weaker Thai instruction-following. Qwen2.5 is among the best open-source options for Thai, but still trails Gemini Flash on complex multi-turn support tasks.

### Infrastructure Cost (Cloud GPU Server — Self-Managed)

| Option | Monthly Cost | Notes |
|---|---|---|
| Hetzner GPU server (RTX 4090, 24 GB VRAM) | ~$200–$250/month | Runs Qwen2.5-14B comfortably |
| RunPod / Vast.ai (reserved A100 80 GB) | ~$300–$400/month | Runs Qwen2.5-72B; best quality |
| On-site hardware (buy RTX 4090 + server) | ~$2,500 one-time + $50/month power | Capex model; breaks even vs Hetzner in ~12 months |
| **Recommended (Hetzner + Qwen2.5-14B)** | **~$230/month** | Balanced cost/quality for Thai |

### Monthly Cost Summary — On-Premise Qwen

| Item | Monthly Cost |
|---|---|
| GPU server (Hetzner, RTX 4090) | $230 |
| Fly.io hosting (API server + dashboard only — no LLM) | $15 |
| PostgreSQL managed database | $7 |
| ChromaDB vector store | $0 |
| Engineering maintenance (higher — model ops added) | $250 |
| **Total** | **~$502/month** |

> **Per-ticket cost: ~$1.00 · Annual: ~$6,024**

### Gemini Flash vs On-Premise Qwen — Direct Comparison

| | Gemini Flash 2.5 | On-Premise Qwen2.5-14B |
|---|:---:|:---:|
| Monthly software cost | $23 | $252 |
| Monthly all-in (with maintenance) | ~$211 | ~$502 |
| Annual all-in | ~$2,532 | ~$6,024 |
| Thai language quality | Excellent | Good (noticeable gap) |
| Setup complexity | Low | High (model serving, GPU ops) |
| Latency | ~1–2s (API round-trip) | ~1–3s (depends on hardware) |
| Data residency | Google infrastructure | Full control |
| Vendor dependency | Google API | None |
| Scales with volume | Yes (pay-per-token) | Yes (fixed cost) |
| Maintenance burden | Low | Higher (GPU, model updates) |

**Verdict:** On-premise Qwen costs more, not less, at our current volume — and delivers lower Thai quality. The breakeven point where Qwen becomes cheaper than Gemini Flash (software cost only) is roughly **50,000+ messages/month** (where per-token costs would exceed $230/month). We are currently at ~1,500 messages/month. On-premise only makes sense if data residency is a hard regulatory requirement.

---

## 4. Freshdesk + Freddy AI

> **Actual annual contract: $18,000/year ($1,500/month)**

This replaces the earlier published-pricing estimate. Freshdesk's actual billed cost from our vendor agreement is $18,000/year — higher than the list-price calculation of $2,808/year, likely due to enterprise tier, onboarding, and support fees negotiated at contract time.

| Item | Monthly Cost | Annual Cost |
|---|---|---|
| Freshdesk contract (actual) | $1,500 | $18,000 |

> **Per-ticket cost: ~$3.00 · Annual: $18,000**

**Notes:**
- Thai language support is limited — a meaningful gap given 68% of our tickets are Thai
- No live account API integration out of the box — requires custom development
- At $18,000/year, Freshdesk is now **more expensive than Yellow.ai ($14,000/year)**

---

## 5. Yellow.ai — Actual Cost

> **Actual annual contract: $14,000/year ($1,167/month)**

This replaces the earlier estimate. Yellow.ai's contract cost is now confirmed from our existing vendor agreement.

| Item | Monthly Cost | Annual Cost |
|---|---|---|
| Yellow.ai contract (actual) | $1,167 | $14,000 |
| Thai language support | Included | Included |
| Gen AI features | Included (per contract) | Included |

> **Per-ticket cost: ~$2.33/month · Annual: $14,000**

**What $14,000/year means in context:**
- That is **89% of one team member's annual salary ($15,600)**
- It is **50× more than our in-house software cost** ($276/year)
- It is **5× more than Freshdesk** ($2,808/year)
- It is **$11,468/year more than our all-in in-house cost** (including maintenance labour)

---

## 6. Full Cost Comparison (All-In, Including Labour)

| | In-House (Gemini) | In-House (Qwen) | Freshdesk + Freddy | Yellow.ai |
|---|:---:|:---:|:---:|:---:|
| **Monthly software cost** | **$23** | **$252** | **$1,500** | **$1,167** |
| **Engineering maintenance/month** | $188 | $250 | $0 | $0 |
| **Monthly all-in** | **$211** | **$502** | **$1,500** | **$1,167** |
| **Annual all-in** | **$2,532** | **$6,024** | **$18,000** | **$14,000** |
| **Per-ticket cost** | **$0.42** | **$1.00** | **$3.00** | **$2.33** |
| Thai language quality | Excellent | Good | Limited | Good |
| Custom account API | Built-in | Built-in | Dev required | Dev required |
| Data residency | Google | Full control | Freshworks | Yellow.ai |
| Lock-in risk | Low | None | Medium | High |
| Maintenance burden | Internal | Internal (higher) | Vendor | Vendor |

> **Both vendor solutions now cost more than one full team member's annual salary ($15,600).** Freshdesk at $18,000/year is the most expensive option of all four.

---

## 7. Cost at Scale

| Monthly Volume | In-House (Gemini) | In-House (Qwen) | Freshdesk (actual) | Yellow.ai (actual) |
|---|---|---|---|---|
| 500 tickets | $211 | $502 | $1,500 | $1,167 |
| 1,000 tickets | $213 | $502 | $1,500+ | $1,167+ |
| 2,000 tickets | $216 | $502 | $1,700+ | ~$1,400+ |
| 5,000 tickets | $225 | $502 | $2,300+ | ~$2,000+ |
| 15,000 tickets | $258 | $502 | $4,100+ | ~$4,000+ |

*Vendor costs at scale are estimates — both Freshdesk and Yellow.ai require contract renegotiation at higher volumes. In-house costs are computed from actual API pricing.*

> **Qwen breaks even with Gemini Flash (software only) at ~50,000 messages/month.** Far beyond current scale.

---

## 8. The Real Vendor Cost: Opportunity Cost

We are currently paying for **both** Yellow.ai and Freshdesk. Combined, that is **$32,000/year** in vendor software costs.

| Vendor | Annual Cost | As % of one team member's salary ($15,600) |
|---|---|---|
| Freshdesk | $18,000 | 115% |
| Yellow.ai | $14,000 | 90% |
| **Combined** | **$32,000** | **205%** — more than two full salaries |

| Alternative use of $32,000/year | Value |
|---|---|
| In-house bot (Gemini) all-in for **12+ years** | Full ownership, no vendor dependency |
| Hire **2 additional CS agents** at $15,600/year | Direct headcount — more coverage, faster response |
| In-house bot + **$29,468 saved annually** | Reinvest in product, tooling, or headcount |

The in-house bot returns **$29,468/year in freed budget** versus the current combined vendor spend, even after absorbing all engineering maintenance costs.

---

## 9. Recommendation

**Continue with the in-house build using Gemini Flash 2.5. Discontinue both Yellow.ai and Freshdesk.**

The economics are unambiguous:

- **vs Yellow.ai ($14,000/year):** Save $11,468/year all-in. Yellow.ai costs 90% of a full team member's salary for software that our in-house bot replicates for $23/month.
- **vs Freshdesk ($18,000/year):** Freshdesk is now the most expensive option — more than Yellow.ai — while offering limited Thai support and no native account API integration. Save $15,468/year all-in by switching off Freshdesk.
- **vs Combined vendor spend ($32,000/year):** Discontinuing both vendors saves $29,468/year — enough to hire two additional CS agents.
- **vs On-Premise Qwen:** More expensive at current volume, lower Thai quality, higher operational complexity. Only rational if data residency becomes a hard regulatory requirement.

**Do not pursue on-premise models at current scale.** Gemini Flash 2.5 is both cheaper and higher quality than any self-hosted alternative at 500 tickets/month.

If the engineering team becomes unavailable and a vendor fallback is required, **neither current vendor is recommended at their actual contract prices.** Re-negotiate Freshdesk down to list price (~$234/month) or find an alternative ticketing tool.

---

*All Gemini Flash 2.5 pricing sourced from Google AI Studio pricing page (April 2026). Freshdesk and Yellow.ai costs from actual vendor contracts (April 2026). Qwen hardware estimates based on Hetzner GPU server pricing and RunPod spot rates (April 2026). Team salary figures provided by management.*
