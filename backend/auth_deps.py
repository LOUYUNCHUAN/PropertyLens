"""JWT helpers and username resolution for Bearer vs legacy query/body username."""

from __future__ import annotations

import os
from typing import Annotated, Optional

from fastapi import Depends, Header, HTTPException
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from db import get_db
from sql_models import AppUser

JWT_SECRET = os.environ.get("JWT_SECRET", "propertylens-dev-only-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.environ.get("JWT_EXPIRE_MINUTES", "10080"))


def decode_token_username(token: str) -> Optional[str]:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        sub = payload.get("sub")
        if isinstance(sub, str) and sub.strip():
            return sub.strip().lower()
        return None
    except JWTError:
        return None


def resolve_effective_username(
    authorization: Optional[str],
    fallback_username: str,
) -> str:
    """
    If Authorization: Bearer <jwt> is present and valid, return token `sub` (lowercase).
    Otherwise return normalized fallback (extension / legacy clients).
    If Bearer is present but invalid, raise 401.
    """
    fb = fallback_username.strip().lower()
    if not authorization:
        return fb
    auth = authorization.strip()
    if not auth.lower().startswith("bearer "):
        return fb
    token = auth[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    un = decode_token_username(token)
    if un is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return un


async def get_current_user(
    authorization: Annotated[Optional[str], Header(alias="Authorization")] = None,
    db: Session = Depends(get_db),
) -> AppUser:
    if not authorization or not authorization.strip().lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.strip()[7:].strip()
    un = decode_token_username(token)
    if not un:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = db.query(AppUser).filter(AppUser.username == un).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user
