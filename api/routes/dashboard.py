"""CS Dashboard API routes — internal agent-facing endpoints."""
import time
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from typing import Optional
from api.middleware.auth import get_user_id
from db.conversation_store import (
    get_open_tickets, get_ticket_with_history,
    update_ticket_status, add_message,
    get_all_conversations, get_conversation_with_history,
    transfer_ticket, snooze_ticket, block_ticket, set_pending_internal,
)
from api.ws_manager import manager
from api.copilot import suggest_reply, summarize_conversation, classify_sentiment, find_related_tickets
from api.routes.auth import USERS_BY_ID

router = APIRouter(prefix="/api", tags=["dashboard"])

# ---------------------------------------------------------------------------
# Mock stubs — replace with real DB queries when agents table exists
# ---------------------------------------------------------------------------

MOCK_AGENTS = [
    {"id": "agent_1", "name": "Ploy", "avatar_url": "https://i.pravatar.cc/150?img=47", "status": "available", "active_conversation_count": 1, "max_capacity": 3, "skills": ["kyc", "general"], "shift": "Morning A"},
    {"id": "agent_2", "name": "James", "avatar_url": "https://i.pravatar.cc/150?img=11", "status": "busy", "active_conversation_count": 3, "max_capacity": 3, "skills": ["finance"], "shift": "Morning B"},
    {"id": "agent_3", "name": "Mint", "avatar_url": "https://i.pravatar.cc/150?img=49", "status": "away", "active_conversation_count": 0, "max_capacity": 3, "skills": ["tech"], "shift": "Afternoon"},
    {"id": "agent_4", "name": "Arm", "avatar_url": "https://i.pravatar.cc/150?img=15", "status": "available", "active_conversation_count": 2, "max_capacity": 3, "skills": ["general", "finance"], "shift": "Morning A"},
    {"id": "agent_5", "name": "Nook", "avatar_url": "https://i.pravatar.cc/150?img=45", "status": "offline", "active_conversation_count": 0, "max_capacity": 3, "skills": ["kyc"], "shift": "Evening"},
]

MOCK_CANNED_RESPONSES = [
    {"id": "cr_1", "title": "Greeting", "shortcut": "greeting", "body": "Hello {{customer_name}}, thank you for contacting Bitazza support. How can I help you today?", "scope": "shared"},
    {"id": "cr_2", "title": "KYC Docs Required", "shortcut": "kyc-docs", "body": "To proceed with your KYC verification, please prepare: 1) National ID or Passport, 2) Selfie with ID, 3) Proof of address.", "scope": "shared"},
    {"id": "cr_3", "title": "Closing", "shortcut": "close", "body": "Thank you for contacting Bitazza support. Your ticket #{{ticket_id}} has been resolved. Please don't hesitate to reach out if you need further assistance.", "scope": "shared"},
]

MOCK_TAGS = ["kyc-pending", "withdrawal-issue", "deposit-issue", "vip-followup", "fraud-flagged", "awaiting-docs", "2fa-reset"]


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class ReplyRequest(BaseModel):
    message: str
    is_internal_note: bool = False

class StatusRequest(BaseModel):
    status: str

class PriorityRequest(BaseModel):
    priority: int  # 1 (VIP) | 2 (EA) | 3 (Standard)

class AssignRequest(BaseModel):
    assigned_to: Optional[str] = None
    agent_id: Optional[str] = None  # backwards compat
    team: Optional[str] = None
    handoff_note: Optional[str] = None

class AgentStatusRequest(BaseModel):
    status: str  # available | busy | away | break | after_call_work | offline

class TagsRequest(BaseModel):
    tags: list[str]

class CopilotRequest(BaseModel):
    conversation_id: str

class SentimentRequest(BaseModel):
    message: str

class CannedResponseCreate(BaseModel):
    title: str
    shortcut: str
    body: str
    scope: str = "personal"

class TransferRequest(BaseModel):
    transferred_to: str  # team name: kyc | finance | compliance | fraud | ops
    note: Optional[str] = None

class SnoozeRequest(BaseModel):
    snooze_until: int  # unix timestamp

class BlockRequest(BaseModel):
    blocked_on: str  # kyc | finance | compliance | fraud | ops

class PendingInternalRequest(BaseModel):
    blocked_on: str


# ---------------------------------------------------------------------------
# Conversations
# ---------------------------------------------------------------------------

@router.get("/conversations")
def list_conversations(
    view: str = "all_open",
    search: str = "",
    user_id: str = Depends(get_user_id),
):
    convs = get_all_conversations()
    if search:
        q = search.lower()
        convs = [c for c in convs if q in (c.get("last_message") or "").lower()
                 or q in (c.get("user_id") or "").lower()]
    return {"conversations": convs}


@router.get("/conversations/{conversation_id}")
def get_conversation(conversation_id: str, user_id: str = Depends(get_user_id)):
    conv = get_conversation_with_history(conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv


@router.post("/conversations/{conversation_id}/reply")
async def reply_to_conversation(conversation_id: str, body: ReplyRequest, user_id: str = Depends(get_user_id)):
    conv = get_conversation_with_history(conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    agent_info = USERS_BY_ID.get(user_id)
    agent_display_name = agent_info["name"] if agent_info else user_id
    agent_avatar_url = agent_info.get("avatar_url") if agent_info else None
    mid = add_message(conversation_id, "agent", body.message, {
        "agent_id": user_id,
        "agent_name": agent_display_name,
        "agent_avatar_url": agent_avatar_url,
        "is_internal_note": body.is_internal_note,
    })
    # Mark as human-handled so the AI bot stops replying
    if not body.is_internal_note:
        update_ticket_status(conversation_id, "in_progress", agent_id=user_id)
    await manager.broadcast(conversation_id, {
        "type": "new_message",
        "conversation_id": conversation_id,
        "message": {
            "id": mid,
            "role": "agent",
            "content": body.message,
            "agent_name": agent_display_name,
            "agent_avatar": agent_display_name[0].upper(),
            "agent_avatar_url": agent_avatar_url,
            "created_at": int(time.time()),
            "is_internal_note": body.is_internal_note,
            "mentions": [],
        },
    }, dashboard_only=body.is_internal_note)
    return {"status": "sent"}


# ---------------------------------------------------------------------------
# Tickets
# ---------------------------------------------------------------------------

@router.get("/tickets")
def list_tickets(user_id: str = Depends(get_user_id)):
    return {"tickets": get_open_tickets()}


@router.get("/tickets/{ticket_id}")
def get_ticket(ticket_id: str, user_id: str = Depends(get_user_id)):
    ticket = get_ticket_with_history(ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return ticket


@router.post("/tickets/{ticket_id}/reply")
async def reply_to_ticket(ticket_id: str, body: ReplyRequest, user_id: str = Depends(get_user_id)):
    ticket = get_ticket_with_history(ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    agent_info = USERS_BY_ID.get(user_id)
    agent_display_name = agent_info["name"] if agent_info else user_id
    agent_avatar_url = agent_info.get("avatar_url") if agent_info else None
    mid = add_message(
        conversation_id=ticket_id,
        role="agent",
        content=body.message,
        metadata={
            "agent_id": user_id,
            "agent_name": agent_display_name,
            "agent_avatar_url": agent_avatar_url,
            "is_internal_note": body.is_internal_note,
        },
    )
    if not body.is_internal_note:
        update_ticket_status(ticket_id, "in_progress", agent_id=user_id)
    await manager.broadcast(ticket_id, {
        "type": "new_message",
        "conversation_id": ticket_id,
        "message": {
            "id": mid,
            "role": "agent",
            "content": body.message,
            "agent_name": agent_display_name,
            "agent_avatar": agent_display_name[0].upper(),
            "agent_avatar_url": agent_avatar_url,
            "created_at": int(time.time()),
            "is_internal_note": body.is_internal_note,
            "mentions": [],
        },
    }, dashboard_only=body.is_internal_note)
    return {"status": "sent"}


@router.patch("/tickets/{ticket_id}/status")
async def update_status(ticket_id: str, body: StatusRequest, user_id: str = Depends(get_user_id)):
    # Map frontend status values to internal DB values
    STATUS_MAP = {
        "Open_Live": "ai_handling",
        "In_Progress": "in_progress",
        "Pending_Customer": "pending_customer",
        "Closed_Resolved": "resolved",
        "Closed_Unresponsive": "closed",
        "Orphaned": "closed",
        "Escalated": "escalated",
    }
    internal_status = STATUS_MAP.get(body.status, body.status)
    valid = {"ai_handling","in_progress","pending_human","assigned","pending_customer","pending_internal","transferred","snoozed","blocked","resolved","closed","spam","escalated"}
    if internal_status not in valid:
        raise HTTPException(status_code=400, detail=f"status must be one of {valid}")
    update_ticket_status(ticket_id, internal_status, agent_id=user_id)
    await manager.broadcast(ticket_id, {
        "type": "status_change",
        "conversation_id": ticket_id,
        "status": body.status,
    })
    return {"status": body.status}


@router.patch("/tickets/{ticket_id}/priority")
def update_priority(ticket_id: str, body: PriorityRequest, user_id: str = Depends(get_user_id)):
    valid = {1, 2, 3}
    if body.priority not in valid:
        raise HTTPException(status_code=400, detail=f"priority must be 1 (VIP), 2 (EA), or 3 (Standard)")
    # Stub — add priority column to tickets table when ready
    return {"priority": body.priority}


@router.patch("/tickets/{ticket_id}/assign")
async def assign_ticket(ticket_id: str, body: AssignRequest, user_id: str = Depends(get_user_id)):
    ticket = get_ticket_with_history(ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    target_agent = body.assigned_to or body.agent_id
    update_ticket_status(ticket_id, "assigned", agent_id=target_agent)
    if body.handoff_note:
        add_message(ticket_id, "system", f"[Handoff] {body.handoff_note}", {"agent_id": user_id})
    await manager.broadcast(ticket_id, {
        "type": "ticket_assigned",
        "conversation_id": ticket_id,
        "agent_id": target_agent,
        "agent_name": next((a["name"] for a in MOCK_AGENTS if a["id"] == target_agent), target_agent),
    })
    return {"status": "assigned", "agent_id": target_agent}


@router.patch("/tickets/{ticket_id}/tags")
def update_tags(ticket_id: str, body: TagsRequest, user_id: str = Depends(get_user_id)):
    # Stub — add tags column to tickets table when ready
    return {"tags": body.tags}


@router.post("/tickets/{ticket_id}/escalate")
async def escalate_ticket(ticket_id: str, user_id: str = Depends(get_user_id)):
    ticket = get_ticket_with_history(ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    update_ticket_status(ticket_id, "escalated", agent_id=user_id)
    # TODO: send Slack notification when Slack integration is added
    return {"status": "escalated"}


@router.post("/tickets/{ticket_id}/transfer")
async def transfer_ticket_endpoint(ticket_id: str, body: TransferRequest, user_id: str = Depends(get_user_id)):
    ticket = get_ticket_with_history(ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    transfer_ticket(ticket_id, body.transferred_to, user_id)
    if body.note:
        add_message(ticket_id, "system", f"[Transfer → {body.transferred_to}] {body.note}", {"agent_id": user_id})
    await manager.broadcast(ticket_id, {"type": "status_change", "conversation_id": ticket_id, "status": "transferred", "transferred_to": body.transferred_to})
    return {"status": "transferred", "transferred_to": body.transferred_to}


@router.post("/tickets/{ticket_id}/snooze")
async def snooze_ticket_endpoint(ticket_id: str, body: SnoozeRequest, user_id: str = Depends(get_user_id)):
    ticket = get_ticket_with_history(ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    snooze_ticket(ticket_id, body.snooze_until, user_id)
    await manager.broadcast(ticket_id, {"type": "status_change", "conversation_id": ticket_id, "status": "snoozed", "snooze_until": body.snooze_until})
    return {"status": "snoozed", "snooze_until": body.snooze_until}


@router.post("/tickets/{ticket_id}/block")
async def block_ticket_endpoint(ticket_id: str, body: BlockRequest, user_id: str = Depends(get_user_id)):
    ticket = get_ticket_with_history(ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    block_ticket(ticket_id, body.blocked_on, user_id)
    await manager.broadcast(ticket_id, {"type": "status_change", "conversation_id": ticket_id, "status": "blocked", "blocked_on": body.blocked_on})
    return {"status": "blocked", "blocked_on": body.blocked_on}


@router.post("/tickets/{ticket_id}/pending-internal")
async def pending_internal_endpoint(ticket_id: str, body: PendingInternalRequest, user_id: str = Depends(get_user_id)):
    ticket = get_ticket_with_history(ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    set_pending_internal(ticket_id, body.blocked_on, user_id)
    await manager.broadcast(ticket_id, {"type": "status_change", "conversation_id": ticket_id, "status": "pending_internal", "blocked_on": body.blocked_on})
    return {"status": "pending_internal", "blocked_on": body.blocked_on}


# ---------------------------------------------------------------------------
# Bulk actions
# ---------------------------------------------------------------------------

class BulkActionRequest(BaseModel):
    ticket_ids: list[str]
    action: str          # assign | close | tag | set_priority | set_status
    value: Optional[str] = None
    tags: Optional[list[str]] = None

@router.post("/tickets/bulk")
def bulk_action(body: BulkActionRequest, user_id: str = Depends(get_user_id)):
    results = []
    for tid in body.ticket_ids:
        if body.action == "close":
            update_ticket_status(tid, "closed", agent_id=user_id)
            results.append({"id": tid, "result": "closed"})
        elif body.action == "assign" and body.value:
            update_ticket_status(tid, "assigned", agent_id=body.value)
            results.append({"id": tid, "result": "assigned"})
        elif body.action == "set_status" and body.value:
            update_ticket_status(tid, body.value, agent_id=user_id)
            results.append({"id": tid, "result": body.value})
        else:
            results.append({"id": tid, "result": "skipped"})
    return {"results": results}


# ---------------------------------------------------------------------------
# Agents
# ---------------------------------------------------------------------------

@router.get("/agents/availability")
def get_agents(user_id: str = Depends(get_user_id)):
    return {"agents": MOCK_AGENTS}


@router.patch("/agents/me/status")
def set_my_status(body: AgentStatusRequest, user_id: str = Depends(get_user_id)):
    valid = {"available", "busy", "away", "break", "after_call_work", "offline"}
    if body.status not in valid:
        raise HTTPException(status_code=400, detail=f"status must be one of {valid}")
    # Stub — update real agent record when agents table exists
    return {"status": body.status}


# ---------------------------------------------------------------------------
# Supervisor live dashboard
# ---------------------------------------------------------------------------

@router.get("/supervisor/live")
def supervisor_live(user_id: str = Depends(get_user_id)):
    tickets = get_open_tickets()
    now = int(time.time())
    return {
        "agents": MOCK_AGENTS,
        "queue": [
            {"channel": "web", "priority": "high", "count": len([t for t in tickets if t.get("status") not in ("resolved", "closed", "spam")])},
        ],
        "sla_at_risk": [],  # Stub — populate when sla_breach_at column added
        "stats": {
            "opened_today": len(tickets),
            "resolved_today": 0,
            "avg_first_response_seconds": 0,
            "avg_resolution_seconds": 0,
            "csat_avg": None,
            "bot_active_count": 0,
            "bot_handoff_rate": 0.0,
        },
    }


# ---------------------------------------------------------------------------
# Analytics
# ---------------------------------------------------------------------------

@router.get("/analytics")
def analytics(
    date_range: str = "7d",
    channel: Optional[str] = None,
    agent_id: Optional[str] = None,
    category: Optional[str] = None,
    user_id: str = Depends(get_user_id),
):
    # Stub — wire up real aggregation queries when schema is extended
    return {
        "volume": {"total": 0, "by_channel": {}, "by_day": []},
        "response_time": {"avg": 0, "median": 0, "p90": 0},
        "resolution_time": {"avg": 0, "by_category": {}},
        "bot_performance": {"resolution_rate": 0.0, "handoff_rate": 0.0, "top_intents": []},
        "csat": {"avg": None, "by_agent": [], "trend": []},
    }


# ---------------------------------------------------------------------------
# Canned responses
# ---------------------------------------------------------------------------

@router.get("/canned-responses")
def list_canned_responses(user_id: str = Depends(get_user_id)):
    return {"canned_responses": MOCK_CANNED_RESPONSES}


@router.post("/canned-responses")
def create_canned_response(body: CannedResponseCreate, user_id: str = Depends(get_user_id)):
    import uuid
    new = {"id": str(uuid.uuid4()), **body.dict()}
    MOCK_CANNED_RESPONSES.append(new)
    return new


# ---------------------------------------------------------------------------
# Tags
# ---------------------------------------------------------------------------

@router.get("/tags")
def list_tags(user_id: str = Depends(get_user_id)):
    return {"tags": MOCK_TAGS}


# ---------------------------------------------------------------------------
# Copilot
# ---------------------------------------------------------------------------

@router.post("/copilot/suggest-reply")
async def copilot_suggest(body: CopilotRequest, user_id: str = Depends(get_user_id)):
    conv = get_conversation_with_history(body.conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    draft = await suggest_reply(conv["history"][-10:])
    return {"draft": draft}


@router.post("/copilot/summarize")
async def copilot_summarize(body: CopilotRequest, user_id: str = Depends(get_user_id)):
    conv = get_conversation_with_history(body.conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    summary = await summarize_conversation(conv["history"])
    return {"summary": summary}


@router.post("/copilot/sentiment")
async def copilot_sentiment(body: SentimentRequest, user_id: str = Depends(get_user_id)):
    sentiment = await classify_sentiment(body.message)
    return {"sentiment": sentiment}


@router.post("/copilot/related-tickets")
async def copilot_related(body: CopilotRequest, user_id: str = Depends(get_user_id)):
    conv = get_conversation_with_history(body.conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    first_message = next((m["content"] for m in conv.get("history", []) if m["role"] == "user"), "")
    tickets = await find_related_tickets(first_message)
    return {"tickets": tickets}


# ---------------------------------------------------------------------------
# WebSocket
# ---------------------------------------------------------------------------

@router.websocket("/ws/conversations")
async def ws_conversations(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_json()
            event_type = data.get("type")
            conv_id = data.get("conversation_id")
            if event_type == "presence" and conv_id:
                await manager.broadcast(conv_id, {
                    "type": "agent_presence",
                    "conversation_id": conv_id,
                    "agent_id": data.get("agent_id", ""),
                    "agent_name": data.get("agent_name", ""),
                    "action": data.get("action", "join"),
                })
            elif event_type == "typing" and conv_id:
                await manager.broadcast(conv_id, {
                    "type": "agent_typing",
                    "conversation_id": conv_id,
                    "agent_id": data.get("agent_id", ""),
                    "agent_name": data.get("agent_name", ""),
                })
    except WebSocketDisconnect:
        manager.disconnect(websocket)
