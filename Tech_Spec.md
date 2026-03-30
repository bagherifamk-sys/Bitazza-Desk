# Technical Specification: AI CS Agent

## Stack
| Layer | Technology |
|---|---|
| LLM | `claude-haiku-4-5-20251001` (Anthropic) |
| RAG | ChromaDB built-in embeddings (no external embedding API) |
| Vector DB | ChromaDB (persistent, local) |
| Backend | FastAPI + Python 3.13 |
| Conversation DB | SQLite (dev) → PostgreSQL (prod) |
| Frontend | React + TypeScript (chat widget + CS dashboard) |
| Auth | JWT (sourced from Freedom/Bitazza session) |
| Infra | venv (dev) → Docker (prod) |

---

## API Endpoints (Phase 1)
```
POST /chat/message          # user sends message → AI response
POST /chat/escalate         # trigger human escalation
GET  /dashboard/tickets     # CS agent ticket queue
GET  /dashboard/tickets/:id # ticket detail + full conversation
POST /dashboard/tickets/:id/reply   # CS agent reply
POST /dashboard/tickets/:id/resolve # close ticket
```

---

## AI Agent Flow
```
message → security_filter → intent_classify → RAG_retrieve
       → [account_tools if needed] → build_prompt → Claude Haiku
       → compliance_filter → confidence_check → [escalate | respond]
```

## Prompt Budget (Haiku context: 200k tokens)
- System prompt: ~500 tokens
- RAG chunks (top-5): ~1500 tokens
- Account context: ~200 tokens
- Conversation history: last 10 turns (~1000 tokens)
- User message: ~100 tokens
- **Total input: ~3300 tokens** — well within limits

---

## Data Models

### Conversation
```python
id, user_id, platform, language, status, created_at, updated_at
```

### Message
```python
id, conversation_id, role (user|assistant|agent), content, metadata, created_at
```

### Ticket
```python
id, conversation_id, status (open|assigned|in_progress|resolved|closed),
assigned_agent_id, escalation_reason, created_at, resolved_at
```

---

## Account Tools (Claude function calls)
```python
get_kyc_status(user_id) → {status, reason, updated_at}
get_deposit_status(user_id, tx_id?) → {status, amount, currency, updated_at}
get_withdrawal_status(user_id, tx_id?) → {status, amount, currency, updated_at}
get_account_restrictions(user_id) → {restrictions: [], reason}
get_trading_availability(user_id) → {available: bool, reason}
```
All calls require authenticated `user_id` from JWT — never from user message.

---

## Escalation Triggers
- Confidence score < 0.6
- Keywords: fraud, hack, stolen, lawyer, regulation, complaint, sue
- User message contains: human, agent, person, real support
- 3+ consecutive low-confidence turns
- Account tool returns error requiring manual review

---

## Security Controls
- Pre-generation: prompt injection detection, jailbreak patterns
- Post-generation: PII scrub, financial advice detection, internal data patterns
- Rate limiting: 20 req/min per user
- All account tool calls logged to audit table

---

## Knowledge Base Sources
| Source | Update Frequency |
|---|---|
| Freshdesk tickets + replies | Daily |
| Yellow.ai tickets | Daily |
| Freedom blog | On publish |
| Bitazza blog | On publish |
| Product docs / manuals | On update |
| Compliance docs | On update |

Chunk size: 512 tokens · Overlap: 50 tokens · Top-K retrieval: 5
