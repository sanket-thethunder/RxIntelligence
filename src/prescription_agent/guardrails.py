from __future__ import annotations

from dataclasses import dataclass

INJECTION_PATTERNS = (
    "ignore previous instructions",
    "forget your instructions",
    "system prompt",
    "developer message",
    "reveal your prompt",
    "jailbreak",
    "bypass policy",
)


@dataclass(frozen=True)
class GuardrailResult:
    allowed: bool
    reasons: list[str]
    sanitized_question: str


def screen_question(question: str) -> GuardrailResult:
    normalized = " ".join(question.lower().split())
    reasons = [pattern for pattern in INJECTION_PATTERNS if pattern in normalized]
    sanitized = question.replace("\x00", "").strip()
    return GuardrailResult(allowed=not reasons, reasons=reasons, sanitized_question=sanitized)


def confidence_from_sources(answer: str, source_texts: list[str]) -> float:
    answer_terms = {term.strip(".,;:()").lower() for term in answer.split() if len(term) > 5}
    source_terms = {
        term.strip(".,;:()").lower()
        for source in source_texts
        for term in source.split()
        if len(term) > 5
    }
    if not answer_terms:
        return 0.0
    overlap = len(answer_terms & source_terms) / len(answer_terms)
    return round(min(1.0, overlap + 0.15), 2)
