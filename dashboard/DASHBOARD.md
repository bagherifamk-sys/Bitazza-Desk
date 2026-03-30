# Dashboard Reference

## Current State
2-panel: `TicketList` + `ConversationPanel`. Polling 15s. No auth, no WS.

## Target Layout
```
[ConversationList 320px] [MessageThread flex-1] [PropertiesPanel 340px]
```
Routes: `/` agent workspace · `/supervisor` · `/analytics` · `/admin`

## Key Types (extend types.ts)
```ts
TicketStatus: open|in_progress|pending_customer|pending_internal|escalated|resolved|closed
Priority: low|normal|high|urgent
Channel: web|line|facebook|email
CustomerTier: standard|ea|vip
AgentStatus: available|busy|away|break|after_call_work|offline
Sentiment: positive|neutral|negative
TicketCategory: kyc|deposit_fiat|deposit_crypto|withdrawal_fiat|withdrawal_crypto|change_information|account_security|trading_platform|general

Ticket: +priority, +channel, +category, +customer{user_id,name,email,tier,kyc_status}, +tags, +sla_breach_at, +last_message_at
Message: +is_internal_note, +mentions(agent_ids)
Agent: id, name, status, active_conversation_count, max_capacity(3), skills[], shift
```

## Components

**ConversationList** — inbox view tabs (All Open/Mine/Unassigned/SLA Risk/Waiting/Priority) · cards show channel icon+priority+sentiment+tags · full-text search · checkbox bulk actions (assign/close/tag/priority/status) · collision badge

**MessageThread** — full history · internal notes (yellow, @mention) · reply composer (`/` = canned response autocomplete, reply/note toggle) · typing indicator (WS emit on keydown, clear 5s)

**PropertiesPanel** — tier badge · kyc/email/uid · inline status+priority edit · reassign modal (agent + handoff note) · **CopilotPanel** (collapsible): reply draft (Accept/Edit/Reject) · summarize button · sentiment badge · top 3 related tickets

**SupervisorDashboard** `/supervisor` — agent grid (status color+load) · queue by channel×priority · SLA at-risk list (red<30m/orange<1h) · today stats · bot activity · 30s auto-refresh

**AnalyticsDashboard** `/analytics` — filters: date/channel/agent/team/category · tabs: Volume/Response Time/Resolution/Bot Performance/CSAT/Intent

**AdminSettings** `/admin` — tabs: Agents/Tags/Canned Responses/Assignment Rules/SLA/Bot Config

## API Endpoints (add to api/)
```
GET/PATCH  /tickets · /tickets/:id · /tickets/:id/messages · /tickets/:id/escalate
GET/PATCH  /agents/availability · /agents/me/status
GET        /supervisor/live · /analytics · /canned-responses
POST       /canned-responses
WS         /ws/conversations
```

## WebSocket Events
```ts
// server→client
{type:'new_message'|'status_change'|'agent_typing'|'agent_presence'|'ticket_assigned', conversation_id, ...payload}
// client→server
{type:'typing'|'presence', conversation_id}
```

## Copilot Endpoints
```
POST /copilot/suggest-reply · /copilot/summarize · /copilot/sentiment · /copilot/related-tickets
```
Pass last 10 messages max. Independent loading per section.

## Auth
JWT · roles: agent/supervisor/admin/kyc/finance/tech · agent sees masked PII · kyc sees full documents

## Build Order
1. types.ts · 2. WS setup · 3. 3-panel layout · 4. ConversationList · 5. MessageThread · 6. PropertiesPanel · 7. CopilotPanel · 8. SupervisorDashboard · 9. AnalyticsDashboard · 10. AdminSettings
