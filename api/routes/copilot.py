"""Copilot API routes — AI assist endpoints for the CS dashboard."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from api.middleware.auth import get_user_id
from db.conversation_store import get_conversation_with_history
from api.copilot import suggest_reply, summarize_conversation, classify_sentiment, find_related_tickets, draft_reply_with_instruction

router = APIRouter(prefix="/api/copilot", tags=["copilot"])


class CopilotTicketRequest(BaseModel):
    ticketId: str


class SentimentRequest(BaseModel):
    ticketId: str


class DraftAssistedRequest(BaseModel):
    ticketId: str
    instruction: str = ""
    partialDraft: str = ""


@router.post("/suggest-reply")
async def copilot_suggest(body: CopilotTicketRequest, user_id: str = Depends(get_user_id)):
    conv = get_conversation_with_history(body.ticketId)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    draft = await suggest_reply(conv.get("history", []))
    return {"suggestion": draft}


@router.post("/summarize")
async def copilot_summarize(body: CopilotTicketRequest, user_id: str = Depends(get_user_id)):
    conv = get_conversation_with_history(body.ticketId)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    summary = await summarize_conversation(conv.get("history", []))
    return {"summary": summary}


@router.post("/sentiment")
async def copilot_sentiment(body: SentimentRequest, user_id: str = Depends(get_user_id)):
    conv = get_conversation_with_history(body.ticketId)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    last_user_msg = next(
        (m["content"] for m in reversed(conv.get("history", [])) if m.get("role") == "user"),
        "",
    )
    sentiment = await classify_sentiment(last_user_msg) if last_user_msg else "neutral"
    return {"sentiment": sentiment}


@router.post("/draft-assisted")
async def copilot_draft_assisted(body: DraftAssistedRequest, user_id: str = Depends(get_user_id)):
    conv = get_conversation_with_history(body.ticketId)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    draft = await draft_reply_with_instruction(
        conv.get("history", []),
        instruction=body.instruction,
        partial_draft=body.partialDraft,
    )
    # Log draft to DB (fire-and-forget — don't fail the request if logging fails)
    try:
        from db.conversation_store import log_ai_draft
        log_ai_draft(body.ticketId, user_id, body.instruction, body.partialDraft, draft)
    except Exception:
        pass
    return {"draft": draft}


@router.post("/related-tickets")
async def copilot_related(body: CopilotTicketRequest, user_id: str = Depends(get_user_id)):
    conv = get_conversation_with_history(body.ticketId)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    first_message = next(
        (m["content"] for m in conv.get("history", []) if m.get("role") == "user"),
        "",
    )
    tickets = await find_related_tickets(first_message)
    return {"related": tickets}
