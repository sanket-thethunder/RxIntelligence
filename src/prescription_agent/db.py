from __future__ import annotations

from sqlalchemy import Boolean, String, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker


class Base(DeclarativeBase):
    pass


class PharmacyBenefit(Base):
    __tablename__ = "pharmacy_benefits"

    plan_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    payer: Mapped[str] = mapped_column(String(160), nullable=False)
    drug_name: Mapped[str] = mapped_column(String(160), primary_key=True)
    tier: Mapped[str] = mapped_column(String(80), nullable=False)
    prior_authorization_required: Mapped[bool] = mapped_column(Boolean, nullable=False)
    copay_assistance_eligible: Mapped[bool] = mapped_column(Boolean, nullable=False)
    formulary_alternatives: Mapped[str] = mapped_column(String(500), nullable=False)


def make_engine(database_url: str):
    connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
    return create_engine(database_url, connect_args=connect_args)


def create_session_factory(database_url: str) -> sessionmaker[Session]:
    engine = make_engine(database_url)
    Base.metadata.create_all(engine)
    return sessionmaker(engine, expire_on_commit=False)
