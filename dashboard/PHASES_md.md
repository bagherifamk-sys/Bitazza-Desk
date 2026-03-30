# PHASES.md — Build Order
Each phase independently deployable. Never skip ahead.

## P1 — Foundation (FR-01, FR-07)
Deliverables: Next.js PWA scaffold, monochrome CSS tokens, PostgreSQL+Redis setup, RBAC auth+route guards, Socket.io server, agent state toggle UI, unified thread view, inbox list upgrade
Exit: Agent logs in, sees inbox, opens ticket, reads thread, posts reply, toggles state

## P2 — Routing + Channels (FR-02–09)
Deliverables: Push routing round-robin, email pull queue+claim, sticky routing, VIP override, SLA timers+breach indicators, LINE/FB/Email/WebChat ingestion, channel switcher, right panel Core API fetch
Exit: Live chat routes correctly, VIP jumps queue, email claims work, SLA turns red, right panel loads or degrades

## P3 — AI + Automation + Collaboration (FR-10–14)
Deliverables: Gemini summarize→internal note, Gemini smart draft, 24h auto-nudge cron, 48h auto-close+CSAT cron, cross-team handoff, supervisor whisper+barge, Slack escalation, Google Meet+fallback, Meta 24h lock enforcement
Exit: Summarize returns 3-bullet note, draft expands shorthand, crons fire correctly, whisper/barge work, Slack payload delivers

## P4 — AI Studio + Analytics + Hardening (FR-15–17)
Deliverables: React Flow canvas+4 node types, publish→JSON→Redis flush, dead-end validation, AI Studio RBAC guard+audit log, metrics dashboard (FRT/AHT/CSAT), supervisor live dashboard, PWA audit, load test, security review
Exit: Flow builds/validates/publishes, metrics correct, PWA installs on mobile, all PRD edge cases pass QA

## Dependency
P1 → P2 → P3 → P4 (strict order)
