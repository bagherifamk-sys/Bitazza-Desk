# ARCHITECTURE.md — Bitazza Help Desk v2.0

## PostgreSQL Schema

```sql
-- users
id UUID PK | email VARCHAR UNIQUE | name VARCHAR | role VARCHAR CHECK(super_admin|supervisor|agent|kyc_agent|finance_agent) | team VARCHAR | state VARCHAR DEFAULT Offline CHECK(Available|Busy|Break|Offline) | active_chats INT DEFAULT 0 | max_chats INT DEFAULT 3 | created_at | updated_at

-- customers
id UUID PK | bitazza_uid VARCHAR UNIQUE | line_uid VARCHAR UNIQUE | fb_psid VARCHAR UNIQUE | email VARCHAR | tier VARCHAR DEFAULT Standard CHECK(VIP|EA|Standard) | created_at

-- tickets
id UUID PK | customer_id FK | owner_id FK users (NEVER changes on handoff) | assigned_to FK users | team VARCHAR DEFAULT cs | channel VARCHAR CHECK(line|facebook|email|web) | status VARCHAR DEFAULT Open_Live CHECK(Open_Live|In_Progress|Pending_Customer|Closed_Resolved|Closed_Unresponsive|Orphaned|Escalated) | priority INT DEFAULT 3 CHECK(1|2|3) | sla_deadline TIMESTAMPTZ | sla_breached BOOL DEFAULT false | last_customer_msg_at TIMESTAMPTZ | nudge_sent_at TIMESTAMPTZ | csat_score INT CHECK(1–5) | created_at | updated_at
INDEX: (customer_id, updated_at DESC) | (status, last_customer_msg_at) WHERE status=Pending_Customer

-- messages
id UUID PK | ticket_id FK CASCADE | sender_type VARCHAR CHECK(customer|agent|bot|system|internal_note|whisper) | sender_id UUID nullable | content TEXT | channel VARCHAR | metadata JSONB DEFAULT {} | created_at
INDEX: (ticket_id, created_at ASC)

-- ai_studio_flows
id UUID PK | name VARCHAR | flow_json JSONB | published BOOL DEFAULT false | published_at TIMESTAMPTZ | published_by FK users | created_by FK users | created_at | updated_at

-- audit_logs
id UUID PK | actor_id FK users | action VARCHAR | target_type VARCHAR | target_id UUID | metadata JSONB | created_at
```

## Redis Keys
| Key | Type | TTL | Purpose |
|---|---|---|---|
| queue:live:{team} | List | — | Push queue (LPUSH=front, RPUSH=back) |
| queue:email:{team} | List | — | Async pull queue |
| agent:session:{id} | Hash | 24h | state, active_chats, socket_id |
| agent:disconnect:{id} | String | 30s | Grace period flag |
| ticket:lock:{id} | String | 5s | Atomic claim lock (SETNX) |
| ticket:queue_pos:{id} | String | 1h | Customer queue position |
| bot:flow:active | String | — | Published AI Studio flow JSON |
| rate:gemini:{agent_id} | Counter | 60s | Gemini rate limit |

## Socket.io Events
```
C→S: agent:state_change {agentId,state} | agent:claim_ticket {agentId,ticketId}
     supervisor:whisper {ticketId,agentId,content} | supervisor:barge {ticketId,supervisorId}
S→C: ticket:assigned {ticket,agentId} | ticket:updated {ticketId,changes}
     queue:position {ticketId,position} | sla:breach {ticketId,tier}
     capacity:zero_alert {} [supervisor only]
```

## REST Endpoints
```
POST   /api/tickets
GET    /api/tickets/:id
PATCH  /api/tickets/:id/status
PATCH  /api/tickets/:id/assign         {team, assigned_to}
POST   /api/tickets/:id/messages
POST   /api/tickets/:id/claim          atomic SETNX lock
POST   /api/tickets/:id/merge
POST   /api/copilot/summarize          {ticketId}
POST   /api/copilot/draft              {ticketId, shorthand}
GET    /api/agents
PATCH  /api/agents/:id/state
GET    /api/studio/flows
POST   /api/studio/flows
PATCH  /api/studio/flows/:id
POST   /api/studio/flows/:id/publish   validate→compile→Redis flush
GET    /api/metrics?agent_id&channel&from&to
```

## External APIs
**Bitazza Core (read-only, timeout 5s, never block composer/routing)**
```
GET /get_user_profile?uid → {uid,name,tier,kyc_status}
GET /get_balances?uid     → {fiat:{THB},crypto:{BTC,ETH}}
GET /get_transactions?uid&limit=10 → [{id,type,amount,currency,status,created_at}]
```
**Gemini Flash (timeout 8s, never auto-send)**
```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-flash:generateContent
Summarize prompt: "Summarize this support thread in exactly 3 bullet points. Focus: issue, actions taken, current status.\n{thread}"
Draft prompt: "Expand to professional Bitazza support reply. Tone: helpful,clear,formal,empathetic. No new info. Shorthand: {text}"
```

## Channels
| Channel | File Limit | Special |
|---|---|---|
| LINE OA | 10MB | Enforce client-side |
| Facebook | 25MB | 24h window lock |
| Email | 25MB | No restrictions |
| Web Chat | 10MB | Socket.io direct |

## Cron Jobs
| Job | Interval | Query | Action |
|---|---|---|---|
| sla_checker | 30s | sla_deadline<NOW AND sla_breached=false AND status=Open_Live | SET sla_breached=true, emit sla:breach |
| nudge_sender | 15min | status=Pending_Customer AND last_msg<NOW-24h AND nudge_sent_at IS NULL | Send follow-up, SET nudge_sent_at=NOW |
| auto_closer | 15min | status=Pending_Customer AND last_msg<NOW-48h | SET status=Closed_Unresponsive, send close msg, fire CSAT |
