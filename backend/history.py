"""
User prediction history API (SQLite MVP).

Events stored:
- Successful /api/predict-style runs logged via POST /api/history/prediction (source=buyer|extension|api).

Not stored in v1: chat transcripts, raw extension page HTML, automatic retention/TTL.
"""

from __future__ import annotations

from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from backend.auth_deps import resolve_effective_username
from backend.db import get_db
from backend.sql_models import PredictionHistory

router = APIRouter(prefix="/history", tags=["history"])


class PredictionHistoryCreate(BaseModel):
    username: str = Field(..., min_length=1, max_length=128)
    source: str = Field(default="buyer", max_length=32)
    payload: dict[str, Any]
    predicted_price: float = Field(..., ge=0)
    confidence_low: Optional[float] = Field(default=None, ge=0)
    confidence_high: Optional[float] = Field(default=None, ge=0)


class PredictionHistoryItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    created_at: datetime
    payload_json: dict[str, Any]
    predicted_price: float
    confidence_low: Optional[float]
    confidence_high: Optional[float]
    source: str


@router.post("/prediction", response_model=PredictionHistoryItem)
def create_prediction_history(
    req: PredictionHistoryCreate,
    db: Session = Depends(get_db),
    authorization: Annotated[Optional[str], Header()] = None,
):
    eff_username = resolve_effective_username(authorization, req.username)
    row = PredictionHistory(
        username=eff_username,
        payload_json=req.payload,
        predicted_price=req.predicted_price,
        confidence_low=req.confidence_low,
        confidence_high=req.confidence_high,
        source=req.source.strip() or "buyer",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return PredictionHistoryItem.model_validate(row)


@router.get("/predictions", response_model=list[PredictionHistoryItem])
def list_prediction_history(
    username: str = Query(..., min_length=1, max_length=128),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    authorization: Annotated[Optional[str], Header()] = None,
):
    eff_username = resolve_effective_username(authorization, username)
    rows = (
        db.query(PredictionHistory)
        .filter(PredictionHistory.username == eff_username)
        .order_by(PredictionHistory.created_at.desc())
        .limit(limit)
        .all()
    )
    return [PredictionHistoryItem.model_validate(r) for r in rows]


@router.delete("/predictions/{row_id}")
def delete_prediction_history(
    row_id: int,
    username: str = Query(..., min_length=1, max_length=128),
    db: Session = Depends(get_db),
    authorization: Annotated[Optional[str], Header()] = None,
):
    eff_username = resolve_effective_username(authorization, username)
    row = (
        db.query(PredictionHistory)
        .filter(
            PredictionHistory.id == row_id,
            PredictionHistory.username == eff_username,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(row)
    db.commit()
    return {"ok": True}
