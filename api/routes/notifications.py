"""Notifications REST endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from api.middleware.auth import get_user_id
from engine.notifications import (
    get_notifications, mark_read, mark_all_read,
    create_notification, fan_out_to_supervisors,
)
from api.ws_manager import manager

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("")
def list_notifications(user_id: str = Depends(get_user_id)):
    return get_notifications(user_id)


@router.patch("/{notif_id}/read")
def read_notification(notif_id: str, user_id: str = Depends(get_user_id)):
    found = mark_read(notif_id, user_id)
    if not found:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"status": "read"}


@router.patch("/read-all/mark")
def read_all_notifications(user_id: str = Depends(get_user_id)):
    count = mark_all_read(user_id)
    return {"updated": count}


class SLABreachRequest(BaseModel):
    ticket_id: str
    customer_name: str | None = None
    assigned_to: str | None = None      # agent user_id
    priority: int = 3                   # 1=VIP 2=EA 3=Standard


@router.post("/sla-breach")
async def trigger_sla_breach(body: SLABreachRequest, user_id: str = Depends(get_user_id)):
    """
    Called by the frontend SLA monitor (or server loop) when a ticket breaches SLA.
    Creates critical notifications for the assigned agent and all supervisors,
    then broadcasts a notification:new WS event.
    """
    tier_label = {1: "VIP", 2: "EA", 3: "Standard"}.get(body.priority, "Standard")
    customer_label = body.customer_name or "Unknown customer"
    title = f"SLA Breached — Ticket #{body.ticket_id[:8]}"
    notif_body = f"{customer_label} ({tier_label}) — response time exceeded"

    created = []

    # Notify assigned agent
    if body.assigned_to:
        notif = create_notification(
            user_id=body.assigned_to,
            role="agent",
            type="sla_breach",
            priority="critical",
            title=title,
            body=notif_body,
            ticket_id=body.ticket_id,
        )
        created.append(notif)
        await manager.broadcast_all({"type": "notification:new", "notification": notif})

    # Notify all supervisors
    for notif in fan_out_to_supervisors(
        type="sla_breach",
        priority="critical",
        title=title,
        body=notif_body,
        ticket_id=body.ticket_id,
    ):
        created.append(notif)
        await manager.broadcast_all({"type": "notification:new", "notification": notif})

    return {"created": len(created)}
