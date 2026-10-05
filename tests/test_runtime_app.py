from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _load_app(tmp_path: Path):
    # App imports database/models at module import time, so give the test process a
    # fresh temporary database before importing them.
    db_path = tmp_path / "test.db"
    os.environ["VOCABFLOW_DB_PATH"] = str(db_path)
    os.environ["VOCABFLOW_ENV"] = "development"
    os.environ.pop("VOCABFLOW_REDIS_URL", None)
    os.environ.pop("VOCABFLOW_PROXY_HOPS", None)
    for name in ("app", "models", "database"):
        sys.modules.pop(name, None)
    sys.path.insert(0, str(ROOT))
    module = importlib.import_module("app")
    module.app.config.update(TESTING=True, WTF_CSRF_ENABLED=False)
    return module


@pytest.fixture
def flask_app(tmp_path: Path):
    try:
        module = _load_app(tmp_path)
    except ModuleNotFoundError as exc:
        pytest.skip(f"Runtime dependencies are not installed in this environment: {exc.name}")
    try:
        yield module
    finally:
        for name in ("app", "models", "database"):
            sys.modules.pop(name, None)
        os.environ.pop("VOCABFLOW_DB_PATH", None)
        os.environ.pop("VOCABFLOW_ENV", None)


def _csrf(client):
    response = client.get("/api/auth/csrf")
    assert response.status_code == 200
    return response.get_json()["csrfToken"]


def _register(client, csrf: str, *, username="testuser", email="testuser@example.com", password="StrongerPass9!"):
    return client.post(
        "/api/auth/register",
        json={
            "username": username,
            "fullName": "Test User",
            "email": email,
            "password": password,
        },
        headers={"X-CSRF-Token": csrf},
    )


def test_404_is_real_404(flask_app):
    client = flask_app.app.test_client()
    response = client.get("/not-a-real-page")
    assert response.status_code == 404


def test_health_is_minimal(flask_app):
    client = flask_app.app.test_client()
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.get_json() == {"ok": True}


def test_register_then_login_with_username_or_email(flask_app):
    client = flask_app.app.test_client()
    csrf = _csrf(client)
    created = _register(client, csrf)
    assert created.status_code == 201
    payload = created.get_json()
    assert payload["ok"] is True
    csrf = payload["csrfToken"]

    client.post("/api/auth/logout", headers={"X-CSRF-Token": csrf})
    csrf = _csrf(client)
    logged_in = client.post(
        "/api/auth/login",
        json={"username": "testuser", "password": "StrongerPass9!"},
        headers={"X-CSRF-Token": csrf},
    )
    assert logged_in.status_code == 200
    assert logged_in.get_json()["ok"] is True


def test_weak_password_is_rejected(flask_app):
    with pytest.raises(ValueError):
        flask_app.validate_password("password123", username="testuser", email="test@example.com")
