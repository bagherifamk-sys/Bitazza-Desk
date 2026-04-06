"""
Mock balance store — holdings per user.
Currencies: THB, USDT, BTC, ETH, XRP, SOL, BNB, ADA
"""
from __future__ import annotations
from engine.mock_api.models import Balance, BalancesResponse

_SEED: dict[str, list[Balance]] = {
    "dev_user": [
        Balance(currency="THB",  available=25000,    locked=0),
        Balance(currency="BTC",  available=0.03,     locked=0.05),
        Balance(currency="USDT", available=850,      locked=0),
        Balance(currency="ETH",  available=0.5,      locked=0),
    ],
    "USR-000001": [
        Balance(currency="THB",  available=5200,     locked=0),
        Balance(currency="BTC",  available=0.08,     locked=0),
        Balance(currency="XRP",  available=480,      locked=0),
    ],
    "USR-000002": [
        Balance(currency="THB",  available=42000,    locked=0),
        Balance(currency="BTC",  available=0.22,     locked=0),
        Balance(currency="ETH",  available=0.95,     locked=0),
        Balance(currency="USDT", available=3200,     locked=0),
        Balance(currency="SOL",  available=10,       locked=0),
    ],
    "USR-000003": [
        Balance(currency="THB",  available=14500,    locked=0),
        Balance(currency="BTC",  available=0.0,      locked=0),
        Balance(currency="ETH",  available=0.4,      locked=0.6),
    ],
    "USR-000004": [
        Balance(currency="THB",  available=380000,   locked=0),
        Balance(currency="BTC",  available=1.0,      locked=0),
        Balance(currency="ETH",  available=7.5,      locked=3.0),
        Balance(currency="USDT", available=28000,    locked=0),
        Balance(currency="SOL",  available=50,       locked=0),
        Balance(currency="BNB",  available=5,        locked=0),
    ],
    "USR-000005": [
        Balance(currency="THB",  available=1800,     locked=0),
    ],
    "USR-000006": [
        Balance(currency="THB",  available=7200,     locked=0),
        Balance(currency="USDT", available=195,      locked=0),
        Balance(currency="BTC",  available=0.018,    locked=0),
    ],
    "USR-000007": [
        Balance(currency="THB",  available=95000,    locked=0),
        Balance(currency="BTC",  available=0.7,      locked=0),
        Balance(currency="ETH",  available=3.0,      locked=0),
    ],
    "USR-000008": [
        Balance(currency="THB",  available=3000,     locked=0),
    ],
    "USR-000009": [
        Balance(currency="THB",  available=13500,    locked=0),
        Balance(currency="USDT", available=0,        locked=1000),
        Balance(currency="XRP",  available=1000,     locked=0),
    ],
    "USR-000010": [
        Balance(currency="THB",  available=38000,    locked=0),
        Balance(currency="ETH",  available=1.0,      locked=0),
        Balance(currency="BTC",  available=0.05,     locked=0),
    ],
    "USR-000011": [
        Balance(currency="THB",  available=18500,    locked=0),
        Balance(currency="USDT", available=290,      locked=500),
        Balance(currency="BTC",  available=0.02,     locked=0),
    ],
    "USR-000012": [
        Balance(currency="THB",  available=22000,    locked=0),
        Balance(currency="BTC",  available=0.3,      locked=0.2),
        Balance(currency="ETH",  available=1.5,      locked=0),
    ],
    "USR-000013": [
        Balance(currency="THB",  available=0,        locked=0),
    ],
    "USR-000014": [
        Balance(currency="THB",  available=2000,     locked=0),
    ],
    "USR-000015": [
        Balance(currency="THB",  available=3200,     locked=0),
        Balance(currency="XRP",  available=1800,     locked=0),
    ],
    "USR-000016": [
        Balance(currency="THB",  available=220000,   locked=0),
        Balance(currency="BTC",  available=1.5,      locked=1.5),
        Balance(currency="ETH",  available=5.0,      locked=0),
    ],
    "USR-000017": [
        Balance(currency="THB",  available=2800,     locked=0),
        Balance(currency="ETH",  available=0.5,      locked=0),
    ],
    "USR-000018": [
        Balance(currency="THB",  available=18000,    locked=0),
        Balance(currency="ETH",  available=0.5,      locked=0),
        Balance(currency="BTC",  available=0.03,     locked=0),
    ],
    "USR-000019": [
        Balance(currency="THB",  available=650000,   locked=0),
        Balance(currency="BTC",  available=2.0,      locked=0),
        Balance(currency="ETH",  available=15.0,     locked=0),
        Balance(currency="USDT", available=45000,    locked=0),
        Balance(currency="SOL",  available=50,       locked=0),
        Balance(currency="BNB",  available=20,       locked=0),
    ],
    "USR-000020": [
        Balance(currency="THB",  available=180000,   locked=0),
        Balance(currency="BTC",  available=3.0,      locked=0),
        Balance(currency="ETH",  available=10.0,     locked=0),
        Balance(currency="USDT", available=12000,    locked=0),
    ],
}

# approximate THB value rates for portfolio valuation
_THB_RATES: dict[str, float] = {
    "THB":  1.0,
    "USDT": 34.5,
    "BTC":  1_800_000.0,
    "ETH":  92_000.0,
    "XRP":  17.0,
    "SOL":  4_200.0,
    "BNB":  13_800.0,
    "ADA":  16.0,
}

def get_balances(user_id: str) -> BalancesResponse:
    items = _SEED.get(user_id, [])
    # filter out zero balances (available + locked == 0)
    items = [b for b in items if b.available + b.locked > 0]
    return BalancesResponse(user_id=user_id, balances=items)

def get_thb_rate(currency: str) -> float:
    return _THB_RATES.get(currency, 0.0)
