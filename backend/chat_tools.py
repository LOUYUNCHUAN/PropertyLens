"""
backend/chat_tools.py
---------------------
Shared tool triggers + helpers used by chat endpoints.

This module exists so multiple endpoints (e.g. /api/rag-chat and
/api/property-search-chat) can reuse the same tool logic:
  - predict price
  - CBR similar sales
  - SHAP explanation
  - shortlist / wishlist lookup

It is extracted from backend/rag_chat.py to keep beta behavior unchanged.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Optional

from sqlalchemy.orm import Session

from backend.hdb_towns import infer_town_from_street
from backend.models import CBRRequest, PredictRequest, RagChatRequest, SHAPRequest
from backend.sql_models import WishlistListing


_SMALLTALK_ACKS = frozenset(
    {
        "ok",
        "okay",
        "k",
        "kk",
        "thanks",
        "thank you",
        "thx",
        "ty",
        "cheers",
        "got it",
        "noted",
        "alright",
        "cool",
        "nice",
        "great",
        "perfect",
        "sounds good",
        "makes sense",
        "bye",
    }
)

_SMALLTALK_SOCIAL_PATTERNS = (
    r"^(hi|hello|hey|hola|yo)\b",
    r"good (morning|afternoon|evening|night)",
    r"how (are|r) (you|u)\b",
    r"(what's|whats) up|how's it going",
    r"who are you|what can you do|what do you do|what are you|what is this|help me",
)

_SMALLTALK_DOMAIN_GUARD = re.compile(
    r"\b(\$|sgd|price|fair|valuation|estimate|predict|how much|worth|cheap|expensive|"
    r"trend|amenit|mrt|school|transaction|near|around|similar|comp|sold|history|"
    r"flat|room|lease|sqm|sqft|bishan|tampines|bedok|jurong|punggol|sengkang|woodlands|"
    r"yishun|ang mo|toa payoh|clementi|queenstown|shortlist|wishlist|save)\b",
    re.I,
)


def classify_smalltalk(msg: str) -> str | None:
    """Return 'ack' | 'social' | None.

    Mirrors the behavior of backend/rag_chat.py but is reusable by other endpoints.
    """
    clean = (msg or "").strip().lower().rstrip(".!?")
    if not clean:
        return None
    if clean in _SMALLTALK_ACKS:
        return "ack"
    tokens = clean.split()
    if len(tokens) <= 3 and all(tok in _SMALLTALK_ACKS for tok in tokens):
        return "ack"
    if _SMALLTALK_DOMAIN_GUARD.search(clean):
        return None
    if len(tokens) <= 8 and any(re.search(p, clean) for p in _SMALLTALK_SOCIAL_PATTERNS):
        return "social"
    return None


def wants_shortlist(msg: str) -> bool:
    m = (msg or "").lower()
    return any(
        k in m
        for k in (
            "shortlist",
            "saved listing",
            "my saves",
            "wishlist",
            "what did i save",
            "my saved",
        )
    )


def wants_predict(msg: str) -> bool:
    m = (msg or "").lower()
    return any(
        k in m
        for k in (
            "predict",
            "estimate",
            "how much",
            "fair price",
            "valuation",
            "price for",
            "worth ",
            "is $",
            "is s$",
        )
    )


def wants_cbr(msg: str) -> bool:
    m = (msg or "").lower()
    return any(
        k in m
        for k in (
            "similar",
            "comparable",
            "comps",
            "comp transaction",
            "sold nearby",
            "past sales",
        )
    )


def wants_shap(msg: str) -> bool:
    m = (msg or "").lower()
    return any(
        k in m
        for k in (
            "why ",
            "explain",
            "shap",
            "driver",
            "feature drove",
            "what drove",
            "top feature",
            "importance",
        )
    )


def resolve_flat_from_rag_body(
    db: Session,
    eff_username: Optional[str],
    body: RagChatRequest,
) -> PredictRequest | None:
    """Resolve a PredictRequest from an explicit request body (rag-chat)."""
    if body.flat_overrides is not None:
        return body.flat_overrides
    if body.shortlist_item_id is not None and eff_username:
        row = (
            db.query(WishlistListing)
            .filter(
                WishlistListing.id == body.shortlist_item_id,
                WishlistListing.username == eff_username,
            )
            .first()
        )
        if row and row.payload_json:
            try:
                return PredictRequest.model_validate(row.payload_json)
            except Exception:
                return None
    return None


def extract_flat_from_message(msg: str) -> Optional[PredictRequest]:
    """Best-effort regex parser: free text → PredictRequest.

    Returns None if required fields (address + flat_type + area) can't be found.
    Relies on the backend feature-table lookup to fill POI/market fields when
    block + street + town + sale_month are all present.
    """
    text = (msg or "").strip()
    if not text:
        return None

    # Accept both:
    #   "BLK 864 TAMPINES STREET 83, 4 room, 122 sqm, ..."
    # and natural phrasing:
    #   "Predict price for BLK 864 TAMPINES STREET 83, 4 room, 122 sqm, ..."
    before_comma = text.split(",")[0].strip()
    addr_m = re.search(
        r"(?:^|\b)(?:blk\s+|block\s+)?(\d{1,4}[a-z]?)\s+(.+?)\s*$",
        before_comma,
        re.I,
    )
    if not addr_m:
        return None
    block = addr_m.group(1).upper()
    street = addr_m.group(2).upper().strip()
    town = infer_town_from_street(street)
    if not town:
        return None

    ft_m = re.search(r"\b([1-5])\s*[- ]?\s*(?:room|rm)\b", text, re.I)
    if not ft_m:
        return None
    flat_type = f"{ft_m.group(1)} ROOM"

    area_m = re.search(r"(\d{2,3}(?:\.\d+)?)\s*(?:sqm|sq\.?m|m²|m2)\b", text, re.I)
    if not area_m:
        return None
    area = float(area_m.group(1))
    if not (20 <= area <= 400):
        return None

    lease_m = re.search(
        r"(?:~|about\s+)?(\d{1,2})\s*(?:y|yr|yrs|year|years)\s*(?:lease|left|remain\w*)?",
        text,
        re.I,
    )
    remaining = int(lease_m.group(1)) if lease_m else 60
    if not (1 <= remaining <= 99):
        remaining = 60

    today = date.today()
    year = today.year
    month = today.month
    lease_start = year - 99 + remaining
    if not (1960 <= lease_start <= 2035):
        return None

    storey_mid = 8.0
    st_m = re.search(r"(\d{1,2})\s*(?:st|nd|rd|th)?\s*(?:floor|storey|storeys|level|lvl)\b", text, re.I)
    if st_m:
        try:
            storey_mid = float(int(st_m.group(1)))
        except ValueError:
            pass

    try:
        return PredictRequest(
            floor_area_sqm=area,
            storey_mid=storey_mid,
            remaining_lease_years=float(remaining),
            lease_commence_date=int(lease_start),
            dist_nearest_mrt_km=0.5,
            block=block,
            street_name=street,
            town=town,
            flat_type=flat_type,
            sale_month=f"{year}-{month:02d}",
            year=year,
            month_num=month,
        )
    except Exception:
        return None


def format_shortlist_rows(rows: list[WishlistListing]) -> str:
    lines: list[str] = []
    for r in rows:
        label = r.display_label or "Listing"
        town = (r.payload_json or {}).get("town") or "—"
        lp = r.listing_price
        pp = r.predicted_price
        if lp is not None:
            lines.append(
                f"- id={r.id} | {label} | town={town} | listing=${lp:,.0f} | model=${pp:,.0f}"
            )
        else:
            lines.append(f"- id={r.id} | {label} | town={town} | model=${pp:,.0f}")
    return "\n".join(lines)


def format_cbr(resp) -> str:
    lines: list[str] = []
    for c in resp.comparables[:8]:
        lines.append(
            f"- {c.town} BLK {c.block} {c.street_name} | {c.flat_type} | "
            f"${c.resale_price:,.0f} | {c.year} | sim≈{c.similarity_pct:.1f}%"
        )
    return "\n".join(lines) if lines else "(no comparables)"


def format_shap(resp) -> str:
    top = (resp.shap_values or [])[:12]
    lines = [
        f"- {f.feature}: value={f.feature_value} SHAP={f.shap_value:+.2f}" for f in top
    ]
    hdr = f"type={resp.explanation_type} predicted_hybrid=${resp.predicted_price:,.0f} base={resp.base_value}"
    if resp.fallback_reason:
        hdr += f" (fallback: {resp.fallback_reason})"
    return hdr + "\n" + "\n".join(lines)


def run_predict_tool(flat: PredictRequest) -> str:
    from backend.predict import predict as _predict

    pr = _predict(flat)
    return (
        f"Hybrid model predicted SGD {pr.predicted_price:,.0f} "
        f"(approx range {pr.confidence_low:,.0f}–{pr.confidence_high:,.0f}). "
        f"Test RMSE ≈ ${pr.rmse:,.0f}."
    )


def run_cbr_tool(flat: PredictRequest, *, k: int = 8) -> str:
    from backend.cbr import run_cbr_similar as _run_cbr_similar

    return format_cbr(_run_cbr_similar(CBRRequest(flat=flat, k=k)))


def run_shap_tool(flat: PredictRequest) -> str:
    from backend.predict import run_explain_shap as _run_explain_shap

    return format_shap(_run_explain_shap(SHAPRequest(flat=flat)))

