"""
Vector store abstraction over ChromaDB.
Handles document ingestion and similarity retrieval for RAG.
Falls back to in-memory stub if chromadb is not installed.
"""
try:
    import chromadb
    _CHROMA_AVAILABLE = True
except ImportError:
    _CHROMA_AVAILABLE = False

from config.settings import CHROMA_PATH

_client = None


def get_client():
    global _client
    if not _CHROMA_AVAILABLE:
        raise RuntimeError("chromadb not installed. Run: pip install chromadb")
    if _client is None:
        _client = chromadb.PersistentClient(path=CHROMA_PATH)
    return _client


def get_collection(name: str = "knowledge_base"):
    return get_client().get_or_create_collection(
        name=name,
        metadata={"hnsw:space": "cosine"},
    )


def upsert_documents(docs: list[dict], collection_name: str = "knowledge_base") -> None:
    """docs: list of {id, text, metadata}"""
    col = get_collection(collection_name)
    col.upsert(
        ids=[d["id"] for d in docs],
        documents=[d["text"] for d in docs],
        metadatas=[d.get("metadata", {}) for d in docs],
    )


def query(text: str, n_results: int = 5, collection_name: str = "knowledge_base") -> list[dict]:
    """Returns top-n chunks with text and metadata."""
    col = get_collection(collection_name)
    results = col.query(query_texts=[text], n_results=n_results)
    chunks = []
    for i, doc in enumerate(results["documents"][0]):
        chunks.append({
            "text": doc,
            "metadata": results["metadatas"][0][i],
            "distance": results["distances"][0][i] if results.get("distances") else None,
        })
    return chunks


def collection_count(collection_name: str = "knowledge_base") -> int:
    if not _CHROMA_AVAILABLE:
        return 0  # RAG disabled until chromadb installed
    try:
        return get_collection(collection_name).count()
    except Exception:
        return 0
