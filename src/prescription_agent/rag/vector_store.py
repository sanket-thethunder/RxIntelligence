from __future__ import annotations

import math
import pickle
import re
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

import numpy as np

TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9_-]+")


@dataclass(frozen=True)
class DocumentChunk:
    text: str
    source: str
    chunk_id: str


@dataclass(frozen=True)
class SearchResult:
    chunk: DocumentChunk
    score: float


class HashingEmbedder:
    def __init__(self, dimensions: int = 384) -> None:
        self.dimensions = dimensions

    def embed(self, text: str) -> np.ndarray:
        vector = np.zeros(self.dimensions, dtype=np.float32)
        for token in TOKEN_RE.findall(text.lower()):
            index = hash(token) % self.dimensions
            vector[index] += 1.0
        norm = float(np.linalg.norm(vector))
        if norm:
            vector /= norm
        return vector


class VectorStore:
    def __init__(self, embedder: HashingEmbedder | None = None) -> None:
        self.embedder = embedder or HashingEmbedder()
        self.chunks: list[DocumentChunk] = []
        self.vectors = np.empty((0, self.embedder.dimensions), dtype=np.float32)
        self._faiss_index = None
        self._faiss = self._import_faiss()

    @staticmethod
    def _import_faiss():
        try:
            import faiss

            return faiss
        except Exception:
            return None

    @property
    def backend_name(self) -> str:
        return "faiss" if self._faiss is not None and self._faiss_index is not None else "numpy"

    def add(self, chunks: Iterable[DocumentChunk]) -> None:
        new_chunks = list(chunks)
        if not new_chunks:
            return
        new_vectors = np.vstack([self.embedder.embed(chunk.text) for chunk in new_chunks])
        self.chunks.extend(new_chunks)
        self.vectors = np.vstack([self.vectors, new_vectors])
        self._rebuild_index()

    def _rebuild_index(self) -> None:
        if self._faiss is None or len(self.vectors) == 0:
            self._faiss_index = None
            return
        index = self._faiss.IndexFlatIP(self.embedder.dimensions)
        index.add(self.vectors.astype(np.float32))
        self._faiss_index = index

    def search(self, query: str, k: int = 4) -> list[SearchResult]:
        if not self.chunks:
            return []
        query_vector = self.embedder.embed(query).reshape(1, -1).astype(np.float32)
        if self._faiss_index is not None:
            scores, indexes = self._faiss_index.search(query_vector, k)
            return [
                SearchResult(chunk=self.chunks[int(index)], score=float(score))
                for score, index in zip(scores[0], indexes[0], strict=False)
                if int(index) >= 0
            ]
        scores = (self.vectors @ query_vector.T).reshape(-1)
        top_indexes = np.argsort(scores)[::-1][:k]
        return [
            SearchResult(chunk=self.chunks[int(index)], score=float(scores[index]))
            for index in top_indexes
        ]

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("wb") as file:
            pickle.dump({"chunks": self.chunks, "vectors": self.vectors}, file)

    @classmethod
    def load(cls, path: Path, embedder: HashingEmbedder | None = None) -> VectorStore:
        store = cls(embedder=embedder)
        with path.open("rb") as file:
            payload = pickle.load(file)
        store.chunks = payload["chunks"]
        store.vectors = payload["vectors"]
        store._rebuild_index()
        return store


def chunk_text(text: str, source: str, chunk_size: int, overlap: int) -> list[DocumentChunk]:
    clean_text = "\n".join(line.strip() for line in text.splitlines() if line.strip())
    if not clean_text:
        return []
    step = max(1, chunk_size - overlap)
    chunks = []
    total = max(1, math.ceil(len(clean_text) / step))
    for idx, start in enumerate(range(0, len(clean_text), step)):
        window = clean_text[start : start + chunk_size]
        chunks.append(
            DocumentChunk(
                text=window,
                source=source,
                chunk_id=f"{source}:{idx + 1}/{total}",
            )
        )
    return chunks


def build_vector_store(docs_path: Path, chunk_size: int, chunk_overlap: int) -> VectorStore:
    store = VectorStore()
    chunks: list[DocumentChunk] = []
    for path in sorted(docs_path.glob("*.md")):
        chunks.extend(
            chunk_text(path.read_text(encoding="utf-8"), path.name, chunk_size, chunk_overlap)
        )
    store.add(chunks)
    return store
