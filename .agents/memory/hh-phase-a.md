---
name: HH Phase A architecture
description: How segment isolation works for the Home Health Skilled care model — routing, validation, UI gating, and migrations.
---

## Segment isolation pattern

The `care_model` column in `practice_settings` is the single source of truth for which segment an org belongs to. Default is `outpatient_professional`.

### Server-side gating
- `server/middleware/require-care-model.ts` exports `requireCareModel(model)` and `requireAnyHomeHealth()`.
- Every `/api/hh/*` route uses `requireHH("home_health_skilled")` (imported lazily inside registerRoutes via `const { requireCareModel: requireHH } = await import(...)`).
- `home_health_personal_care` is a future segment — routes reject it with 501.

### Validation packs
- `hh-episode-completeness` and `hh-auth-visit-cap` packs have `appliesTo.careModels: ["home_health_skilled"]`.
- `resolvePacksForClaim` in `pack-loader.ts` accepts a `careModel` arg (loaded from practice_settings in runner.ts) and only includes segment packs when the org matches.

### HH tables (all RLS-protected)
- `episodes`, `billing_periods`, `episode_visits`, `pre_claim_reviews`, `noa_filings`
- All have `organization_id` + RLS policy on `app.current_organization_id`.
- Seeder in `routes.ts` creates these tables idempotently using `seederLog` guards.

### NOA clock
- `due_date = soc_date + 5 calendar days` — computed in POST /api/hh/episodes and stored in `noa_filings`.
- `penalty_days = max(0, floor((filed_date - due_date) / msPerDay))` in PATCH /api/hh/noa/:id/file.
- `status = 'late'` when `penalty_days > 0`, else `'filed'`.

### G6 gate
- Before submit-oa or submit-stedi, if `claims.billing_period_id` is set, assert `billing_periods.period_status = 'ready_to_bill'`.
- Returns HTTP 422 with `code: "G6_BILLING_PERIOD_NOT_READY"` otherwise.

### Visit-cap tracking
- POST /api/hh/episodes/:id/visits increments `prior_authorizations.visits_used` when `counts_against_auth = true`.
- Uses `episodes.authorization_id` to find the PA record.

### UI gating
- `client/src/contexts/segment.tsx` — `SegmentProvider` reads `/api/billing/practice-settings` and exposes `useIsHH()` / `useSegment()`.
- `BillingLayout` wraps with `SegmentProvider` so every billing page has access.
- Billing sidebar shows Episodes + NOA nav items only when `isHH === true`.

### Admin provisioning
- Super-admin PATCH `/api/super-admin/orgs/:orgId/care-model` — sets care_model, rcd_state.
- `home_health_personal_care` is rejected (not yet implemented).
- Clinic-detail admin page has a "Segment Provisioning" card with a dropdown + RCD state field.

### Caritas seed
- Seeder auto-sets `care_model = 'home_health_skilled'`, `rcd_state = 'FL'` for any org with name LIKE '%caritas%' when their current value is the default.

**Why:**
Segment isolation must be enforced at the server level (middleware guard), not just the UI level. The UI gating is convenience only.
