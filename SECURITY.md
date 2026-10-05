# VocabFlow security notes

VocabFlow includes authentication hardening, server-owned learning attempts, protected review scheduling, security headers, Content-Security-Policy, rate limiting, session expiration, and CSV formula-injection protection.

## Production requirements

- Set `VOCABFLOW_ENV=production`.
- Set a stable, high-entropy `VOCABFLOW_SECRET_KEY`.
- Configure `VOCABFLOW_REDIS_URL` for the shared authentication rate limiter.
- Set `VOCABFLOW_PROXY_HOPS` only to the number of trusted reverse proxies directly in front of Flask.
- Use HTTPS in production.

## Database

The public release intentionally does not include a populated SQLite database. The application creates `vocabflow.db` automatically. Never publish a local database containing real accounts or learning data.

## Data limits

The application enforces hard per-user limits for vocabulary, sentences, review history, and learning history. The limits are checked in the application and reinforced by SQLite triggers.

## Legacy migration

Legacy rows without `user_id` are never assigned automatically to the first account. Run `python migrate_legacy.py --owner-id <existing-user-id>` once for an old database.

## Dependency integrity

`requirements-lock.txt` pins runtime dependencies and includes SHA-256 hashes. Use `--require-hashes` in trusted build environments.
