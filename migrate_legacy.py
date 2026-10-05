from __future__ import annotations

import argparse
import os
import sys


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Safely migrate legacy VocabFlow rows that have no user_id."
    )
    parser.add_argument("--owner-id", required=True, type=int, help="Existing VocabFlow user id that should own the legacy data")
    args = parser.parse_args()
    if args.owner_id < 1:
        parser.error("--owner-id must be a positive integer")

    os.environ["VOCABFLOW_LEGACY_OWNER_ID"] = str(args.owner_id)
    try:
        from database import init_db
        init_db()
    except Exception as exc:
        print(f"Migration failed: {exc}", file=sys.stderr)
        return 1

    print(f"Legacy migration completed. Explicit owner id: {args.owner_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
