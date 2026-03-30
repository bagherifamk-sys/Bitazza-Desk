"""
Seed users for the mock API — 20 users covering every KYC status + tier combo.
Keyed by user_id, email, and phone for O(1) lookup on all three.
"""
from engine.mock_api.models import UserProfile, KYCInfo, KYCStatus, UserTier

# ── Raw seed data ────────────────────────────────────────────────────────────

_SEED: list[dict] = [
    # ── dev_user: local development fallback (no JWT injected yet) ──────────
    {
        "user_id": "dev_user",
        "first_name": "Dev",
        "last_name": "User",
        "email": "dev@bitazza.com",
        "phone": "+66800000000",
        "tier": UserTier.vip,
        "kyc": KYCInfo(
            status=KYCStatus.rejected,
            rejection_reason="ID document is expired",
            reviewed_at="2026-01-10T10:00:00Z",
        ),
    },
    # approved — one per tier
    {
        "user_id": "USR-000001",
        "first_name": "Somchai",
        "last_name": "Rakpong",
        "email": "somchai.rakpong@example.com",
        "phone": "+66812345601",
        "tier": UserTier.regular,
        "kyc": KYCInfo(status=KYCStatus.approved, reviewed_at="2025-11-01T09:00:00Z"),
    },
    {
        "user_id": "USR-000002",
        "first_name": "Nattaya",
        "last_name": "Suwan",
        "email": "nattaya.suwan@example.com",
        "phone": "+66812345602",
        "tier": UserTier.vip,
        "kyc": KYCInfo(status=KYCStatus.approved, reviewed_at="2025-10-15T14:30:00Z"),
    },
    {
        "user_id": "USR-000003",
        "first_name": "Preecha",
        "last_name": "Kongkiat",
        "email": "preecha.kongkiat@example.com",
        "phone": "+66812345603",
        "tier": UserTier.ea,
        "kyc": KYCInfo(status=KYCStatus.approved, reviewed_at="2025-09-20T08:00:00Z"),
    },
    {
        "user_id": "USR-000004",
        "first_name": "Wanida",
        "last_name": "Phirom",
        "email": "wanida.phirom@example.com",
        "phone": "+66812345604",
        "tier": UserTier.high_net_worth,
        "kyc": KYCInfo(status=KYCStatus.approved, reviewed_at="2025-08-05T11:15:00Z"),
    },
    # rejected — multiple reasons
    {
        "user_id": "USR-000005",
        "first_name": "Tanawat",
        "last_name": "Srisuk",
        "email": "tanawat.srisuk@example.com",
        "phone": "+66812345605",
        "tier": UserTier.regular,
        "kyc": KYCInfo(
            status=KYCStatus.rejected,
            rejection_reason="ID document is expired",
            reviewed_at="2026-01-10T10:00:00Z",
        ),
    },
    {
        "user_id": "USR-000006",
        "first_name": "Malee",
        "last_name": "Chantra",
        "email": "malee.chantra@example.com",
        "phone": "+66812345606",
        "tier": UserTier.regular,
        "kyc": KYCInfo(
            status=KYCStatus.rejected,
            rejection_reason="Selfie does not match the ID photo",
            reviewed_at="2026-02-03T13:45:00Z",
        ),
    },
    {
        "user_id": "USR-000007",
        "first_name": "Korakot",
        "last_name": "Boonmee",
        "email": "korakot.boonmee@example.com",
        "phone": "+66812345607",
        "tier": UserTier.vip,
        "kyc": KYCInfo(
            status=KYCStatus.rejected,
            rejection_reason="Address on proof of residence does not match the registered address",
            reviewed_at="2026-01-28T09:30:00Z",
        ),
    },
    {
        "user_id": "USR-000008",
        "first_name": "Siriporn",
        "last_name": "Nakorn",
        "email": "siriporn.nakorn@example.com",
        "phone": "+66812345608",
        "tier": UserTier.regular,
        "kyc": KYCInfo(
            status=KYCStatus.rejected,
            rejection_reason="Document image is too blurry to verify",
            reviewed_at="2026-03-01T16:00:00Z",
        ),
    },
    # pending_information
    {
        "user_id": "USR-000009",
        "first_name": "Arthit",
        "last_name": "Thongdee",
        "email": "arthit.thongdee@example.com",
        "phone": "+66812345609",
        "tier": UserTier.regular,
        "kyc": KYCInfo(status=KYCStatus.pending_information, reviewed_at="2026-03-20T08:00:00Z"),
    },
    {
        "user_id": "USR-000010",
        "first_name": "Jintana",
        "last_name": "Wiset",
        "email": "jintana.wiset@example.com",
        "phone": "+66812345610",
        "tier": UserTier.vip,
        "kyc": KYCInfo(status=KYCStatus.pending_information, reviewed_at="2026-03-22T10:00:00Z"),
    },
    # pending_review
    {
        "user_id": "USR-000011",
        "first_name": "Piyawat",
        "last_name": "Ladda",
        "email": "piyawat.ladda@example.com",
        "phone": "+66812345611",
        "tier": UserTier.regular,
        "kyc": KYCInfo(status=KYCStatus.pending_review, reviewed_at="2026-03-25T12:00:00Z"),
    },
    {
        "user_id": "USR-000012",
        "first_name": "Supansa",
        "last_name": "Panya",
        "email": "supansa.panya@example.com",
        "phone": "+66812345612",
        "tier": UserTier.ea,
        "kyc": KYCInfo(status=KYCStatus.pending_review, reviewed_at="2026-03-26T09:00:00Z"),
    },
    # not_started
    {
        "user_id": "USR-000013",
        "first_name": "Ratchanok",
        "last_name": "Sombat",
        "email": "ratchanok.sombat@example.com",
        "phone": "+66812345613",
        "tier": UserTier.regular,
        "kyc": KYCInfo(status=KYCStatus.not_started),
    },
    {
        "user_id": "USR-000014",
        "first_name": "Kittisak",
        "last_name": "Meechai",
        "email": "kittisak.meechai@example.com",
        "phone": "+66812345614",
        "tier": UserTier.regular,
        "kyc": KYCInfo(status=KYCStatus.not_started),
    },
    # suspended
    {
        "user_id": "USR-000015",
        "first_name": "Panida",
        "last_name": "Krongkaew",
        "email": "panida.krongkaew@example.com",
        "phone": "+66812345615",
        "tier": UserTier.regular,
        "kyc": KYCInfo(status=KYCStatus.suspended, reviewed_at="2026-02-14T11:00:00Z"),
    },
    {
        "user_id": "USR-000016",
        "first_name": "Noppadol",
        "last_name": "Saengjan",
        "email": "noppadol.saengjan@example.com",
        "phone": "+66812345616",
        "tier": UserTier.vip,
        "kyc": KYCInfo(status=KYCStatus.suspended, reviewed_at="2026-01-05T15:00:00Z"),
    },
    # expired
    {
        "user_id": "USR-000017",
        "first_name": "Waraporn",
        "last_name": "Chai",
        "email": "waraporn.chai@example.com",
        "phone": "+66812345617",
        "tier": UserTier.regular,
        "kyc": KYCInfo(status=KYCStatus.expired, reviewed_at="2024-03-01T09:00:00Z"),
    },
    {
        "user_id": "USR-000018",
        "first_name": "Thanakorn",
        "last_name": "Prom",
        "email": "thanakorn.prom@example.com",
        "phone": "+66812345618",
        "tier": UserTier.ea,
        "kyc": KYCInfo(status=KYCStatus.expired, reviewed_at="2024-06-10T14:00:00Z"),
    },
    # high net worth — additional statuses
    {
        "user_id": "USR-000019",
        "first_name": "Lalita",
        "last_name": "Ruangrit",
        "email": "lalita.ruangrit@example.com",
        "phone": "+66812345619",
        "tier": UserTier.high_net_worth,
        "kyc": KYCInfo(status=KYCStatus.pending_review, reviewed_at="2026-03-28T08:00:00Z"),
    },
    {
        "user_id": "USR-000020",
        "first_name": "Veerasak",
        "last_name": "Inthawong",
        "email": "veerasak.inthawong@example.com",
        "phone": "+66812345620",
        "tier": UserTier.high_net_worth,
        "kyc": KYCInfo(
            status=KYCStatus.rejected,
            rejection_reason="Source of funds documentation is insufficient",
            reviewed_at="2026-03-15T10:30:00Z",
        ),
    },
]

# ── Indexes (built once at import time) ──────────────────────────────────────

_BY_ID: dict[str, UserProfile] = {}
_BY_EMAIL: dict[str, UserProfile] = {}
_BY_PHONE: dict[str, UserProfile] = {}

for _u in _SEED:
    _profile = UserProfile(**_u)
    _BY_ID[_profile.user_id] = _profile
    _BY_EMAIL[_profile.email.lower()] = _profile
    _BY_PHONE[_profile.phone] = _profile


def get_by_user_id(user_id: str) -> UserProfile | None:
    return _BY_ID.get(user_id)


def get_by_email(email: str) -> UserProfile | None:
    return _BY_EMAIL.get(email.lower().strip())


def get_by_phone(phone: str) -> UserProfile | None:
    return _BY_PHONE.get(phone.strip())
