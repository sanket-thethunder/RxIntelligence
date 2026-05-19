from pathlib import Path

from prescription_agent.agent import PrescriptionAccessAgent
from prescription_agent.config import Settings
from prescription_agent.etl.pharmacy_benefits import sync_benefits_from_file


def test_agent_returns_sources_and_audit_id(tmp_path: Path) -> None:
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'benefits.db'}",
        audit_log_path=tmp_path / "audit.log",
        docs_path=Path("data/docs"),
        benefits_path=Path("data/pharmacy_benefits.json"),
    )
    sync_benefits_from_file(settings.benefits_path, settings.database_url)
    agent = PrescriptionAccessAgent(settings=settings)

    response = agent.answer("What copay assistance exists for StepOne Inhaler?", "patient-1")

    assert "copay" in response.answer.lower()
    assert response.sources
    assert response.audit_id
    assert (tmp_path / "audit.log").exists()
