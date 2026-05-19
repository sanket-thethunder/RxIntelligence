from __future__ import annotations

from fastapi import FastAPI
from pydantic import BaseModel, Field

from prescription_agent.agent import PrescriptionAccessAgent
from prescription_agent.config import get_settings
from prescription_agent.etl.pharmacy_benefits import sync_benefits_from_file


class AskRequest(BaseModel):
    question: str = Field(min_length=3, max_length=1000)
    patient_id: str | None = None


class AskResponse(BaseModel):
    answer: str
    confidence: float
    sources: list[dict]
    audit_id: str
    guardrail_reasons: list[str]
    vector_backend: str


settings = get_settings()
agent = PrescriptionAccessAgent(settings=settings)
app = FastAPI(title="Prescription Intelligence & Access Agent", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "vector_backend": agent.vector_store.backend_name}


@app.post("/ask", response_model=AskResponse)
def ask(request: AskRequest) -> AskResponse:
    response = agent.answer(request.question, patient_id=request.patient_id)
    return AskResponse(**response.__dict__)


@app.post("/etl/sync-benefits")
def sync_benefits() -> dict[str, int | str]:
    count = sync_benefits_from_file(settings.benefits_path, settings.database_url)
    return {"status": "synced", "records": count}
