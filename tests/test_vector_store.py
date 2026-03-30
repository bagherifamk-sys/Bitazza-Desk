"""Tests for vector store abstraction."""
import pytest
import os


@pytest.fixture
def tmp_chroma(tmp_path, monkeypatch):
    monkeypatch.setenv("CHROMA_PATH", str(tmp_path / "chroma"))
    import importlib
    import db.vector_store as vs
    importlib.reload(vs)
    vs._client = None  # reset singleton
    return vs


def test_upsert_and_query(tmp_chroma):
    vs = tmp_chroma
    vs.upsert_documents([
        {"id": "doc1", "text": "KYC verification requires passport and selfie", "metadata": {"source": "docs"}},
        {"id": "doc2", "text": "Withdrawal processing takes 1-3 business days", "metadata": {"source": "docs"}},
        {"id": "doc3", "text": "How to reset your password and 2FA", "metadata": {"source": "docs"}},
    ])
    assert vs.collection_count() == 3


def test_query_returns_results(tmp_chroma):
    vs = tmp_chroma
    vs.upsert_documents([
        {"id": "t1", "text": "KYC verification requires government ID", "metadata": {"source": "test"}},
        {"id": "t2", "text": "Deposit money via bank transfer", "metadata": {"source": "test"}},
    ])
    results = vs.query("KYC documents required", n_results=2)
    assert len(results) >= 1
    assert all("text" in r for r in results)


def test_upsert_deduplicates(tmp_chroma):
    vs = tmp_chroma
    vs.upsert_documents([{"id": "dup1", "text": "Original text", "metadata": {}}])
    vs.upsert_documents([{"id": "dup1", "text": "Updated text", "metadata": {}}])
    assert vs.collection_count() == 1


def test_collection_count_zero_on_empty(tmp_chroma):
    vs = tmp_chroma
    assert vs.collection_count() == 0
