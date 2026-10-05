from __future__ import annotations

import json
import hashlib
import hmac
import os
import random
import re
import secrets
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path
from typing import Any

from flask import Flask, Response, g, jsonify, redirect, render_template, request, session
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import check_password_hash, generate_password_hash

from database import PROJECT_ROOT, USER_QUOTA_LIMITS, close_session, db_session, init_db
from models import (
    LearningAttempt,
    PracticeSession,
    QuizSession,
    Review,
    Sentence,
    SentenceQuizSession,
    SentenceReview,
    Settings,
    User,
    Word,
)

ALLOWED_DIFFICULTIES = {"easy", "medium", "hard"}
ALLOWED_WORD_STATUS = {"new", "learning", "reviewing", "mastered"}
ALLOWED_RATINGS = {"again", "hard", "good", "easy"}
USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,32}$")
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
CSRF_HEADER = "X-CSRF-Token"
CSRF_SESSION_KEY = "csrf_token"
MAX_IMPORT_ITEMS = 5000
MAX_WORDS_PER_USER = USER_QUOTA_LIMITS["words"]
MAX_SENTENCES_PER_USER = USER_QUOTA_LIMITS["sentences"]
MAX_REVIEWS_PER_USER = USER_QUOTA_LIMITS["reviews"]
MAX_SENTENCE_REVIEWS_PER_USER = USER_QUOTA_LIMITS["sentence_reviews"]
MAX_QUIZ_HISTORY_PER_USER = USER_QUOTA_LIMITS["quiz_history"]
MAX_SENTENCE_QUIZ_HISTORY_PER_USER = USER_QUOTA_LIMITS["sentence_quiz_history"]
MAX_PRACTICE_HISTORY_PER_USER = USER_QUOTA_LIMITS["practice_history"]
MAX_CREATED_AT_FUTURE_SECONDS = 300
MAX_AUTH_ATTEMPTS = 8
SENSITIVE_ACTION_MAX_ATTEMPTS = 5
AUTH_RATE_WINDOW_SECONDS = 15 * 60
AUTH_RATE_LOCK = threading.Lock()
AUTH_FAILURES: dict[str, list[float]] = {}
REDIS_URL = os.environ.get("VOCABFLOW_REDIS_URL", "").strip()
RATE_LIMIT_NAMESPACE = os.environ.get("VOCABFLOW_RATE_LIMIT_NAMESPACE", "default").strip() or "default"
ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,100}$")

app = Flask(__name__, template_folder="templates", static_folder="static", static_url_path="/static")
APP_ENV = os.environ.get("VOCABFLOW_ENV", "development").strip().lower()
SECRET_KEY = os.environ.get("VOCABFLOW_SECRET_KEY")
if APP_ENV == "production" and not SECRET_KEY:
    raise RuntimeError("VOCABFLOW_SECRET_KEY must be configured in production")
if not SECRET_KEY:
    SECRET_KEY = secrets.token_urlsafe(48)

DUMMY_PASSWORD_HASH = generate_password_hash("VocabFlow-Invalid-Password")

app.config.update(
    SECRET_KEY=SECRET_KEY,
    DEBUG=False,
    TESTING=False,
    MAX_CONTENT_LENGTH=12 * 1024 * 1024,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=(APP_ENV == "production") or os.environ.get("VOCABFLOW_COOKIE_SECURE", "0") == "1",
    SESSION_COOKIE_NAME="vocabflow_session",
    SESSION_REFRESH_EACH_REQUEST=True,
    PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
)

SESSION_ABSOLUTE_LIFETIME_SECONDS = 12 * 60 * 60


# Trust forwarded client information only when the deployment explicitly says how many
# reverse proxies are trusted. Leaving this at 0 is safe for local development.
proxy_hops_raw = os.environ.get("VOCABFLOW_PROXY_HOPS", "0").strip()
try:
    TRUSTED_PROXY_HOPS = int(proxy_hops_raw)
except ValueError as exc:
    if APP_ENV == "production":
        raise RuntimeError("VOCABFLOW_PROXY_HOPS must be a non-negative integer") from exc
    TRUSTED_PROXY_HOPS = 0
if TRUSTED_PROXY_HOPS < 0:
    if APP_ENV == "production":
        raise RuntimeError("VOCABFLOW_PROXY_HOPS must be a non-negative integer")
    TRUSTED_PROXY_HOPS = 0
if TRUSTED_PROXY_HOPS:
    app.wsgi_app = ProxyFix(
        app.wsgi_app,
        x_for=TRUSTED_PROXY_HOPS,
        x_proto=TRUSTED_PROXY_HOPS,
        x_host=TRUSTED_PROXY_HOPS,
    )


class AuthenticationRateLimiter:
    """Shared authentication limiter with Redis as the production backend."""

    def __init__(self, redis_url: str):
        self.redis_url = redis_url
        self._redis = None
        self._redis_error = None

        if APP_ENV == "production" and not redis_url:
            raise RuntimeError(
                "VOCABFLOW_REDIS_URL must be configured in production; "
                "the process-local rate limiter is development-only"
            )

        if redis_url:
            try:
                import redis  # type: ignore
                self._redis = redis.Redis.from_url(
                    redis_url,
                    decode_responses=True,
                    socket_connect_timeout=2,
                    socket_timeout=2,
                    health_check_interval=30,
                )
                self._redis.ping()
            except Exception as exc:  # pragma: no cover - depends on deployment environment
                self._redis = None
                self._redis_error = exc
                if APP_ENV == "production":
                    raise RuntimeError(
                        "VOCABFLOW_REDIS_URL is configured but Redis is unavailable"
                    ) from exc

    @property
    def backend_name(self) -> str:
        return "redis" if self._redis is not None else "memory"

    def _redis_key(self, key: str) -> str:
        # Do not store usernames or IP addresses directly in Redis keys. Hash the
        # logical limiter key so the shared store does not become a source of
        # authentication metadata disclosure.
        digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
        return f"vocabflow:{RATE_LIMIT_NAMESPACE}:auth:{digest}"

    def remaining(self, key: str, limit: int = MAX_AUTH_ATTEMPTS) -> int:
        if self._redis is not None:
            try:
                value = self._redis.get(self._redis_key(key))
                return max(0, limit - int(value or 0))
            except Exception:
                if APP_ENV == "production":
                    raise
        now = time.monotonic()
        cutoff = now - AUTH_RATE_WINDOW_SECONDS
        with AUTH_RATE_LOCK:
            attempts = [stamp for stamp in AUTH_FAILURES.get(key, []) if stamp > cutoff]
            AUTH_FAILURES[key] = attempts
            return max(0, limit - len(attempts))

    def record(self, key: str) -> None:
        if self._redis is not None:
            try:
                redis_key = self._redis_key(key)
                count = int(self._redis.incr(redis_key))
                if count == 1:
                    self._redis.expire(redis_key, AUTH_RATE_WINDOW_SECONDS)
                return
            except Exception:
                if APP_ENV == "production":
                    raise
        now = time.monotonic()
        cutoff = now - AUTH_RATE_WINDOW_SECONDS
        with AUTH_RATE_LOCK:
            attempts = [stamp for stamp in AUTH_FAILURES.get(key, []) if stamp > cutoff]
            attempts.append(now)
            AUTH_FAILURES[key] = attempts

    def clear(self, key: str) -> None:
        if self._redis is not None:
            try:
                self._redis.delete(self._redis_key(key))
                return
            except Exception:
                if APP_ENV == "production":
                    raise
        with AUTH_RATE_LOCK:
            AUTH_FAILURES.pop(key, None)


AUTH_RATE_LIMITER = AuthenticationRateLimiter(REDIS_URL)


@app.before_request
def prepare_csp_nonce():
    # Per-response nonce for the small inline bootstrap snippets that are required
    # before the external JavaScript bundle loads.
    g.csp_nonce = secrets.token_urlsafe(18)


def session_is_expired() -> bool:
    """Return True when the authenticated session exceeded its absolute lifetime.

    The check is intentionally independent from Flask's cookie refresh behavior.
    SESSION_REFRESH_EACH_REQUEST may extend the browser cookie expiry, but it must
    never extend this server-enforced absolute session lifetime.
    """
    if current_user_id() is None:
        return False

    expires_at = session.get("session_expires_at")
    if expires_at is not None:
        try:
            return time.time() >= float(expires_at)
        except (TypeError, ValueError):
            return True

    # Backward compatibility for sessions created before S4.5.
    started_at = session.get("session_started_at")
    if started_at is None:
        return False
    try:
        return (time.time() - float(started_at)) >= SESSION_ABSOLUTE_LIFETIME_SECONDS
    except (TypeError, ValueError):
        return True


def expire_authenticated_session() -> None:
    """Clear all server-side session state for an expired session."""
    session.clear()
    session.permanent = False


def session_expired_response():
    expire_authenticated_session()
    return jsonify({"ok": False, "authenticated": False, "error": "Session expired"}), 401


@app.before_request
def protect_api_requests():
    if not request.path.startswith("/api/"):
        return None

    uid = current_user_id()
    public_auth_endpoints = {"auth_csrf", "auth_me", "auth_login", "auth_register", "auth_logout"}
    if uid is not None and request.endpoint not in public_auth_endpoints and session_is_expired():
        return session_expired_response()

    if request.method in {"POST", "PUT", "PATCH", "DELETE"} and not csrf_valid():
        return jsonify({"ok": False, "error": "Invalid or missing CSRF token"}), 403

    return None


@app.after_request
def add_security_headers(response):
    # HTML and API responses must not be cached because they can contain
    # authenticated account or learning data. Static assets remain cacheable.
    if response.mimetype == "text/html" or request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"

    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")

    nonce = getattr(g, "csp_nonce", "")
    csp = [
        "default-src 'self'",
        f"script-src 'self' 'nonce-{nonce}'" if nonce else "script-src 'self'",
        "style-src 'self'",
        "style-src-attr 'none'",
        "font-src 'self'",
        "img-src 'self' data: blob:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'self'",
        "form-action 'self'",
    ]
    response.headers.setdefault("Content-Security-Policy", "; ".join(csp))

    if request.is_secure:
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response


@app.errorhandler(413)
def request_too_large(error):
    if request.path.startswith("/api/"):
        return jsonify({"ok": False, "error": "Request is too large"}), 413
    return Response("Request is too large", status=413, mimetype="text/plain")


@app.teardown_appcontext
def teardown_db(_error=None):
    close_session()


def clean_text(value: Any, default: str = "") -> str:
    return str(value if value is not None else default).strip()


def clean_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() in {"1", "true", "yes", "on"}
    return bool(value)


def clean_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def clean_float(value: Any, default: float = 2.5) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_created_at(value: Any) -> str:
    if value in (None, ""):
        return now_iso()
    if not isinstance(value, str):
        raise ValueError("createdAt must be an ISO-8601 date string")
    raw = value.strip()
    if not raw or len(raw) > 40:
        raise ValueError("Invalid createdAt")
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("createdAt must be a valid ISO-8601 date") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    parsed = parsed.astimezone(timezone.utc)
    if parsed > datetime.now(timezone.utc) + timedelta(seconds=MAX_CREATED_AT_FUTURE_SECONDS):
        raise ValueError("createdAt cannot be in the future")
    return parsed.isoformat()


def current_user_id() -> int | None:
    value = session.get("user_id")
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def current_user(session_db):
    uid = current_user_id()
    return session_db.get(User, uid) if uid is not None else None


def csrf_token() -> str:
    token = session.get(CSRF_SESSION_KEY)
    if not isinstance(token, str) or len(token) < 32:
        token = secrets.token_urlsafe(32)
        session[CSRF_SESSION_KEY] = token
    return token


def rotate_csrf_token() -> str:
    token = secrets.token_urlsafe(32)
    session[CSRF_SESSION_KEY] = token
    return token


def start_authenticated_session(user_id: int, security_version: int = 1) -> str:
    now = time.time()
    session.clear()
    session.permanent = True
    session["user_id"] = user_id
    session["session_started_at"] = now
    session["session_expires_at"] = now + SESSION_ABSOLUTE_LIFETIME_SECONDS
    session["security_version"] = int(security_version or 1)
    return rotate_csrf_token()


def csrf_valid() -> bool:
    expected = session.get(CSRF_SESSION_KEY)
    supplied = request.headers.get(CSRF_HEADER, "")
    return (
        isinstance(expected, str)
        and bool(supplied)
        and len(supplied) <= 256
        and hmac.compare_digest(expected, supplied)
    )


def client_key(scope: str, username: str = "") -> str:
    ip = request.remote_addr or "unknown"
    return f"{scope}:{ip}:{username.casefold()}"


def rate_limit_key(key: str, limit: int = MAX_AUTH_ATTEMPTS) -> int:
    return AUTH_RATE_LIMITER.remaining(key, limit)


def record_auth_failure(key: str) -> None:
    AUTH_RATE_LIMITER.record(key)


def clear_auth_failures(key: str) -> None:
    AUTH_RATE_LIMITER.clear(key)


def auth_rate_limited(key: str, limit: int = MAX_AUTH_ATTEMPTS) -> bool:
    return rate_limit_key(key, limit) <= 0


def rate_limit_response() -> Response:
    response = jsonify({"ok": False, "error": "Too many authentication attempts. Please try again later."})
    response.status_code = 429
    retry_after = AUTH_RATE_WINDOW_SECONDS
    response.headers["Retry-After"] = str(retry_after)
    return response


def bounded_text(value: Any, max_length: int, default: str = "") -> str:
    value = clean_text(value, default)
    if len(value) > max_length:
        raise ValueError(f"Value exceeds the maximum length of {max_length} characters")
    return value


class UserQuotaExceeded(ValueError):
    def __init__(self, resource: str, limit: int):
        self.resource = resource
        self.limit = limit
        super().__init__(f"{resource} quota reached (maximum {limit})")


def enforce_user_quota(session_db, model, user_id: int, limit: int, resource: str, additional: int = 1) -> None:
    if additional < 0:
        raise ValueError("Invalid quota increment")
    current = int(session_db.execute(select(func.count()).select_from(model).where(model.user_id == user_id)).scalar_one())
    if current + additional > limit:
        raise UserQuotaExceeded(resource, limit)


def new_entity_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def safe_identifier(value: Any, field: str = "id", max_length: int = 100) -> str:
    value = clean_text(value)
    if not value or len(value) > max_length or not ID_RE.fullmatch(value):
        raise ValueError(f"Invalid {field}")
    return value


def safe_json_for_script(value: Any) -> str:
    serialized = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return serialized.translate(str.maketrans({
        "<": "\\u003c",
        ">": "\\u003e",
        "&": "\\u0026",
        "\u2028": "\\u2028",
        "\u2029": "\\u2029",
    }))


def auth_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if session_is_expired():
            return session_expired_response()
        session_db = db_session()
        user = current_user(session_db)
        if user is None:
            # A stale/deleted user id in the browser session must not count as
            # an authenticated account. Clear it before returning 401.
            session.clear()
            return jsonify({"ok": False, "authenticated": False, "error": "Authentication required"}), 401
        current_version = int(getattr(user, "security_version", 1) or 1)
        session_version = session.get("security_version")
        if session_version is None:
            session["security_version"] = current_version
        else:
            try:
                if int(session_version) != current_version:
                    session.clear()
                    return jsonify({"ok": False, "authenticated": False, "error": "Authentication required"}), 401
            except (TypeError, ValueError):
                session.clear()
                return jsonify({"ok": False, "authenticated": False, "error": "Authentication required"}), 401
        return fn(*args, **kwargs)
    return wrapper


def normalize_username(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("Username must be a string")
    username = value.strip()
    if not USERNAME_RE.fullmatch(username):
        raise ValueError("Username must be 3-32 characters using letters, numbers, or underscore")
    return username


COMMON_WEAK_PASSWORDS = {
    "12345678", "123456789", "1234567890", "password", "password1", "password123",
    "qwerty", "qwerty123", "qwertyui", "123123123", "11111111", "00000000",
    "abcdefgh", "abcdefgh1", "abcd1234", "iloveyou", "iloveyou1", "admin",
    "admin123", "welcome", "welcome1", "welcome123", "letmein", "letmein1",
    "football", "monkey", "monkey123", "login", "login123", "passw0rd",
    "secret123", "changeme", "dragon123", "baseball", "master123", "sunshine",
    "princess", "superman", "trustno1", "zaq12wsx", "asdfghjk", "zxcvbnm",
    "1q2w3e4r", "1qaz2wsx", "qazwsxed", "qweasdzxc", "987654321", "87654321",
    "iloveyou2", "lovely123", "hello123", "welcome2", "password2", "password12",
    "computer", "internet", "freedom", "whatever", "starwars", "charlie",
    "donald", "login1", "test1234", "testing1", "letmein123", "adminadmin",
}

def validate_password(value: Any, username: str | None = None, email: str | None = None) -> str:
    if not isinstance(value, str):
        raise ValueError("Password must be a string")
    password = value
    normalized = password.strip().casefold()
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters")
    if len(password) > 128:
        raise ValueError("Password must not exceed 128 characters")
    if normalized in COMMON_WEAK_PASSWORDS:
        raise ValueError("Choose a stronger password. This password is too common.")
    if len(set(password)) == 1:
        raise ValueError("Choose a stronger password.")
    if username:
        username_key = username.strip().casefold()
        if normalized == username_key or (len(username_key) >= 4 and username_key in normalized):
            raise ValueError("Password cannot be the same as or contain your username.")
    if email:
        local_part = email.split("@", 1)[0].strip().casefold()
        if local_part and (normalized == local_part or (len(local_part) >= 5 and local_part in normalized)):
            raise ValueError("Password cannot be the same as or contain your email name.")
    return password

def verify_current_password(user: User, supplied: Any) -> bool:
    return isinstance(supplied, str) and bool(supplied) and check_password_hash(user.password_hash, supplied)


def normalize_email(value: Any, required: bool = True) -> str:
    email = str(value or "").strip().lower()
    if not email:
        if required:
            raise ValueError("Email address is required")
        return ""
    if len(email) > 160 or not EMAIL_RE.fullmatch(email):
        raise ValueError("Enter a valid email address")
    return email


def normalize_full_name(value: Any, required: bool = True) -> str:
    name = str(value or "").strip()
    if not name:
        if required:
            raise ValueError("Full name is required")
        return ""
    if len(name) > 80:
        raise ValueError("Full name must not exceed 80 characters")
    return name


def user_to_dict(row: User) -> dict[str, Any]:
    return {"id": row.id, "username": row.username, "fullName": getattr(row, "full_name", "") or "", "email": getattr(row, "email", "") or "", "createdAt": row.created_at}


def review_state_defaults() -> dict[str, Any]:
    return {
        "status": "new",
        "repetitions": 0,
        "interval": 0,
        "ease_factor": 2.5,
        "last_review": None,
        "next_review": None,
    }


def preserve_server_review_state(item: dict[str, Any], existing: Word | Sentence | None) -> None:
    if existing is None:
        fields = review_state_defaults()
    else:
        fields = {
            "status": existing.status,
            "repetitions": existing.repetitions,
            "interval": existing.interval,
            "ease_factor": existing.ease_factor,
            "last_review": existing.last_review,
            "next_review": existing.next_review,
        }
    item.update(fields)


def normalize_word(raw: dict[str, Any]) -> dict[str, Any]:
    word_id = safe_identifier(raw.get("id"), "word id", 80)
    word = bounded_text(raw.get("word"), 255)
    definition = bounded_text(raw.get("definition"), 4000)
    if not word or not definition:
        raise ValueError("Word and definition are required")
    difficulty = clean_text(raw.get("difficulty"), "medium").lower()
    status = clean_text(raw.get("status"), "new").lower()
    if difficulty not in ALLOWED_DIFFICULTIES:
        difficulty = "medium"
    if status not in ALLOWED_WORD_STATUS:
        status = "new"
    return {
        "id": word_id,
        "word": word,
        "definition": definition,
        "part_of_speech": bounded_text(raw.get("partOfSpeech"), 80),
        "example_sentence": bounded_text(raw.get("exampleSentence"), 4000),
        "category": bounded_text(raw.get("category"), 120, "General") or "General",
        "difficulty": difficulty,
        "favorite": clean_bool(raw.get("favorite", False)),
        "status": status,
        "repetitions": max(0, clean_int(raw.get("repetitions"), 0)),
        "interval": max(0, clean_int(raw.get("interval"), 0)),
        "ease_factor": max(1.0, clean_float(raw.get("easeFactor"), 2.5)),
        "last_review": None,
        "next_review": None,
        "created_at": normalize_created_at(raw.get("createdAt")),
    }


def normalize_sentence(raw: dict[str, Any]) -> dict[str, Any]:
    sentence_id = safe_identifier(raw.get("id"), "sentence id", 80)
    sentence = " ".join(bounded_text(raw.get("sentence"), 5000).split())
    meaning = bounded_text(raw.get("arabicMeaning"), 4000)
    if not sentence or not meaning:
        raise ValueError("Sentence and Arabic meaning are required")
    difficulty = clean_text(raw.get("difficulty"), "medium").lower()
    status = clean_text(raw.get("status"), "new").lower()
    if difficulty not in ALLOWED_DIFFICULTIES:
        difficulty = "medium"
    if status not in ALLOWED_WORD_STATUS:
        status = "new"
    return {
        "id": sentence_id,
        "sentence": sentence,
        "arabic_meaning": meaning,
        "category": bounded_text(raw.get("category"), 120, "General") or "General",
        "difficulty": difficulty,
        "favorite": clean_bool(raw.get("favorite", False)),
        "status": status,
        "repetitions": max(0, clean_int(raw.get("repetitions"), 0)),
        "interval": max(0, clean_int(raw.get("interval"), 0)),
        "ease_factor": max(1.0, clean_float(raw.get("easeFactor"), 2.5)),
        "last_review": None,
        "next_review": None,
        "created_at": normalize_created_at(raw.get("createdAt")),
    }


def word_to_dict(row: Word) -> dict[str, Any]:
    return {
        "id": row.id,
        "word": row.word,
        "definition": row.definition,
        "partOfSpeech": row.part_of_speech,
        "exampleSentence": row.example_sentence,
        "category": row.category,
        "difficulty": row.difficulty,
        "favorite": row.favorite,
        "status": row.status,
        "repetitions": row.repetitions,
        "interval": row.interval,
        "easeFactor": row.ease_factor,
        "lastReview": row.last_review,
        "nextReview": row.next_review,
        "createdAt": row.created_at,
    }


def sentence_to_dict(row: Sentence) -> dict[str, Any]:
    return {
        "id": row.id,
        "sentence": row.sentence,
        "arabicMeaning": row.arabic_meaning,
        "category": row.category,
        "difficulty": row.difficulty,
        "favorite": row.favorite,
        "status": row.status,
        "repetitions": row.repetitions,
        "interval": row.interval,
        "easeFactor": row.ease_factor,
        "lastReview": row.last_review,
        "nextReview": row.next_review,
        "createdAt": row.created_at,
    }


def review_to_dict(row: Review) -> dict[str, Any]:
    return {"wordId": row.word_id, "rating": row.rating, "reviewedAt": row.reviewed_at, "interval": row.interval}


def sentence_review_to_dict(row: SentenceReview) -> dict[str, Any]:
    return {"sentenceId": row.sentence_id, "rating": row.rating, "reviewedAt": row.reviewed_at, "interval": row.interval}


def settings_to_dict(row: Settings) -> dict[str, Any]:
    return {"theme": row.theme, "dailyNewWords": row.daily_new_words, "language": row.language}


def patch_payload(raw: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
    merged = dict(current)
    aliases = {
        "part_of_speech": "partOfSpeech",
        "example_sentence": "exampleSentence",
        "arabic_meaning": "arabicMeaning",
        "ease_factor": "easeFactor",
        "last_review": "lastReview",
        "next_review": "nextReview",
        "created_at": "createdAt",
    }
    for key, value in raw.items():
        merged[aliases.get(key, key)] = value
    return merged


def user_words(session_db, user_id: int):
    return session_db.execute(select(Word).where(Word.user_id == user_id).order_by(Word.created_at, Word.id)).scalars().all()


def user_sentences(session_db, user_id: int):
    return session_db.execute(select(Sentence).where(Sentence.user_id == user_id).order_by(Sentence.created_at, Sentence.id)).scalars().all()


def user_settings(session_db, user_id: int, create: bool = True) -> Settings | None:
    row = session_db.execute(select(Settings).where(Settings.user_id == user_id)).scalar_one_or_none()
    if row is None and create:
        row = Settings(user_id=user_id, theme="light", daily_new_words=10, language="en")
        session_db.add(row)
        session_db.flush()
    return row


def get_state(session_db, user_id: int) -> dict[str, Any]:
    words = user_words(session_db, user_id)
    sentences = user_sentences(session_db, user_id)
    reviews = session_db.execute(select(Review).where(Review.user_id == user_id).order_by(Review.id)).scalars().all()
    sentence_reviews = session_db.execute(select(SentenceReview).where(SentenceReview.user_id == user_id).order_by(SentenceReview.id)).scalars().all()
    quiz_history = session_db.execute(select(QuizSession).where(QuizSession.user_id == user_id).order_by(QuizSession.date, QuizSession.session_id)).scalars().all()
    sentence_quiz_history = session_db.execute(select(SentenceQuizSession).where(SentenceQuizSession.user_id == user_id).order_by(SentenceQuizSession.date, SentenceQuizSession.session_id)).scalars().all()
    practice_history = session_db.execute(select(PracticeSession).where(PracticeSession.user_id == user_id).order_by(PracticeSession.date, PracticeSession.session_id)).scalars().all()
    settings = user_settings(session_db, user_id)
    return {
        "words": [word_to_dict(row) for row in words],
        "sentences": [sentence_to_dict(row) for row in sentences],
        "reviews": [review_to_dict(row) for row in reviews],
        "sentenceReviews": [sentence_review_to_dict(row) for row in sentence_reviews],
        "quizHistory": [
            {"sessionId": row.session_id, "date": row.date, "totalQuestions": row.total_questions, "correct": row.correct, "durationSeconds": row.duration_seconds}
            for row in quiz_history
        ],
        "sentenceQuizHistory": [
            {"sessionId": row.session_id, "date": row.date, "totalQuestions": row.total_questions, "correct": row.correct}
            for row in sentence_quiz_history
        ],
        "practiceHistory": [
            {"sessionId": row.session_id, "date": row.date, "totalTasks": row.total_tasks, "correct": row.correct, "words": row.words, "sentences": row.sentences}
            for row in practice_history
        ],
        "settings": settings_to_dict(settings),
    }


def _replace_owned_entities(session_db, model, normalized: list[dict[str, Any]], user_id: int, label: str) -> None:
    incoming_ids = {item["id"] for item in normalized}
    existing_rows = session_db.execute(select(model).where(model.user_id == user_id)).scalars().all()
    existing_by_id = {row.id: row for row in existing_rows}

    # Check IDs owned by another account in bounded batches so this also works
    # with SQLite builds that retain the older 999-bind-variable limit.
    new_ids = [item_id for item_id in incoming_ids if item_id not in existing_by_id]
    for offset in range(0, len(new_ids), 500):
        chunk = new_ids[offset:offset + 500]
        conflicts = session_db.execute(
            select(model.id).where(model.id.in_(chunk), (model.user_id != user_id) | model.user_id.is_(None))
        ).scalars().first()
        if conflicts is not None:
            raise ValueError(f"{label} id is already used by another account")

    for row in existing_rows:
        if row.id not in incoming_ids:
            session_db.delete(row)
    # Flush the bounded deletion batch first so foreign-key cascades are
    # applied before any incoming review history is validated or inserted.
    session_db.flush()

    new_rows = []
    for item in normalized:
        row = existing_by_id.get(item["id"])
        if row is None:
            row = model(id=item["id"], user_id=user_id)
            new_rows.append(row)
        for key, value in item.items():
            if key != "id":
                setattr(row, key, value)
    if new_rows:
        session_db.add_all(new_rows)


def replace_words(session_db, items: list[dict[str, Any]], user_id: int) -> None:
    normalized = [normalize_word(item) for item in items]
    existing_ids = {row.id for row in session_db.execute(select(Word.id).where(Word.user_id == user_id)).all()}
    additions = sum(1 for item in normalized if item["id"] not in existing_ids)
    enforce_user_quota(session_db, Word, user_id, MAX_WORDS_PER_USER, "Words", additional=additions)
    seen = set()
    existing_rows = {row.id: row for row in session_db.execute(select(Word).where(Word.user_id == user_id)).scalars().all()}
    for item in normalized:
        key = item["word"].casefold()
        if key in seen:
            raise ValueError(f"Duplicate word: {item['word']}")
        seen.add(key)
        existing = existing_rows.get(item["id"])
        preserve_server_review_state(item, existing)
        if existing is not None:
            item["created_at"] = existing.created_at
    _replace_owned_entities(session_db, Word, normalized, user_id, "Word")


def replace_sentences(session_db, items: list[dict[str, Any]], user_id: int) -> None:
    normalized = [normalize_sentence(item) for item in items]
    existing_ids = {row.id for row in session_db.execute(select(Sentence.id).where(Sentence.user_id == user_id)).all()}
    additions = sum(1 for item in normalized if item["id"] not in existing_ids)
    enforce_user_quota(session_db, Sentence, user_id, MAX_SENTENCES_PER_USER, "Sentences", additional=additions)
    seen = set()
    existing_rows = {row.id: row for row in session_db.execute(select(Sentence).where(Sentence.user_id == user_id)).scalars().all()}
    for item in normalized:
        key = item["sentence"].casefold().rstrip(".!?,;:")
        if key in seen:
            raise ValueError(f"Duplicate sentence: {item['sentence']}")
        seen.add(key)
        existing = existing_rows.get(item["id"])
        preserve_server_review_state(item, existing)
        if existing is not None:
            item["created_at"] = existing.created_at
    _replace_owned_entities(session_db, Sentence, normalized, user_id, "Sentence")


# --------------------------- Server-owned learning attempts ---------------------------

ATTEMPT_KINDS = {"quiz", "sentence-quiz", "practice"}
MAX_ATTEMPT_ITEMS = 50
ATTEMPT_MAX_AGE_SECONDS = 2 * 60 * 60


def attempt_uuid(kind: str) -> str:
    return f"{kind}_{uuid.uuid4().hex}"


def _norm_answer(value: Any) -> str:
    value = str(value or "").strip().lower()
    value = value.replace("“", "").replace("”", "").replace('"', "").replace("’", "")
    value = re.sub(r"[.!?,;:]+$", "", value)
    return re.sub(r"\s+", " ", value).strip()


def _clean_sentence_for_arrange(value: str) -> str:
    return re.sub(r"[.!?]+$", "", str(value or "").strip())


def _unique_values(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        key = _norm_answer(value)
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(value)
    return result


def _public_question(question: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in question.items() if key not in {"correct", "answer", "correct_order"}}


def _load_attempt(session_db, attempt_id: str, kind: str) -> LearningAttempt | None:
    row = session_db.get(LearningAttempt, attempt_id)
    if row is None or row.kind != kind or row.user_id != current_user_id() or row.completed:
        return None
    try:
        age = time.time() - datetime.fromisoformat(row.started_at).timestamp()
    except (TypeError, ValueError, OSError):
        age = ATTEMPT_MAX_AGE_SECONDS + 1
    if age > ATTEMPT_MAX_AGE_SECONDS:
        row.completed = True
        session_db.commit()
        return None
    return row


def _finish_attempt(session_db, attempt: LearningAttempt) -> dict[str, Any]:
    questions = json.loads(attempt.questions_json)
    total = len(questions)
    try:
        started = datetime.fromisoformat(attempt.started_at).timestamp()
        duration = max(1, round(time.time() - started))
    except (TypeError, ValueError, OSError):
        duration = 1
    correct = min(attempt.correct, total)
    if attempt.kind == "quiz":
        enforce_user_quota(session_db, QuizSession, attempt.user_id, MAX_QUIZ_HISTORY_PER_USER, "Quiz history")
    elif attempt.kind == "sentence-quiz":
        enforce_user_quota(session_db, SentenceQuizSession, attempt.user_id, MAX_SENTENCE_QUIZ_HISTORY_PER_USER, "Sentence quiz history")
    else:
        enforce_user_quota(session_db, PracticeSession, attempt.user_id, MAX_PRACTICE_HISTORY_PER_USER, "Practice history")
    attempt.completed = True
    if attempt.kind == "quiz":
        session_db.add(QuizSession(session_id=attempt.attempt_id, user_id=attempt.user_id, date=now_iso(), total_questions=total, correct=correct, duration_seconds=duration))
    elif attempt.kind == "sentence-quiz":
        session_db.add(SentenceQuizSession(session_id=attempt.attempt_id, user_id=attempt.user_id, date=now_iso(), total_questions=total, correct=correct))
    else:
        session_db.add(PracticeSession(session_id=attempt.attempt_id, user_id=attempt.user_id, date=now_iso(), total_tasks=total, correct=correct, words=attempt.words, sentences=attempt.sentences))
    session_db.commit()
    return {"completed": True, "correct": correct, "total": total, "durationSeconds": duration, "words": attempt.words, "sentences": attempt.sentences}


def _create_attempt(session_db, user_id: int, kind: str, questions: list[dict[str, Any]], words: int = 0, sentences: int = 0) -> LearningAttempt:
    if kind not in ATTEMPT_KINDS:
        raise ValueError("Invalid attempt kind")
    session_db.execute(delete(LearningAttempt).where(LearningAttempt.user_id == user_id, LearningAttempt.kind == kind, LearningAttempt.completed.is_(False)))
    row = LearningAttempt(
        attempt_id=attempt_uuid(kind),
        user_id=user_id,
        kind=kind,
        questions_json=json.dumps(questions, ensure_ascii=False, separators=(",", ":")),
        current_index=0,
        correct=0,
        total_items=len(questions),
        words=words,
        sentences=sentences,
        started_at=now_iso(),
        completed=False,
    )
    session_db.add(row)
    session_db.commit()
    return row


def _word_quiz_questions(session_db, user_id: int, count: int, difficulty: str, quiz_type: str) -> list[dict[str, Any]]:
    words = user_words(session_db, user_id)
    if len(words) < 4:
        raise ValueError("Add at least four vocabulary words before starting a quiz")
    pool = [w for w in words if difficulty == "all" or w.difficulty == difficulty] or words
    candidates = pool[:]
    random.shuffle(candidates)
    result: list[dict[str, Any]] = []
    for word in candidates:
        actual = random.choice(("word-definition", "definition-word")) if quiz_type == "mixed" else quiz_type
        if actual == "definition-word":
            distractors = _unique_values([w.word for w in words if w.id != word.id])
            if len(distractors) < 3:
                continue
            options = [word.word, *random.sample(distractors, 3)]
            random.shuffle(options)
            result.append({"wordId": word.id, "type": actual, "prompt": word.definition, "options": options, "correct": word.word})
        else:
            if not word.definition.strip():
                continue
            distractors = _unique_values([w.definition for w in words if w.id != word.id])
            if len(distractors) < 3:
                continue
            options = [word.definition, *random.sample(distractors, 3)]
            random.shuffle(options)
            result.append({"wordId": word.id, "type": actual, "prompt": word.word, "options": options, "correct": word.definition})
        if len(result) >= count:
            break
    if not result:
        raise ValueError("There are not enough distinct answers to build this quiz")
    return result[:count]


def _sentence_quiz_questions(session_db, user_id: int, count: int, mode: str) -> list[dict[str, Any]]:
    sentences = user_sentences(session_db, user_id)
    if not sentences:
        raise ValueError("Add at least one sentence before starting")
    mode = mode if mode in {"mixed", "meaning-mcq", "fill", "translate", "arrange"} else "mixed"
    pool = sentences[:]
    random.shuffle(pool)
    result: list[dict[str, Any]] = []
    for item in pool:
        q_type = random.choice(["meaning-mcq", "fill", "translate", "arrange"]) if mode == "mixed" else mode
        if q_type == "meaning-mcq":
            distractors = _unique_values([s.arabic_meaning for s in sentences if s.id != item.id])
            if len(distractors) >= 3:
                options = [item.arabic_meaning, *random.sample(distractors, 3)]
                random.shuffle(options)
                result.append({"sentenceId": item.id, "type": "meaning-mcq", "prompt": item.sentence, "options": options, "answer": item.arabic_meaning})
                if len(result) >= count:
                    break
                continue
            q_type = "translate"
        if q_type == "fill":
            parts = item.sentence.split()
            if len(parts) >= 3:
                idx = len(parts) // 2
                answer = re.sub(r"[.,!?;:]+$", "", parts[idx])
                if answer:
                    parts[idx] = "_____"
                    result.append({"sentenceId": item.id, "type": "fill", "prompt": " ".join(parts), "answer": answer})
                    if len(result) >= count:
                        break
                    continue
            q_type = "translate"
        if q_type == "translate":
            result.append({"sentenceId": item.id, "type": "translate", "prompt": item.arabic_meaning, "answer": item.sentence})
        elif q_type == "arrange":
            clean = _clean_sentence_for_arrange(item.sentence)
            tokens = clean.split()
            shuffled = tokens[:]
            random.shuffle(shuffled)
            result.append({"sentenceId": item.id, "type": "arrange", "prompt": "Put the words in the correct order.", "answer": clean, "tokens": shuffled, "correct_order": tokens})
        if len(result) >= count:
            break
    return result[:count]


def _sentence_for_word(sentences: list[Sentence], word_value: str) -> Sentence | None:
    target = re.sub(r"[^a-z0-9-]", "", str(word_value or "").lower())
    if not target:
        return None
    for sentence in sentences:
        tokens = [re.sub(r"[^a-z0-9-]", "", token.lower()) for token in sentence.sentence.split()]
        if target in tokens:
            return sentence
    return None


def _practice_tasks(session_db, user_id: int, word_count: int, sentence_count: int, total: int, mode: str) -> tuple[list[dict[str, Any]], int, int]:
    words = user_words(session_db, user_id)
    sentences = user_sentences(session_db, user_id)
    if not words and not sentences:
        raise ValueError("Add vocabulary or sentences before starting practice")
    mode = mode if mode in {"balanced", "words", "sentences"} else "balanced"
    random.shuffle(words)
    random.shuffle(sentences)
    selected_words = words[:min(word_count, len(words))]
    selected_sentences = sentences[:min(sentence_count, len(sentences))]
    tasks: list[dict[str, Any]] = []

    def add_word_task(word: Word):
        pool = _unique_values([word.definition] + [w.definition for w in words if w.id != word.id and w.definition.strip()])
        if len(pool) < 4:
            return
        options = random.sample(pool, 4)
        if word.definition not in options:
            options[0] = word.definition
        random.shuffle(options)
        tasks.append({"kind":"word","prompt":word.word,"secondary":"What is the Arabic meaning?","options":options,"answer":word.definition,"wordId":word.id})

    def add_sentence_task(sentence: Sentence):
        tasks.append({"kind":"sentence","prompt":sentence.sentence,"secondary":"What does this sentence mean?","answer":sentence.arabic_meaning,"sentenceId":sentence.id})

    def add_fill_task(sentence: Sentence):
        parts = sentence.sentence.split()
        if len(parts) < 3:
            add_sentence_task(sentence)
            return
        idx = len(parts)//2
        answer = re.sub(r"[.,!?;:]+$", "", parts[idx])
        parts[idx] = "_____"
        tasks.append({"kind":"fill","prompt":" ".join(parts),"secondary":"Complete the missing word.","answer":answer,"sentenceId":sentence.id})

    def add_writing_task(sentence: Sentence):
        tasks.append({"kind":"writing","prompt":sentence.arabic_meaning,"secondary":"Write the English sentence from memory.","answer":sentence.sentence,"sentenceId":sentence.id})

    if mode == "words":
        for word in selected_words:
            add_word_task(word)
    elif mode == "sentences":
        for sentence in selected_sentences:
            add_fill_task(sentence)
    else:
        for word in selected_words:
            add_word_task(word)
            related = _sentence_for_word(sentences, word.word)
            if related:
                add_sentence_task(related)
        for sentence in selected_sentences:
            add_fill_task(sentence) if random.random() < .5 else add_writing_task(sentence)
    random.shuffle(tasks)
    tasks = tasks[:max(1, min(total, MAX_ATTEMPT_ITEMS))]
    return tasks, len(selected_words), len(selected_sentences)


def _score_attempt_answer(attempt: LearningAttempt, payload: dict[str, Any]) -> tuple[bool, str]:
    questions = json.loads(attempt.questions_json)
    if attempt.current_index >= len(questions):
        raise ValueError("Attempt is already complete")
    question = questions[attempt.current_index]
    if attempt.kind == "quiz":
        index = clean_int(payload.get("selectedIndex"), -1)
        options = question.get("options") or []
        if index < 0 or index >= len(options):
            raise ValueError("Invalid answer")
        chosen = str(options[index])
        return chosen == str(question.get("correct", "")), str(question.get("correct", ""))
    if attempt.kind == "sentence-quiz":
        q_type = question.get("type")
        if q_type == "meaning-mcq":
            index = clean_int(payload.get("selectedIndex"), -1)
            options = question.get("options") or []
            if index < 0 or index >= len(options):
                raise ValueError("Invalid answer")
            chosen = str(options[index])
            return _norm_answer(chosen) == _norm_answer(question.get("answer")), str(question.get("answer", ""))
        if q_type in {"fill", "translate"}:
            chosen = clean_text(payload.get("text"))
            return _norm_answer(chosen) == _norm_answer(question.get("answer")), str(question.get("answer", ""))
        if q_type == "arrange":
            order = payload.get("order")
            tokens = question.get("tokens") or []
            if not isinstance(order, list) or len(order) != len(tokens):
                raise ValueError("Invalid word order")
            try:
                order = [int(item) for item in order]
            except (TypeError, ValueError):
                raise ValueError("Invalid word order")
            if sorted(order) != list(range(len(tokens))):
                raise ValueError("Invalid word order")
            chosen = " ".join(tokens[index] for index in order)
            return _norm_answer(chosen) == _norm_answer(question.get("answer")), str(question.get("answer", ""))
        raise ValueError("Invalid question type")
    kind = question.get("kind")
    if kind == "word":
        index = clean_int(payload.get("selectedIndex"), -1)
        options = question.get("options") or []
        if index < 0 or index >= len(options):
            raise ValueError("Invalid answer")
        chosen = str(options[index])
        return _norm_answer(chosen) == _norm_answer(question.get("answer")), str(question.get("answer", ""))
    if kind in {"fill", "writing"}:
        chosen = clean_text(payload.get("text"))
        return _norm_answer(chosen) == _norm_answer(question.get("answer")), str(question.get("answer", ""))
    if kind == "sentence":
        if payload.get("action") != "reveal":
            raise ValueError("Invalid answer")
        return False, str(question.get("answer", ""))
    raise ValueError("Invalid task type")


def _attempt_public_state(attempt: LearningAttempt) -> dict[str, Any]:
    questions = json.loads(attempt.questions_json)
    return {
        "attemptId": attempt.attempt_id,
        "kind": attempt.kind,
        "questions": [_public_question(question) for question in questions],
        "currentIndex": attempt.current_index,
        "total": len(questions),
        "words": attempt.words,
        "sentences": attempt.sentences,
    }


def normalize_review_payload(raw: dict[str, Any], id_key: str) -> dict[str, Any]:
    """Accept only the review decision and an optimistic concurrency token.

    The browser must not be able to choose the review timestamp or interval.
    Those values are calculated from the server-side item state.
    """
    if not isinstance(raw, dict):
        raise ValueError("JSON object required")
    if "expectedLastReview" not in raw:
        raise ValueError("expectedLastReview is required")
    item_id = safe_identifier(raw.get(id_key), id_key, 80)
    rating = clean_text(raw.get("rating")).lower()
    if rating not in ALLOWED_RATINGS:
        raise ValueError("Invalid review rating")
    expected = raw.get("expectedLastReview")
    if expected is not None:
        expected = bounded_text(expected, 40)
        if not expected:
            raise ValueError("Invalid expectedLastReview")
    return {id_key: item_id, "rating": rating, "expected_last_review": expected}


def calculate_server_review_state(item: Word | Sentence, rating: str, reviewed_at: str) -> dict[str, Any]:
    """Calculate the next spaced-repetition state exclusively on the server."""
    repetitions = max(0, int(item.repetitions or 0))
    ease = max(1.0, float(item.ease_factor or 2.5))
    interval = max(0, int(item.interval or 0))

    if rating == "again":
        next_repetitions = 0
        next_interval = 0
        next_ease = max(1.3, ease - 0.20)
    elif rating == "hard":
        next_repetitions = repetitions + 1
        next_interval = max(1, round((interval or 1) * 1.2))
        next_ease = max(1.3, ease - 0.15)
    elif rating == "good":
        next_repetitions = repetitions + 1
        if repetitions == 0:
            next_interval = 1
        elif repetitions == 1:
            next_interval = 3
        else:
            next_interval = max(4, round((interval or 3) * ease))
        next_ease = ease
    else:  # easy
        next_repetitions = repetitions + 1
        if repetitions == 0:
            next_interval = 4
        elif repetitions == 1:
            next_interval = 7
        else:
            next_interval = max(7, round((interval or 7) * (ease + 0.3)))
        next_ease = min(3.2, ease + 0.15)

    next_status = "learning"
    if rating != "again" and next_repetitions >= 5 and next_interval >= 21:
        next_status = "mastered"
    elif next_repetitions >= 2:
        next_status = "reviewing"

    reviewed_dt = datetime.fromisoformat(reviewed_at)
    next_review = reviewed_dt.replace(hour=9, minute=0, second=0, microsecond=0)
    next_review += timedelta(days=next_interval)
    return {
        "repetitions": next_repetitions,
        "interval": next_interval,
        "ease_factor": round(next_ease, 2),
        "last_review": reviewed_at,
        "next_review": next_review.isoformat(),
        "status": next_status,
    }


def replace_settings(session_db, raw: dict[str, Any], user_id: int) -> None:
    row = user_settings(session_db, user_id)
    row.theme = "dark" if clean_text(raw.get("theme")) == "dark" else "light"
    row.daily_new_words = max(1, clean_int(raw.get("dailyNewWords"), 10))
    language = clean_text(raw.get("language"), "en").lower()
    row.language = language if language in {"en", "ar"} else "en"


def replace_state(session_db, payload: dict[str, Any], user_id: int) -> dict[str, Any]:
    # Reviews are server-owned. Backup/restore may replace words, sentences, and
    # settings, but it cannot manufacture, rewrite, or delete review history.
    replace_words(session_db, payload.get("words", []) or [], user_id)
    replace_sentences(session_db, payload.get("sentences", []) or [], user_id)
    replace_settings(session_db, payload.get("settings", {}) or {}, user_id)
    session_db.commit()
    return get_state(session_db, user_id)


@app.get("/api/health")
def health():
    session_db = db_session()
    try:
        session_db.execute(select(func.count(User.id))).scalar()
        return jsonify({"ok": True})
    except SQLAlchemyError:
        session_db.rollback()
        return jsonify({"ok": False}), 503


@app.get("/api/auth/me")
def auth_me():
    if session_is_expired():
        expire_authenticated_session()
        return jsonify({"ok": True, "authenticated": False, "user": None})
    session_db = db_session()
    user = current_user(session_db)
    if user is None:
        session.clear()
        return jsonify({"ok": True, "authenticated": False, "user": None})
    current_version = int(getattr(user, "security_version", 1) or 1)
    session_version = session.get("security_version")
    if session_version is not None:
        try:
            if int(session_version) != current_version:
                session.clear()
                return jsonify({"ok": True, "authenticated": False, "user": None})
        except (TypeError, ValueError):
            session.clear()
            return jsonify({"ok": True, "authenticated": False, "user": None})
    return jsonify({"ok": True, "authenticated": True, "user": user_to_dict(user)})


@app.get("/api/auth/csrf")
def auth_csrf():
    return jsonify({"ok": True, "csrfToken": csrf_token()})


@app.post("/api/auth/register")
def auth_register():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "JSON object required"}), 400

    session_db = db_session()
    try:
        username = normalize_username(payload.get("username"))
        full_name = normalize_full_name(payload.get("fullName"))
        email = normalize_email(payload.get("email"))
        password = validate_password(payload.get("password"), username=username, email=email)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    auth_key = client_key("register")
    if auth_rate_limited(auth_key):
        return rate_limit_response()

    account_create_error = {
        "ok": False,
        "code": "ACCOUNT_CREATE_FAILED",
        "error": "Unable to create the account. Check the username and email and try again."
    }

    try:
        existing = session_db.execute(
            select(User.id).where(
                or_(
                    func.lower(User.username) == username.lower(),
                    func.lower(User.email) == email.lower(),
                )
            ).limit(1)
        ).scalar_one_or_none()
        if existing is not None:
            record_auth_failure(auth_key)
            return jsonify(account_create_error), 400

        user = User(
            username=username,
            full_name=full_name,
            email=email,
            password_hash=generate_password_hash(password),
            created_at=now_iso(),
        )
        session_db.add(user)
        session_db.flush()
        session_db.commit()
        token = start_authenticated_session(user.id, getattr(user, "security_version", 1))
        clear_auth_failures(auth_key)
        return jsonify({"ok": True, "user": user_to_dict(user), "migrateLegacy": False, "claimedLegacyRows": 0, "csrfToken": token}), 201
    except IntegrityError:
        session_db.rollback()
        record_auth_failure(auth_key)
        return jsonify(account_create_error), 400


@app.post("/api/auth/login")
def auth_login():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "JSON object required"}), 400
    session_db = db_session()
    identifier = str(payload.get("username") or "").strip()
    password = str(payload.get("password") or "")
    if not identifier:
        return jsonify({"ok": False, "error": "Invalid username or password"}), 401
    try:
        identifier_key = normalize_email(identifier, required=False) if "@" in identifier else normalize_username(identifier)
    except ValueError:
        return jsonify({"ok": False, "error": "Invalid username or password"}), 401

    auth_key = client_key("login", identifier_key)
    ip_key = client_key("login-ip")
    if auth_rate_limited(auth_key) or auth_rate_limited(ip_key):
        return rate_limit_response()

    if "@" in identifier_key:
        user = session_db.execute(select(User).where(func.lower(User.email) == identifier_key.lower())).scalar_one_or_none()
    else:
        user = session_db.execute(select(User).where(func.lower(User.username) == identifier_key.lower())).scalar_one_or_none()
    password_hash = user.password_hash if user is not None else DUMMY_PASSWORD_HASH
    if not check_password_hash(password_hash, password):
        record_auth_failure(auth_key)
        record_auth_failure(ip_key)
        return jsonify({"ok": False, "error": "Invalid username or password"}), 401

    clear_auth_failures(auth_key)
    clear_auth_failures(ip_key)
    token = start_authenticated_session(user.id, getattr(user, "security_version", 1))
    return jsonify({"ok": True, "user": user_to_dict(user), "csrfToken": token})


@app.post("/api/auth/logout")
def auth_logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/bootstrap")
@auth_required
def bootstrap():
    session_db = db_session()
    state = get_state(session_db, current_user_id())
    has_data = any([
        state["words"], state["sentences"], state["reviews"], state["sentenceReviews"],
        state["quizHistory"], state["sentenceQuizHistory"], state["practiceHistory"],
    ])
    return jsonify({"ok": True, "hasData": has_data, "state": state})


@app.put("/api/bootstrap")
@auth_required
def bootstrap_replace():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "JSON object required"}), 400
    for key in ("words", "sentences", "reviews", "sentenceReviews", "quizHistory", "sentenceQuizHistory", "practiceHistory"):
        if key in payload and (not isinstance(payload[key], list) or len(payload[key]) > MAX_IMPORT_ITEMS):
            return jsonify({"ok": False, "error": f"{key} exceeds the maximum of {MAX_IMPORT_ITEMS} items"}), 400
    session_db = db_session()
    try:
        state = replace_state(session_db, payload, current_user_id())
        return jsonify({"ok": True, "state": state})
    except UserQuotaExceeded as exc:
        session_db.rollback()
        return jsonify({"ok": False, "error": str(exc), "code": "QUOTA_EXCEEDED", "resource": exc.resource, "limit": exc.limit}), 409
    except ValueError as exc:
        session_db.rollback()
        return jsonify({"ok": False, "error": str(exc)}), 400
    except IntegrityError:
        session_db.rollback()
        return jsonify({"ok": False, "error": "The submitted data conflicts with an existing record"}), 409


@app.get("/api/words")
@auth_required
def list_words():
    return jsonify([word_to_dict(row) for row in user_words(db_session(), current_user_id())])


@app.post("/api/words")
@auth_required
def create_word():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "JSON object required"}), 400
    session_db = db_session()
    try:
        item = normalize_word(payload)
        preserve_server_review_state(item, None)
        item["created_at"] = now_iso()
        user_id = current_user_id()
        if session_db.get(Word, item["id"]) is not None:
            return jsonify({"ok": False, "error": "Word id is already in use"}), 409
        enforce_user_quota(session_db, Word, user_id, MAX_WORDS_PER_USER, "Words")
        row = Word(user_id=user_id, **item)
        session_db.add(row)
        session_db.commit()
        return jsonify({"ok": True, "word": word_to_dict(row)}), 201
    except UserQuotaExceeded as exc:
        session_db.rollback()
        return jsonify({"ok": False, "error": str(exc), "code": "QUOTA_EXCEEDED", "resource": exc.resource, "limit": exc.limit}), 409
    except ValueError as exc:
        session_db.rollback()
        return jsonify({"ok": False, "error": str(exc)}), 400
    except IntegrityError:
        session_db.rollback()
        return jsonify({"ok": False, "error": "The submitted data conflicts with an existing record"}), 409


@app.patch("/api/words/<word_id>")
@auth_required
def patch_word(word_id: str):
    try:
        word_id = safe_identifier(word_id, "word id", 80)
    except ValueError:
        return jsonify({"ok": False, "error": "Invalid word id"}), 400
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "JSON object required"}), 400
    session_db = db_session()
    row = session_db.execute(select(Word).where(Word.id == word_id, Word.user_id == current_user_id())).scalar_one_or_none()
    if row is None:
        return jsonify({"ok": False, "error": "Word not found"}), 404
    try:
        item = normalize_word(patch_payload(payload, word_to_dict(row)))
        preserve_server_review_state(item, row)
        item["created_at"] = row.created_at
        for key, value in item.items():
            if key != "id":
                setattr(row, key, value)
        session_db.commit()
        return jsonify({"ok": True, "word": word_to_dict(row)})
    except ValueError as exc:
        session_db.rollback()
        return jsonify({"ok": False, "error": str(exc)}), 400
    except IntegrityError:
        session_db.rollback()
        return jsonify({"ok": False, "error": "The submitted data conflicts with an existing record"}), 409


@app.delete("/api/words/<word_id>")
@auth_required
def remove_word(word_id: str):
    try:
        word_id = safe_identifier(word_id, "word id", 80)
    except ValueError:
        return jsonify({"ok": False, "error": "Invalid word id"}), 400
    session_db = db_session()
    row = session_db.execute(select(Word).where(Word.id == word_id, Word.user_id == current_user_id())).scalar_one_or_none()
    if row is None:
        return jsonify({"ok": True, "deleted": False})
    session_db.delete(row)
    session_db.commit()
    return jsonify({"ok": True, "deleted": True})


@app.put("/api/words")
@auth_required
def put_words():
    payload = request.get_json(silent=True)
    if not isinstance(payload, list):
        return jsonify({"ok": False, "error": "Expected an array of words"}), 400
    if len(payload) > MAX_IMPORT_ITEMS:
        return jsonify({"ok": False, "error": f"Too many words (maximum {MAX_IMPORT_ITEMS})"}), 400
    session_db = db_session()
    try:
        replace_words(session_db, payload, current_user_id())
        session_db.commit()
        return jsonify({"ok": True, "count": len(payload)})
    except UserQuotaExceeded as exc:
        session_db.rollback()
        return jsonify({"ok": False, "error": str(exc), "code": "QUOTA_EXCEEDED", "resource": exc.resource, "limit": exc.limit}), 409
    except ValueError as exc:
        session_db.rollback()
        return jsonify({"ok": False, "error": str(exc)}), 400
    except IntegrityError:
        session_db.rollback()
        return jsonify({"ok": False, "error": "The submitted data conflicts with an existing record"}), 409


@app.get("/api/sentences")
@auth_required
def list_sentences():
    return jsonify([sentence_to_dict(row) for row in user_sentences(db_session(), current_user_id())])


@app.post("/api/sentences")
@auth_required
def create_sentence():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "JSON object required"}), 400
    session_db = db_session()
    try:
        item = normalize_sentence(payload)
        preserve_server_review_state(item, None)
        item["created_at"] = now_iso()
        user_id = current_user_id()
        if session_db.get(Sentence, item["id"]) is not None:
            return jsonify({"ok": False, "error": "Sentence id is already in use"}), 409
        enforce_user_quota(session_db, Sentence, user_id, MAX_SENTENCES_PER_USER, "Sentences")
        row = Sentence(user_id=user_id, **item)
        session_db.add(row)
        session_db.commit()
        return jsonify({"ok": True, "sentence": sentence_to_dict(row)}), 201
    except UserQuotaExceeded as exc:
        session_db.rollback()
        return jsonify({"ok": False, "error": str(exc), "code": "QUOTA_EXCEEDED", "resource": exc.resource, "limit": exc.limit}), 409
    except ValueError as exc:
        session_db.rollback()
        return jsonify({"ok": False, "error": str(exc)}), 400
    except IntegrityError:
        session_db.rollback()
        return jsonify({"ok": False, "error": "The submitted data conflicts with an existing record"}), 409


@app.patch("/api/sentences/<sentence_id>")
@auth_required
def patch_sentence(sentence_id: str):
    try:
        sentence_id = safe_identifier(sentence_id, "sentence id", 80)
    except ValueError:
        return jsonify({"ok": False, "error": "Invalid sentence id"}), 400
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "JSON object required"}), 400
    session_db = db_session()
    row = session_db.execute(select(Sentence).where(Sentence.id == sentence_id, Sentence.user_id == current_user_id())).scalar_one_or_none()
    if row is None:
        return jsonify({"ok": False, "error": "Sentence not found"}), 404
    try:
        item = normalize_sentence(patch_payload(payload, sentence_to_dict(row)))
        preserve_server_review_state(item, row)
        item["created_at"] = row.created_at
        for key, value in item.items():
            if key != "id":
                setattr(row, key, value)
        session_db.commit()
        return jsonify({"ok": True, "sentence": sentence_to_dict(row)})
    except ValueError as exc:
        session_db.rollback()
        return jsonify({"ok": False, "error": str(exc)}), 400
    except IntegrityError:
        session_db.rollback()
        return jsonify({"ok": False, "error": "The submitted data conflicts with an existing record"}), 409


@app.delete("/api/sentences/<sentence_id>")
@auth_required
def remove_sentence(sentence_id: str):
    try:
        sentence_id = safe_identifier(sentence_id, "sentence id", 80)
    except ValueError:
        return jsonify({"ok": False, "error": "Invalid sentence id"}), 400
    session_db = db_session()
    row = session_db.execute(select(Sentence).where(Sentence.id == sentence_id, Sentence.user_id == current_user_id())).scalar_one_or_none()
    if row is None:
        return jsonify({"ok": True, "deleted": False})
    session_db.delete(row)
    session_db.commit()
    return jsonify({"ok": True, "deleted": True})


@app.put("/api/sentences")
@auth_required
def put_sentences():
    payload = request.get_json(silent=True)
    if not isinstance(payload, list):
        return jsonify({"ok": False, "error": "Expected an array of sentences"}), 400
    if len(payload) > MAX_IMPORT_ITEMS:
        return jsonify({"ok": False, "error": f"Too many sentences (maximum {MAX_IMPORT_ITEMS})"}), 400
    session_db = db_session()
    try:
        replace_sentences(session_db, payload, current_user_id())
        session_db.commit()
        return jsonify({"ok": True, "count": len(payload)})
    except UserQuotaExceeded as exc:
        session_db.rollback()
        return jsonify({"ok": False, "error": str(exc), "code": "QUOTA_EXCEEDED", "resource": exc.resource, "limit": exc.limit}), 409
    except ValueError as exc:
        session_db.rollback()
        return jsonify({"ok": False, "error": str(exc)}), 400
    except IntegrityError:
        session_db.rollback()
        return jsonify({"ok": False, "error": "The submitted data conflicts with an existing record"}), 409


@app.post("/api/reviews")
@auth_required
def create_review():
    payload = request.get_json(silent=True)
    session_db = db_session()
    try:
        item = normalize_review_payload(payload, "wordId")
        user_id = current_user_id()
        target = session_db.execute(
            select(Word).where(Word.id == item["wordId"], Word.user_id == user_id)
        ).scalar_one_or_none()
        if target is None:
            return jsonify({"ok": False, "error": "Word not found"}), 404

        expected = item["expected_last_review"]
        if expected is None:
            state_match = target.last_review is None
        else:
            state_match = target.last_review == expected
        if not state_match:
            session_db.rollback()
            return jsonify({"ok": False, "error": "Word was updated. Refresh the review and try again."}), 409

        enforce_user_quota(session_db, Review, user_id, MAX_REVIEWS_PER_USER, "Reviews")

        reviewed_at = now_iso()
        next_state = calculate_server_review_state(target, item["rating"], reviewed_at)
        if expected is None:
            where = (Word.id == target.id, Word.user_id == user_id, Word.last_review.is_(None))
        else:
            where = (Word.id == target.id, Word.user_id == user_id, Word.last_review == expected)
        result = session_db.execute(
            update(Word).where(*where).values(**next_state)
        )
        if result.rowcount != 1:
            session_db.rollback()
            return jsonify({"ok": False, "error": "Word was updated. Refresh the review and try again."}), 409

        row = Review(
            user_id=user_id,
            word_id=target.id,
            rating=item["rating"],
            reviewed_at=reviewed_at,
            interval=next_state["interval"],
        )
        session_db.add(row)
        session_db.commit()
        refreshed = session_db.get(Word, target.id)
        return jsonify({"ok": True, "word": word_to_dict(refreshed), "review": review_to_dict(row)}), 201
    except UserQuotaExceeded as exc:
        session_db.rollback()
        return jsonify({"ok": False, "error": str(exc), "code": "QUOTA_EXCEEDED", "resource": exc.resource, "limit": exc.limit}), 409
    except ValueError as exc:
        session_db.rollback()
        return jsonify({"ok": False, "error": str(exc)}), 400
    except IntegrityError:
        session_db.rollback()
        return jsonify({"ok": False, "error": "Review could not be recorded"}), 409


@app.post("/api/sentence-reviews")
@auth_required
def create_sentence_review():
    payload = request.get_json(silent=True)
    session_db = db_session()
    try:
        item = normalize_review_payload(payload, "sentenceId")
        user_id = current_user_id()
        target = session_db.execute(
            select(Sentence).where(Sentence.id == item["sentenceId"], Sentence.user_id == user_id)
        ).scalar_one_or_none()
        if target is None:
            return jsonify({"ok": False, "error": "Sentence not found"}), 404

        expected = item["expected_last_review"]
        if expected is None:
            state_match = target.last_review is None
        else:
            state_match = target.last_review == expected
        if not state_match:
            session_db.rollback()
            return jsonify({"ok": False, "error": "Sentence was updated. Refresh the review and try again."}), 409

        enforce_user_quota(session_db, SentenceReview, user_id, MAX_SENTENCE_REVIEWS_PER_USER, "Sentence reviews")

        reviewed_at = now_iso()
        next_state = calculate_server_review_state(target, item["rating"], reviewed_at)
        if expected is None:
            where = (Sentence.id == target.id, Sentence.user_id == user_id, Sentence.last_review.is_(None))
        else:
            where = (Sentence.id == target.id, Sentence.user_id == user_id, Sentence.last_review == expected)
        result = session_db.execute(
            update(Sentence).where(*where).values(**next_state)
        )
        if result.rowcount != 1:
            session_db.rollback()
            return jsonify({"ok": False, "error": "Sentence was updated. Refresh the review and try again."}), 409

        row = SentenceReview(
            user_id=user_id,
            sentence_id=target.id,
            rating=item["rating"],
            reviewed_at=reviewed_at,
            interval=next_state["interval"],
        )
        session_db.add(row)
        session_db.commit()
        refreshed = session_db.get(Sentence, target.id)
        return jsonify({"ok": True, "sentence": sentence_to_dict(refreshed), "review": sentence_review_to_dict(row)}), 201
    except UserQuotaExceeded as exc:
        session_db.rollback()
        return jsonify({"ok": False, "error": str(exc), "code": "QUOTA_EXCEEDED", "resource": exc.resource, "limit": exc.limit}), 409
    except ValueError as exc:
        session_db.rollback()
        return jsonify({"ok": False, "error": str(exc)}), 400
    except IntegrityError:
        session_db.rollback()
        return jsonify({"ok": False, "error": "Review could not be recorded"}), 409



@app.post("/api/quiz/start")
@auth_required
def start_quiz_attempt():
    payload = request.get_json(silent=True) or {}
    session_db = db_session()
    try:
        count = min(MAX_ATTEMPT_ITEMS, max(1, clean_int(payload.get("count"), 10)))
        difficulty = clean_text(payload.get("difficulty"), "all").lower()
        if difficulty not in {"all", *ALLOWED_DIFFICULTIES}:
            difficulty = "all"
        quiz_type = clean_text(payload.get("type"), "mixed").lower()
        if quiz_type not in {"mixed", "word-definition", "definition-word"}:
            quiz_type = "mixed"
        questions = _word_quiz_questions(session_db, current_user_id(), count, difficulty, quiz_type)
        return jsonify(_attempt_public_state(_create_attempt(session_db, current_user_id(), "quiz", questions)))
    except ValueError as exc:
        session_db.rollback()
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.post("/api/quiz/answer")
@auth_required
def answer_quiz_attempt():
    payload = request.get_json(silent=True) or {}
    session_db = db_session()
    try:
        attempt = _load_attempt(session_db, safe_identifier(payload.get("attemptId"), "attemptId", 100), "quiz")
        if attempt is None:
            return jsonify({"ok": False, "error": "Quiz attempt not found or expired"}), 404
        index = clean_int(payload.get("questionIndex"), -1)
        if index != attempt.current_index:
            return jsonify({"ok": False, "error": "Question is no longer active"}), 409
        correct, answer = _score_attempt_answer(attempt, payload)
        if correct:
            attempt.correct += 1
        attempt.current_index += 1
        completed = attempt.current_index >= attempt.total_items
        result = {"ok": True, "correct": correct, "correctAnswer": answer, "completed": completed, "nextIndex": attempt.current_index}
        if completed:
            result["summary"] = _finish_attempt(session_db, attempt)
        else:
            session_db.commit()
        return jsonify(result)
    except ValueError as exc:
        session_db.rollback()
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.post("/api/sentence-quiz/start")
@auth_required
def start_sentence_quiz_attempt():
    payload = request.get_json(silent=True) or {}
    session_db = db_session()
    try:
        count = min(MAX_ATTEMPT_ITEMS, max(1, clean_int(payload.get("count"), 10)))
        mode = clean_text(payload.get("mode"), "mixed").lower()
        questions = _sentence_quiz_questions(session_db, current_user_id(), count, mode)
        if not questions:
            raise ValueError("Could not build a sentence quiz from the current library")
        return jsonify(_attempt_public_state(_create_attempt(session_db, current_user_id(), "sentence-quiz", questions)))
    except ValueError as exc:
        session_db.rollback()
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.post("/api/sentence-quiz/answer")
@auth_required
def answer_sentence_quiz_attempt():
    payload = request.get_json(silent=True) or {}
    session_db = db_session()
    try:
        attempt = _load_attempt(session_db, safe_identifier(payload.get("attemptId"), "attemptId", 100), "sentence-quiz")
        if attempt is None:
            return jsonify({"ok": False, "error": "Sentence quiz attempt not found or expired"}), 404
        index = clean_int(payload.get("questionIndex"), -1)
        if index != attempt.current_index:
            return jsonify({"ok": False, "error": "Question is no longer active"}), 409
        correct, answer = _score_attempt_answer(attempt, payload)
        if correct:
            attempt.correct += 1
        attempt.current_index += 1
        completed = attempt.current_index >= attempt.total_items
        result = {"ok": True, "correct": correct, "correctAnswer": answer, "completed": completed, "nextIndex": attempt.current_index}
        if completed:
            result["summary"] = _finish_attempt(session_db, attempt)
        else:
            session_db.commit()
        return jsonify(result)
    except ValueError as exc:
        session_db.rollback()
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.post("/api/practice/start")
@auth_required
def start_practice_attempt():
    payload = request.get_json(silent=True) or {}
    session_db = db_session()
    try:
        word_count = min(MAX_ATTEMPT_ITEMS, max(0, clean_int(payload.get("wordCount"), 5)))
        sentence_count = min(MAX_ATTEMPT_ITEMS, max(0, clean_int(payload.get("sentenceCount"), 5)))
        total = min(MAX_ATTEMPT_ITEMS, max(1, clean_int(payload.get("total"), 15)))
        mode = clean_text(payload.get("mode"), "balanced").lower()
        tasks, words_count, sentences_count = _practice_tasks(session_db, current_user_id(), word_count, sentence_count, total, mode)
        return jsonify(_attempt_public_state(_create_attempt(session_db, current_user_id(), "practice", tasks, words_count, sentences_count)))
    except ValueError as exc:
        session_db.rollback()
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.post("/api/practice/answer")
@auth_required
def answer_practice_attempt():
    payload = request.get_json(silent=True) or {}
    session_db = db_session()
    try:
        attempt = _load_attempt(session_db, safe_identifier(payload.get("attemptId"), "attemptId", 100), "practice")
        if attempt is None:
            return jsonify({"ok": False, "error": "Practice attempt not found or expired"}), 404
        index = clean_int(payload.get("questionIndex"), -1)
        if index != attempt.current_index:
            return jsonify({"ok": False, "error": "Task is no longer active"}), 409
        correct, answer = _score_attempt_answer(attempt, payload)
        if correct:
            attempt.correct += 1
        attempt.current_index += 1
        completed = attempt.current_index >= attempt.total_items
        result = {"ok": True, "correct": correct, "correctAnswer": answer, "completed": completed, "nextIndex": attempt.current_index}
        if completed:
            result["summary"] = _finish_attempt(session_db, attempt)
        else:
            session_db.commit()
        return jsonify(result)
    except ValueError as exc:
        session_db.rollback()
        return jsonify({"ok": False, "error": str(exc)}), 400

@app.post("/api/quiz-history")
@auth_required
def create_quiz_history():
    return jsonify({"ok": False, "error": "Quiz history is server-managed. Complete a quiz attempt instead."}), 410


@app.post("/api/sentence-quiz-history")
@auth_required
def create_sentence_quiz_history():
    return jsonify({"ok": False, "error": "Sentence quiz history is server-managed. Complete a sentence quiz attempt instead."}), 410


@app.post("/api/practice-history")
@auth_required
def create_practice_history():
    return jsonify({"ok": False, "error": "Practice history is server-managed. Complete a practice attempt instead."}), 410


@app.put("/api/reviews")
@auth_required
def put_reviews():
    return jsonify({"ok": False, "error": "Review history is server-managed. Complete a review instead."}), 410


@app.put("/api/sentence-reviews")
@auth_required
def put_sentence_reviews():
    return jsonify({"ok": False, "error": "Sentence review history is server-managed. Complete a review instead."}), 410


@app.put("/api/quiz-history")
@auth_required
def put_quiz_history():
    return jsonify({"ok": False, "error": "Quiz history is server-managed."}), 410


@app.put("/api/sentence-quiz-history")
@auth_required
def put_sentence_quiz_history():
    return jsonify({"ok": False, "error": "Sentence quiz history is server-managed."}), 410


@app.put("/api/practice-history")
@auth_required
def put_practice_history():
    return jsonify({"ok": False, "error": "Practice history is server-managed."}), 410


@app.get("/api/progress")
@auth_required
def progress():
    user_id = current_user_id()
    session_db = db_session()
    state = get_state(session_db, user_id)
    words = state["words"]
    sentences = state["sentences"]
    reviews = state["reviews"]
    sentence_reviews = state["sentenceReviews"]
    practice = state["practiceHistory"]
    quiz = state["quizHistory"]
    sentence_quiz = state["sentenceQuizHistory"]

    def counts(items):
        out = {"total": len(items), "new": 0, "learning": 0, "reviewing": 0, "mastered": 0}
        for item in items:
            status = item.get("status", "new")
            if status in out:
                out[status] += 1
        return out

    def accuracy(items):
        if not items:
            return 0
        return round(sum(1 for item in items if item.get("rating") != "again") / len(items) * 100)

    practice_tasks = sum(int(x.get("totalTasks", 0)) for x in practice)
    practice_correct = sum(int(x.get("correct", 0)) for x in practice)
    quiz_questions = sum(int(x.get("totalQuestions", 0)) for x in quiz + sentence_quiz)
    quiz_correct = sum(int(x.get("correct", 0)) for x in quiz + sentence_quiz)
    return jsonify({"ok": True, "progress": {
        "words": {**counts(words), "reviews": len(reviews), "accuracy": accuracy(reviews)},
        "sentences": {**counts(sentences), "reviews": len(sentence_reviews), "accuracy": accuracy(sentence_reviews)},
        "practice": {"sessions": len(practice), "tasks": practice_tasks, "correct": practice_correct, "accuracy": round(practice_correct / practice_tasks * 100) if practice_tasks else 0},
        "quizzes": {"sessions": len(quiz) + len(sentence_quiz), "questions": quiz_questions, "correct": quiz_correct, "accuracy": round(quiz_correct / quiz_questions * 100) if quiz_questions else 0}
    }})


@app.put("/api/settings")
@auth_required
def put_settings():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "Expected an object"}), 400
    session_db = db_session()
    replace_settings(session_db, payload, current_user_id())
    session_db.commit()
    return jsonify({"ok": True, "settings": settings_to_dict(user_settings(session_db, current_user_id()))})


@app.get("/api/account")
@auth_required
def get_account():
    session_db = db_session()
    return jsonify({"ok": True, "user": user_to_dict(current_user(session_db))})


@app.put("/api/account")
@auth_required
def update_account():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "Expected an object"}), 400
    try:
        full_name = normalize_full_name(payload.get("fullName"))
        email = normalize_email(payload.get("email"))
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    session_db = db_session()
    user = current_user(session_db)
    current_email = (user.email or "").strip().lower()
    email_changed = email.lower() != current_email
    email_reauth_key = client_key("email-change", str(user.id))
    if email_changed:
        if auth_rate_limited(email_reauth_key, limit=SENSITIVE_ACTION_MAX_ATTEMPTS):
            return rate_limit_response()
        if not verify_current_password(user, payload.get("currentPassword")):
            record_auth_failure(email_reauth_key)
            return jsonify({"ok": False, "error": "Current password is required to change the email address"}), 403
        clear_auth_failures(email_reauth_key)
    existing = session_db.execute(
        select(User).where(func.lower(User.email) == email.lower(), User.id != user.id)
    ).scalar_one_or_none()
    if existing is not None:
        return jsonify({"ok": False, "error": "Email address is already registered"}), 409
    user.full_name = full_name
    user.email = email
    try:
        session_db.commit()
    except IntegrityError:
        session_db.rollback()
        return jsonify({"ok": False, "error": "Email address is already registered"}), 409
    return jsonify({"ok": True, "user": user_to_dict(user)})


@app.post("/api/account/password")
@auth_required
def change_password():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "Expected an object"}), 400
    session_db = db_session()
    user = current_user(session_db)
    if user is None:
        return jsonify({"ok": False, "error": "Authentication required"}), 401

    rate_key = client_key("password-change", str(user.id))
    if auth_rate_limited(rate_key, limit=5):
        return rate_limit_response()

    current_password = payload.get("currentPassword")
    new_password = payload.get("newPassword")
    confirm_password = payload.get("confirmPassword")
    if not verify_current_password(user, current_password):
        record_auth_failure(rate_key)
        return jsonify({"ok": False, "error": "Current password is incorrect"}), 403
    if not isinstance(confirm_password, str) or new_password != confirm_password:
        return jsonify({"ok": False, "error": "New passwords do not match"}), 400
    try:
        normalized_password = validate_password(new_password, username=user.username, email=user.email)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    if check_password_hash(user.password_hash, normalized_password):
        return jsonify({"ok": False, "error": "Choose a password different from your current password"}), 400

    user.password_hash = generate_password_hash(normalized_password)
    user.security_version = int(getattr(user, "security_version", 1) or 1) + 1
    try:
        session_db.commit()
    except SQLAlchemyError:
        session_db.rollback()
        raise
    clear_auth_failures(rate_key)
    token = start_authenticated_session(user.id, getattr(user, "security_version", 1))
    return jsonify({"ok": True, "csrfToken": token})


@app.delete("/api/account")
@auth_required
def delete_account():
    session_db = db_session()
    user = current_user(session_db)
    if user is None:
        return jsonify({"ok": False, "error": "Account not found"}), 404

    delete_reauth_key = client_key("account-delete", str(user.id))
    if auth_rate_limited(delete_reauth_key, limit=SENSITIVE_ACTION_MAX_ATTEMPTS):
        return rate_limit_response()

    payload = request.get_json(silent=True)
    supplied_password = payload.get("currentPassword") if isinstance(payload, dict) else None
    if not verify_current_password(user, supplied_password):
        record_auth_failure(delete_reauth_key)
        return jsonify({"ok": False, "error": "Current password is required to delete the account"}), 403
    clear_auth_failures(delete_reauth_key)

    uid = user.id
    try:
        # Delete children explicitly so this remains safe even when SQLite foreign-key
        # enforcement was not enabled on an existing connection.
        for model in (Review, SentenceReview, QuizSession, SentenceQuizSession, PracticeSession, Settings):
            session_db.execute(delete(model).where(model.user_id == uid))
        session_db.execute(delete(Word).where(Word.user_id == uid))
        session_db.execute(delete(Sentence).where(Sentence.user_id == uid))
        session_db.delete(user)
        session_db.commit()
        session.clear()
        return jsonify({"ok": True})
    except Exception:
        session_db.rollback()
        raise


def render_login():
    return render_template("login.html", csp_nonce=getattr(g, "csp_nonce", ""))


def render_page(template_name: str):
    if session_is_expired():
        expire_authenticated_session()
        return redirect("/login")
    session_db = db_session()
    user = current_user(session_db)
    if user is None:
        session.clear()
        return redirect("/login")
    current_version = int(getattr(user, "security_version", 1) or 1)
    session_version = session.get("security_version")
    if session_version is not None:
        try:
            if int(session_version) != current_version:
                session.clear()
                return redirect("/login")
        except (TypeError, ValueError):
            session.clear()
            return redirect("/login")
    navigation_request = request.headers.get("X-VocabFlow-Navigation") == "1"
    if navigation_request:
        bootstrap_script = ""
    else:
        state = get_state(session_db, user.id)
        user_json = safe_json_for_script(user_to_dict(user))
        bootstrap = safe_json_for_script(state)
        bootstrap_script = (
            f'<script id="vocabflow-server-bootstrap" nonce="{getattr(g, "csp_nonce", "")}">'
            f'window.__VOCABFLOW_USER__={user_json};'
            f'window.__VOCABFLOW_BOOTSTRAP__={bootstrap};'
            '(function(){'
            'var lang=window.__VOCABFLOW_BOOTSTRAP__.settings?.language==="ar"?"ar":"en";'
            'var root=document.documentElement;root.lang=lang;root.dir="ltr";'
            'root.dataset.lang=lang;if(lang==="ar")root.dataset.i18nPending="true";'
            '})();'
            '</script>'
        )
    html = render_template(template_name, bootstrap_script=bootstrap_script, csp_nonce=getattr(g, "csp_nonce", ""))
    page_key = Path(template_name).stem
    if page_key == "index":
        page_key = "dashboard"
    html = re.sub(
        r'(<main\b[^>]*class="[^"]*\bmain-content\b[^"]*")',
        rf'\1 data-vf-page="{page_key}"',
        html,
        count=1,
    )
    html = re.sub(
        r"</body>",
        '<script src="/static/js/navigation.js"></script></body>',
        html,
        count=1,
        flags=re.IGNORECASE,
    )
    if navigation_request:
        head = re.search(r"<head\b[^>]*>([\s\S]*?)</head>", html, re.IGNORECASE)
        main = re.search(r'<main\b[^>]*class="[^"]*\bmain-content\b[^"]*"[\s\S]*?</main>', html, re.IGNORECASE)
        title = re.search(r"<title\b[^>]*>([\s\S]*?)</title>", html, re.IGNORECASE)
        if head and main:
            styles = "".join(re.findall(r'<link\b[^>]*rel="stylesheet"[^>]*>', head.group(1), re.IGNORECASE))
            scripts = "".join(re.findall(r'<script\b[^>]*\bsrc="[^"]+"[^>]*>\s*</script>', html, re.IGNORECASE))
            partial = (
                '<!DOCTYPE html><html><head>'
                f'<title>{title.group(1) if title else "VocabFlow"}</title>{styles}'
                f'</head><body>{main.group(0)}{scripts}</body></html>'
            )
            return Response(partial, mimetype="text/html", headers={"Cache-Control": "no-store"})
    return html


@app.errorhandler(404)
def not_found(error):
    if request.path.startswith("/api/"):
        return jsonify({"ok": False, "error": "Not found"}), 404
    return render_template("404.html", csp_nonce=getattr(g, "csp_nonce", "")), 404


@app.get("/")
def dashboard_page():
    return render_page("index.html")


@app.get("/login")
@app.get("/login.html")
def login_page():
    if session_is_expired():
        expire_authenticated_session()
    if current_user(db_session()) is not None:
        return redirect("/")
    return render_login()


@app.get("/account")
def account_page():
    return render_page("account.html")


PAGE_ROUTES = {
    "review": "pages/review.html",
    "words": "pages/words.html",
    "sentences": "pages/sentences.html",
    "sentence-review": "pages/sentence-review.html",
    "sentence-quiz": "pages/sentence-quiz.html",
    "sentence-writing": "pages/sentence-writing.html",
    "practice": "pages/practice.html",
    "add-word": "pages/add-word.html",
    "add-sentence": "pages/add-sentence.html",
    "progress": "pages/progress.html",
    "quiz": "pages/quiz.html",
    "data": "pages/data.html",
    "word-context": "pages/word-context.html",
}


def _page_handler(template_name):
    def handler():
        return render_page(template_name)
    return handler


for route_name, template_name in PAGE_ROUTES.items():
    app.add_url_rule(f"/{route_name}", f"page_{route_name.replace('-', '_')}", _page_handler(template_name), methods=["GET"])


with app.app_context():
    init_db()


if __name__ == "__main__":
    host = os.environ.get("VOCABFLOW_HOST", "127.0.0.1")
    port = clean_int(os.environ.get("VOCABFLOW_PORT"), 5000)
    debug = os.environ.get("VOCABFLOW_DEBUG", "0") == "1" and APP_ENV != "production"
    app.run(host=host, port=port, debug=debug)
