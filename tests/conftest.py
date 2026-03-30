"""Shared pytest configuration."""
import os

# Set test environment variables before any imports
os.environ.setdefault("GEMINI_API_KEY", "test-key-not-real")
os.environ.setdefault("FRESHDESK_API_KEY", "test")
os.environ.setdefault("FRESHDESK_SUBDOMAIN", "test.freshdesk.com")
os.environ.setdefault("JWT_SECRET", "test-secret-key")
os.environ.setdefault("CHROMA_PATH", "./data/chroma_test")
