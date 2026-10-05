import os
from pathlib import Path
from typing import Iterable

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, scoped_session, sessionmaker
from sqlalchemy.schema import CreateTable

PROJECT_ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("VOCABFLOW_DB_PATH", PROJECT_ROOT / "vocabflow.db")).resolve()
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
DATABASE_URL = f"sqlite:///{DB_PATH.as_posix()}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False, "timeout": 5},
    future=True,
    pool_pre_ping=True,
)


class Base(DeclarativeBase):
    pass


SessionLocal = scoped_session(
    sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
)

SCHEMA_VERSION = 13
# Hard per-user storage ceilings. App-level checks provide friendly errors; SQLite
# triggers below make the ceilings effective even under concurrent writes.
USER_QUOTA_LIMITS = {
    "words": 10000,
    "sentences": 10000,
    "reviews": 50000,
    "sentence_reviews": 50000,
    "quiz_history": 10000,
    "sentence_quiz_history": 10000,
    "practice_history": 10000,
}
OWNED_TABLES = (
    "words",
    "sentences",
    "reviews",
    "sentence_reviews",
    "quiz_history",
    "sentence_quiz_history",
    "practice_history",
    "settings",
)
REBUILD_ORDER = (
    "reviews",
    "sentence_reviews",
    "quiz_history",
    "sentence_quiz_history",
    "practice_history",
    "settings",
    "words",
    "sentences",
)


def _column_names(connection, table: str) -> set[str]:
    return {column["name"] for column in inspect(connection).get_columns(table)}


def _foreign_key_pairs(connection, table: str) -> set[tuple[str, str, str]]:
    return {
        (fk["constrained_columns"][0], fk["referred_table"], fk["referred_columns"][0])
        for fk in inspect(connection).get_foreign_keys(table)
        if len(fk.get("constrained_columns", [])) == 1 and len(fk.get("referred_columns", [])) == 1
    }


def _ensure_schema_meta(connection) -> int:
    connection.execute(text("""
        CREATE TABLE IF NOT EXISTS schema_meta (
            key TEXT PRIMARY KEY,
            version INTEGER NOT NULL
        )
    """))
    row = connection.execute(text("SELECT version FROM schema_meta WHERE key = 'schema'" )).first()
    return int(row[0]) if row else 0


def _set_schema_version(connection, version: int) -> None:
    connection.execute(text("""
        INSERT INTO schema_meta (key, version) VALUES ('schema', :version)
        ON CONFLICT(key) DO UPDATE SET version = excluded.version
    """), {"version": version})


def _add_legacy_user_columns(connection, tables: Iterable[str]) -> None:
    for table in tables:
        if table not in inspect(connection).get_table_names():
            continue
        if "user_id" not in _column_names(connection, table):
            connection.execute(text(f"ALTER TABLE {table} ADD COLUMN user_id INTEGER"))


def _migrate_legacy_rows(connection) -> int:
    """Move orphaned legacy rows only to an explicitly selected owner account."""
    tables = set(inspect(connection).get_table_names())
    orphan_tables = {
        table: int(connection.execute(text(f"SELECT COUNT(*) FROM {table} WHERE user_id IS NULL")).scalar_one())
        for table in OWNED_TABLES
        if table in tables and "user_id" in _column_names(connection, table)
    }
    orphan_tables = {table: count for table, count in orphan_tables.items() if count}
    if not orphan_tables:
        return 0

    raw_owner = os.environ.get("VOCABFLOW_LEGACY_OWNER_ID", "").strip()
    if not raw_owner:
        raise RuntimeError(
            "Legacy rows without user ownership were found. Refusing to assign them automatically. "
            "Run 'python migrate_legacy.py --owner-id <existing-user-id>' once, then start VocabFlow."
        )
    try:
        owner_id = int(raw_owner)
    except ValueError as exc:
        raise RuntimeError("VOCABFLOW_LEGACY_OWNER_ID must be a positive integer") from exc
    if owner_id < 1:
        raise RuntimeError("VOCABFLOW_LEGACY_OWNER_ID must be a positive integer")
    owner_exists = connection.execute(text("SELECT 1 FROM users WHERE id = :owner_id LIMIT 1"), {"owner_id": owner_id}).first()
    if owner_exists is None:
        raise RuntimeError(f"Legacy migration owner account {owner_id} does not exist")

    total = 0
    for table, count in orphan_tables.items():
        if table == "settings":
            # Settings is one row per user. If the owner already has settings, keep the
            # owner's current row and discard the obsolete orphan row instead of creating
            # a UNIQUE(user_id) conflict.
            owner_settings = connection.execute(
                text("SELECT 1 FROM settings WHERE user_id = :owner_id LIMIT 1"),
                {"owner_id": owner_id},
            ).first()
            if owner_settings is not None:
                result = connection.execute(text("DELETE FROM settings WHERE user_id IS NULL"))
            else:
                result = connection.execute(
                    text("UPDATE settings SET user_id = :owner_id WHERE user_id IS NULL"),
                    {"owner_id": owner_id},
                )
        else:
            result = connection.execute(
                text(f"UPDATE {table} SET user_id = :owner_id WHERE user_id IS NULL"),
                {"owner_id": owner_id},
            )
        total += result.rowcount or 0
    return total


def _needs_fk_rebuild(connection) -> list[str]:
    required = {
        "words": {("user_id", "users", "id")},
        "sentences": {("user_id", "users", "id")},
        "reviews": {("user_id", "users", "id"), ("word_id", "words", "id")},
        "sentence_reviews": {("user_id", "users", "id"), ("sentence_id", "sentences", "id")},
        "quiz_history": {("user_id", "users", "id")},
        "sentence_quiz_history": {("user_id", "users", "id")},
        "practice_history": {("user_id", "users", "id")},
        "settings": {("user_id", "users", "id")},
        "learning_attempts": {("user_id", "users", "id")},
    }
    return [table for table, fks in required.items() if table in inspect(connection).get_table_names() and not fks.issubset(_foreign_key_pairs(connection, table))]




def _ensure_user_security_columns(connection) -> None:
    if "users" not in inspect(connection).get_table_names():
        return
    cols = _column_names(connection, "users")
    if "security_version" not in cols:
        connection.execute(text("ALTER TABLE users ADD COLUMN security_version INTEGER NOT NULL DEFAULT 1"))
    connection.execute(text("UPDATE users SET security_version = 1 WHERE security_version IS NULL OR security_version < 1"))


def _ensure_user_profile_columns(connection) -> None:
    if "users" not in inspect(connection).get_table_names():
        return
    cols = _column_names(connection, "users")
    if "full_name" not in cols:
        connection.execute(text("ALTER TABLE users ADD COLUMN full_name VARCHAR(80) NOT NULL DEFAULT ''"))
    if "email" not in cols:
        connection.execute(text("ALTER TABLE users ADD COLUMN email VARCHAR(160)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS ix_users_email ON users (email)"))

def _ensure_indexes(connection) -> None:
    statements = {
        "words": (
            "CREATE INDEX IF NOT EXISTS ix_words_user_id ON words (user_id)",
            "CREATE INDEX IF NOT EXISTS ix_words_user_category ON words (user_id, category)",
            "CREATE INDEX IF NOT EXISTS ix_words_user_status_next_review ON words (user_id, status, next_review)",
        ),
        "sentences": (
            "CREATE INDEX IF NOT EXISTS ix_sentences_user_id ON sentences (user_id)",
            "CREATE INDEX IF NOT EXISTS ix_sentences_user_category ON sentences (user_id, category)",
            "CREATE INDEX IF NOT EXISTS ix_sentences_user_status_next_review ON sentences (user_id, status, next_review)",
        ),
        "reviews": (
            "CREATE INDEX IF NOT EXISTS ix_reviews_user_id ON reviews (user_id)",
            "CREATE INDEX IF NOT EXISTS ix_reviews_user_reviewed_at ON reviews (user_id, reviewed_at)",
            "CREATE INDEX IF NOT EXISTS ix_reviews_user_word_reviewed_at ON reviews (user_id, word_id, reviewed_at)",
        ),
        "sentence_reviews": (
            "CREATE INDEX IF NOT EXISTS ix_sentence_reviews_user_id ON sentence_reviews (user_id)",
            "CREATE INDEX IF NOT EXISTS ix_sentence_reviews_user_reviewed_at ON sentence_reviews (user_id, reviewed_at)",
            "CREATE INDEX IF NOT EXISTS ix_sentence_reviews_user_sentence_reviewed_at ON sentence_reviews (user_id, sentence_id, reviewed_at)",
        ),
        "quiz_history": (
            "CREATE INDEX IF NOT EXISTS ix_quiz_history_user_id ON quiz_history (user_id)",
            "CREATE INDEX IF NOT EXISTS ix_quiz_history_user_date ON quiz_history (user_id, date)",
        ),
        "sentence_quiz_history": (
            "CREATE INDEX IF NOT EXISTS ix_sentence_quiz_history_user_id ON sentence_quiz_history (user_id)",
            "CREATE INDEX IF NOT EXISTS ix_sentence_quiz_history_user_date ON sentence_quiz_history (user_id, date)",
        ),
        "practice_history": (
            "CREATE INDEX IF NOT EXISTS ix_practice_history_user_id ON practice_history (user_id)",
            "CREATE INDEX IF NOT EXISTS ix_practice_history_user_date ON practice_history (user_id, date)",
        ),
        "settings": (
            "CREATE INDEX IF NOT EXISTS ix_settings_user_id ON settings (user_id)",
        ),
        "users": (
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username_nocase ON users (username COLLATE NOCASE)",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_nocase ON users (lower(email)) WHERE email IS NOT NULL AND trim(email) <> ''",
        ),
    }
    tables = set(inspect(connection).get_table_names())
    for table, ddl_items in statements.items():
        if table not in tables:
            continue
        for ddl in ddl_items:
            connection.exec_driver_sql(ddl)


def _ensure_quota_triggers(connection) -> None:
    """Create database-level per-user quota guards for owned collections."""
    tables = set(inspect(connection).get_table_names())
    for table, limit in USER_QUOTA_LIMITS.items():
        if table not in tables or "user_id" not in _column_names(connection, table):
            continue
        trigger_name = f"trg_{table}_user_quota"
        connection.exec_driver_sql(f"""
            CREATE TRIGGER IF NOT EXISTS "{trigger_name}"
            BEFORE INSERT ON "{table}"
            WHEN NEW.user_id IS NOT NULL
             AND (SELECT COUNT(*) FROM "{table}" WHERE user_id = NEW.user_id) >= {int(limit)}
            BEGIN
                SELECT RAISE(ABORT, '{table} quota reached');
            END
        """)



def _foreign_key_check(connection) -> list[tuple]:
    return list(connection.execute(text("PRAGMA foreign_key_check")).fetchall())


def init_db() -> None:
    import models  # noqa: F401

    # WAL lets readers continue while a short write is in progress. NORMAL keeps
    # commits durable while avoiding an unnecessary full sync for every request.
    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA journal_mode=WAL")
        connection.exec_driver_sql("PRAGMA synchronous=NORMAL")

    Base.metadata.create_all(bind=engine)
    with engine.begin() as connection:
        _ensure_user_profile_columns(connection)
        _ensure_user_security_columns(connection)
        _add_legacy_user_columns(connection, OWNED_TABLES)
        current_version = _ensure_schema_meta(connection)
        _migrate_legacy_rows(connection)

        # Existing Stage 5/6 databases may have user_id columns added by ALTER TABLE,
        # which SQLite cannot retrofit with foreign keys. Rebuild only those legacy tables.
        needs_rebuild = _needs_fk_rebuild(connection)

    if needs_rebuild:
        raw = engine.raw_connection()
        try:
            raw.execute("PRAGMA foreign_keys=OFF")
            cursor = raw.cursor()
            import models  # noqa: F401
            for table in REBUILD_ORDER:
                if table in needs_rebuild:
                    model_table = Base.metadata.tables[table]
                    temp_name = f"{table}__stage9_new"
                    cursor.execute(f'DROP TABLE IF EXISTS "{temp_name}"')
                    ddl = str(CreateTable(model_table).compile(dialect=engine.dialect))
                    ddl = ddl.replace(f'CREATE TABLE {table}', f'CREATE TABLE {temp_name}', 1)
                    ddl = ddl.replace(f'CREATE TABLE "{table}"', f'CREATE TABLE "{temp_name}"', 1)
                    cursor.execute(ddl)
                    cols = ", ".join(f'"{column.name}"' for column in model_table.columns)
                    cursor.execute(f'INSERT INTO "{temp_name}" ({cols}) SELECT {cols} FROM "{table}"')
                    cursor.execute(f'DROP TABLE "{table}"')
                    cursor.execute(f'ALTER TABLE "{temp_name}" RENAME TO "{table}"')
            raw.commit()
        finally:
            try:
                raw.execute("PRAGMA foreign_keys=ON")
            finally:
                raw.close()

    with engine.begin() as connection:
        _ensure_indexes(connection)
        _ensure_quota_triggers(connection)
        version = _ensure_schema_meta(connection)
        if version < SCHEMA_VERSION:
            _set_schema_version(connection, SCHEMA_VERSION)
        violations = _foreign_key_check(connection)
        if violations:
            raise RuntimeError(f"SQLite foreign-key integrity check failed: {violations[:5]}")


def db_session():
    return SessionLocal()


def close_session() -> None:
    SessionLocal.remove()


@event.listens_for(engine, "connect")
def _enable_sqlite_pragmas(dbapi_connection, _connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA temp_store=MEMORY")
    cursor.close()
