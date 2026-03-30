"""
Pydantic models for the User Profile / KYC API.

These models define the canonical internal schema.
When connecting to the real API, map its response into these models —
the rest of the codebase never needs to change.
"""
from __future__ import annotations

from enum import Enum
from typing import Optional
from pydantic import BaseModel


class KYCStatus(str, Enum):
    approved = "approved"
    rejected = "rejected"
    pending_information = "pending_information"
    pending_review = "pending_review"
    not_started = "not_started"
    suspended = "suspended"
    expired = "expired"


class UserTier(str, Enum):
    regular = "regular"
    vip = "VIP"
    ea = "EA"
    high_net_worth = "High net worth"


class KYCInfo(BaseModel):
    status: KYCStatus
    rejection_reason: Optional[str] = None   # only populated when status == rejected
    reviewed_at: Optional[str] = None        # ISO-8601 datetime string


class UserProfile(BaseModel):
    user_id: str
    first_name: str
    last_name: str
    email: str
    phone: str
    tier: UserTier
    kyc: KYCInfo


class ErrorResponse(BaseModel):
    error: str
    detail: Optional[str] = None
