# PRD: AI Customer Support Agent
**Products:** Freedom Platform · Bitazza Exchange
**Status:** Phase 0 — Ticket Classification

---

## Problem
Support tickets scale linearly with users → rising cost, slow responses, inconsistent quality.

## Goal
AI-first support layer that resolves 50–70% of tickets automatically; seamless human escalation for the rest.

## Users
- **End users** — Freedom/Bitazza customers seeking support via web chat widget
- **CS agents** — Internal team managing escalated tickets via CS dashboard

---

## Phase 0 — Ticket Classification (Current)
**Input:** All historical Freshdesk tickets + Yellow.ai tickets
**Output:** Ranked CSV of use cases by volume → drives Phase 1 scope

Deliverables:
1. `freshdesk_export.py` — pull all tickets via API
2. `yellowai_export.py` — pull Yellow.ai tickets
3. `classify_tickets.py` — categorize each ticket (Claude Haiku)
4. `analyze_categories.py` — rank + report

---

## Phase 1 — Core AI Agent (MVP)
**Scope locked by Phase 0 analysis (3,438 tickets classified):**
- Languages: 68% Thai, 30% English — both must be fully supported
- 76.4% of tickets are account-specific — live account data is mandatory
- Top 7 categories = 75% of all ticket volume

### Functional Requirements
| # | Requirement |
|---|---|
| F1 | Chat widget embedded on Freedom + Bitazza web (floating bubble) |
| F2 | RAG-based answers grounded in knowledge base (tickets, blogs, docs) |
| F3 | Account-aware: bot fetches live user data (KYC, deposits, withdrawals, restrictions) |
| F4 | EN/TH auto-detection with language-matched responses |
| F5 | Escalation to human agent (auto + manual trigger) |
| F6 | CS dashboard: ticket queue + full AI conversation history |
| F7 | Security filter: block prompt injection, social engineering |
| F8 | Compliance filter: no financial advice, no internal data leakage |

### Non-Functional Requirements
| # | Requirement |
|---|---|
| NF1 | Response latency < 3s (p95) |
| NF2 | Uptime 99.9% |
| NF3 | All user data access audited |
| NF4 | No PII stored in vector DB — tickets stripped before ingestion |

---

## Success Metrics
- Support ticket reduction rate (target: 50–70%)
- Average response time (target: < 3s)
- Human escalation rate (target: < 30%)
- Customer satisfaction score (CSAT)
- AI answer accuracy (internal eval)

---

## Out of Scope (Phase 1)
- Mobile app integration
- Telegram/LINE bot
- Persian/Chinese language support
- Proactive outreach / push notifications
