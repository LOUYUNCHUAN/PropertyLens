"""
SQLAlchemy ORM models for app persistence (user history).

MVP scope:
- prediction_history: successful hybrid estimates (Buyer / optional logging).
- wishlist_listing: saved listings per username (extension or Buyer); stores snapshot of
  model, SHAP, CBR, and map context at save time.

Retention: no automatic purge in MVP; cap list via GET ?limit=.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Float, Index, Integer, JSON, String, DateTime, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class AppUser(Base):
    """Registered web users; wishlist/history rows still key by username string."""

    __tablename__ = "app_user"
    __table_args__ = (UniqueConstraint("username", name="uq_app_user_username"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(128), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(256), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


class PredictionHistory(Base):
    __tablename__ = "prediction_history"
    __table_args__ = (
        Index("ix_prediction_history_username_created", "username", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    payload_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    predicted_price: Mapped[float] = mapped_column(Float, nullable=False)
    confidence_low: Mapped[float | None] = mapped_column(Float, nullable=True)
    confidence_high: Mapped[float | None] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="buyer")


class WishlistListing(Base):
    """User-curated listings with frozen estimate + explainability for the web shortlist UI."""

    __tablename__ = "wishlist_listing"
    __table_args__ = (Index("ix_wishlist_username_created", "username", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    display_label: Mapped[str | None] = mapped_column(String(256), nullable=True)
    listing_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    listing_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    payload_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    predicted_price: Mapped[float] = mapped_column(Float, nullable=False)
    confidence_low: Mapped[float | None] = mapped_column(Float, nullable=True)
    confidence_high: Mapped[float | None] = mapped_column(Float, nullable=True)
    prediction_snapshot_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    shap_snapshot_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    cbr_snapshot_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    map_snapshot_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="extension")
