"""
Mock trading & transaction history store.
Keyed by user_id. Paginated by the router.
"""
from __future__ import annotations
from engine.mock_api.models import (
    Transaction, TransactionType, TransactionStatus,
    SpotTrade, SpotSide, SpotOrderType, SpotOrderStatus,
    FuturesTrade, FuturesSide, FuturesStatus,
)

# ── helpers ──────────────────────────────────────────────────────────────────

def _tx(tid, typ, status, currency, amount, fee, network=None, tx_hash=None, bank_ref=None, created_at="2026-01-10T10:00:00Z", completed_at=None):
    return Transaction(
        transaction_id=tid, type=typ, status=status,
        currency=currency, amount=amount, fee=fee,
        network=network, tx_hash=tx_hash, bank_ref=bank_ref,
        created_at=created_at, completed_at=completed_at,
    )

def _spot(oid, symbol, side, otype, status, price, qty, filled, fee, fee_cur, created, updated):
    return SpotTrade(
        order_id=oid, symbol=symbol, side=side, order_type=otype, status=status,
        price=price, quantity=qty, filled_qty=filled, fee=fee, fee_currency=fee_cur,
        created_at=created, updated_at=updated,
    )

def _fut(pid, symbol, side, status, leverage, entry, exit_p, qty, pnl, fee, liq=None, created="2026-01-15T08:00:00Z", closed=None):
    return FuturesTrade(
        position_id=pid, symbol=symbol, side=side, status=status,
        leverage=leverage, entry_price=entry, exit_price=exit_p,
        quantity=qty, pnl=pnl, fee=fee, liquidation_price=liq,
        created_at=created, closed_at=closed,
    )

# ── Seed data per user ────────────────────────────────────────────────────────

_TRANSACTIONS: dict[str, list[Transaction]] = {
    "dev_user": [
        _tx("TXN-DEV-001", TransactionType.deposit, TransactionStatus.completed, "THB", 50000, 0, bank_ref="REF123456", created_at="2026-03-01T09:00:00Z", completed_at="2026-03-01T09:05:00Z"),
        _tx("TXN-DEV-002", TransactionType.withdrawal, TransactionStatus.pending, "BTC", 0.05, 0.0002, network="BTC", tx_hash=None, created_at="2026-03-20T14:00:00Z"),
        _tx("TXN-DEV-003", TransactionType.deposit, TransactionStatus.completed, "USDT", 1000, 1, network="TRC20", tx_hash="abc123def456", created_at="2026-02-15T11:00:00Z", completed_at="2026-02-15T11:10:00Z"),
    ],
    "USR-000001": [
        _tx("TXN-001-001", TransactionType.deposit, TransactionStatus.completed, "THB", 10000, 0, bank_ref="REF-A1001", created_at="2025-12-01T08:00:00Z", completed_at="2025-12-01T08:03:00Z"),
        _tx("TXN-001-002", TransactionType.deposit, TransactionStatus.completed, "BTC", 0.1, 0.0001, network="BTC", tx_hash="tx001abc", created_at="2026-01-05T10:00:00Z", completed_at="2026-01-05T10:30:00Z"),
        _tx("TXN-001-003", TransactionType.withdrawal, TransactionStatus.completed, "THB", 5000, 15, bank_ref="WD-A1001", created_at="2026-02-10T13:00:00Z", completed_at="2026-02-10T13:01:00Z"),
        _tx("TXN-001-004", TransactionType.withdrawal, TransactionStatus.failed, "USDT", 200, 1, network="ERC20", created_at="2026-03-01T09:00:00Z"),
    ],
    "USR-000002": [
        _tx("TXN-002-001", TransactionType.deposit, TransactionStatus.completed, "THB", 100000, 0, bank_ref="REF-B2001", created_at="2025-10-20T09:00:00Z", completed_at="2025-10-20T09:02:00Z"),
        _tx("TXN-002-002", TransactionType.deposit, TransactionStatus.completed, "ETH", 2.5, 0.002, network="ETH", tx_hash="tx002eth", created_at="2025-11-15T11:00:00Z", completed_at="2025-11-15T11:15:00Z"),
        _tx("TXN-002-003", TransactionType.withdrawal, TransactionStatus.completed, "BTC", 0.5, 0.0005, network="BTC", tx_hash="tx002btc_wd", created_at="2026-01-20T16:00:00Z", completed_at="2026-01-20T16:45:00Z"),
        _tx("TXN-002-004", TransactionType.deposit, TransactionStatus.completed, "USDT", 5000, 5, network="TRC20", tx_hash="tx002usdt", created_at="2026-02-28T10:00:00Z", completed_at="2026-02-28T10:08:00Z"),
        _tx("TXN-002-005", TransactionType.withdrawal, TransactionStatus.pending, "ETH", 1.0, 0.001, network="ETH", created_at="2026-03-25T14:00:00Z"),
    ],
    "USR-000003": [
        _tx("TXN-003-001", TransactionType.deposit, TransactionStatus.completed, "THB", 25000, 0, bank_ref="REF-C3001", created_at="2025-09-25T08:00:00Z", completed_at="2025-09-25T08:02:00Z"),
        _tx("TXN-003-002", TransactionType.withdrawal, TransactionStatus.completed, "THB", 10000, 30, bank_ref="WD-C3001", created_at="2026-01-10T10:00:00Z", completed_at="2026-01-10T10:01:00Z"),
        _tx("TXN-003-003", TransactionType.deposit, TransactionStatus.failed, "BTC", 0.2, 0.0002, network="BTC", created_at="2026-02-05T12:00:00Z"),
    ],
    "USR-000004": [
        _tx("TXN-004-001", TransactionType.deposit, TransactionStatus.completed, "THB", 500000, 0, bank_ref="REF-D4001", created_at="2025-08-10T09:00:00Z", completed_at="2025-08-10T09:01:00Z"),
        _tx("TXN-004-002", TransactionType.deposit, TransactionStatus.completed, "BTC", 2.0, 0.002, network="BTC", tx_hash="tx004btc", created_at="2025-09-01T11:00:00Z", completed_at="2025-09-01T11:30:00Z"),
        _tx("TXN-004-003", TransactionType.deposit, TransactionStatus.completed, "ETH", 10.0, 0.01, network="ETH", tx_hash="tx004eth", created_at="2025-10-15T10:00:00Z", completed_at="2025-10-15T10:20:00Z"),
        _tx("TXN-004-004", TransactionType.withdrawal, TransactionStatus.completed, "USDT", 20000, 20, network="TRC20", tx_hash="tx004usdt_wd", created_at="2026-01-30T14:00:00Z", completed_at="2026-01-30T14:10:00Z"),
        _tx("TXN-004-005", TransactionType.withdrawal, TransactionStatus.completed, "THB", 100000, 300, bank_ref="WD-D4001", created_at="2026-02-20T09:00:00Z", completed_at="2026-02-20T09:02:00Z"),
        _tx("TXN-004-006", TransactionType.deposit, TransactionStatus.completed, "USDT", 50000, 50, network="TRC20", tx_hash="tx004usdt2", created_at="2026-03-10T13:00:00Z", completed_at="2026-03-10T13:08:00Z"),
    ],
    "USR-000005": [
        _tx("TXN-005-001", TransactionType.deposit, TransactionStatus.completed, "THB", 5000, 0, bank_ref="REF-E5001", created_at="2026-01-15T10:00:00Z", completed_at="2026-01-15T10:03:00Z"),
        _tx("TXN-005-002", TransactionType.withdrawal, TransactionStatus.cancelled, "THB", 3000, 9, bank_ref="WD-E5001", created_at="2026-02-01T11:00:00Z"),
    ],
    "USR-000006": [
        _tx("TXN-006-001", TransactionType.deposit, TransactionStatus.completed, "THB", 8000, 0, bank_ref="REF-F6001", created_at="2025-12-20T08:00:00Z", completed_at="2025-12-20T08:02:00Z"),
        _tx("TXN-006-002", TransactionType.deposit, TransactionStatus.completed, "USDT", 500, 0.5, network="TRC20", tx_hash="tx006usdt", created_at="2026-01-25T09:00:00Z", completed_at="2026-01-25T09:05:00Z"),
        _tx("TXN-006-003", TransactionType.withdrawal, TransactionStatus.failed, "USDT", 300, 0.3, network="TRC20", created_at="2026-03-05T15:00:00Z"),
    ],
    "USR-000007": [
        _tx("TXN-007-001", TransactionType.deposit, TransactionStatus.completed, "THB", 200000, 0, bank_ref="REF-G7001", created_at="2025-11-01T10:00:00Z", completed_at="2025-11-01T10:01:00Z"),
        _tx("TXN-007-002", TransactionType.deposit, TransactionStatus.completed, "BTC", 1.0, 0.001, network="BTC", tx_hash="tx007btc", created_at="2025-12-15T11:00:00Z", completed_at="2025-12-15T11:40:00Z"),
        _tx("TXN-007-003", TransactionType.withdrawal, TransactionStatus.completed, "BTC", 0.3, 0.0003, network="BTC", tx_hash="tx007btc_wd", created_at="2026-02-01T14:00:00Z", completed_at="2026-02-01T14:50:00Z"),
        _tx("TXN-007-004", TransactionType.withdrawal, TransactionStatus.pending, "THB", 50000, 150, bank_ref="WD-G7001", created_at="2026-03-28T09:00:00Z"),
    ],
    "USR-000008": [
        _tx("TXN-008-001", TransactionType.deposit, TransactionStatus.completed, "THB", 3000, 0, bank_ref="REF-H8001", created_at="2026-02-10T08:00:00Z", completed_at="2026-02-10T08:03:00Z"),
    ],
    "USR-000009": [
        _tx("TXN-009-001", TransactionType.deposit, TransactionStatus.completed, "THB", 15000, 0, bank_ref="REF-I9001", created_at="2026-03-01T09:00:00Z", completed_at="2026-03-01T09:02:00Z"),
        _tx("TXN-009-002", TransactionType.withdrawal, TransactionStatus.pending, "USDT", 1000, 1, network="TRC20", created_at="2026-03-22T14:00:00Z"),
    ],
    "USR-000010": [
        _tx("TXN-010-001", TransactionType.deposit, TransactionStatus.completed, "THB", 75000, 0, bank_ref="REF-J10001", created_at="2025-10-01T10:00:00Z", completed_at="2025-10-01T10:01:00Z"),
        _tx("TXN-010-002", TransactionType.deposit, TransactionStatus.completed, "ETH", 3.0, 0.003, network="ETH", tx_hash="tx010eth", created_at="2025-12-10T11:00:00Z", completed_at="2025-12-10T11:18:00Z"),
        _tx("TXN-010-003", TransactionType.withdrawal, TransactionStatus.completed, "THB", 20000, 60, bank_ref="WD-J10001", created_at="2026-01-15T13:00:00Z", completed_at="2026-01-15T13:01:00Z"),
        _tx("TXN-010-004", TransactionType.withdrawal, TransactionStatus.failed, "BTC", 0.1, 0.0001, network="BTC", created_at="2026-03-20T10:00:00Z"),
    ],
    "USR-000011": [
        _tx("TXN-011-001", TransactionType.deposit, TransactionStatus.completed, "THB", 20000, 0, bank_ref="REF-K11001", created_at="2026-01-20T09:00:00Z", completed_at="2026-01-20T09:02:00Z"),
        _tx("TXN-011-002", TransactionType.deposit, TransactionStatus.completed, "USDT", 800, 0.8, network="TRC20", tx_hash="tx011usdt", created_at="2026-02-15T10:00:00Z", completed_at="2026-02-15T10:06:00Z"),
        _tx("TXN-011-003", TransactionType.withdrawal, TransactionStatus.completed, "USDT", 500, 0.5, network="TRC20", tx_hash="tx011usdt_wd", created_at="2026-03-05T14:00:00Z", completed_at="2026-03-05T14:07:00Z"),
    ],
    "USR-000012": [
        _tx("TXN-012-001", TransactionType.deposit, TransactionStatus.completed, "THB", 40000, 0, bank_ref="REF-L12001", created_at="2025-11-20T08:00:00Z", completed_at="2025-11-20T08:02:00Z"),
        _tx("TXN-012-002", TransactionType.deposit, TransactionStatus.completed, "BTC", 0.5, 0.0005, network="BTC", tx_hash="tx012btc", created_at="2026-01-10T11:00:00Z", completed_at="2026-01-10T11:35:00Z"),
        _tx("TXN-012-003", TransactionType.withdrawal, TransactionStatus.pending, "BTC", 0.2, 0.0002, network="BTC", created_at="2026-03-26T09:00:00Z"),
    ],
    "USR-000013": [],
    "USR-000014": [
        _tx("TXN-014-001", TransactionType.deposit, TransactionStatus.completed, "THB", 2000, 0, bank_ref="REF-N14001", created_at="2026-03-15T10:00:00Z", completed_at="2026-03-15T10:03:00Z"),
    ],
    "USR-000015": [
        _tx("TXN-015-001", TransactionType.deposit, TransactionStatus.completed, "THB", 12000, 0, bank_ref="REF-O15001", created_at="2026-01-05T09:00:00Z", completed_at="2026-01-05T09:02:00Z"),
        _tx("TXN-015-002", TransactionType.withdrawal, TransactionStatus.cancelled, "THB", 8000, 24, bank_ref="WD-O15001", created_at="2026-02-14T11:30:00Z"),
    ],
    "USR-000016": [
        _tx("TXN-016-001", TransactionType.deposit, TransactionStatus.completed, "THB", 300000, 0, bank_ref="REF-P16001", created_at="2025-12-01T10:00:00Z", completed_at="2025-12-01T10:01:00Z"),
        _tx("TXN-016-002", TransactionType.deposit, TransactionStatus.completed, "BTC", 3.0, 0.003, network="BTC", tx_hash="tx016btc", created_at="2026-01-05T11:00:00Z", completed_at="2026-01-05T11:45:00Z"),
        _tx("TXN-016-003", TransactionType.withdrawal, TransactionStatus.pending, "BTC", 1.5, 0.0015, network="BTC", created_at="2026-01-05T12:00:00Z"),
    ],
    "USR-000017": [
        _tx("TXN-017-001", TransactionType.deposit, TransactionStatus.completed, "THB", 6000, 0, bank_ref="REF-Q17001", created_at="2023-08-01T09:00:00Z", completed_at="2023-08-01T09:02:00Z"),
        _tx("TXN-017-002", TransactionType.withdrawal, TransactionStatus.completed, "THB", 3000, 9, bank_ref="WD-Q17001", created_at="2023-09-10T10:00:00Z", completed_at="2023-09-10T10:01:00Z"),
    ],
    "USR-000018": [
        _tx("TXN-018-001", TransactionType.deposit, TransactionStatus.completed, "THB", 30000, 0, bank_ref="REF-R18001", created_at="2023-06-15T10:00:00Z", completed_at="2023-06-15T10:02:00Z"),
        _tx("TXN-018-002", TransactionType.deposit, TransactionStatus.completed, "ETH", 1.0, 0.001, network="ETH", tx_hash="tx018eth", created_at="2023-09-20T11:00:00Z", completed_at="2023-09-20T11:12:00Z"),
        _tx("TXN-018-003", TransactionType.withdrawal, TransactionStatus.completed, "ETH", 0.5, 0.0005, network="ETH", tx_hash="tx018eth_wd", created_at="2024-01-10T14:00:00Z", completed_at="2024-01-10T14:15:00Z"),
    ],
    "USR-000019": [
        _tx("TXN-019-001", TransactionType.deposit, TransactionStatus.completed, "THB", 1000000, 0, bank_ref="REF-S19001", created_at="2026-01-05T09:00:00Z", completed_at="2026-01-05T09:01:00Z"),
        _tx("TXN-019-002", TransactionType.deposit, TransactionStatus.completed, "BTC", 5.0, 0.005, network="BTC", tx_hash="tx019btc", created_at="2026-01-20T10:00:00Z", completed_at="2026-01-20T10:50:00Z"),
        _tx("TXN-019-003", TransactionType.deposit, TransactionStatus.completed, "ETH", 20.0, 0.02, network="ETH", tx_hash="tx019eth", created_at="2026-02-01T11:00:00Z", completed_at="2026-02-01T11:20:00Z"),
        _tx("TXN-019-004", TransactionType.withdrawal, TransactionStatus.completed, "USDT", 100000, 100, network="TRC20", tx_hash="tx019usdt_wd", created_at="2026-02-15T14:00:00Z", completed_at="2026-02-15T14:10:00Z"),
        _tx("TXN-019-005", TransactionType.withdrawal, TransactionStatus.pending, "BTC", 2.0, 0.002, network="BTC", created_at="2026-03-28T09:00:00Z"),
    ],
    "USR-000020": [
        _tx("TXN-020-001", TransactionType.deposit, TransactionStatus.completed, "THB", 500000, 0, bank_ref="REF-T20001", created_at="2026-01-10T10:00:00Z", completed_at="2026-01-10T10:01:00Z"),
        _tx("TXN-020-002", TransactionType.deposit, TransactionStatus.completed, "BTC", 4.0, 0.004, network="BTC", tx_hash="tx020btc", created_at="2026-02-05T11:00:00Z", completed_at="2026-02-05T11:45:00Z"),
        _tx("TXN-020-003", TransactionType.withdrawal, TransactionStatus.completed, "THB", 200000, 600, bank_ref="WD-T20001", created_at="2026-03-10T09:00:00Z", completed_at="2026-03-10T09:02:00Z"),
        _tx("TXN-020-004", TransactionType.withdrawal, TransactionStatus.failed, "BTC", 1.0, 0.001, network="BTC", created_at="2026-03-15T14:00:00Z"),
    ],
}

_SPOT_TRADES: dict[str, list[SpotTrade]] = {
    "dev_user": [
        _spot("SPT-DEV-001", "BTC/THB", SpotSide.buy, SpotOrderType.limit, SpotOrderStatus.filled, 1800000, 0.05, 0.05, 90, "THB", "2026-02-01T10:00:00Z", "2026-02-01T10:05:00Z"),
        _spot("SPT-DEV-002", "ETH/THB", SpotSide.sell, SpotOrderType.market, SpotOrderStatus.filled, 95000, 1.0, 1.0, 95, "THB", "2026-03-10T14:00:00Z", "2026-03-10T14:00:01Z"),
    ],
    "USR-000001": [
        _spot("SPT-001-001", "BTC/THB", SpotSide.buy, SpotOrderType.limit, SpotOrderStatus.filled, 1750000, 0.1, 0.1, 175, "THB", "2026-01-06T09:00:00Z", "2026-01-06T09:30:00Z"),
        _spot("SPT-001-002", "XRP/THB", SpotSide.buy, SpotOrderType.market, SpotOrderStatus.filled, 18, 500, 500, 9, "THB", "2026-02-20T11:00:00Z", "2026-02-20T11:00:01Z"),
        _spot("SPT-001-003", "BTC/THB", SpotSide.sell, SpotOrderType.limit, SpotOrderStatus.cancelled, 1900000, 0.05, 0, 0, "THB", "2026-03-01T10:00:00Z", "2026-03-05T10:00:00Z"),
    ],
    "USR-000002": [
        _spot("SPT-002-001", "BTC/THB", SpotSide.buy, SpotOrderType.limit, SpotOrderStatus.filled, 1600000, 0.5, 0.5, 800, "THB", "2025-11-16T09:00:00Z", "2025-11-16T09:20:00Z"),
        _spot("SPT-002-002", "ETH/THB", SpotSide.buy, SpotOrderType.market, SpotOrderStatus.filled, 90000, 2.0, 2.0, 180, "THB", "2025-12-01T11:00:00Z", "2025-12-01T11:00:02Z"),
        _spot("SPT-002-003", "SOL/USDT", SpotSide.buy, SpotOrderType.limit, SpotOrderStatus.filled, 120, 10, 10, 1.2, "USDT", "2026-01-10T10:00:00Z", "2026-01-10T10:15:00Z"),
        _spot("SPT-002-004", "BTC/THB", SpotSide.sell, SpotOrderType.limit, SpotOrderStatus.filled, 1850000, 0.3, 0.3, 555, "THB", "2026-02-10T14:00:00Z", "2026-02-10T14:25:00Z"),
        _spot("SPT-002-005", "ETH/USDT", SpotSide.sell, SpotOrderType.market, SpotOrderStatus.filled, 2800, 1.5, 1.5, 4.2, "USDT", "2026-03-20T09:00:00Z", "2026-03-20T09:00:01Z"),
    ],
    "USR-000003": [
        _spot("SPT-003-001", "BTC/THB", SpotSide.buy, SpotOrderType.limit, SpotOrderStatus.filled, 1680000, 0.2, 0.2, 336, "THB", "2025-10-01T10:00:00Z", "2025-10-01T10:40:00Z"),
        _spot("SPT-003-002", "ETH/THB", SpotSide.sell, SpotOrderType.limit, SpotOrderStatus.partially_filled, 95000, 1.0, 0.6, 57, "THB", "2026-03-15T10:00:00Z", "2026-03-15T11:00:00Z"),
    ],
    "USR-000004": [
        _spot("SPT-004-001", "BTC/THB", SpotSide.buy, SpotOrderType.limit, SpotOrderStatus.filled, 1500000, 2.0, 2.0, 3000, "THB", "2025-08-15T09:00:00Z", "2025-08-15T09:50:00Z"),
        _spot("SPT-004-002", "ETH/THB", SpotSide.buy, SpotOrderType.market, SpotOrderStatus.filled, 85000, 10.0, 10.0, 850, "THB", "2025-09-05T11:00:00Z", "2025-09-05T11:00:03Z"),
        _spot("SPT-004-003", "SOL/USDT", SpotSide.buy, SpotOrderType.limit, SpotOrderStatus.filled, 100, 50, 50, 5, "USDT", "2025-10-20T10:00:00Z", "2025-10-20T10:10:00Z"),
        _spot("SPT-004-004", "BTC/THB", SpotSide.sell, SpotOrderType.limit, SpotOrderStatus.filled, 1750000, 1.0, 1.0, 1750, "THB", "2026-01-05T14:00:00Z", "2026-01-05T14:30:00Z"),
        _spot("SPT-004-005", "ETH/USDT", SpotSide.buy, SpotOrderType.limit, SpotOrderStatus.open, 2500, 3.0, 0, 0, "USDT", "2026-03-15T09:00:00Z", "2026-03-15T09:00:00Z"),
        _spot("SPT-004-006", "BNB/USDT", SpotSide.buy, SpotOrderType.market, SpotOrderStatus.filled, 380, 5, 5, 1.9, "USDT", "2026-03-25T11:00:00Z", "2026-03-25T11:00:01Z"),
    ],
    "USR-000005": [],
    "USR-000006": [
        _spot("SPT-006-001", "BTC/THB", SpotSide.buy, SpotOrderType.market, SpotOrderStatus.filled, 1720000, 0.02, 0.02, 34.4, "THB", "2026-01-26T10:00:00Z", "2026-01-26T10:00:02Z"),
    ],
    "USR-000007": [
        _spot("SPT-007-001", "BTC/THB", SpotSide.buy, SpotOrderType.limit, SpotOrderStatus.filled, 1650000, 1.0, 1.0, 1650, "THB", "2025-12-16T09:00:00Z", "2025-12-16T09:40:00Z"),
        _spot("SPT-007-002", "ETH/THB", SpotSide.buy, SpotOrderType.market, SpotOrderStatus.filled, 92000, 3.0, 3.0, 276, "THB", "2026-01-20T11:00:00Z", "2026-01-20T11:00:02Z"),
        _spot("SPT-007-003", "BTC/THB", SpotSide.sell, SpotOrderType.limit, SpotOrderStatus.filled, 1800000, 0.3, 0.3, 540, "THB", "2026-02-05T14:00:00Z", "2026-02-05T14:20:00Z"),
    ],
    "USR-000008": [],
    "USR-000009": [
        _spot("SPT-009-001", "XRP/THB", SpotSide.buy, SpotOrderType.market, SpotOrderStatus.filled, 17, 1000, 1000, 17, "THB", "2026-03-02T10:00:00Z", "2026-03-02T10:00:01Z"),
    ],
    "USR-000010": [
        _spot("SPT-010-001", "ETH/THB", SpotSide.buy, SpotOrderType.limit, SpotOrderStatus.filled, 88000, 3.0, 3.0, 264, "THB", "2025-12-11T10:00:00Z", "2025-12-11T10:20:00Z"),
        _spot("SPT-010-002", "BTC/USDT", SpotSide.buy, SpotOrderType.limit, SpotOrderStatus.filled, 42000, 0.1, 0.1, 4.2, "USDT", "2026-01-05T09:00:00Z", "2026-01-05T09:35:00Z"),
        _spot("SPT-010-003", "ETH/THB", SpotSide.sell, SpotOrderType.market, SpotOrderStatus.filled, 93000, 2.0, 2.0, 186, "THB", "2026-02-20T14:00:00Z", "2026-02-20T14:00:01Z"),
    ],
    "USR-000011": [
        _spot("SPT-011-001", "BTC/THB", SpotSide.buy, SpotOrderType.market, SpotOrderStatus.filled, 1780000, 0.02, 0.02, 35.6, "THB", "2026-02-16T11:00:00Z", "2026-02-16T11:00:01Z"),
        _spot("SPT-011-002", "USDT/THB", SpotSide.sell, SpotOrderType.limit, SpotOrderStatus.filled, 34.5, 400, 400, 13.8, "THB", "2026-03-06T10:00:00Z", "2026-03-06T10:05:00Z"),
    ],
    "USR-000012": [
        _spot("SPT-012-001", "BTC/THB", SpotSide.buy, SpotOrderType.limit, SpotOrderStatus.filled, 1700000, 0.5, 0.5, 850, "THB", "2026-01-11T10:00:00Z", "2026-01-11T10:40:00Z"),
        _spot("SPT-012-002", "ETH/THB", SpotSide.buy, SpotOrderType.market, SpotOrderStatus.filled, 89000, 1.5, 1.5, 133.5, "THB", "2026-02-01T11:00:00Z", "2026-02-01T11:00:02Z"),
        _spot("SPT-012-003", "BTC/THB", SpotSide.sell, SpotOrderType.limit, SpotOrderStatus.open, 1950000, 0.2, 0, 0, "THB", "2026-03-26T09:00:00Z", "2026-03-26T09:00:00Z"),
    ],
    "USR-000013": [],
    "USR-000014": [],
    "USR-000015": [
        _spot("SPT-015-001", "XRP/THB", SpotSide.buy, SpotOrderType.market, SpotOrderStatus.filled, 16, 2000, 2000, 32, "THB", "2026-01-06T09:00:00Z", "2026-01-06T09:00:01Z"),
    ],
    "USR-000016": [
        _spot("SPT-016-001", "BTC/THB", SpotSide.buy, SpotOrderType.limit, SpotOrderStatus.filled, 1620000, 3.0, 3.0, 4860, "THB", "2025-12-05T10:00:00Z", "2025-12-05T10:45:00Z"),
        _spot("SPT-016-002", "ETH/THB", SpotSide.buy, SpotOrderType.market, SpotOrderStatus.filled, 91000, 5.0, 5.0, 455, "THB", "2026-01-07T11:00:00Z", "2026-01-07T11:00:02Z"),
        _spot("SPT-016-003", "BTC/THB", SpotSide.sell, SpotOrderType.limit, SpotOrderStatus.partially_filled, 1900000, 2.0, 0.8, 1520, "THB", "2026-01-08T09:00:00Z", "2026-01-08T12:00:00Z"),
    ],
    "USR-000017": [
        _spot("SPT-017-001", "ETH/THB", SpotSide.buy, SpotOrderType.limit, SpotOrderStatus.filled, 80000, 0.5, 0.5, 40, "THB", "2023-08-05T10:00:00Z", "2023-08-05T10:20:00Z"),
    ],
    "USR-000018": [
        _spot("SPT-018-001", "ETH/THB", SpotSide.buy, SpotOrderType.market, SpotOrderStatus.filled, 82000, 1.0, 1.0, 82, "THB", "2023-09-21T10:00:00Z", "2023-09-21T10:00:02Z"),
        _spot("SPT-018-002", "BTC/USDT", SpotSide.buy, SpotOrderType.limit, SpotOrderStatus.filled, 28000, 0.05, 0.05, 1.4, "USDT", "2023-12-01T11:00:00Z", "2023-12-01T11:30:00Z"),
        _spot("SPT-018-003", "ETH/USDT", SpotSide.sell, SpotOrderType.market, SpotOrderStatus.filled, 2200, 0.5, 0.5, 1.1, "USDT", "2024-01-12T14:00:00Z", "2024-01-12T14:00:01Z"),
    ],
    "USR-000019": [
        _spot("SPT-019-001", "BTC/THB", SpotSide.buy, SpotOrderType.limit, SpotOrderStatus.filled, 1720000, 5.0, 5.0, 8600, "THB", "2026-01-22T10:00:00Z", "2026-01-22T10:50:00Z"),
        _spot("SPT-019-002", "ETH/THB", SpotSide.buy, SpotOrderType.market, SpotOrderStatus.filled, 91000, 20.0, 20.0, 1820, "THB", "2026-02-02T11:00:00Z", "2026-02-02T11:00:03Z"),
        _spot("SPT-019-003", "SOL/USDT", SpotSide.buy, SpotOrderType.limit, SpotOrderStatus.filled, 115, 100, 100, 11.5, "USDT", "2026-02-20T09:00:00Z", "2026-02-20T09:10:00Z"),
        _spot("SPT-019-004", "BTC/THB", SpotSide.sell, SpotOrderType.limit, SpotOrderStatus.filled, 1870000, 3.0, 3.0, 5610, "THB", "2026-03-01T14:00:00Z", "2026-03-01T14:30:00Z"),
        _spot("SPT-019-005", "ETH/USDT", SpotSide.buy, SpotOrderType.limit, SpotOrderStatus.open, 2600, 5.0, 0, 0, "USDT", "2026-03-29T09:00:00Z", "2026-03-29T09:00:00Z"),
    ],
    "USR-000020": [
        _spot("SPT-020-001", "BTC/THB", SpotSide.buy, SpotOrderType.limit, SpotOrderStatus.filled, 1710000, 4.0, 4.0, 6840, "THB", "2026-02-06T10:00:00Z", "2026-02-06T10:45:00Z"),
        _spot("SPT-020-002", "ETH/USDT", SpotSide.buy, SpotOrderType.market, SpotOrderStatus.filled, 2750, 10.0, 10.0, 27.5, "USDT", "2026-02-20T11:00:00Z", "2026-02-20T11:00:02Z"),
        _spot("SPT-020-003", "BTC/THB", SpotSide.sell, SpotOrderType.limit, SpotOrderStatus.cancelled, 1950000, 2.0, 0, 0, "THB", "2026-03-16T09:00:00Z", "2026-03-18T09:00:00Z"),
    ],
}

_FUTURES_TRADES: dict[str, list[FuturesTrade]] = {
    "dev_user": [
        _fut("FUT-DEV-001", "BTCUSDT-PERP", FuturesSide.long, FuturesStatus.closed, 10, 42000, 45000, 0.1, 300, 4.2, liq=38000, created="2026-02-05T10:00:00Z", closed="2026-02-10T14:00:00Z"),
    ],
    "USR-000001": [],
    "USR-000002": [
        _fut("FUT-002-001", "BTCUSDT-PERP", FuturesSide.long, FuturesStatus.closed, 5, 40000, 44000, 0.2, 800, 4.0, liq=36000, created="2025-12-01T10:00:00Z", closed="2025-12-15T14:00:00Z"),
        _fut("FUT-002-002", "ETHUSDT-PERP", FuturesSide.short, FuturesStatus.closed, 3, 2800, 2500, 1.0, 300, 0.84, liq=3200, created="2026-01-10T09:00:00Z", closed="2026-01-20T11:00:00Z"),
        _fut("FUT-002-003", "BTCUSDT-PERP", FuturesSide.long, FuturesStatus.open, 10, 43000, None, 0.1, None, 4.3, liq=38700, created="2026-03-25T09:00:00Z"),
    ],
    "USR-000003": [
        _fut("FUT-003-001", "BTCUSDT-PERP", FuturesSide.short, FuturesStatus.liquidated, 20, 35000, 40000, 0.05, -500, 3.5, liq=40000, created="2026-01-15T10:00:00Z", closed="2026-01-20T08:00:00Z"),
    ],
    "USR-000004": [
        _fut("FUT-004-001", "BTCUSDT-PERP", FuturesSide.long, FuturesStatus.closed, 5, 38000, 43000, 1.0, 5000, 38, liq=34000, created="2025-09-10T10:00:00Z", closed="2025-10-01T14:00:00Z"),
        _fut("FUT-004-002", "ETHUSDT-PERP", FuturesSide.long, FuturesStatus.closed, 10, 2500, 2900, 5.0, 2000, 25, liq=2200, created="2025-11-01T09:00:00Z", closed="2025-11-20T11:00:00Z"),
        _fut("FUT-004-003", "SOLUSDT-PERP", FuturesSide.short, FuturesStatus.closed, 5, 140, 110, 20, 600, 14, liq=162, created="2026-01-05T10:00:00Z", closed="2026-01-25T14:00:00Z"),
        _fut("FUT-004-004", "BTCUSDT-PERP", FuturesSide.long, FuturesStatus.open, 3, 44000, None, 0.5, None, 22, liq=40000, created="2026-03-20T09:00:00Z"),
    ],
    "USR-000005": [],
    "USR-000006": [],
    "USR-000007": [
        _fut("FUT-007-001", "BTCUSDT-PERP", FuturesSide.long, FuturesStatus.closed, 10, 41000, 46000, 0.3, 1500, 12.3, liq=36900, created="2026-01-05T10:00:00Z", closed="2026-02-10T14:00:00Z"),
        _fut("FUT-007-002", "ETHUSDT-PERP", FuturesSide.short, FuturesStatus.closed, 5, 2900, 2600, 2.0, 600, 5.8, liq=3335, created="2026-02-15T09:00:00Z", closed="2026-03-01T11:00:00Z"),
    ],
    "USR-000008": [],
    "USR-000009": [],
    "USR-000010": [
        _fut("FUT-010-001", "BTCUSDT-PERP", FuturesSide.short, FuturesStatus.liquidated, 15, 44000, 47500, 0.1, -525, 6.6, liq=47500, created="2026-03-01T10:00:00Z", closed="2026-03-22T09:00:00Z"),
    ],
    "USR-000011": [],
    "USR-000012": [
        _fut("FUT-012-001", "BTCUSDT-PERP", FuturesSide.long, FuturesStatus.open, 5, 44500, None, 0.1, None, 4.45, liq=40000, created="2026-03-27T09:00:00Z"),
    ],
    "USR-000013": [],
    "USR-000014": [],
    "USR-000015": [],
    "USR-000016": [
        _fut("FUT-016-001", "BTCUSDT-PERP", FuturesSide.long, FuturesStatus.closed, 20, 39000, 41000, 1.0, 2000, 39, liq=35100, created="2025-12-10T10:00:00Z", closed="2026-01-05T11:00:00Z"),
        _fut("FUT-016-002", "ETHUSDT-PERP", FuturesSide.short, FuturesStatus.liquidated, 25, 3000, 3200, 2.0, -400, 60, liq=3240, created="2026-01-08T09:00:00Z", closed="2026-01-08T15:00:00Z"),
    ],
    "USR-000017": [],
    "USR-000018": [],
    "USR-000019": [
        _fut("FUT-019-001", "BTCUSDT-PERP", FuturesSide.long, FuturesStatus.closed, 5, 41000, 47000, 2.0, 12000, 82, liq=37000, created="2026-01-25T10:00:00Z", closed="2026-02-28T14:00:00Z"),
        _fut("FUT-019-002", "ETHUSDT-PERP", FuturesSide.long, FuturesStatus.closed, 10, 2700, 2950, 5.0, 1250, 27, liq=2430, created="2026-02-05T09:00:00Z", closed="2026-03-10T11:00:00Z"),
        _fut("FUT-019-003", "SOLUSDT-PERP", FuturesSide.long, FuturesStatus.open, 5, 130, None, 50, None, 6.5, liq=117, created="2026-03-25T09:00:00Z"),
    ],
    "USR-000020": [
        _fut("FUT-020-001", "BTCUSDT-PERP", FuturesSide.long, FuturesStatus.closed, 10, 42500, 44000, 1.0, 1500, 42.5, liq=38250, created="2026-02-10T10:00:00Z", closed="2026-03-05T14:00:00Z"),
        _fut("FUT-020-002", "BTCUSDT-PERP", FuturesSide.short, FuturesStatus.open, 5, 45000, None, 0.5, None, 22.5, liq=49500, created="2026-03-20T09:00:00Z"),
    ],
}


def get_transactions(user_id: str, page: int = 1, page_size: int = 20) -> list[Transaction]:
    items = _TRANSACTIONS.get(user_id, [])
    start = (page - 1) * page_size
    return items[start:start + page_size]

def get_transaction_count(user_id: str) -> int:
    return len(_TRANSACTIONS.get(user_id, []))

def get_spot_trades(user_id: str, page: int = 1, page_size: int = 20) -> list[SpotTrade]:
    items = _SPOT_TRADES.get(user_id, [])
    start = (page - 1) * page_size
    return items[start:start + page_size]

def get_spot_count(user_id: str) -> int:
    return len(_SPOT_TRADES.get(user_id, []))

def get_futures_trades(user_id: str, page: int = 1, page_size: int = 20) -> list[FuturesTrade]:
    items = _FUTURES_TRADES.get(user_id, [])
    start = (page - 1) * page_size
    return items[start:start + page_size]

def get_futures_count(user_id: str) -> int:
    return len(_FUTURES_TRADES.get(user_id, []))
