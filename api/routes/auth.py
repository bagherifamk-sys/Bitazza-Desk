"""Auth routes — login endpoint for dashboard agents."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from jose import jwt
import time
from config.settings import JWT_SECRET, JWT_ALGORITHM

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Stub user store — replace with real DB when agents table exists.
# Add real agent accounts here until the agents table is built.
USERS = {
    "admin@bitazza.com": {
        "password": "admin123",
        "id": "agent_admin",
        "name": "Admin",
        "avatar_url": None,
        "role": "admin",
        "team": "ops",
    },
    "kas@bitazza.com": {
        "password": "kas123",
        "id": "agent_kas",
        "name": "Kas",
        "avatar_url": None,
        "role": "agent",
        "team": "support",
    },
}

# Index by id for fast lookup from dashboard reply endpoints
USERS_BY_ID = {u["id"]: u for u in USERS.values()}


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/login")
def login(body: LoginRequest):
    user = USERS.get(body.email.lower())
    if not user or user["password"] != body.password:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = jwt.encode(
        {"sub": user["id"], "exp": int(time.time()) + 86400 * 7},
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )
    return {
        "token": token,
        "user": {
            "id": user["id"],
            "name": user["name"],
            "avatar_url": user.get("avatar_url"),
            "role": user["role"],
            "team": user["team"],
        },
    }
