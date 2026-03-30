"""
Vector store abstraction over ChromaDB.
Uses a word-level TF-IDF-style embedding (numpy only, no downloads required).
Significantly better than character n-grams for support ticket keyword matching.
Swap _embed_fn for a real model (e.g. sentence-transformers) in production.
"""
try:
    import chromadb
    from chromadb import EmbeddingFunction, Documents, Embeddings
    _CHROMA_AVAILABLE = True
except ImportError:
    _CHROMA_AVAILABLE = False

import hashlib, math, re
from config.settings import CHROMA_PATH

_DIM = 512

# Common English/Thai stop words to ignore
_STOP = {
    "the","a","an","is","it","to","of","and","in","for","on","with","my","i",
    "me","you","your","we","be","have","has","was","are","do","did","not","or",
    "at","by","this","that","can","will","please","help","hi","hello","dear",
}


def _word_embed(text: str) -> list[float]:
    """Word-level hashed embedding with IDF-style dampening via log(1+freq)."""
    vec = [0.0] * _DIM
    words = re.findall(r"[a-z0-9_]+|[\u0e00-\u0e7f]+", text.lower())
    word_counts: dict[str, int] = {}
    for w in words:
        if w not in _STOP and len(w) > 1:
            word_counts[w] = word_counts.get(w, 0) + 1
    for w, count in word_counts.items():
        h = int(hashlib.md5(w.encode()).hexdigest(), 16)
        idx = h % _DIM
        vec[idx] += math.log1p(count)
        # Also hash bigrams with next word for phrase context
    word_list = [w for w in words if w not in _STOP and len(w) > 1]
    for i in range(len(word_list) - 1):
        bigram = word_list[i] + "_" + word_list[i+1]
        h = int(hashlib.md5(bigram.encode()).hexdigest(), 16)
        idx = h % _DIM
        vec[idx] += 0.5
    norm = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [x / norm for x in vec]


if _CHROMA_AVAILABLE:
    class _WordEmbedFn(EmbeddingFunction):
        def __call__(self, input: Documents) -> Embeddings:
            return [_word_embed(doc) for doc in input]

    _embed_fn = _WordEmbedFn()
else:
    _embed_fn = None

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
        embedding_function=_embed_fn,
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
