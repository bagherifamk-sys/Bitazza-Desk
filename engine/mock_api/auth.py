"""
Mock token issuer — simulates what Freedom/Bitazza's backend would do.

Endpoint:  POST /mock/auth/token
           Body: { "user_id": "USR-000001" }
           Returns: { "token": "<signed JWT>", "expires_in": 3600 }

Swap path: Remove this router (and set USE_MOCK_USER_API=false) when
           Freedom/Bitazza issues real tokens. The widget and validation
           middleware stay unchanged.

Security:  Only mounted when USE_MOCK_USER_API=true (see api/main.py).
           Never expose in production.
"""
import time
from fastapi import APIRouter, HTTPException
from jose import jwt
from pydantic import BaseModel
from config.settings import JWT_SECRET, JWT_ALGORITHM
from engine.mock_api import users as user_store

router = APIRouter(prefix="/mock/auth", tags=["mock-auth"])

TOKEN_TTL_SECONDS = 3600  # 1 hour — short-lived, matching production intent


class TokenRequest(BaseModel):
    user_id: str


class TokenResponse(BaseModel):
    token: str
    expires_in: int


@router.post(
    "/token",
    response_model=TokenResponse,
    summary="Issue a signed JWT for a mock user (dev only).",
)
def issue_token(body: TokenRequest) -> TokenResponse:
    # Validate the user_id exists in the mock store so callers get a clear
    # error instead of a token that will always 404 on lookup.
    if not user_store.get_by_user_id(body.user_id):
        raise HTTPException(
            status_code=404,
            detail=f"No mock user found with user_id='{body.user_id}'",
        )

    payload = {
        "sub": body.user_id,
        "iat": int(time.time()),
        "exp": int(time.time()) + TOKEN_TTL_SECONDS,
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return TokenResponse(token=token, expires_in=TOKEN_TTL_SECONDS)
