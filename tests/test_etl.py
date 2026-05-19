from pathlib import Path

from prescription_agent.etl.pharmacy_benefits import find_benefits_for_drug, sync_benefits_from_file


def test_sync_benefits_loads_records(tmp_path: Path) -> None:
    database_url = f"sqlite:///{tmp_path / 'benefits.db'}"
    count = sync_benefits_from_file(Path("data/pharmacy_benefits.json"), database_url)
    rows = find_benefits_for_drug("StepOne", database_url)

    assert count == 3
    assert len(rows) == 2
    assert rows[0]["drug_name"] == "StepOne Inhaler"
