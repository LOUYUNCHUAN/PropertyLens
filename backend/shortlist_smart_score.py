"""
Client-side Smart Score parity (matches frontend/src/lib/smartScore.js) for server-side sort.
"""

from __future__ import annotations

from typing import Any


def _clamp(lo: float, hi: float, x: float) -> float:
    return max(lo, min(hi, x))


def _median(values: list[float]) -> float | None:
    arr = [v for v in values if isinstance(v, (int, float)) and v == v]
    if not arr:
        return None
    arr.sort()
    mid = len(arr) // 2
    return arr[mid] if len(arr) % 2 else (arr[mid - 1] + arr[mid]) / 2


def price_vs_model_score(snap: dict[str, Any]) -> tuple[float, bool]:
    listing = float(snap.get("listing_price") or 0)
    predicted = float(snap.get("model_estimate") or 0)
    if listing <= 0 or predicted <= 0:
        return 0.0, False
    gap = (listing - predicted) / predicted
    lo = snap.get("confidence_low")
    hi = snap.get("confidence_high")
    band_w = 0.0
    if isinstance(lo, (int, float)) and isinstance(hi, (int, float)) and hi > lo:
        band_w = (hi - lo) / predicted
    conf_trust = _clamp(0.5, 1.0, 1 - band_w)
    premium = max(0.0, gap + 0.05)
    raw = 60 - premium * 100 * 3
    score = _clamp(0, 60, raw) * conf_trust
    return score, True


def comp_agreement_score(snap: dict[str, Any]) -> tuple[float, bool]:
    listing = float(snap.get("listing_price") or 0)
    top = (snap.get("cbr_matches") or [])[:3]
    prices = []
    for c in top:
        rp = c.get("resale_price")
        if rp is not None and float(rp) > 0:
            prices.append(float(rp))
    if listing <= 0 or not prices:
        return 0.0, False
    med = _median(prices)
    if med is None or med <= 0:
        return 0.0, False
    comp_gap = (listing - med) / med
    premium = max(0.0, comp_gap)
    raw = 20 - premium * 100 * (30 / 35)
    score = _clamp(0, 20, raw)
    if len(prices) < 3:
        score *= len(prices) / 3
    return score, True


def lease_quality_score(snap: dict[str, Any]) -> tuple[float, bool]:
    y = snap.get("remaining_lease_years")
    if y is None:
        return 0.0, False
    years = float(y)
    if years <= 0:
        return 0.0, False
    if years >= 90:
        s15 = 15.0
    elif years >= 60:
        s15 = 10 + ((years - 60) / 30) * 5
    elif years >= 40:
        s15 = 5 + ((years - 40) / 20) * 5
    elif years >= 30:
        s15 = ((years - 30) / 10) * 5
    else:
        s15 = 0.0
    score = s15 * (20 / 15)
    return score, True


def wishlist_row_to_snap(detail: dict[str, Any]) -> dict[str, Any]:
    payload = detail.get("payload_json") or {}
    cbr = detail.get("cbr_snapshot_json") or []
    cbr_matches = []
    for c in cbr:
        cbr_matches.append(
            {
                "match_score": c.get("similarity_pct") or c.get("match_score") or 0,
                "resale_price": c.get("resale_price"),
            }
        )
    rly = payload.get("remaining_lease_years")
    return {
        "listing_price": detail.get("listing_price"),
        "model_estimate": detail.get("predicted_price"),
        "confidence_low": detail.get("confidence_low"),
        "confidence_high": detail.get("confidence_high"),
        "remaining_lease_years": float(rly) if rly is not None else None,
        "cbr_matches": cbr_matches,
    }


def sum_smart_score(snap: dict[str, Any]) -> int:
    p, _ = price_vs_model_score(snap)
    c, _ = comp_agreement_score(snap)
    l, _ = lease_quality_score(snap)
    return int(round(_clamp(0, 100, p + c + l)))
