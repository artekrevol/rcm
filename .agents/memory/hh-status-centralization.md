---
name: HH status single source of truth
description: Where Home Health UTN/NOA status constants live and a permanent grep false-positive to expect
---

# Home Health status constants are centralized in `shared/hh-status.ts`

All Home Health UTN/PCR `review_status` and NOA `status` vocabularies live in `shared/hh-status.ts` (UTN_AFFIRMED_CANONICAL / UTN_AFFIRMED_STATES / PCR_REVIEW_STATUSES / NOA_STATUS / NOA_GATE_STATUSES + helpers `isUtnAffirmedStatus`, `isNoaGateSatisfied`, `formatStatusList`). Consumers: `server/services/hh/gates.ts`, `server/services/validation/packs/hh-noa-precondition.ts`, `server/services/validation/engine/runner.ts`, and `server/routes.ts`.

**Why:** the NOA gate set was previously duplicated between gates.ts and the validation pack (the pack even carried a "must remain in sync with gates.ts" comment) and UTN affirmed states were inlined as SQL `IN ('affirmed','accepted','approved')` in multiple places — a real drift risk.

**How to apply:**
- Server imports use the alias form `@shared/hh-status` (no `.js`); relative imports in server code use `.js`.
- SQL filters use `review_status = ANY($n::text[])` with `[...UTN_AFFIRMED_STATES]` as a param — never inline the literals again.
- `.includes()` on these `as const` arrays needs a `(X as readonly string[]).includes(...)` cast to accept a plain `string`.

## Permanent grep false-positive
The audit `grep -rn "'accepted'" server/services/validation server/routes.ts` will always flag `validHandoffStatuses = ["not_sent","sent","accepted"]` in routes.ts. That is the **lead-handoff** domain (sits with `validStatuses`/`validPriorities`/`validVobStatuses`), NOT an HH UTN/NOA status — it merely shares the word "accepted". Do **not** fold it into `shared/hh-status.ts`; doing so would conflate unrelated domains. If a fully-green audit is required, centralize lead/VOB statuses into their own module instead.
