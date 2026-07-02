# Memory Index

- [tsc is not a passing gate here](tsc-not-a-gate.md) — `npm run check` has ~145 pre-existing errors; app ships via tsx (type-stripping). Don't treat red tsc as a regression you caused.
- [HH status single source of truth](hh-status-centralization.md) — HH UTN/NOA status literals live in shared/hh-status.ts; the lead-handoff "accepted" literal is a permanent grep false-positive, not an HH status.
- [GitHub push mechanism](git-push-to-github.md) — GitHub origin needs an explicit push task; the local origin/main tracking ref lies about "ahead N", trust git ls-remote.
- [Demo seed safety](demo-seed-safety.md) — org demo seeds must be standalone dev-only scripts, never wired into startup or the prod seed (those run against Railway prod/PHI).
- [Claim risk staleness contract](claim-risk-staleness.md) — risk scores are snapshots; any write touching rules-engine inputs must bump updated_at (or call the shared helper) or stale 100/RED sticks.
- [ERA 835 ingestion rules](era-835-ingestion.md) — structural rules that prevent silent data loss across all 835 ingestion paths.
- [CLM01 format](clm01-format.md) — how the 837P patient control number derives from the claim UUID and how to reverse-match it in SQL.
- [Stedi 277CA polling](stedi-277-polling.md) — correct polling architecture; common mistakes that cause silent failures.
- [HH Phase A architecture](hh-phase-a.md) — segment isolation for the Home Health Skilled care model: routing, validation, UI gating, migrations.
- [Phase B 837I interface](phase-b-837i-interface.md) — key decisions, interface shapes, and test gotchas for the institutional billing generator and gates.
- [care_model enum migration](care-model-enum.md) — why the seeder's ALTER COLUMN TYPE silently failed and the correct 3-step fix.
- [RLS grants](rls-grants.md) — RLS policies are invisible until the role has table-level GRANTs; HH tables were missing them.
- [Phase A test harness](phase-a-tests.md) — how to run the verification harness and the pure-function extraction pattern.
