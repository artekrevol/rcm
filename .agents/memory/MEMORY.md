# Memory Index

- [tsc is not a passing gate here](tsc-not-a-gate.md) — `npm run check` has ~145 pre-existing errors; app ships via tsx (type-stripping). Don't treat red tsc as a regression you caused.
- [HH status single source of truth](hh-status-centralization.md) — HH UTN/NOA status literals live in shared/hh-status.ts; the lead-handoff "accepted" literal is a permanent grep false-positive, not an HH status.
