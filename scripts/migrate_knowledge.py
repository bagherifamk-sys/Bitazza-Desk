"""
Migration: create knowledge_items table.

Run once against your PostgreSQL database:
    python scripts/migrate_knowledge.py
"""
import os
import sys

import psycopg2
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL env var not set.", file=sys.stderr)
    sys.exit(1)

DDL = """
CREATE TABLE IF NOT EXISTS knowledge_items (
    id          SERIAL PRIMARY KEY,
    title       TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('url', 'pdf', 'docx')),
    source_ref  TEXT,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

conn = psycopg2.connect(DATABASE_URL)
try:
    with conn:
        with conn.cursor() as cur:
            cur.execute(DDL)
    print("knowledge_items table created (or already exists).")
finally:
    conn.close()
