from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "vocabflow.db"


def _require_database() -> None:
    if not DB.exists():
        pytest.skip("No local vocabflow.db is bundled in the public release")
    with sqlite3.connect(DB) as db:
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        required = {"users", "schema_meta", "learning_attempts"}
        if not required.issubset(tables):
            pytest.skip("Local database has not been initialized to the current application schema")


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB)
    connection.row_factory = sqlite3.Row
    return connection


def test_database_integrity_is_clean() -> None:
    _require_database()
    with connect() as db:
        assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []


def test_schema_version_and_security_columns() -> None:
    _require_database()
    with connect() as db:
        version = db.execute(
            "SELECT version FROM schema_meta WHERE key='schema'"
        ).fetchone()[0]
        assert version == 13
        columns = {row[1] for row in db.execute("PRAGMA table_info(users)")}
        assert "security_version" in columns
        assert "email" in columns


def test_unique_email_and_username_indexes_exist() -> None:
    _require_database()
    with connect() as db:
        indexes = {row[1] for row in db.execute("PRAGMA index_list(users)")}
        assert "uq_users_email_nocase" in indexes
        assert "uq_users_username_nocase" in indexes


def test_learning_attempts_are_user_scoped() -> None:
    _require_database()
    with connect() as db:
        columns = {row[1] for row in db.execute("PRAGMA table_info(learning_attempts)")}
        assert {"attempt_id", "user_id", "kind", "current_index", "correct", "completed"} <= columns
        fks = db.execute("PRAGMA foreign_key_list(learning_attempts)").fetchall()
        assert any(row[2] == "users" and row[3] == "user_id" for row in fks)
