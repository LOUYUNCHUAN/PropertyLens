"""Pinecone hybrid RAG (v5.1 notebook parity) for /api/rag-chat."""

# Expose submodules so unittest.mock.patch("backend.rag_v51.<module>.…") resolves.
from . import generate  # noqa: F401
from . import pinecone_index  # noqa: F401
from . import retrieve  # noqa: F401
