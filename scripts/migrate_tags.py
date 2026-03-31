"""
Migration: create tags + ticket_tags tables and seed default tags.
Run once: python scripts/migrate_tags.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from db.conversation_store import _conn

SEED_TAGS = [
    "kyc-pending",
    "withdrawal-issue",
    "deposit-issue",
    "vip-followup",
    "fraud-flagged",
    "awaiting-docs",
    "2fa-reset",
]

DDL = """
CREATE TABLE IF NOT EXISTS ticket_tags (
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    tag_id    UUID NOT NULL REFERENCES tags(id)    ON DELETE CASCADE,
    PRIMARY KEY (ticket_id, tag_id)
);
"""

def run():
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute(DDL)
        for tag in SEED_TAGS:
            cur.execute(
                "INSERT INTO tags (id, name) VALUES (gen_random_uuid(), %s) ON CONFLICT (name) DO NOTHING",
                (tag,)
            )
        conn.commit()
    print(f"Migration done. Seeded {len(SEED_TAGS)} tags.")

if __name__ == "__main__":
    run()
