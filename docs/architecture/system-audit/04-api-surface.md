# 04 — API Surface

**Total Express handlers (raw grep):** 261 (`_queries/20_routes_raw.txt`).
All registered in `server/routes.ts` from line 207 (`registerRoutes`) onwards.

The full inventory with file:line is in `_queries/21_code_inventory.txt` (`=== ROLE CHECKS ===` section). Below is a curated grouping; a route is auth-gated by `requireAuth`, `requireRole(...)`, or `requireSuperAdmin` (defined in `server/auth.ts:231-260`).

## Auth helpers

```ts
// server/auth.ts:231-260 (per progress notes)
requireAuth        // any logged-in user
requireRole(...r)  // user.role ∈ r
requireSuperAdmin  // user.role === 'super_admin'
```

Org context resolver at `server/routes.ts:153-186`:
- `getOrgId(req)` — for super_admin returns `req.session.impersonatingOrgId` (or null), else `user.organization_id`.
- `verifyOrg(entity, req)` — denies if no orgId in session (super_admin must impersonate).
- `requireOrgCtx(req, res)` — 400-replies with "No organization context" if missing.

## Billing module routes

Sample (selected from `_queries/21_code_inventory.txt`; full list there):

| Method | Path | Roles | Line |
|---|---|---|---:|
| GET | `/api/billing/payers` | admin, rcm_manager | 3297 |
| GET | `/api/billing/providers` | admin, rcm_manager | 3316 |
| POST | `/api/billing/providers` | admin, rcm_manager | 3334 |
| PATCH | `/api/billing/providers/:id` | admin, rcm_manager | 3384 |
| GET | `/api/billing/org-readiness` | admin, rcm_manager, biller, coder, front_desk | 3439 |
| GET | `/api/billing/practice-settings` | admin, rcm_manager | 3472 |
| PUT | `/api/billing/practice-settings` | admin, rcm_manager | 3484 |
| PATCH | `/api/billing/practice-settings/frcpb-enrollment` | admin, rcm_manager | 3520 |
| GET | `/api/billing/va-locations` | admin, rcm_manager | 3658 |
| GET | `/api/billing/va-rate` | admin, rcm_manager | 3668 |
| GET | `/api/billing/filing-alerts` | admin, rcm_manager, biller | 3742 |
| POST | `/api/billing/filing-alerts/:id/acknowledge` | admin, rcm_manager, biller | 3815 |
| POST | `/api/billing/filing-alerts/:id/snooze` | admin, rcm_manager, biller | 3832 |
| POST | `/api/billing/claims/:id/timely-filing-evaluate` | admin, rcm_manager | 3850 |
| GET | `/api/billing/patients/:id/referrals` | admin, rcm_manager, biller | 3879 |
| POST | `/api/billing/patients/:id/referrals` | admin, rcm_manager, biller | 3898 |
| PATCH | `/api/billing/referrals/:id` | admin, rcm_manager, biller | 3934 |
| POST | `/api/billing/claims/:id/link-referral` | admin, rcm_manager, biller | 3960 |
| GET | `/api/billing/claim-tracker` | admin, rcm_manager | 4007 |
| POST | `/api/billing/claims/:id/mark-fixed` | admin, rcm_manager | 4071 |
| GET | `/api/billing/eras` | admin, rcm_manager | 4271 |
| POST | `/api/billing/eras` | admin, rcm_manager | 4286 |
| GET | `/api/billing/eras/:id` | admin, rcm_manager | 4308 |
| PATCH | `/api/billing/eras/:id` | admin, rcm_manager | 4324 |
| POST | `/api/billing/eras/upload` | admin, rcm_manager | 12715 |
| GET | `/api/billing/follow-up` | admin, rcm_manager | 4457 |
| POST | `/api/billing/follow-up-notes` | admin, rcm_manager | 4488 |
| GET | `/api/billing/follow-up-notes/:claimId` | admin, rcm_manager | 4505 |
| POST | `/api/billing/follow-up-notes/copy-to-patient` | admin, rcm_manager | 4518 |
| GET | `/api/billing/claims/:id/letter-data` | admin, rcm_manager | 4547 |
| GET | `/api/billing/dashboard/stats` | admin, rcm_manager | 4628 |
| GET | `/api/billing/onboarding-checklist` | admin, rcm_manager | 4743 |
| POST | `/api/billing/onboarding-checklist/dismiss` | admin, rcm_manager | 4814 |
| GET | `/api/billing/claims/:id/denial-recovery` | admin, rcm_manager | 4828 |
| POST | `/api/billing/refresh-responses` | admin, rcm_manager | 4891 |
| GET | `/api/billing/prior-auths` | admin, rcm_manager | 4969 |
| GET | `/api/billing/activity-logs` | **admin only** | 4991 |
| GET | `/api/billing/compliance-report/:type` | **admin only** | 5018 |
| GET | `/api/billing/claims/wizard-data` | admin, rcm_manager | 5119 |
| POST | `/api/billing/claims/draft` | admin, rcm_manager | 5139 |
| POST | `/api/billing/claims/preflight` | admin, rcm_manager | 5262 |
| PATCH | `/api/billing/claims/:id` | admin, rcm_manager | 5311 |
| POST | `/api/billing/claims/:id/risk` | admin, rcm_manager | 5419 |
| GET | `/api/billing/claims/:id/pdf-data` | admin, rcm_manager | 5522 |
| PATCH | `/api/billing/claims/:id/pdf-generated` | admin, rcm_manager | 5580 |
| PATCH | `/api/billing/claims/:id/archive` | admin, rcm_manager | 5606 |
| GET | `/api/billing/claims/:id/edi-validate` | admin, rcm_manager | 5643 |
| GET | `/api/billing/claims/:id/edi` | admin, rcm_manager | 6006 |
| POST | `/api/billing/test-oa-connection` | admin, rcm_manager | 6168 |
| POST | `/api/billing/claims/:id/submit-oa` | admin, rcm_manager | 6190 |
| POST | `/api/billing/claims/:id/submit-stedi` | admin, rcm_manager | 6348 |
| POST | `/api/billing/claims/:id/test-stedi` | admin, rcm_manager, **super_admin** | 6623 |
| POST | `/api/billing/claims/:id/check-277` | admin, rcm_manager | 6821 |
| GET | `/api/billing/hcpcs` etc. (search, by code, rates) | admin, rcm_manager | 6859, 6868, 6935, 6953 |
| GET | `/api/billing/icd10/search` | admin, rcm_manager | 6965 |
| POST | `/api/billing/payers` / PATCH | admin, rcm_manager | 6990, 7005 |
| POST | `/api/billing/payers/sync-stedi` | admin, rcm_manager | 7076 |
| GET | `/api/billing/payers/stedi-search` | admin, rcm_manager | 7182 |
| GET, POST, PATCH, DELETE | `/api/billing/payer-auth-requirements*` | admin (writes), admin/rcm_manager (reads) | 7197-7351 |
| GET | `/api/billing/rates`, `va-rates` | admin, rcm_manager | 7351, 7364 |
| POST/PATCH/DELETE | `/api/billing/rates*` | admin, rcm_manager | 7401, 7416, 7441 |
| GET | `/api/billing/payers/:id/plan-products` | admin, rcm_manager | 7453 |
| GET | `/api/billing/payers/:id/delegated-entities` | admin, rcm_manager | 7471 |
| GET | `/api/billing/plan-products` | admin, rcm_manager | 7501 |
| GET, POST, PATCH | `/api/billing/patients*` | admin, rcm_manager | 7511-7706 |
| PATCH | `/api/billing/patients/:id/archive` and `/restore` | admin, rcm_manager | 7706, 7750 |
| GET | `/api/billing/patients/:id/claims` | admin, rcm_manager | 7768 |
| POST | `/api/billing/patients/:id/notes` | admin, rcm_manager | 7783 |
| GET | `/api/billing/patients/:id/vob` | admin, rcm_manager | 7810 |
| GET | `/api/billing/stedi/status` | admin, rcm_manager | 7829 |
| POST | `/api/billing/patients/:id/vob/check` | admin, rcm_manager | 7840 |
| POST | `/api/billing/patients/:id/vob/manual` | admin, rcm_manager | 7933 |
| GET | `/api/billing/reports/clean-claim-rate` | admin, rcm_manager | 12684 |

## Intake module

Per `_queries/21_code_inventory.txt`:

| Method | Path | Roles | Line |
|---|---|---|---:|
| GET | `/api/intake/dashboard/stats` | admin, intake | 4588 |

Plus the intake-flow management routes (`/api/flows`, `/api/leads`, `/api/calls`, `/api/orgs/:slug/*`) which appear in `_queries/20_routes_raw.txt` but are not all role-checked in the inventory grep — most are gated via `requireAuth` only and use `getOrgId` for tenant scoping.

## Admin module

| Method | Path | Roles | Line |
|---|---|---|---:|
| GET | `/api/admin/users` | admin | 5053 |
| POST | `/api/admin/users` | admin | 5063 |
| PATCH | `/api/admin/users/:id` | admin | 5076 |
| PATCH | `/api/admin/users/:id/password` | admin | 5091 |
| DELETE | `/api/admin/users/:id` | admin | 5104 |

`requireSuperAdmin` is referenced in `routes.ts:9` but full enumeration of super-admin routes is in the broader 261-route grep (`_queries/20_routes_raw.txt`). Notably `/admin/clinics`, `/admin/payer-manuals`, `/admin/data-tools`, `/admin/rules-database`, `/admin/scrapers` UI pages all hit super_admin-only API endpoints.

## Cross-module / shared

| Method | Path | Roles | Line |
|---|---|---|---:|
| GET | `/api/dashboard/metrics` | admin, rcm_manager, intake | 7983 |

## Webhooks (no role gate; signed)

- Vapi: signature header validated against `VAPI_WEBHOOK_SECRET` (`routes.ts:9279`).
- Stedi: validated against `STEDI_WEBHOOK_SECRET` (`routes.ts:12767`).
- Twilio inbound SMS: **UNVERIFIED** signature check; route exists per inventory.

## Hotspots / observations

- **`server/routes.ts` is 13,867 lines and registers all 261 endpoints in one function.** Modularization would help testability and review; see 12.
- Several routes use bare `requireRole("admin")` for intelligence/compliance endpoints (`/api/billing/activity-logs`, `/api/billing/compliance-report/:type`) where rcm_manager is excluded — confirm intent.
- `/api/billing/claims/:id/test-stedi` is the only billing route that explicitly grants `super_admin` (`routes.ts:6623`). Other test/diagnostic routes don't — UNVERIFIED whether super_admin is implicitly authorized via session impersonation.
