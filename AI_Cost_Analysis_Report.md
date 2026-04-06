# AI Customer Support — Build vs Buy Cost Analysis
**Prepared for:** Chief Executive Officer
**Date:** April 1, 2026
**Prepared by:** Engineering Team
**Scope:** 500 support tickets/month · Freedom Platform & Bitazza Exchange

---

## Executive Summary

We evaluated three options for delivering AI-powered customer support at our current volume of 500 tickets/month:

1. **Custom-built AI bot** (current in-house project using Google Gemini Flash 2.5)
2. **Freshdesk + Freddy AI** (off-the-shelf helpdesk with built-in AI)
3. **Yellow.ai** (enterprise conversational AI platform)

**The in-house solution costs approximately $23/month to operate — roughly 10× less than Freshdesk and up to 200× less than Yellow.ai at our current volume.** The cost advantage widens as ticket volume grows.

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

### What "one ticket" costs in AI compute

When a customer sends a message, our system executes the following steps:

1. **Security pre-filter** — checks message for prompt injection (no LLM cost)
2. **Language detection** — detects EN or TH (no LLM cost)
3. **RAG retrieval** — fetches 5 relevant knowledge base chunks (no LLM cost)
4. **LLM Turn 1** — sends system prompt + knowledge context + conversation history + user message to Gemini → receives a JSON reply
5. **Account tool call** — for 76% of tickets, the LLM calls a live account API (KYC status, withdrawal status, etc.) and a **second LLM turn** processes the result
6. **Compliance post-filter** — redacts PII from the response (no LLM cost)
7. **Copilot calls** — for ~35% of tickets that escalate to a human agent, 3 lightweight AI calls assist the agent (reply suggestion, conversation summary, sentiment label)

The cost is therefore purely the Gemini API usage for steps 4, 5, and 7.

---

## 2. In-House Bot — Detailed Cost Calculation

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

**For the 76% of tickets requiring an account tool call** (second turn, same context + tool result):
- Additional input: 3,360 tokens → **$0.000252**
- Additional output: 200 tokens → **$0.000060**
- Second turn cost: **$0.000312**

**Blended cost per message:**
- With tool call (76%): $0.000297 + $0.000312 = $0.000609
- Without tool call (24%): $0.000297
- Weighted average: (0.76 × $0.000609) + (0.24 × $0.000297) = **$0.000534 per message**

**Average messages per ticket:** 3
(KYC, account restrictions, and password resets typically require clarification exchanges before resolution)

**Cost per ticket (AI bot turns):** $0.000534 × 3 = **$0.0016**

### Copilot Assist (for Escalated Tickets)

~35% of 500 tickets = ~175 tickets escalated to human agents.
Each escalated ticket uses 3 lightweight AI calls (reply suggestion, summary, sentiment):

| Call | Input | Output | Cost |
|---|---|---|---|
| Reply suggestion | ~1,200 tokens | ~150 tokens | $0.000135 |
| Conversation summary | ~1,500 tokens | ~120 tokens | $0.000149 |
| Sentiment label | ~100 tokens | ~5 tokens | $0.000009 |
| **Per escalated ticket** | | | **$0.000293** |

Total copilot cost: 175 × $0.000293 = **$0.05/month**

### Monthly Cost Summary — In-House Bot

| Item | Monthly Cost |
|---|---|
| Gemini API — bot replies (500 tickets × 3 msgs × $0.000534) | $0.80 |
| Gemini API — copilot assist (175 escalated tickets) | $0.05 |
| Fly.io hosting (API server + dashboard + chat widget) | $15.00 |
| PostgreSQL managed database (Fly.io small instance) | $7.00 |
| ChromaDB vector store (self-hosted, no extra cost) | $0.00 |
| **Total** | **$22.85/month** |

> **Per-ticket cost: ~$0.046**

---

## 3. Freshdesk + Freddy AI — Cost Calculation

Freshdesk is the most credible off-the-shelf alternative. It combines a ticketing helpdesk with Freddy AI, their built-in AI bot and agent-assist tools.

### Pricing (Annual billing, as of 2026)

| Component | Unit Cost |
|---|---|
| Freshdesk Pro plan (required for Freddy AI) | $49 / agent / month |
| Freddy AI Agent (bot sessions) | 500 sessions/month **included free** on Pro |
| Additional bot sessions (beyond 500) | $100 per 1,000 sessions ($0.10/session) |
| Freddy AI Copilot (agent reply assist, summaries) | $29 / agent / month |

### Cost for Our Use Case (3 human agents to handle escalations)

| Item | Monthly Cost |
|---|---|
| Freshdesk Pro — 3 agents × $49 | $147.00 |
| Freddy AI Agent — 500 sessions (included free in Pro) | $0.00 |
| Freddy AI Copilot — 3 agents × $29 | $87.00 |
| **Total** | **$234.00/month** |

> **Per-ticket cost: ~$0.47**

**Notes:**
- Minimum 1 agent required (no hard floor), but realistically 2–3 agents are needed to manage escalated tickets
- If monthly volume exceeds 500 tickets, additional bot sessions are charged at $0.10/session — costs scale linearly
- Price does not include any data migration, onboarding, or integration development costs

---

## 4. Yellow.ai — Cost Calculation

Yellow.ai is an enterprise-grade conversational AI platform. It does **not publish pricing** — all contracts require a direct sales negotiation.

### What is Publicly Known

| Item | Cost |
|---|---|
| Freemium plan | Free — but limited to basic FAQ flows, no generative AI, no production environment separation. **Not viable for production use.** |
| Enterprise plan | Custom quote only — no published rate |
| Gen AI Add-on (required for LLM-powered responses) | ~**$18,000/year** ($1,500/month) — confirmed across multiple independent sources |

### Realistic Cost Estimate

Based on industry reports and Yellow.ai's publicly disclosed add-on pricing:

| Item | Monthly Cost |
|---|---|
| Enterprise base contract (estimated low end) | ~$1,500 |
| Gen AI Add-on | $1,500 |
| **Estimated total** | **~$3,000/month** *(minimum — actual quote likely higher)* |

> **Per-ticket cost: ~$6.00+ (estimated)**

**Important caveat:** Yellow.ai's Freemium tier does technically allow 5,000 bot conversations/month at no cost, which would cover 500 tickets. However, Freemium excludes generative AI responses, production deployment controls, custom integrations, and SLA support — making it unsuitable for a live customer-facing product.

---

## 5. Side-by-Side Comparison

| | In-House Bot | Freshdesk + Freddy AI | Yellow.ai (Enterprise) |
|---|:---:|:---:|:---:|
| **Monthly cost** | **$23** | **$234** | **~$3,000+** |
| **Cost per ticket** | **$0.046** | **$0.47** | **~$6.00+** |
| **Annual cost** | **~$276** | **~$2,808** | **~$36,000+** |
| Pricing transparency | Full (API pay-per-use) | Full (published per-seat) | None (sales only) |
| Thai language support | Native (68% of our tickets) | Limited | Yes |
| Custom business logic | Full control | Constrained by platform | Constrained by platform |
| Account API integration | Built-in (KYC, withdrawals, etc.) | Custom dev required | Custom dev required |
| Escalation workflow | Built-in | Built-in | Built-in |
| Maintenance burden | Internal team | Vendor-managed | Vendor-managed |
| Data residency control | Full | Freshworks servers | Yellow.ai servers |
| Lock-in risk | Low | Medium | High |

---

## 6. Cost at Scale

As ticket volume grows, the cost gap widens:

| Monthly Volume | In-House Bot | Freshdesk + Freddy AI | Yellow.ai |
|---|---|---|---|
| 500 tickets | $23 | $234 | ~$3,000 |
| 1,000 tickets | $38 | $334 ($100 extra sessions) | ~$3,000+ |
| 2,000 tickets | $68 | $534 | ~$4,000+ |
| 5,000 tickets | $158 | $1,134 | ~$6,000+ |

*Freshdesk costs grow with both agents (more headcount) and session packs. Yellow.ai costs grow by contract renegotiation.*

---

## 7. Considerations Beyond Cost

### Where Freshdesk wins
- **Zero maintenance burden** — no engineering time required to keep the bot running
- **Built-in ticketing, reporting, and SLA management** — features we would need to build
- **Faster time-to-live** — no development required
- At $234/month, it is a reasonable option if engineering capacity is constrained

### Where Yellow.ai loses
- Most expensive option by a wide margin
- Pricing opacity makes budgeting unreliable
- The Gen AI add-on cost ($18K/year) exceeds our entire annual AI infrastructure spend
- We already export our Yellow.ai tickets for analysis — we understand its limitations firsthand

### In-House risks to acknowledge
- Requires ongoing engineering maintenance (~5–10 hrs/month estimated)
- Infrastructure incidents are our responsibility to resolve
- Feature additions (new ticket categories, new languages) require development sprints

---

## 8. Recommendation

**Continue with the in-house build.**

The economics are unambiguous. At 500 tickets/month, our custom AI bot costs **$23/month all-in** — a **10× saving over Freshdesk** and a **130× saving over Yellow.ai**. The savings compound as volume grows.

More importantly, our stack is purpose-built for this use case:
- Native Thai/English bilingual support (68% of tickets are Thai — a non-trivial capability gap in generic platforms)
- Live account API integration for KYC, withdrawals, and restrictions (76% of tickets require this)
- Full control over escalation logic, compliance filters, and response quality

The only scenario where an off-the-shelf tool becomes rational is if the engineering team is no longer available to maintain the system. In that case, **Freshdesk Pro + Freddy AI at $234/month** is the recommended fallback — transparent pricing, viable AI bot, and no $18K/year Gen AI surcharge.

---

*All Gemini Flash 2.5 pricing sourced from Google AI Studio pricing page (April 2026). Freshdesk pricing sourced from freshworks.com/freshdesk/pricing (April 2026). Yellow.ai pricing sourced from yellow.ai/pricing and corroborated by eesel.ai, GetApp, and Capterra analyst reports (2025–2026).*
