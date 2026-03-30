# FEATURES.md — All FRs

## FR-01 Agent State Toggle [P1]
UI: 4-button segmented control in left nav, always visible. Pill badge (text only, no color) next to avatar.
On change: emit agent:state_change → update Redis agent:session:{id} → update users.state in PG.
Available: immediately triggers queue check + assignment.
Offline (manual): confirmation modal if active_chats>0 — "You have {n} active chats. Going offline will re-queue them."
Edge: Redis session expiry → force Offline + log.

## FR-02 Live Push Routing [P2]
Trigger: new live chat (LINE/FB/Web).
Algorithm: query Redis for Available agents, active_chats<max, team=CS → sort by last_assigned_at ASC → apply FR-04 sticky check → apply FR-05 VIP check → assign top candidate (update assigned_to, increment active_chats in Redis, emit ticket:assigned).
No candidates: RPUSH queue:live:cs, emit queue:position to customer.
Edge: zero agents → emit capacity:zero_alert to supervisor (red pulsing). Queue drain: when agent→Available, pop queue:live front. Atomic Redis tx prevents over-assignment.

## FR-03 Email Pull Queue [P2]
Inbound: webhook → ticket created (assigned_to=NULL) → RPUSH queue:email:cs.
UI: inbox filtered by channel=email AND assigned_to IS NULL. "Claim" button per row.
Claim flow: POST /api/tickets/:id/claim → SETNX ticket:lock:{id} (5s TTL) → update owner_id+assigned_to → release lock.
Edge: simultaneous claim → SETNX ensures one wins, loser gets 409 toast "Ticket already claimed by [Agent Name]."

## FR-04 Sticky Routing [P2]
On new ticket: SELECT assigned_to FROM tickets WHERE customer_id=$1 AND updated_at>NOW()-12h ORDER BY updated_at DESC LIMIT 1.
If found AND agent.state=Available AND active_chats<max → assign directly, skip FR-02.
If unavailable → fall through to FR-02. Bypassed entirely for VIP (FR-05 wins).

## FR-05 VIP Override [P2]
On ticket create: GET /get_user_profile. If tier=VIP → priority=1, sla_deadline=NOW+1min, LPUSH queue:live:cs (front).
Round-robin always pops priority=1 first. Right Panel shows VIP badge.
Edge: Core API down → default priority=3, log warning, never block ticket creation.

## FR-06 SLA Timers [P2]
On assignment: sla_deadline = NOW + (VIP:1min | EA:3min | Standard:10min).
Cron sla_checker (30s): breach → sla_breached=true + emit sla:breach → ticket header countdown turns red (#D32F2F).

## FR-07 Unified Thread [P1]
On open: fetch messages ORDER BY created_at ASC. Subscribe to socket room ticket:{id}.
Render by sender_type:
- customer: left bubble, gray bg
- agent: right bubble, white+border
- bot: left, italic, "Bot:" prefix
- system: centered, small gray text
- internal_note: full-width cream bg, "Internal Note" label (never sent to customer)
- whisper: full-width yellow bg, "Whisper from [Supervisor]" (agent-only)
Virtualize list at >100 messages. Gemini summaries auto-render as internal_note.

## FR-08 Channel Switcher [P2]
Dropdown in composer toolbar. Options = customer's linked IDs in customers table.
Email selected: rich-text editor. LINE/FB: plain-text + attachments.
State is local only (not persisted until send).
Edge: FB + last_customer_msg>24h → disable FB option, tooltip "Meta 24h window closed. Switch to Email." LINE file >10MB → block + toast. Single channel → hide switcher.

## FR-09 Right Panel Context [P2]
On ticket open: if customer.bitazza_uid exists → 3 parallel requests to Core API (profile, balances, transactions last 10).
Desktop: always-visible right panel. Mobile: bottom-sheet via header icon. All data read-only.
Loading: skeleton per section. Timeout 5s: gray banner "Internal data unavailable. Verify manually."
No UID: "No Bitazza account linked." API failure MUST NOT block routing or composer.

## FR-10 Gemini Summarize [P3]
Button: ticket header. Disabled if messages<3.
Flow: fetch thread → POST /api/copilot/summarize → Gemini prompt (3 bullets: issue/actions/status) → create internal_note message with metadata.source=gemini_summary → renders inline.
Edge: timeout 8s → revert button + toast "AI Assist unavailable." Rate limit → same toast + audit log.

## FR-11 Gemini Smart Draft [P3]
Button: composer toolbar, visible only when composer has text.
Flow: POST /api/copilot/draft with shorthand → Gemini expands to professional Bitazza tone → replace composer content + show "AI Draft" label.
Label clears on send. Agent responsible for all sent content.
Edge: timeout 8s → revert to original shorthand + toast. Empty composer → button disabled.

## FR-12 Auto-Nudge 24h [P3]
Cron nudge_sender (15min): SELECT tickets WHERE status=Pending_Customer AND last_customer_msg_at<NOW-24h AND nudge_sent_at IS NULL.
Action: send "Hi, we noticed you may still need help. Reply if unresolved, or we'll close in 24 hours." via original channel → SET nudge_sent_at=NOW → log as sender_type=system.
Edge: FB ticket + customer_msg>24h ago → send via email if available, else log "Nudge skipped — Meta window closed, no alternate channel." Status recheck before send.

## FR-13 Auto-Close 48h [P3]
Cron auto_closer (15min): SELECT tickets WHERE status=Pending_Customer AND last_customer_msg_at<NOW-48h.
Action: SET status=Closed_Unresponsive → send "Ticket closed due to no response. Contact us again if needed." → fire CSAT (1–5 inline buttons) → store response in csat_score → emit ticket:updated.

## FR-14 Cross-Team Handoff [P3]
UI: "Assign to Team" dropdown (CS/KYC/Finance) in ticket action bar.
PATCH /api/tickets/:id/assign {team, assigned_to:null} → tickets.team updated, assigned_to cleared, owner_id NEVER changes → ticket leaves CS queue, enters target team unassigned queue.
Original CS agent retains read-only view via "My Tickets" filter.
Edge: target team empty/inactive → accept route but fire Slack webhook to #cs-management "Ticket {id} routed to {team} queue — no agents active." CSAT always attributed to owner_id.

## FR-15 AI Studio Canvas [P4]
Route /studio: super_admin + supervisor only (403→/inbox + audit log for others).
React Flow canvas: draggable, connectable, deletable nodes.
Node types: Message (bot sends text) | Condition (branch on input/API response) | API Call (endpoint call) | Handoff (→ human agent queue).
Config: right sidebar per node. Save Draft → persist to ai_studio_flows.flow_json.
Publish → FR-16. Canvas style: white bg, black borders. Invalid node: red border (#D32F2F).

## FR-16 AI Studio Publish [P4]
POST /api/studio/flows/:id/publish:
1. Validate: all Condition branches connected, all nodes reachable from Start, ≥1 Handoff exists
2. Fail → 400 + broken node IDs → canvas highlights in red + "Dead end on '{label}'. Connect to proceed."
3. Pass → serialize JSON → atomic Redis tx: SET bot:flow:active + UPDATE ai_studio_flows published=true
4. Return 200 → toast "Flow published successfully." (green #2E7D32)
Edge: in-flight conversations finish on old flow. Concurrent publishes → last write wins + both audit logged.

## FR-17 Metrics Dashboard [P4]
Route /metrics: supervisor + super_admin only.
Metrics: FRT (ticket.created_at → first agent message) | AHT (Open_Live → Closed_*) | CSAT (tickets.csat_score).
API: GET /api/metrics?agent_id&channel&from&to → PG aggregations (not Redis).
Charts (Recharts): FRT over time (line) | AHT by channel (bar) | CSAT distribution (donut).
Supervisor Live Dashboard (separate, Socket.io driven): agent states, active chat counts, queue depth, zero-capacity red alert.
```sql
-- FRT per agent last 7d
SELECT assigned_to, AVG(EXTRACT(EPOCH FROM(first_reply_at-created_at))) FROM tickets WHERE created_at>NOW()-'7 days' GROUP BY assigned_to;
-- CSAT per channel
SELECT channel, AVG(csat_score), COUNT(*) FROM tickets WHERE csat_score IS NOT NULL GROUP BY channel;
```
