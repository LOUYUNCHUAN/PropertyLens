"""Single source of truth for HDB towns, mature estates, and street→town aliases.

Imported by `backend/chat.py` (intent extraction) and `backend/rag_chat.py`
(NL flat extraction). Do NOT duplicate these constants in other modules —
add new mappings here so every code path sees them.
"""
from __future__ import annotations

TOWNS: tuple[str, ...] = (
    "ANG MO KIO", "BEDOK", "BISHAN", "BUKIT BATOK", "BUKIT MERAH",
    "BUKIT PANJANG", "BUKIT TIMAH", "CENTRAL AREA", "CHOA CHU KANG",
    "CLEMENTI", "GEYLANG", "HOUGANG", "JURONG EAST", "JURONG WEST",
    "KALLANG/WHAMPOA", "MARINE PARADE", "PASIR RIS", "PUNGGOL",
    "QUEENSTOWN", "SEMBAWANG", "SENGKANG", "SERANGOON", "TAMPINES",
    "TOA PAYOH", "WOODLANDS", "YISHUN",
)

MATURE_ESTATES: frozenset[str] = frozenset({
    "ANG MO KIO", "BEDOK", "BISHAN", "BUKIT MERAH", "BUKIT TIMAH",
    "CENTRAL AREA", "CLEMENTI", "GEYLANG", "KALLANG/WHAMPOA",
    "MARINE PARADE", "PASIR RIS", "QUEENSTOWN", "SERANGOON",
    "TAMPINES", "TOA PAYOH",
})

STREET_PREFIX_TO_TOWN: dict[str, str] = {
    "TELOK BLANGAH": "BUKIT MERAH",
    "LORONG LEW LIAN": "SERANGOON",
    "LOR LEW LIAN": "SERANGOON",
    "DEPOT": "BUKIT MERAH",
    "REDHILL": "BUKIT MERAH",
    "TIONG BAHRU": "BUKIT MERAH",
    "HENDERSON": "BUKIT MERAH",
    "LENGKOK BAHRU": "BUKIT MERAH",
    "DAWSON": "QUEENSTOWN",
    "STIRLING": "QUEENSTOWN",
    "COMMONWEALTH": "QUEENSTOWN",
    "HOLLAND": "QUEENSTOWN",
    "GHIM MOH": "QUEENSTOWN",
    "MEI LING": "QUEENSTOWN",
    "TANGLIN HALT": "QUEENSTOWN",
    "BOON LAY": "JURONG WEST",
    "YUNG": "JURONG WEST",
    "BOON KENG": "KALLANG/WHAMPOA",
    "WHAMPOA": "KALLANG/WHAMPOA",
    "KALLANG": "KALLANG/WHAMPOA",
    "JELLICOE": "KALLANG/WHAMPOA",
    "LOR 1A TOA PAYOH": "TOA PAYOH",
    "LOR 1 TOA PAYOH": "TOA PAYOH",
}


def infer_town_from_street(street: str) -> str | None:
    """Longest-prefix match: alias first, then canonical town list."""
    s = (street or "").upper().strip()
    for prefix in sorted(STREET_PREFIX_TO_TOWN.keys(), key=len, reverse=True):
        if s.startswith(prefix):
            return STREET_PREFIX_TO_TOWN[prefix]
    for t in sorted(TOWNS, key=len, reverse=True):
        if s.startswith(t):
            return t
    return None
