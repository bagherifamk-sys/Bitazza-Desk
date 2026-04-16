"""
Mock account restriction data — covers all 21 mock users (dev_user + USR-000001–000020).

Scenario coverage:
  • No restrictions       : USR-000001–000004, USR-000014
  • withdrawal_block      : USR-000005, USR-000006, USR-000011, USR-000017, dev_user
  • trading_block         : USR-000007, USR-000012, USR-000018
  • deposit_block         : USR-000008, USR-000019
  • full_freeze (AML/comp) : USR-000009, USR-000010, USR-000015, USR-000016, USR-000020
  • login_block            : USR-000013
  • can_self_resolve=True  : USR-000011, USR-000017 (expired KYC), USR-000013 (2FA reset)
"""
from engine.mock_api.models import (
    AccountRestriction,
    AccountRestrictionsResponse,
    RestrictionType,
    RestrictionStatus,
)

# ── Seed data ─────────────────────────────────────────────────────────────────

_SEED: list[dict] = [
    # ── dev_user: withdrawal blocked — easy local testing ────────────────────
    {
        "user_id": "dev_user",
        "restrictions": [
            AccountRestriction(
                restriction_id="RST-DEV-001",
                type=RestrictionType.withdrawal_block,
                status=RestrictionStatus.active,
                reason="Withdrawal temporarily blocked pending identity re-verification.",
                applied_at="2026-03-28T10:00:00Z",
                expected_lift_at="2026-04-07T10:00:00Z",
                can_self_resolve=True,
                resolution_steps=(
                    "Please update your ID document in the KYC section of your profile. "
                    "Withdrawals will be re-enabled within 24 hours of approval."
                ),
            )
        ],
    },

    # ── No restrictions ───────────────────────────────────────────────────────
    {"user_id": "USR-000001", "restrictions": []},
    {"user_id": "USR-000002", "restrictions": []},
    {"user_id": "USR-000003", "restrictions": []},
    {"user_id": "USR-000004", "restrictions": []},
    {"user_id": "USR-000014", "restrictions": []},

    # ── Withdrawal blocks ─────────────────────────────────────────────────────
    {
        "user_id": "USR-000005",
        "restrictions": [
            AccountRestriction(
                restriction_id="RST-000005-001",
                type=RestrictionType.withdrawal_block,
                status=RestrictionStatus.under_review,
                reason="Unusual withdrawal pattern detected. Account is under routine review.",
                applied_at="2026-03-29T08:00:00Z",
                expected_lift_at="2026-04-05T08:00:00Z",
                can_self_resolve=False,
            )
        ],
    },
    {
        "user_id": "USR-000006",
        "restrictions": [
            AccountRestriction(
                restriction_id="RST-000006-001",
                type=RestrictionType.withdrawal_block,
                status=RestrictionStatus.active,
                reason="Withdrawal blocked due to a mismatch in registered bank account details.",
                applied_at="2026-03-25T14:00:00Z",
                expected_lift_at=None,
                can_self_resolve=True,
                resolution_steps=(
                    "Please verify your bank account details under Settings > Payment Methods "
                    "and resubmit for review. The block will be lifted within 1 business day."
                ),
            )
        ],
    },
    {
        "user_id": "USR-000011",
        "restrictions": [
            AccountRestriction(
                restriction_id="RST-000011-001",
                type=RestrictionType.withdrawal_block,
                status=RestrictionStatus.active,
                reason="Withdrawal disabled because your KYC verification has expired.",
                applied_at="2026-03-01T00:00:00Z",
                expected_lift_at=None,
                can_self_resolve=True,
                resolution_steps=(
                    "Renew your KYC by re-submitting a valid national ID and selfie in the "
                    "Verification section. Withdrawals will resume within 24 hours of approval."
                ),
            )
        ],
    },
    {
        "user_id": "USR-000017",
        "restrictions": [
            AccountRestriction(
                restriction_id="RST-000017-001",
                type=RestrictionType.withdrawal_block,
                status=RestrictionStatus.active,
                reason="Withdrawal blocked — KYC documents have expired.",
                applied_at="2026-03-01T00:00:00Z",
                expected_lift_at=None,
                can_self_resolve=True,
                resolution_steps=(
                    "Re-submit your identity documents via the KYC portal. "
                    "Withdrawals will be re-enabled within 24 hours of successful re-verification."
                ),
            )
        ],
    },

    # ── Trading blocks ────────────────────────────────────────────────────────
    {
        "user_id": "USR-000007",
        "restrictions": [
            AccountRestriction(
                restriction_id="RST-000007-001",
                type=RestrictionType.trading_block,
                status=RestrictionStatus.active,
                reason="Trading suspended due to a leverage limit breach on your account.",
                applied_at="2026-03-30T11:00:00Z",
                expected_lift_at=None,
                can_self_resolve=False,
            )
        ],
    },
    {
        "user_id": "USR-000012",
        "restrictions": [
            AccountRestriction(
                restriction_id="RST-000012-001",
                type=RestrictionType.trading_block,
                status=RestrictionStatus.under_review,
                reason="Trading temporarily paused while a compliance review is in progress.",
                applied_at="2026-03-28T09:00:00Z",
                expected_lift_at="2026-04-04T09:00:00Z",
                can_self_resolve=False,
            )
        ],
    },
    {
        "user_id": "USR-000018",
        "restrictions": [
            AccountRestriction(
                restriction_id="RST-000018-001",
                type=RestrictionType.trading_block,
                status=RestrictionStatus.active,
                reason="Trading blocked due to an unresolved margin call on your account.",
                applied_at="2026-03-27T16:00:00Z",
                expected_lift_at=None,
                can_self_resolve=True,
                resolution_steps=(
                    "Please deposit sufficient funds to cover the margin deficit or close "
                    "open positions to bring your account back to the required margin level. "
                    "Trading will resume automatically once the margin call is resolved."
                ),
            )
        ],
    },

    # ── Deposit blocks ────────────────────────────────────────────────────────
    {
        "user_id": "USR-000008",
        "restrictions": [
            AccountRestriction(
                restriction_id="RST-000008-001",
                type=RestrictionType.deposit_block,
                status=RestrictionStatus.active,
                reason="Deposits blocked because the linked payment method has been flagged for review.",
                applied_at="2026-03-26T13:00:00Z",
                expected_lift_at=None,
                can_self_resolve=True,
                resolution_steps=(
                    "Remove the flagged payment method and add a new verified bank account "
                    "or card under Settings > Payment Methods. Deposits will resume immediately."
                ),
            )
        ],
    },
    {
        "user_id": "USR-000019",
        "restrictions": [
            AccountRestriction(
                restriction_id="RST-000019-001",
                type=RestrictionType.deposit_block,
                status=RestrictionStatus.under_review,
                reason="Deposit channel temporarily suspended while an account review is ongoing.",
                applied_at="2026-03-31T08:00:00Z",
                expected_lift_at="2026-04-03T08:00:00Z",
                can_self_resolve=False,
            )
        ],
    },

    # ── Full freeze — AML / compliance (never share specifics) ────────────────
    {
        "user_id": "USR-000009",
        "restrictions": [
            AccountRestriction(
                restriction_id="RST-000009-001",
                type=RestrictionType.full_freeze,
                status=RestrictionStatus.under_review,
                reason="Your account has been temporarily frozen pending a compliance review.",
                applied_at="2026-03-20T00:00:00Z",
                expected_lift_at=None,
                can_self_resolve=False,
            )
        ],
    },
    {
        "user_id": "USR-000010",
        "restrictions": [
            AccountRestriction(
                restriction_id="RST-000010-001",
                type=RestrictionType.full_freeze,
                status=RestrictionStatus.under_review,
                reason="Account frozen as part of a regulatory review process.",
                applied_at="2026-03-22T00:00:00Z",
                expected_lift_at=None,
                can_self_resolve=False,
            )
        ],
    },
    {
        "user_id": "USR-000015",
        "restrictions": [
            AccountRestriction(
                restriction_id="RST-000015-001",
                type=RestrictionType.full_freeze,
                status=RestrictionStatus.active,
                reason="Account suspended following detection of unusual withdrawal patterns flagged by the AML monitoring system. A compliance specialist is reviewing the account.",
                applied_at="2026-02-14T11:00:00Z",
                expected_lift_at=None,
                can_self_resolve=False,
            )
        ],
    },
    {
        "user_id": "USR-000016",
        "restrictions": [
            AccountRestriction(
                restriction_id="RST-000016-001",
                type=RestrictionType.full_freeze,
                status=RestrictionStatus.active,
                reason="Account suspended after KYC documents were rejected due to mismatched identity information. Account access is blocked until KYC is successfully resubmitted and approved.",
                applied_at="2026-01-05T15:00:00Z",
                expected_lift_at=None,
                can_self_resolve=False,
            )
        ],
    },
    {
        "user_id": "USR-000020",
        "restrictions": [
            AccountRestriction(
                restriction_id="RST-000020-001",
                type=RestrictionType.full_freeze,
                status=RestrictionStatus.under_review,
                reason="Account frozen pending review of account funding documentation.",
                applied_at="2026-03-15T10:30:00Z",
                expected_lift_at=None,
                can_self_resolve=False,
            )
        ],
    },

    # ── Login block ───────────────────────────────────────────────────────────
    {
        "user_id": "USR-000013",
        "restrictions": [
            AccountRestriction(
                restriction_id="RST-000013-001",
                type=RestrictionType.login_block,
                status=RestrictionStatus.active,
                reason="Login temporarily blocked due to suspicious activity from an unrecognised location.",
                applied_at="2026-03-31T06:00:00Z",
                expected_lift_at=None,
                can_self_resolve=True,
                resolution_steps=(
                    "Reset your 2FA by tapping 'Forgot authenticator?' on the login screen. "
                    "You will need access to your registered email to complete verification. "
                    "Login will be restored immediately after the reset."
                ),
            )
        ],
    },
]

# ── Index ─────────────────────────────────────────────────────────────────────

_BY_ID: dict[str, AccountRestrictionsResponse] = {}

for _entry in _SEED:
    _uid = _entry["user_id"]
    _restrictions: list[AccountRestriction] = _entry["restrictions"]
    _has = len(_restrictions) > 0
    _trading_blocked = any(
        r.type in (RestrictionType.trading_block, RestrictionType.full_freeze)
        and r.status != RestrictionStatus.lifted
        for r in _restrictions
    )
    _trading_block_reason: str | None = None
    if _trading_blocked:
        _r = next(
            r for r in _restrictions
            if r.type in (RestrictionType.trading_block, RestrictionType.full_freeze)
            and r.status != RestrictionStatus.lifted
        )
        _trading_block_reason = _r.reason

    _BY_ID[_uid] = AccountRestrictionsResponse(
        user_id=_uid,
        has_restrictions=_has,
        restrictions=_restrictions,
        trading_available=not _trading_blocked,
        trading_block_reason=_trading_block_reason,
    )


def get_by_user_id(user_id: str) -> AccountRestrictionsResponse | None:
    return _BY_ID.get(user_id)
