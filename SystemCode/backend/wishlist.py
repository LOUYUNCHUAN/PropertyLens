"""
Wishlist / shortlist API: persist listings per demo username with frozen model + XAI snapshots.
"""

from __future__ import annotations

from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from backend.auth_deps import resolve_effective_username
from backend.db import get_db
from backend.location import compute_nearby, enrich_map_snapshot_json, geocode, nearest_highway_dist_m
from backend.models import CBRRequest, PredictRequest, SHAPRequest
from backend.shortlist_plan_apply import apply_plan, merge_nl_constraint_overrides
from backend.shortlist_search import (
    NLSearchRequest,
    NLSearchResponse,
    compile_nl_plan_with_ollama,
    _row_features,
)
from backend.sql_models import WishlistListing

router = APIRouter(prefix="/wishlist", tags=["wishlist"])


class WishlistCreate(BaseModel):
    username: str = Field(..., min_length=1, max_length=128)
    payload: dict[str, Any]
    listing_price: Optional[float] = Field(default=None, ge=0)
    source: str = Field(default="extension", max_length=32)
    listing_url: Optional[str] = Field(default=None, max_length=2048)
    display_label: Optional[str] = Field(default=None, max_length=256)


class WishlistSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: Any
    display_label: Optional[str]
    listing_url: Optional[str]
    listing_price: Optional[float]
    predicted_price: float
    confidence_low: Optional[float]
    confidence_high: Optional[float]
    source: str
    town: Optional[str]
    address_short: str


class WishlistDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    created_at: Any
    display_label: Optional[str]
    listing_url: Optional[str]
    listing_price: Optional[float]
    predicted_price: float
    confidence_low: Optional[float]
    confidence_high: Optional[float]
    source: str
    payload_json: dict[str, Any]
    prediction_snapshot_json: Optional[dict[str, Any]]
    shap_snapshot_json: Optional[list[Any]]
    cbr_snapshot_json: Optional[list[Any]]
    map_snapshot_json: Optional[dict[str, Any]]


def _address_short(payload: dict) -> str:
    b = str(payload.get("block") or "").strip()
    s = str(payload.get("street_name") or "").strip()
    if b and s:
        return f"BLK {b} {s}"
    return str(payload.get("town") or "—")


def _display_label_for(req: PredictRequest, override: Optional[str]) -> str:
    if override and override.strip():
        return override.strip()
    b = (req.block or "").strip()
    s = (req.street_name or "").strip()
    if b and s:
        return f"BLK {b} {s}"
    t = (req.town or "").strip()
    if t:
        return f"{t} · {req.flat_type}"
    return str(req.flat_type or "Listing")


@router.post("/items", response_model=WishlistDetail)
def create_wishlist_item(
    req: WishlistCreate,
    db: Session = Depends(get_db),
    authorization: Annotated[Optional[str], Header()] = None,
):
    from backend.cbr import cbr_similar
    from backend.predict import explain_shap, predict

    try:
        flat = PredictRequest.model_validate(req.payload)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Invalid listing payload: {e}") from e

    pred = predict(flat)
    pred_snap = pred.model_dump(mode="json")

    shap_snap: list[dict[str, Any]] = []
    try:
        shap_resp = explain_shap(SHAPRequest(flat=flat))
        shap_snap = [f.model_dump(mode="json") for f in (shap_resp.shap_values or [])[:15]]
    except Exception:
        pass

    cbr_snap: list[dict[str, Any]] = []
    try:
        cbr_resp = cbr_similar(CBRRequest(flat=flat, k=5))
        cbr_snap = [c.model_dump(mode="json") for c in cbr_resp.comparables]
    except Exception:
        pass

    map_snap: dict[str, Any] = {"geocode": None, "nearby": None, "nearest_highway_dist_m": None}
    block = (flat.block or "").strip()
    street = (flat.street_name or "").strip()
    if block and street:
        g = geocode(f"{block} {street}")
        map_snap["geocode"] = g
        if g.get("found") and g.get("lat") is not None and g.get("lng") is not None:
            lat_f, lng_f = float(g["lat"]), float(g["lng"])
            map_snap["nearby"] = compute_nearby(lat_f, lng_f, 2000.0)
            map_snap["nearest_highway_dist_m"] = nearest_highway_dist_m(lat_f, lng_f)

    label = _display_label_for(flat, req.display_label)
    eff_username = resolve_effective_username(authorization, req.username)
    row = WishlistListing(
        username=eff_username,
        display_label=label,
        listing_url=(req.listing_url or "").strip() or None,
        listing_price=req.listing_price,
        payload_json=flat.model_dump(mode="json"),
        predicted_price=float(pred.predicted_price),
        confidence_low=float(pred.confidence_low),
        confidence_high=float(pred.confidence_high),
        prediction_snapshot_json=pred_snap,
        shap_snapshot_json=shap_snap or None,
        cbr_snapshot_json=cbr_snap or None,
        map_snapshot_json=map_snap,
        source=(req.source or "extension").strip() or "extension",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return WishlistDetail.model_validate(_row_to_detail_dict(row))


def _row_to_detail_dict(row: WishlistListing) -> dict:
    d = {c.name: getattr(row, c.name) for c in row.__table__.columns}
    ms = d.get("map_snapshot_json")
    if ms is not None:
        d["map_snapshot_json"] = enrich_map_snapshot_json(ms)
    return d


def _row_to_summary(row: WishlistListing) -> WishlistSummary:
    p = row.payload_json or {}
    return WishlistSummary(
        id=row.id,
        created_at=row.created_at,
        display_label=row.display_label,
        listing_url=row.listing_url,
        listing_price=row.listing_price,
        predicted_price=row.predicted_price,
        confidence_low=row.confidence_low,
        confidence_high=row.confidence_high,
        source=row.source,
        town=p.get("town"),
        address_short=_address_short(p),
    )


@router.get("/items", response_model=list[WishlistSummary])
def list_wishlist(
    username: str = Query(..., min_length=1, max_length=128),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    authorization: Annotated[Optional[str], Header()] = None,
):
    eff_username = resolve_effective_username(authorization, username)
    rows = (
        db.query(WishlistListing)
        .filter(WishlistListing.username == eff_username)
        .order_by(WishlistListing.created_at.desc())
        .limit(limit)
        .all()
    )
    return [_row_to_summary(r) for r in rows]


@router.get("/items/{item_id}", response_model=WishlistDetail)
def get_wishlist_item(
    item_id: int,
    username: str = Query(..., min_length=1, max_length=128),
    db: Session = Depends(get_db),
    authorization: Annotated[Optional[str], Header()] = None,
):
    eff_username = resolve_effective_username(authorization, username)
    row = (
        db.query(WishlistListing)
        .filter(
            WishlistListing.id == item_id,
            WishlistListing.username == eff_username,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    return WishlistDetail.model_validate(_row_to_detail_dict(row))


@router.post("/nl-search", response_model=NLSearchResponse)
def nl_search_shortlist(
    body: NLSearchRequest,
    db: Session = Depends(get_db),
    authorization: Annotated[Optional[str], Header()] = None,
):
    """Natural-language filter + sort over saved shortlist rows (Ollama → JSON plan)."""
    eff_username = resolve_effective_username(authorization, body.username)
    rows = (
        db.query(WishlistListing)
        .filter(WishlistListing.username == eff_username)
        .order_by(WishlistListing.created_at.desc())
        .limit(body.limit)
        .all()
    )
    row_dicts = [_row_to_detail_dict(r) for r in rows]
    feats = [_row_features(d) for d in row_dicts]
    plan, ollama_err = compile_nl_plan_with_ollama(body.query)
    plan = merge_nl_constraint_overrides(
        plan,
        mrt_max_dist_m=body.mrt_max_dist_m,
        highway_min_dist_m=body.highway_min_dist_m,
    )
    sorted_ids, notes = apply_plan(feats, plan)
    return NLSearchResponse(
        filters_applied=plan,
        sorted_ids=sorted_ids,
        row_notes=notes,
        ollama_error=ollama_err,
    )


@router.delete("/items/{item_id}")
def delete_wishlist_item(
    item_id: int,
    username: str = Query(..., min_length=1, max_length=128),
    db: Session = Depends(get_db),
    authorization: Annotated[Optional[str], Header()] = None,
):
    eff_username = resolve_effective_username(authorization, username)
    row = (
        db.query(WishlistListing)
        .filter(
            WishlistListing.id == item_id,
            WishlistListing.username == eff_username,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(row)
    db.commit()
    return {"ok": True}
