from __future__ import annotations

from dataclasses import dataclass
from typing import Any, TypedDict

from prescription_agent.audit import write_audit_event
from prescription_agent.config import Settings, get_settings
from prescription_agent.etl.pharmacy_benefits import find_benefits_for_drug
from prescription_agent.guardrails import confidence_from_sources, screen_question
from prescription_agent.rag.vector_store import SearchResult, VectorStore, build_vector_store


class AgentState(TypedDict, total=False):
    question: str
    patient_id: str | None
    guardrail_reasons: list[str]
    retrieved: list[SearchResult]
    answer: str
    confidence: float
    audit_id: str
    blocked: bool


@dataclass(frozen=True)
class AgentResponse:
    answer: str
    confidence: float
    sources: list[dict[str, Any]]
    audit_id: str
    guardrail_reasons: list[str]
    vector_backend: str


class PrescriptionAccessAgent:
    def __init__(
        self,
        settings: Settings | None = None,
        vector_store: VectorStore | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.vector_store = vector_store or build_vector_store(
            self.settings.docs_path,
            self.settings.chunk_size,
            self.settings.chunk_overlap,
        )
        self.graph = self._build_graph()

    def answer(self, question: str, patient_id: str | None = None) -> AgentResponse:
        initial: AgentState = {"question": question, "patient_id": patient_id}
        if self.graph is not None:
            state = self.graph.invoke(initial)
        else:
            state = self._run_fallback(initial)
        retrieved = state.get("retrieved", [])
        sources = [
            {
                "source": result.chunk.source,
                "chunk_id": result.chunk.chunk_id,
                "score": round(result.score, 3),
                "preview": result.chunk.text[:240],
            }
            for result in retrieved
        ]
        return AgentResponse(
            answer=state["answer"],
            confidence=state["confidence"],
            sources=sources,
            audit_id=state["audit_id"],
            guardrail_reasons=state.get("guardrail_reasons", []),
            vector_backend=self.vector_store.backend_name,
        )

    def _build_graph(self):
        try:
            from langgraph.graph import END, StateGraph
        except Exception:
            return None

        workflow = StateGraph(AgentState)
        workflow.add_node("screen", self._screen)
        workflow.add_node("retrieve", self._retrieve)
        workflow.add_node("generate", self._generate)
        workflow.add_node("audit", self._audit)
        workflow.set_entry_point("screen")
        workflow.add_conditional_edges(
            "screen",
            self._route_after_screen,
            {"blocked": "audit", "ok": "retrieve"},
        )
        workflow.add_edge("retrieve", "generate")
        workflow.add_edge("generate", "audit")
        workflow.add_edge("audit", END)
        return workflow.compile()

    def _run_fallback(self, state: AgentState) -> AgentState:
        state = self._screen(state)
        if not state.get("blocked"):
            state = self._retrieve(state)
            state = self._generate(state)
        return self._audit(state)

    def _screen(self, state: AgentState) -> AgentState:
        result = screen_question(state["question"])
        if not result.allowed:
            state["blocked"] = True
            state["guardrail_reasons"] = result.reasons
            state["answer"] = (
                "I cannot answer that request because it appears to contain prompt "
                "injection language. Please ask a prescription access or coverage "
                "question directly."
            )
            state["confidence"] = 0.0
        else:
            state["question"] = result.sanitized_question
            state["guardrail_reasons"] = []
        return state

    @staticmethod
    def _route_after_screen(state: AgentState) -> str:
        return "blocked" if state.get("blocked") else "ok"

    def _retrieve(self, state: AgentState) -> AgentState:
        state["retrieved"] = self.vector_store.search(state["question"], k=4)
        return state

    def _generate(self, state: AgentState) -> AgentState:
        retrieved = state.get("retrieved", [])
        context = "\n\n".join(result.chunk.text for result in retrieved)
        answer = self._call_anthropic(state["question"], context) or self._local_answer(
            state["question"],
            retrieved,
        )
        confidence = confidence_from_sources(answer, [result.chunk.text for result in retrieved])
        state["answer"] = answer
        state["confidence"] = confidence
        return state

    def _call_anthropic(self, question: str, context: str) -> str | None:
        if not self.settings.anthropic_api_key:
            return None
        try:
            import anthropic

            client = anthropic.Anthropic(api_key=self.settings.anthropic_api_key)
            message = client.messages.create(
                model="claude-3-5-sonnet-latest",
                max_tokens=450,
                temperature=0.1,
                system=(
                    "You answer prescription access questions using only the provided context. "
                    "If evidence is missing, say what must be verified by the care team."
                ),
                messages=[
                    {
                        "role": "user",
                        "content": f"Context:\n{context}\n\nQuestion:\n{question}",
                    }
                ],
            )
            text_blocks = []
            for block in message.content:
                if getattr(block, "type", "") == "text":
                    text_blocks.append(getattr(block, "text", ""))
            return "".join(text_blocks)
        except Exception:
            return None

    def _local_answer(self, question: str, retrieved: list[SearchResult]) -> str:
        question_lower = question.lower()
        evidence = " ".join(result.chunk.text for result in retrieved)
        benefits = []
        for drug in ("StepOne Inhaler", "GLP Access"):
            if drug.lower() in question_lower or drug.lower() in evidence.lower():
                benefits.extend(find_benefits_for_drug(drug, self.settings.database_url))

        lines = [
            "Based on the retrieved policy and label evidence:",
            "- Prior authorization should be checked when the plan marks the drug as "
            "non-preferred or specialty.",
            "- Commercially insured patients may be eligible for manufacturer copay "
            "support; government-funded plans are excluded.",
            "- If the prescribed therapy is not preferred, review documented formulary "
            "alternatives before escalation.",
        ]
        if benefits:
            lines.append("- Benefit records found:")
            lines.extend(
                f"  - {row['payer']} lists {row['drug_name']} as {row['tier']}; "
                f"PA required: {row['prior_authorization_required']}; "
                f"copay eligible: {row['copay_assistance_eligible']}; "
                f"alternatives: {row['formulary_alternatives']}."
                for row in benefits
            )
        lines.append(
            "Care team verification is still required before therapy or coverage decisions."
        )
        return "\n".join(lines)

    def _audit(self, state: AgentState) -> AgentState:
        state["audit_id"] = write_audit_event(
            self.settings.audit_log_path,
            {
                "patient_id": state.get("patient_id"),
                "question": state["question"],
                "guardrail_reasons": state.get("guardrail_reasons", []),
                "confidence": state.get("confidence", 0.0),
                "sources": [result.chunk.chunk_id for result in state.get("retrieved", [])],
            },
        )
        return state
