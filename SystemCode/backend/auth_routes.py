"""Register, login, profile, password change — DB-backed users + JWT."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import APIRouter, Depends, HTTPException
from jose import jwt
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.auth_deps import JWT_ALGORITHM, JWT_EXPIRE_MINUTES, JWT_SECRET, get_current_user
from backend.db import get_db
from backend.sql_models import AppUser, PredictionHistory, WishlistListing

router = APIRouter(prefix="/auth", tags=["auth"])

# bcrypt has a 72-byte password limit; keep in sync with Pydantic max lengths.
_BCRYPT_MAX_BYTES = 72


def _hash_password(plain: str) -> str:
    raw = plain.encode("utf-8")
    if len(raw) > _BCRYPT_MAX_BYTES:
        raise HTTPException(
            status_code=422,
            detail="Password exceeds maximum length (72 bytes).",
        )
    return bcrypt.hashpw(raw, bcrypt.gensalt(rounds=12)).decode("ascii")


def _verify_password(plain: str, stored_hash: str) -> bool:
    try:
        raw = plain.encode("utf-8")
        if len(raw) > _BCRYPT_MAX_BYTES:
            return False
        return bcrypt.checkpw(raw, stored_hash.encode("ascii"))
    except Exception:
        return False


class RegisterBody(BaseModel):
    username: str = Field(..., min_length=1, max_length=128)
    password: str = Field(..., min_length=4, max_length=256)
    display_name: str | None = Field(default=None, max_length=256)


class LoginBody(BaseModel):
    username: str = Field(..., min_length=1, max_length=128)
    password: str = Field(..., min_length=1, max_length=256)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str
    display_name: str | None


class UserPublic(BaseModel):
    username: str
    display_name: str | None
    created_at: datetime


class UserPublicPatch(BaseModel):
    """PATCH /me — includes new JWT when login username changes."""

    username: str
    display_name: str | None
    created_at: datetime
    access_token: str | None = None


class PatchMeBody(BaseModel):
    display_name: str | None = Field(default=None, max_length=256)
    username: str | None = Field(default=None, min_length=1, max_length=128)


class ChangePasswordBody(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=256)
    new_password: str = Field(..., min_length=4, max_length=256)


def _norm_username(u: str) -> str:
    return u.strip().lower()


def _create_token(username: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MINUTES)
    return jwt.encode(
        {"sub": username, "exp": expire},
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )


def ensure_demo_user(db: Session) -> None:
    """Seed demo user `user` / `1234` if missing (local dev / README)."""
    un = "user"
    if db.query(AppUser).filter(AppUser.username == un).first():
        return
    db.add(
        AppUser(
            username=un,
            password_hash=_hash_password("1234"),
            display_name="Demo user",
        )
    )
    db.commit()


@router.post("/register", response_model=TokenResponse)
def register(body: RegisterBody, db: Session = Depends(get_db)):
    u = _norm_username(body.username)
    if not re.match(r"^[a-z0-9._-]{3,128}$", u):
        raise HTTPException(
            status_code=422,
            detail="Username must be 3–128 chars: lowercase letters, digits, . _ -",
        )
    if db.query(AppUser).filter(AppUser.username == u).first():
        raise HTTPException(status_code=409, detail="Username already taken")
    dn = (body.display_name or "").strip() or None
    row = AppUser(
        username=u,
        password_hash=_hash_password(body.password),
        display_name=dn,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    token = _create_token(row.username)
    return TokenResponse(
        access_token=token,
        username=row.username,
        display_name=row.display_name,
    )


@router.post("/login", response_model=TokenResponse)
def login(body: LoginBody, db: Session = Depends(get_db)):
    u = _norm_username(body.username)
    row = db.query(AppUser).filter(AppUser.username == u).first()
    if not row or not _verify_password(body.password, row.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = _create_token(row.username)
    return TokenResponse(
        access_token=token,
        username=row.username,
        display_name=row.display_name,
    )


@router.get("/me", response_model=UserPublic)
def me(user: AppUser = Depends(get_current_user)):
    return UserPublic(
        username=user.username,
        display_name=user.display_name,
        created_at=user.created_at,
    )


@router.patch("/me", response_model=UserPublicPatch)
def patch_me(
    body: PatchMeBody,
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
):
    if body.display_name is not None:
        dn = body.display_name.strip()
        user.display_name = dn or None

    new_token: str | None = None
    if body.username is not None:
        new_u = _norm_username(body.username)
        if new_u != user.username:
            if not re.match(r"^[a-z0-9._-]{3,128}$", new_u):
                raise HTTPException(
                    status_code=422,
                    detail="Username must be 3–128 chars: lowercase letters, digits, . _ -",
                )
            if db.query(AppUser).filter(AppUser.username == new_u).first():
                raise HTTPException(status_code=409, detail="Username already taken")
            old_u = user.username
            (
                db.query(PredictionHistory)
                .filter(PredictionHistory.username == old_u)
                .update({PredictionHistory.username: new_u}, synchronize_session=False)
            )
            (
                db.query(WishlistListing)
                .filter(WishlistListing.username == old_u)
                .update({WishlistListing.username: new_u}, synchronize_session=False)
            )
            user.username = new_u
            new_token = _create_token(user.username)

    db.add(user)
    db.commit()
    db.refresh(user)
    return UserPublicPatch(
        username=user.username,
        display_name=user.display_name,
        created_at=user.created_at,
        access_token=new_token,
    )


@router.post("/change-password")
def change_password(
    body: ChangePasswordBody,
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
):
    if not _verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    user.password_hash = _hash_password(body.new_password)
    db.add(user)
    db.commit()
    return {"ok": True}
