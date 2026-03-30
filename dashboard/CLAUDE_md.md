# CLAUDE.md — Bitazza Help Desk v2.0
Read this + /docs/*.md before any code.

## Stack
- Frontend: Next.js PWA (React)
- Backend: Node.js (Express)
- Realtime: Socket.io
- DB: PostgreSQL (persistence) + Redis (live state/queues)
- AI: Gemini Flash (agent-assist only)
- External: Bitazza Core API (read-only), Slack webhooks, Google Workspace API, Meta Graph API, LINE Messaging API

## Design: Monochrome High-Density
- bg:#FFF text:#000/#333 border:#EAEAEA/#CCC
- Red #D32F2F: SLA breach, critical errors, disconnected state ONLY
- Green #2E7D32: successful deploy ONLY
- No gradients, no color accents

## Layout (PWA)
- >1024px: 3-panel static (Left:Nav/Queue | Center:Thread | Right:Context)
- 768–1024px: 2-panel, left nav = hamburger
- <768px: single view → tap opens composer → header icon = bottom-sheet context

## Structure
```
/app /components/{workspace,composer,copilot,supervisor,ai-studio}
/lib/{routing,sockets,redis,gemini,integrations}
/db/{migrations,queries} /docs
```

## RBAC
super_admin > supervisor > agent | kyc_agent | finance_agent

## Ticket States
Open_Live → In_Progress → Pending_Customer → Closed_Resolved | Closed_Unresponsive | Orphaned | Escalated

## Agent States
Available | Busy | Break | Offline

## Priority + SLA
1=VIP(1min) 2=EA(3min) 3=Standard(10min)

## Hard Rules
1. Never block composer/routing on external API failure — always degrade gracefully
2. Redis = live queue truth. PostgreSQL = persistence
3. Gemini never auto-sends — always returns to composer for review
4. Atomic DB lock on ticket.owner_id for Pull/Claim (prevents race condition)
5. WebSocket grace = 30s before Offline + re-queue orphaned chats
6. AI Studio publish = compile JSON + flush Redis atomically
7. Follow FEATURES.md per FR exactly. Follow PHASES.md for build order.
