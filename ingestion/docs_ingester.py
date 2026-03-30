"""
Ingest PDF/text documentation into the vector knowledge base.
Supports: .pdf, .txt, .md files.
Usage: python ingestion/docs_ingester.py --dir path/to/docs
"""
import argparse, uuid
from pathlib import Path
from db.vector_store import upsert_documents, collection_count

CHUNK_SIZE = 800   # characters per chunk
CHUNK_OVERLAP = 100


def chunk_text(text: str, source: str) -> list[dict]:
    chunks = []
    start = 0
    while start < len(text):
        end = start + CHUNK_SIZE
        chunk = text[start:end].strip()
        if chunk:
            chunks.append({
                "id": f"doc_{uuid.uuid4().hex[:8]}",
                "text": chunk,
                "metadata": {"source": source, "doc_type": "documentation"},
            })
        start += CHUNK_SIZE - CHUNK_OVERLAP
    return chunks


def read_file(path: Path) -> str:
    if path.suffix == ".pdf":
        try:
            import pypdf
            reader = pypdf.PdfReader(str(path))
            return "\n".join(page.extract_text() or "" for page in reader.pages)
        except ImportError:
            print(f"  SKIP {path.name}: install pypdf to read PDFs")
            return ""
    return path.read_text(encoding="utf-8", errors="ignore")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", default="docs", help="Directory containing docs to ingest")
    args = parser.parse_args()

    docs_dir = Path(args.dir)
    if not docs_dir.exists():
        print(f"ERROR: {docs_dir} does not exist")
        return

    all_chunks = []
    for path in docs_dir.rglob("*"):
        if path.suffix.lower() not in {".pdf", ".txt", ".md"}:
            continue
        print(f"  Reading {path.name}...")
        text = read_file(path)
        if text:
            all_chunks.extend(chunk_text(text, source=path.name))

    if not all_chunks:
        print("No documents found.")
        return

    print(f"Ingesting {len(all_chunks)} chunks from {docs_dir}...")
    for i in range(0, len(all_chunks), 500):
        upsert_documents(all_chunks[i:i+500])
    print(f"Done. Vector DB now has {collection_count()} documents.")


if __name__ == "__main__":
    main()
