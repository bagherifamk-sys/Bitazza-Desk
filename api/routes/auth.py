"""Auth routes — login endpoint for dashboard agents."""
import bcrypt
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from jose import jwt
import time
from config.settings import JWT_SECRET, JWT_ALGORITHM
from db.conversation_store import get_agent_by_email, get_agent

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Section permissions granted per role
ROLE_PERMISSIONS: dict[str, list[str]] = {
    "super_admin": [
        "section.home", "section.inbox", "section.supervisor",
        "section.analytics", "section.metrics", "section.studio", "section.admin",
        "section.knowledge",
        "tickets.*", "agents.*", "roles.*", "analytics.*", "knowledge.*",
        "inbox.reply", "inbox.assign", "inbox.close", "inbox.claim",
        "inbox.escalate", "inbox.internal_note",
        "supervisor.whisper", "studio.publish",
        "admin.agents", "admin.roles", "admin.settings",
    ],
    "admin": [
        "section.home", "section.inbox", "section.supervisor",
        "section.analytics", "section.metrics", "section.studio", "section.admin",
        "section.knowledge",
        "tickets.*", "agents.*", "roles.*", "analytics.*", "knowledge.*",
        "inbox.reply", "inbox.assign", "inbox.close", "inbox.claim",
        "inbox.escalate", "inbox.internal_note",
        "supervisor.whisper", "studio.publish",
        "admin.agents", "admin.roles", "admin.settings",
    ],
    "supervisor": [
        "section.home", "section.inbox", "section.supervisor",
        "section.analytics", "section.metrics", "section.knowledge",
        "tickets.*", "agents.read", "analytics.*", "knowledge.read",
        "inbox.reply", "inbox.assign", "inbox.close", "inbox.claim",
        "inbox.escalate", "inbox.internal_note",
        "supervisor.whisper",
    ],
    "kyc_agent": [
        "section.home", "section.inbox",
        "tickets.read", "tickets.reply", "tickets.assign_self",
        "inbox.reply", "inbox.assign", "inbox.close", "inbox.claim", "inbox.internal_note",
    ],
    "finance_agent": [
        "section.home", "section.inbox",
        "tickets.read", "tickets.reply", "tickets.assign_self",
        "inbox.reply", "inbox.assign", "inbox.close", "inbox.claim", "inbox.internal_note",
    ],
    "agent": [
        "section.home", "section.inbox",
        "tickets.read", "tickets.reply", "tickets.assign_self",
        "inbox.reply", "inbox.assign", "inbox.close", "inbox.claim", "inbox.internal_note",
    ],
}

# Keep USERS_BY_ID for any legacy imports (will be empty — real data is in DB)
USERS_BY_ID: dict = {}


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/login")
def login(body: LoginRequest):
    user = get_agent_by_email(body.email.lower())
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    pw_hash = user.get("password_hash", "")
    try:
        valid = bcrypt.checkpw(body.password.encode(), pw_hash.encode())
    except Exception:
        valid = False

    if not valid:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not user.get("active", True):
        raise HTTPException(status_code=403, detail="Account deactivated")

    token = jwt.encode(
        {"sub": str(user["id"]), "exp": int(time.time()) + 86400 * 7},
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )
    return {
        "token": token,
        "user": {
            "id": str(user["id"]),
            "name": user["name"],
            "email": user["email"],
            "avatar_url": user.get("avatar_url"),
            "role": user["role"],
            "team": user["team"],
            "permissions": ROLE_PERMISSIONS.get(user["role"], ROLE_PERMISSIONS["agent"]),
        },
    }
