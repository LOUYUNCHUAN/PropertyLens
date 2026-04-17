"""SQLAlchemy engine and session factory. MVP: SQLite file under repo data/."""

from __future__ import annotations

import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.sql_models import Base

REPO_ROOT = Path(__file__).resolve().parent.parent
_DEFAULT_DB_PATH = REPO_ROOT / "data" / "propertylens.db"

_raw_url = os.environ.get("DATABASE_URL", "").strip()
if _raw_url:
    DATABASE_URL = _raw_url
else:
    _DEFAULT_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    DATABASE_URL = f"sqlite:///{_DEFAULT_DB_PATH}"

_connect_args: dict = {}
if DATABASE_URL.startswith("sqlite"):
    _connect_args["check_same_thread"] = False

engine = create_engine(DATABASE_URL, connect_args=_connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
