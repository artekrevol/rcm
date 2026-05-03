# ClaimShield — Phase 3 Sprint 1c Audit Report

**Sprint:** EDI Route → `evaluateClaim` Wire-In
**Scope:** server-side only; gates `POST /api/billing/claims/:id/submit-stedi` and `POST /api/billing/claims/:id/test-stedi` on Tier 1 structural integrity before `generate837P`
**Mode:** Build (executed directly by main agent in dev workspace)
**Status:** ⚠️ **STOPPED at Step 1 — `tsc --noEmit` baseline FAILED. Awaiting sign-off on how to proceed.**

This report follows the same convention as `sprint1a-audit-report.md` / `sprint1b-…` / `phase3-prod-deploy-audit-report.md`: per-step results, line-cited evidence, no production touches, dev-only.

---

## §1 Pre-flight (Step 1)

### §1.1 Snapshot (Step 1a) — ✅ DONE

| Item | Value |
|---|---|
| Snapshot path | `docs/architecture/sprint1c-snapshots/dev-pre-sprint1c-20260503-072034Z.sql` |
| Tool | `pg_dump (PostgreSQL) 16.5` (dev server is also v16; v17 binary not required for dev) |
| Flags | `--no-owner --no-privileges` |
| Size | 127 MB / 183,366 lines |
| `.gitignore` | `docs/architecture/sprint1c-snapshots/` already covered (pre-existing entry) |

### §1.2 Baseline test results (Step 1b)

| Check | Expected per prompt | Actual | Status |
|---|---|---|---|
| `scripts/verify-tenant-isolation.ts` | 12/12 | 12 passed, 0 failed | ✅ PASS |
| `server/services/rules-engine/tier1-structural-integrity.test.ts` | 16/16 | 16 passed, 0 failed | ✅ PASS |
| `server/services/rules-engine.test.ts` | 4/4 | 4 passed, 0 failed | ✅ PASS |
| `server/services/voice-persona-builder.test.ts` | 8/8 | **23 passed, 0 failed** | ✅ PASS (test suite expanded since prompt was authored — non-blocking, just a stale prompt expectation) |
| `scripts/smoke-helpers.ts` | "green" | Chajinel→home_care; demo ppe=2; chajinel ppe=0; no-ctx=0 | ✅ PASS (dev counts; matches Phase 3 expected dev state) |
| `npx tsc --noEmit` | "clean" | **exit 1, 85 errors across 10 files** | ❌ **FAIL** |

### §1.3 `tsc --noEmit` failure breakdown

Output captured to `/tmp/tsc-baseline.log`. Errors are **pre-existing** — Sprint 1c has not yet written or modified any code. Distribution:

**Errors per file (top → bottom):**
```
63  server/routes.ts
 5  server/storage.ts
 4  server/services/rate-ingest.ts
 4  client/src/pages/billing/claim-wizard.tsx
 3  server/services/field-resolver.ts
 1  server/services/rules-engine.ts
 1  server/services/manual-extractor.ts
 1  server/seed.ts
 1  server/lib/rate-lookup.ts
 1  client/src/pages/claim-detail.tsx
 1  client/src/lib/generate-claim-pdf.ts
```

**Errors per code (top → bottom):**
```
27  TS2345  (Argument of type X not assignable to parameter)
21  TS2304  (Cannot find name)
11  TS2339  (Property does not exist on type)
 7  TS2802  (Set/Map iteration target lower than es2015)
 6  TS7006  (Implicit any)
 6  TS2769  (No overload matches this call)
 4  TS2322  (Type X not assignable to type Y)
 1  TS7016, 1 TS18047, 1 TS1252
```

### §1.4 Sprint-1c relevance assessment

Three of the failing files intersect Sprint 1c's scope:

1. **`server/routes.ts` — 63 errors.** This is the file Sprint 1c must edit (insertions at `:6348` and `:6623`). The TSC errors are pre-existing and not localized to the Sprint 1c insertion points; they're scattered across the 7,000+ line file. Sample: lines 662 (`storage.ts insert call`), various `routes.ts` entries.
2. **`server/services/rules-engine.ts` — 1 error.** The exact module Sprint 1c routes through:
   ```
   server/services/rules-engine.ts(196,52): error TS2802: Type 'Set<string>' can only be iterated through when using the '--downlevelIteration' flag or with a '--target' of 'es2015' or higher.
   ```
   This is a tsconfig `target`/`downlevelIteration` config issue, not a logic bug. Tests for `rules-engine.ts` and `tier1-structural-integrity.ts` both pass cleanly via tsx (which does its own transpile and doesn't enforce strict tsc), so runtime behavior is unaffected.
3. **`server/storage.ts` — 5 errors.** Drizzle insert overload mismatches; not Sprint 1c scope but adjacent.

### §1.5 Standing-rule trigger

The prompt's hard rule under Step 1b is **"If any baseline fails, stop and flag."** I am stopping here as instructed.

### §1.6 Reviewer decision required

The 85 tsc errors are **pre-existing in dev**, predate Sprint 1c, and do not block any of the 5 runtime test suites that DO pass. They are also not in scope for Sprint 1c per the "What this sprint is NOT" section ("No changes to `evaluateClaim`'s signature… No changes to `generate837P` itself").

Three reasonable paths forward — picking one is a reviewer call, not an architect call:

**Path A — Proceed to Step 2 anyway, treating the tsc baseline as "known-pre-existing-failure".** Document the 85-error count as the baseline. Sprint 1c's success criterion at Step 5 becomes "tsc error count ≤ 85 (i.e. Sprint 1c introduced zero new tsc errors)" rather than "tsc clean". This preserves the spirit of the gate (Sprint 1c must not regress) without blocking on a pre-existing dev hygiene issue.

**Path B — Pause Sprint 1c and run a tsc-cleanup sprint first.** Drains the 85 errors before any Sprint 1c code lands. Pure: Sprint 1c finishes against a clean baseline. Cost: a delay of unknown size; the 63 errors in `routes.ts` alone could be substantial. Some errors (e.g. the TS2802 Set-iteration in `rules-engine.ts:196`) are tsconfig fixes not code fixes.

**Path C — Fix only the tsc errors that touch Sprint 1c's scope.** Specifically `server/services/rules-engine.ts:196` (the one Sprint 1c routes through) and any of the 63 `routes.ts` errors that fall within ±50 lines of `:6348` or `:6623`. Leave the rest. Smallest delta; lets Sprint 1c land cleanly at its own insertion points without claiming to fix the whole repo.

### §1.7 Recommendation

**Path A** is the lowest-friction option that respects both the standing rule (don't introduce new failures) and the sprint scope (server-side gate, not repo hygiene). The hard rule's intent is "don't proceed against a regressing baseline" — and a pre-existing failure that Sprint 1c neither caused nor touches is not a regression. Path A would re-run `tsc --noEmit` after Step 4 and assert error count ≤ 85.

If you prefer Path C, I can scope it as a Step 1.5 (fix `rules-engine.ts:196` TS2802 + audit the `routes.ts:6348/6623` neighborhoods) and then resume Step 2.

Path B is technically cleanest but probably out of proportion for a sprint whose net change is ~30 lines of new code.

---

## §2 Discovery — NOT STARTED

Awaiting sign-off on §1.6 before proceeding to Step 2.

---

## §3+ — NOT STARTED
