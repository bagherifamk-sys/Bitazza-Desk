"""
Mock User/KYC API router.

Endpoint:   GET /mock/user?user_id=...
            GET /mock/user?email=...
            GET /mock/user?phone=...

Exactly one query param must be supplied per request.
Auth:       Bearer token required (mock JWT — any non-empty token is accepted
            in dev; real JWT validation is wired in via the get_current_user
            dependency used by the production router).

Swap path:  Mount this router only when USE_MOCK_USER_API=true in .env.
            The production router uses the same response models, so the agent
            never needs to change.
"""
from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from engine.mock_api import users as user_store
from engine.mock_api.models import UserProfile

router = APIRouter(prefix="/mock", tags=["mock-user-api"])

_bearer = HTTPBearer()


def _require_auth(credentials: HTTPAuthorizationCredentials = Depends(_bearer)) -> str:
    """
    Mock auth: accept any non-empty bearer token.
    Replace this dependency with the real JWT validator when going live.
    """
    token = credentials.credentials
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    return token


@router.get(
    "/user",
    response_model=UserProfile,
    summary="Look up a user by user_id, email, or phone (exactly one param).",
)
def get_user(
    user_id: Optional[str] = Query(default=None, description="Internal user ID"),
    email: Optional[str] = Query(default=None, description="Registered email address"),
    phone: Optional[str] = Query(default=None, description="Registered phone number"),
    _token: str = Depends(_require_auth),
) -> UserProfile:
    params = {k: v for k, v in {"user_id": user_id, "email": email, "phone": phone}.items() if v}

    if len(params) == 0:
        raise HTTPException(status_code=400, detail="Provide exactly one of: user_id, email, phone")
    if len(params) > 1:
        raise HTTPException(
            status_code=400,
            detail=f"Only one lookup param allowed; received: {', '.join(params.keys())}",
        )

    param, value = next(iter(params.items()))

    if param == "user_id":
        profile = user_store.get_by_user_id(value)
    elif param == "email":
        profile = user_store.get_by_email(value)
    else:
        profile = user_store.get_by_phone(value)

    if profile is None:
        raise HTTPException(status_code=404, detail=f"No user found for {param}='{value}'")

    return profile
