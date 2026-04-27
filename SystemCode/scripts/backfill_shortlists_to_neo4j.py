"""
backfill_shortlists_to_neo4j.py
================================
One-shot projection of every WishlistListing row from SQLite into Neo4j.

Use after:
- enabling the new shortlist projection layer for the first time, OR
- restoring SQLite from backup while Neo4j was offline, OR
- promoting a new bundle and wanting the OF_PROPERTY edges to re-resolve.

Idempotent — safe to re-run. Opens a single shared driver (no per-row open/close)
so a multi-thousand-row backfill stays fast.

Usage from repo root:

    SystemCode/backend/.venv/bin/python SystemCode/scripts/backfill_shortlists_to_neo4j.py
    SystemCode/backend/.venv/bin/python SystemCode/scripts/backfill_shortlists_to_neo4j.py --dry-run
    SystemCode/backend/.venv/bin/python SystemCode/scripts/backfill_shortlists_to_neo4j.py --username user
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "SystemCode"))

# Load SystemCode/.env exactly like the FastAPI backend does (app_state.py:24).
try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / "SystemCode" / ".env")
except ImportError:
    pass  # python-dotenv is a backend dep; if missing the env must already be set

from backend.shortlist_graph import (  # noqa: E402
    _CYPHER_MERGE_ITEM,
    _CYPHER_MERGE_USER,
    _neo4j_creds,
    _row_to_projection_params,
    _session_kwargs,
)
from backend.db import SessionLocal  # noqa: E402
from backend.sql_models import WishlistListing  # noqa: E402

CONSTRAINTS = [
    "CREATE CONSTRAINT user_username_unique IF NOT EXISTS "
    "FOR (u:User) REQUIRE u.username IS UNIQUE",
    "CREATE CONSTRAINT shortlist_sql_id_unique IF NOT EXISTS "
    "FOR (i:UserShortlistItem) REQUIRE i.sql_id IS UNIQUE",
]


def _open_driver():
    from neo4j import GraphDatabase

    creds = _neo4j_creds()
    if not creds["uri"] or not creds["user"] or not creds["password"]:
        raise SystemExit(
            "Neo4j credentials missing. Set NEO4J_URI, NEO4J_USER/NEO4J_USERNAME, NEO4J_PASSWORD."
        )
    return GraphDatabase.driver(creds["uri"], auth=(creds["user"], creds["password"]))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Read SQL rows and report what would be projected; touch nothing in Neo4j.",
    )
    parser.add_argument(
        "--username", default=None,
        help="Restrict backfill to a single username (case-insensitive).",
    )
    parser.add_argument(
        "--limit", type=int, default=0,
        help="Cap the number of rows processed (0 = no cap).",
    )
    args = parser.parse_args()

    print(f"Repo root: {ROOT}")
    print(f"Mode: {'DRY RUN' if args.dry_run else 'WRITE'}")
    if args.username:
        print(f"Filter:    username={args.username.lower()}")
    if args.limit > 0:
        print(f"Limit:     {args.limit:,} rows")

    db = SessionLocal()
    try:
        q = db.query(WishlistListing).order_by(
            WishlistListing.username.asc(), WishlistListing.created_at.asc()
        )
        if args.username:
            q = q.filter(WishlistListing.username == args.username.strip().lower())
        if args.limit > 0:
            q = q.limit(args.limit)
        rows = q.all()
        print(f"\nLoaded {len(rows):,} wishlist row(s) from SQLite")
    finally:
        db.close()

    if not rows:
        print("Nothing to backfill.")
        return 0

    # Pre-compute projection params + classify on/off-graph based on address_key alone
    # (cheap; the actual OF_PROPERTY merge inside the Cypher template confirms via OPTIONAL MATCH)
    seen_users: set[str] = set()
    has_address_count = 0
    skipped: list[tuple[int, str]] = []
    valid: list[dict] = []
    for r in rows:
        params = _row_to_projection_params(r)
        if params is None or not params["username"]:
            skipped.append((getattr(r, "id", -1), "missing username or unprojectable payload"))
            continue
        seen_users.add(params["username"])
        if params["address_key"]:
            has_address_count += 1
        valid.append(params)

    print(
        f"Plan: {len(valid):,} project-able rows across {len(seen_users)} user(s); "
        f"{has_address_count:,} have address_key (eligible for OF_PROPERTY edge); "
        f"{len(skipped)} skipped"
    )
    if skipped[:5]:
        print("Sample skipped rows:")
        for sql_id, reason in skipped[:5]:
            print(f"  sql_id={sql_id}: {reason}")

    if args.dry_run:
        print("\nDRY RUN — no Cypher executed.")
        return 0

    driver = _open_driver()
    projected = 0
    failed = 0
    try:
        with driver.session(**_session_kwargs()) as session:
            print("\nApplying constraints...")
            for c in CONSTRAINTS:
                session.run(c)
            print("  ✓ constraints in place\n")

            print("Merging users...")
            for username in sorted(seen_users):
                session.run(_CYPHER_MERGE_USER, username=username)
            print(f"  ✓ {len(seen_users)} user node(s) merged\n")

            print("Projecting shortlist items...")
            for params in valid:
                try:
                    session.run(_CYPHER_MERGE_ITEM, **params)
                    projected += 1
                    if projected % 50 == 0:
                        print(f"  {projected:,}/{len(valid):,} done", end="\r")
                except Exception as e:  # noqa: BLE001 — keep best-effort per row
                    failed += 1
                    print(f"\n  ✗ sql_id={params['sql_id']} ({params['username']}): {e}")
            print(f"  {projected:,}/{len(valid):,} done                ")
    finally:
        driver.close()

    print("\nSummary")
    print(f"  projected       : {projected:,}")
    print(f"  failed          : {failed:,}")
    print(f"  with address_key: {has_address_count:,}  (OF_PROPERTY edges resolved during MERGE)")
    print(f"  off-graph saves : {projected - has_address_count:,}  (no historical sale; only IN_TOWN edge)")
    print(f"  skipped         : {len(skipped):,}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
