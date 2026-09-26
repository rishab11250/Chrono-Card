# Repository audit — September 2026

Scope: source, deployment configuration, shared game rules, HTTP and Socket.IO boundaries, browser recovery, SQLite/Redis persistence, and automated regression tests. Public hosting remains deferred; this is not an external penetration-test certification.

## Findings addressed

| Severity | Finding                                                                                                 | Fix and regression evidence                                                                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Critical | Public default signing key and incomplete token expiry validation                                       | Per-app authentication key, production startup guard, strict claims and expiry checks; `audit-auth.test.ts`                                                                                                        |
| High     | Simultaneous guests could not act; the party shared one action budget; queued plans vanished on restart | Own-player previews, validated ordered plans, independent budgets/RNG, deterministic collision handling, persisted plans and forfeit resolution; `simultaneous.test.ts`, socket, browser, and Redis recovery tests |
| High     | Account endpoints allowed repeated/fabricated daily run statistics                                      | Authoritative room proof for online records and unique run receipts; server integration tests                                                                                                                      |
| High     | Failed Redis writes poisoned the persistence queue                                                      | Recoverable serialized writes, health reporting, bounded startup and safe closure; `persistence-errors.test.ts`                                                                                                    |
| Medium   | Concurrent case-variant account names could collide                                                     | SQLite unique case-insensitive index and conflict response; persistence and HTTP tests                                                                                                                             |
| Medium   | Synchronous password hashing blocked the server event loop                                              | Asynchronous scrypt retaining password-record compatibility; authentication tests                                                                                                                                  |
| Medium   | Inconsistent API origin, malformed-input and rate-limit handling                                        | Shared origin/preflight handling, JSON errors, auth/write limits, bounded proxy trust and security headers; server integration tests                                                                               |
| Medium   | Corrupt saves or unavailable browser storage broke recovery                                             | Validated local state, guarded storage operations, replay metadata restoration; saved-state and browser tests                                                                                                      |
| Medium   | Ghost records could be overwritten by ID and grow without bound                                         | Insert-only records and retention of the newest 1,000 replays                                                                                                                                                      |

The production-audit and security-review skills guided the boundary checks, negative tests, and explicit deployment requirements. No source was uploaded to a third-party scanner.

## Verification

Required gate: `npm run typecheck && npm run lint && npx vitest run`. Additional gates: full test typechecking, Prettier, Chromium browser tests, production build, and dependency audit. Redis restart tests require `TEST_REDIS_URL`; GitHub CI supplies an isolated Redis service. Tests cover both alternating and simultaneous restart recovery.

## Remaining operating limits

- One authoritative server instance only; snapshots are not distributed locking.
- Provision a stable private signing key, exact allowed origins, correct proxy hop count, HTTPS, persistent disk, and backups before deployment. Review legacy case-colliding accounts before upgrading. See [deployment handoff](deployment.md).
- Local personal statistics and anonymous display names are not verified identities. Daily competitive scores are server-resolved; never use offline personal statistics for prizes or rankings.
- Account bearer tokens in local storage remain exposed to same-origin script compromise. There is no account recovery or signing-key rotation grace window.
- Manual screen-reader testing, public-device/network smoke testing, sustained load testing, and a backup-restore drill remain release-operator tasks. No public deployment was performed.
