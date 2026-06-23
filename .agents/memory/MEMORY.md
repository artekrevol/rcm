# Memory Index

- [tsc is not a passing gate here](tsc-not-a-gate.md) — `npm run check` has ~145 pre-existing errors; app ships via tsx (type-stripping). Don't treat red tsc as a regression you caused.
- [HH status single source of truth](hh-status-centralization.md) — HH UTN/NOA status literals live in shared/hh-status.ts; the lead-handoff "accepted" literal is a permanent grep false-positive, not an HH status.
- [GitHub push mechanism](git-push-to-github.md) — GitHub origin needs an explicit push task; the local origin/main tracking ref lies about "ahead N", trust git ls-remote.
- [Demo seed safety](demo-seed-safety.md) — org demo seeds must be standalone dev-only scripts, never wired into startup or the prod seed (those run against Railway prod/PHI).
