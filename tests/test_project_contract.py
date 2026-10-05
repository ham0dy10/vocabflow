from __future__ import annotations

import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read_text(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def test_all_python_files_parse() -> None:
    for path in ROOT.rglob("*.py"):
        if any(part in {".venv", "venv", "env"} for part in path.parts):
            continue
        ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def test_required_security_routes_exist() -> None:
    source = read_text("app.py")
    for route in (
        '"/api/quiz/start"',
        '"/api/quiz/answer"',
        '"/api/sentence-quiz/start"',
        '"/api/sentence-quiz/answer"',
        '"/api/practice/start"',
        '"/api/practice/answer"',
        '"/api/reviews"',
        '"/api/sentence-reviews"',
        '"/api/account/password"',
        '"/api/account"',
        '"/api/auth/login"',
        '"/api/auth/register"',
    ):
        assert route in source


def test_server_owned_learning_guards_are_present() -> None:
    source = read_text("app.py")
    assert "def _public_question" in source
    assert "def _load_attempt" in source
    assert "row.user_id != current_user_id()" in source
    assert "if index != attempt.current_index:" in source
    assert "Review history is server-managed" in source


def test_review_state_is_server_calculated() -> None:
    source = read_text("app.py")
    assert "def calculate_server_review_state" in source
    assert '"expected_last_review"' in source
    assert '"interval": next_interval' in source
    assert '"repetitions": next_repetitions' in source
    assert '"ease_factor": round(next_ease, 2)' in source


def test_security_headers_are_declared() -> None:
    source = read_text("app.py")
    assert '"Content-Security-Policy"' in source
    assert "style-src-attr 'none'" in source
    assert '"Cache-Control"' in source
    assert '"no-store' in source
    assert 'X-Content-Type-Options' in source
    assert 'X-Frame-Options' in source


def test_generic_registration_error_prevents_account_enumeration() -> None:
    source = read_text("app.py")
    register_block = source[source.index('def auth_register():'):source.index('@app.post("/api/auth/login")')]
    assert '"Unable to create the account. Check the username and email and try again."' in register_block
    assert "Username is already registered" not in register_block
    assert "Email address is already registered" not in register_block


def test_session_absolute_expiry_is_enforced() -> None:
    source = read_text("app.py")
    assert "SESSION_ABSOLUTE_LIFETIME_SECONDS" in source
    assert 'session["session_expires_at"]' in source
    assert "session_is_expired()" in source
    assert 'return session_expired_response()' in source


def test_no_old_client_controlled_result_write_endpoints() -> None:
    source = read_text("app.py")
    for marker in (
        'def create_quiz_history():\n    return jsonify({"ok": False',
        'def create_sentence_quiz_history():\n    return jsonify({"ok": False',
        'def create_practice_history():\n    return jsonify({"ok": False',
        'def put_reviews():\n    return jsonify({"ok": False',
        'def put_sentence_reviews():\n    return jsonify({"ok": False',
    ):
        assert marker in source
    assert ", 410" in source


def test_runtime_requirements_are_exactly_pinned() -> None:
    lines = [line.strip() for line in read_text("requirements.txt").splitlines() if line.strip() and not line.lstrip().startswith("#")]
    assert lines
    assert all("==" in line and ">=" not in line and "<" not in line for line in lines)


def test_frontend_has_no_forbidden_inline_style_assignment_pattern_in_progress_files() -> None:
    for relative in ("static/js/progress.js", "static/js/sentence-progress.js"):
        source = read_text(relative)
        assert " style=\"" not in source
        assert " style='" not in source


def test_sensitive_rate_limiter_accepts_operation_specific_limit() -> None:
    tree = ast.parse(read_text("app.py"), filename="app.py")
    defs = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "auth_rate_limited"]
    assert len(defs) == 1
    node = defs[0]
    assert len(node.args.args) == 2
    assert [arg.arg for arg in node.args.args] == ["key", "limit"]
    assert len(node.args.defaults) == 1
    default = node.args.defaults[0]
    assert isinstance(default, ast.Name)
    assert default.id == "MAX_AUTH_ATTEMPTS"
    assert any(isinstance(n, ast.Call) and getattr(n.func, "id", None) == "rate_limit_key" for n in ast.walk(node))


def test_legacy_migration_never_chooses_first_account_automatically() -> None:
    db_source = read_text("database.py")
    app_source = read_text("app.py")
    assert "def _migrate_legacy_rows" in db_source
    assert "VOCABFLOW_LEGACY_OWNER_ID" in db_source
    assert "ORDER BY id LIMIT 1" not in db_source
    assert "claim_legacy_workspace" not in app_source
    assert "migrate_legacy.py --owner-id <existing-user-id>" in db_source


def test_per_user_quotas_exist_in_app_and_database() -> None:
    app_source = read_text("app.py")
    db_source = read_text("database.py")
    for marker in (
        "MAX_WORDS_PER_USER",
        "MAX_SENTENCES_PER_USER",
        "MAX_REVIEWS_PER_USER",
        "MAX_SENTENCE_REVIEWS_PER_USER",
        "MAX_QUIZ_HISTORY_PER_USER",
        "MAX_SENTENCE_QUIZ_HISTORY_PER_USER",
        "MAX_PRACTICE_HISTORY_PER_USER",
        "def enforce_user_quota",
    ):
        assert marker in app_source
    assert "def _ensure_quota_triggers" in db_source
    assert "RAISE(ABORT" in db_source


def test_created_at_is_strictly_normalized_and_server_owned_on_updates() -> None:
    source = read_text("app.py")
    assert "def normalize_created_at" in source
    assert "createdAt cannot be in the future" in source
    assert 'item["created_at"] = now_iso()' in source
    assert 'item["created_at"] = row.created_at' in source


def test_sentence_writing_persists_reviews_on_server() -> None:
    source = read_text("static/js/sentence-writing.js")
    assert 'VocabFlowApi.request("/api/sentence-reviews"' in source
    assert "expectedLastReview:item.lastReview||null" in source
    assert "applyServerSentenceReview(response.sentence,response.review)" in source
    assert "saveSentences(getSentences()" not in source
    assert "sentenceNextReview(item,rating)" not in source


def test_runtime_lock_contains_sha256_hashes() -> None:
    source = read_text("requirements-lock.txt")
    package_lines = [
        line.strip()
        for line in source.splitlines()
        if line.strip() and not line.lstrip().startswith("#") and "--hash=" not in line and not line.lstrip().startswith("--hash=")
    ]
    assert package_lines
    assert "click==8.5.0" in source
    assert all("==" in line for line in package_lines)
    assert source.count("--hash=sha256:") >= len(package_lines)


def test_release_excludes_pytest_cache() -> None:
    assert ".pytest_cache/" in read_text(".gitignore")
