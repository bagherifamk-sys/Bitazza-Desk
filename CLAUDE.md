# CS BOT — Claude Code Guide

## Project
AI Customer Support Agent for Freedom Platform & Bitazza Exchange.
Stack: Python/FastAPI backend · React frontend · Gemini Flash (LLM) · ChromaDB (vector) · PostgreSQL (state).

## Key Directories
```
scripts/       Phase 0: Freshdesk/YellowAI export + classification + analysis
ingestion/     Knowledge base pipeline (tickets, blogs, docs → vector DB)
engine/        AI core: agent, RAG retriever, account tools, escalation, filters
api/           FastAPI app (chat, escalation, dashboard routes + middleware)
db/            Vector store + conversation store abstractions
dashboard/     Internal CS agent dashboard (FastAPI backend + React frontend)
frontend/      Embeddable chat widget (React)
config/        Settings (env-based, never hardcoded secrets)
tests/         Pytest test suite
```

## Critical Rules
- Secrets live in `.env` only — never hardcode API keys
- All LLM calls use `gemini-2.0-flash` unless specified otherwise
- RAG always cites source chunk metadata in responses
- Every response must pass security_filter BEFORE and compliance_filter AFTER generation
- Escalation threshold: confidence < 0.6 OR explicit trigger keywords
- Language: auto-detect EN/TH on every message; use matching prompt template
- Account tools (KYC, deposits, etc.) require authenticated user_id from JWT — never trust client-supplied IDs

## Env Vars (see .env.example)
`GEMINI_API_KEY` · `FRESHDESK_API_KEY` · `FRESHDESK_SUBDOMAIN` · `YELLOWAI_API_KEY` · `DATABASE_URL` · `CHROMA_PATH` · `JWT_SECRET`

## Commands
```bash
pip install -r requirements.txt          # install deps
python scripts/freshdesk_export.py       # export Freshdesk tickets
python scripts/yellowai_export.py        # export Yellow.ai tickets
python scripts/classify_tickets.py       # classify tickets with Gemini Flash
python scripts/analyze_categories.py     # rank use cases by volume
uvicorn api.main:app --reload            # run API server
```

## Phase Status
- [x] Phase 0: Ticket classification (Freshdesk + Yellow.ai)
- [x] Phase 1 backend: AI engine built (agent, RAG, account tools, security, escalation, API)
- [ ] Phase 1 remaining: Yellow.ai ticket analysis · knowledge ingestion · React widget · CS dashboard UI

## Data (Phase 0 results — 3,438 tickets)
Top categories: kyc_verification 21% · account_restriction 19% · password_2fa_reset 10% · fraud_security 7% · withdrawal_issue 7%
68% Thai · 30% English · 76% account-specific → live account API integration mandatory
