from __future__ import annotations

import json
from pathlib import Path

from prescription_agent.db import PharmacyBenefit, create_session_factory


def sync_benefits_from_file(source_path: Path, database_url: str) -> int:
    records = json.loads(source_path.read_text(encoding="utf-8"))
    session_factory = create_session_factory(database_url)
    count = 0
    with session_factory() as session:
        for record in records:
            benefit = PharmacyBenefit(
                plan_id=record["plan_id"],
                payer=record["payer"],
                drug_name=record["drug_name"],
                tier=record["tier"],
                prior_authorization_required=record["prior_authorization_required"],
                copay_assistance_eligible=record["copay_assistance_eligible"],
                formulary_alternatives=", ".join(record["formulary_alternatives"]),
            )
            session.merge(benefit)
            count += 1
        session.commit()
    return count


def find_benefits_for_drug(drug_name: str, database_url: str) -> list[dict]:
    session_factory = create_session_factory(database_url)
    with session_factory() as session:
        rows = (
            session.query(PharmacyBenefit)
            .filter(PharmacyBenefit.drug_name.ilike(f"%{drug_name}%"))
            .order_by(PharmacyBenefit.payer)
            .all()
        )
        return [
            {
                "plan_id": row.plan_id,
                "payer": row.payer,
                "drug_name": row.drug_name,
                "tier": row.tier,
                "prior_authorization_required": row.prior_authorization_required,
                "copay_assistance_eligible": row.copay_assistance_eligible,
                "formulary_alternatives": row.formulary_alternatives,
            }
            for row in rows
        ]
