# 12 — Known Issues & Tech Debt

This section consolidates UNVERIFIED items, observable drift, and structural tech debt surfaced during the audit. Nothing here is automatically remediated — Abeer review required before any change.

## Resolved since original audit (Sprint 1a + 1b)

- ✅ **Tier 1 structural validator wired into `evaluateClaim`** (Sprint 1b commit `d797b89`). Short-circuits on any `block` finding; otherwise findings merge into the legacy violation pipeline as `data_quality` with `source: 'tier1-structural'`. See 07.
- ✅ **Voice persona prompt composition at runtime** (Sprint 1b, `voice-persona-builder.ts`). Opt-in via `org_voice_personas.compose_from_profile`. Caritas remains opt-out and byte-identical; Chajinel migrated to opt-in. See 09.
- ✅ **`WITH CHECK` clauses on the 6 Phase 3 RLS policies** (Sprint 1a). Cross-tenant INSERTs are now DB-blocked. (Cross-reference `migration-state.md`.)
- ⚠ **Stale docstring**: `server/services/rules-engine/tier1-structural-integrity.ts:14-15` still says "NOT wired into the legacy `evaluateClaim` pipeline" — outdated since `d797b89`. Cleanup candidate.

## Verified gaps (high signal)

1. **Monolithic `server/routes.ts`** — 13,867 lines, 261 routes, all in one `registerRoutes()` (`routes.ts:207`). Splitting per-module (`routes/billing.ts`, `routes/intake.ts`, `routes/admin.ts`, `routes/webhooks.ts`) would cut review time and reduce merge conflicts.
2. **RLS partial — only on 6 of 88 tables (Phase 3 only).** Sprint 0 (2026-05-03) added RLS + `FORCE ROW LEVEL SECURITY` to the 6 Phase 3 tables, with `claimshield_app_role` and `withTenantTx` middleware. The legacy 82 tables (incl. `claims`, `patients`, `leads`, `calls`) still depend exclusively on app-level `verifyOrg`/`requireOrgCtx` (`routes.ts:168-186`). **Recommend** extending RLS to legacy tenant-scoped tables once `WITH CHECK` clauses are validated on the Phase 3 set. See `docs/architecture/migration-state.md` and `sprint0-audit-report.md`.
2b. ~~**`WITH CHECK` clauses missing** on the 6 Phase 3 RLS policies~~ — **resolved in Sprint 1a** (see Resolved section above). All 12 Phase 3 policies now have both `USING` and `WITH CHECK`; cross-tenant INSERTs are DB-blocked.
3. **Missing FK on tenant-scoped tables** — `leads`, `calls`, `chat_sessions`, `appointments`, `flows`, `flow_runs`, `denials`, `era_batches`, `activity_logs`, `email_logs` carry `organization_id` per the Drizzle schema but the FK constraint is absent in `_queries/04_foreign_keys.tsv`. Adding the FK would prevent orphan rows and make tenancy auditing trivial.
4. **Duplicate FK on `practice_settings`** — both `practice_settings_org_fk` (RESTRICT) and `practice_settings_organization_id_fkey` (NO ACTION) exist (`_queries/04_foreign_keys.tsv:36-37`). Drop one.
5. **No DB triggers / no views / no stored procedures / no sequences for ID generation on most tables.** All business logic lives in Node. This is fine, but it means any DB-level safety net is absent — every safeguard must be a code path.
6. **In-memory cron dedupe is restart-fragile.** `lastRunDate`, `lastWeeklyKey`, `lastRunYearQuarter` are module-scoped variables in `server/jobs/*-cron.ts`. A crash during a fired window followed by restart can re-fire the job.
7. **Single-instance assumption.** The orchestrator's optimistic claim via `UPDATE flow_runs SET next_action_at = NOW()+60s WHERE next_action_at <= NOW()` is race-safe across processes (`flow-orchestrator.ts:48-54`). The crons are **not** — they would double-fire on multi-replica deploys.
8. **Chajinel placeholder Vapi assistant** — `org_voice_personas` row for `chajinel-org-001` holds `vapi_assistant_id = 'PLACEHOLDER_AWAITING_VAPI_CONFIG'`, and the org is `is_active=false` (per `replit.md`). Must be replaced before activation.
9. **Daniela / Super-admin password env reset paths** at `routes.ts:501-547` — convenient for dev, **not safe for production** if `SUPER_ADMIN_PASSWORD` / `DANIELA_PASSWORD` env vars are present in prod. Harden by gating on `NODE_ENV !== 'production'` (UNVERIFIED whether such gating already exists; not seen in the read range).
10. **`STEDI_WEBHOOK_SECRET` not currently in `<available_secrets>`** — required at boot per `index.ts:16`. Currently missing → inbound 277/835 webhook signatures cannot be verified. App will warn at boot but still start.
11. **Twilio inbound SMS signature validation UNVERIFIED.** Vapi and Stedi webhooks both enforce a shared-secret check (`VAPI_WEBHOOK_SECRET`, `STEDI_WEBHOOK_SECRET`). The Twilio inbound SMS handler should validate `X-Twilio-Signature` — confirm.

## UNVERIFIED items (require follow-up reads)

- `IStorage` interface and per-method org filtering (`server/storage.ts` not read in detail this session). The refreshed grep at `_grep/org_filters.txt` shows 504 matches of `organizationId` / `organization_id` filter patterns across server code, confirming the filter is widely applied — but 100% coverage on every query path is still **UNVERIFIED**.
- `rules-engine.ts` lines 120–698 (DB-backed rule fetch + risk-score calculation).
- `rules-engine.ts` integration with `cci_edits` (currently 0 rows; UNVERIFIED whether the engine handles an empty CCI table gracefully).
- `transcript-extractor.ts` — Vapi call → patient field mapping; only the env import was sampled.
- `services/scraper-monitor.ts` full assertion logic.
- `seeds/reference-tables.ts` — what reference data it touches at startup.
- `services/edi-parser.ts` — inbound 835/277 file parser used by the upload route.
- `routes.ts:209-1000` — startup schema seeder; **UNVERIFIED whether it runs DDL**. The `seederLog` helper at `routes.ts:216-220` only reads `information_schema`, but subsequent code may apply migrations. Confirm to satisfy the "no mutations" standing order during normal boot.
- Office Ally submission path (`routes.ts:6190+`) — confirm it shares the ISA15 guard from `services/stedi-claims.ts:67-74` or implements its own.
- Super-admin impersonation set-path: where does `req.session.impersonatingOrgId` get assigned? Likely `/api/admin/impersonate/:orgId` but not confirmed.

## Drift between `replit.md` and code

- `practice_settings.billing_model` exists per the Sprint 0 audit and must be reconciled with profile rule `edi_structural_rules.rendering_provider_loop_2310B.omit_when='agency_billed'` during Sprint 2 EDI refactor. `routes.ts:3520` route `/api/billing/practice-settings/frcpb-enrollment` references `frcpb_enrolled` separately.
- `replit.md` references `org_types` and `org_type_field_specs` tables — **these tables do not exist**. Phase 3 (`practice_profiles` + `organization_practice_profiles`) is the live profile-aware design.
- `organizations.is_active` does **not** exist in the DB — code must filter on `status = 'active'`. The Drizzle declaration of `organizations` (`shared/schema.ts:518-523`) is out of date; fix tracked in `migration-state.md`.
- `replit.md` lists `caritas-org-001` and `chajinel-org-001`. The DB has 3 organizations — third org identity UNVERIFIED here.
- `<missing_secrets>` lists `VERIFYTX_API_KEY` / `VERIFYTX_API_SECRET` — names not referenced in code (`verifytx.ts` uses USERNAME/PASSWORD/CLIENT_ID/CLIENT_SECRET). The missing-secrets list appears stale.

## Cleanup candidates

- **Remove `caritas-constants.ts` follow-up:** `replit.md` says deleted; double-check no stale imports (UNVERIFIED via global grep this session).
- **`_autoArchiveDemoPatients`** at `routes.ts:188-205` is exported with leading underscore (private convention). Confirm it's wired from a real call site or candidate for removal.
- **`/cascade-demo`** is publicly routed (`App.tsx:67`). If purely an internal showcase, gate or remove before any production marketing-domain mapping.
- **Static `payers.ts`** at the repo root vs the 238-row `payers` table. Confirm static list is only a seed source; otherwise dual sources of truth.

## Operational notes

- Audit was run against the **dev** DB only. No production access was attempted, no `EXPLAIN`/`ANALYZE` issued. All findings are static + DB-shape only; runtime perf hotspots are not in scope.
- Re-run `_queries/run_all.sh` to refresh staging TSVs (idempotent, read-only).
- Standing order honored: no deploys, no DB writes, no code mutations were performed in producing this audit.
