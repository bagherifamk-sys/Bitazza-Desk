"""
Re-index all ChromaDB chunks using Gemini embeddings.

Must be run after switching vector_store.py from word-hash to Gemini embedding.
It reads every existing document + metadata from ChromaDB and re-upserts them
so they get re-embedded with the new model.

Usage:
    python scripts/reindex_embeddings.py

Progress is printed to stdout. Safe to re-run — upsert is idempotent.
"""
import sys, os, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import chromadb
from config.settings import CHROMA_PATH, GEMINI_API_KEY
from db.vector_store import _EMBED_BATCH, _gemini_embed_batch, _word_embed, get_client

COLLECTION_NAME = "knowledge_base"
PAGE_SIZE = 100  # fetch existing docs in pages

def reindex():
    if not GEMINI_API_KEY:
        print("ERROR: GEMINI_API_KEY not set in .env", file=sys.stderr)
        sys.exit(1)

    client = get_client()

    # Step 1: dump everything from the old collection
    print("Reading existing collection…")
    old_col = client.get_or_create_collection(COLLECTION_NAME)
    total = old_col.count()
    print(f"  {total} documents found")

    if total == 0:
        print("Nothing to reindex.")
        return

    # Fetch all in pages
    all_ids, all_docs, all_metas = [], [], []
    offset = 0
    while offset < total:
        batch = old_col.get(
            limit=PAGE_SIZE,
            offset=offset,
            include=["documents", "metadatas"],
        )
        all_ids.extend(batch["ids"])
        all_docs.extend(batch["documents"])
        all_metas.extend(batch["metadatas"])
        offset += PAGE_SIZE
        print(f"  Fetched {min(offset, total)}/{total}…", end="\r")

    print(f"\n  Done — {len(all_ids)} documents loaded")

    # Step 2: delete and recreate the collection so old vectors are gone
    print("Recreating collection with Gemini embedding function…")
    client.delete_collection(COLLECTION_NAME)

    # Import the new embedding function (Gemini)
    from db.vector_store import _embed_fn, get_collection
    new_col = get_collection(COLLECTION_NAME)

    # Step 3: re-upsert in batches (triggers Gemini embedding)
    print(f"Re-embedding {len(all_ids)} documents in batches of {_EMBED_BATCH}…")
    errors = 0
    for start in range(0, len(all_ids), _EMBED_BATCH):
        end = min(start + _EMBED_BATCH, len(all_ids))
        ids   = all_ids[start:end]
        docs  = all_docs[start:end]
        metas = all_metas[start:end]

        # Get Gemini embeddings for this batch
        vecs = _gemini_embed_batch(docs)
        if vecs is None:
            print(f"  WARNING: Gemini failed for batch {start}-{end}, using word-hash fallback")
            vecs = [_word_embed(d) for d in docs]
            errors += len(ids)

        new_col.upsert(ids=ids, documents=docs, metadatas=metas, embeddings=vecs)

        pct = int(end / len(all_ids) * 100)
        print(f"  [{pct:3d}%] {end}/{len(all_ids)} re-embedded…", end="\r")

        # Polite rate-limit pause
        time.sleep(0.05)

    print(f"\nDone. {len(all_ids) - errors}/{len(all_ids)} embedded with Gemini"
          + (f", {errors} fell back to word-hash" if errors else "") + ".")

if __name__ == "__main__":
    reindex()
