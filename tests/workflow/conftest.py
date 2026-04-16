"""
Shared fixtures for workflow engine tests.

Extends the root conftest.py with workflow-specific environment setup.
"""
import os
import pytest

# Ensure test env vars are set before any workflow_engine imports
os.environ.setdefault("GEMINI_API_KEY", "test-key-not-real")
os.environ.setdefault("JWT_SECRET", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost/test")
os.environ.setdefault("CHROMA_PATH", "./data/chroma_test")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("GMAIL_PUBSUB_SECRET", "test-pubsub-secret")
os.environ.setdefault("VITE_API_URL", "http://localhost:8000")
