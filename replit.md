# Claim Shield Health — Full Reference Document

## Overview
Claim Shield Health is a multi-tenant healthcare Revenue Cycle Management (RCM) platform. It provides comprehensive solutions for billing and patient intake, targeting home care agencies, behavioral health organizations, and specialty practices. The platform aims to streamline operations through modules covering claims lifecycle management, denial recovery, EDI submission, lead management, AI-driven patient outreach, and insurance verification. Its core vision is to enhance efficiency and financial performance for healthcare providers.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
Claim Shield Health is built on a modern web stack. The frontend utilizes React 18 with TypeScript, Vite, and Wouter for routing. State management is handled by TanStack Query for server state and React's `useState` for local component state. The UI components are built using `shadcn/ui` and Radix UI, styled with Tailwind CSS, and enhanced with Recharts for data visualization and Lucide for icons.

The backend is developed with Express.js and Node.js, also in TypeScript. PostgreSQL serves as the primary database, accessed via Drizzle ORM. Authentication is managed using Passport.js with a local strategy, `bcryptjs` for password hashing, and `express-session` with `pg-session-store` for session management.

Key technical implementations include:
- **EDI Generation and Parsing**: An internal 837P generator creates claim files, and parsers handle 835 ERA and 277 acknowledgment files.
- **AI-powered Intake**: Integration with Vapi API for outbound patient intake calls and transcript extraction.
- **Payer Document Scraping**: Playwright is used for scraping payer policy documents, with an orchestrator for managing scraper runs, circuit breaking, and rate limiting.
- **Rules Engine**: A sophisticated engine evaluates claims against a comprehensive set of rules, including CMS NCCI PTP edits and payer-specific manual extractions, to calculate risk scores and readiness statuses.
- **Multi-tenancy**: Achieved by including an `organization_id` column in every database table and enforcing tenant isolation at the API level.
- **Cron Jobs**: Scheduled tasks manage intake flow orchestration, timely filing alerts, payer document scraping, and CCI quarterly data ingestion.
- **Conditional Field Management**: Dynamically resolves patient form fields based on payer and plan contexts.
- **Client-side PDF Generation**: Generates CMS-1500 forms and appeal letters directly in the browser.

UI/UX Design:
- Uses `shadcn/ui` and Radix UI for a consistent and accessible component library.
- Tailwind CSS for utility-first styling.
- Modular layouts for different sections (Admin, Billing, Intake) with dedicated sidebars for navigation.
- Data visualization through Recharts on dashboards for KPIs and analytics.

## Multi-Tenancy — Intake Module (Completed Phases A–E)

### Org_ Tables (seeded/idempotent at startup)
| Table | Purpose |
|---|---|
| `org_message_templates` | Per-org SMS/email templates keyed by `template_key` + `channel` |
| `org_service_types` | Per-org service codes (e.g. home_health, va_community_care) |
| `org_payer_mappings` | Carrier name → Stedi trading partner ID per org |
| `org_voice_personas` | Vapi assistant IDs + system prompts per org persona_key |
| `org_lead_sources` | Lead source slugs/labels per org |
| `org_providers` | Credentialed providers with service_types + language arrays |
| `step_types` | Reference table of all valid flow step type keys |

### Configured Organizations
| org_id | Org name | Flow | Status |
|---|---|---|---|
| `caritas-org-001` | Caritas Senior Care | 8-step Standard Intake | `is_active=true` |
| `chajinel-org-001` | Chajinel Clinic | 9-step Standard Intake | `is_active=false` (pending Vapi assistant config) |

### Flow Step Executor (`server/services/flow-step-executor.ts`)
- **Org-agnostic** — zero hardcoded org data. Loads org context via `getOrgContext()` (60s TTL cache).
- Handles all 7 step types: `wait`, `sms_message`, `voice_call`, `email_message`, `vob_check`, `provider_match`, `appointment_schedule`, `webhook`
- Condition evaluator on each step (`condition` JSONB column): `eq`, `neq`, `in`, `not_in`, `exists`, `not_exists`, `gt`, `gte`, `lt`, `lte`, `contains`
- Writes `failed_at` + `failure_reason` on permanent failure; exponential backoff (5min, then 15min)
- `voice_call` steps: per-org persona looked up by `config.persona_key` → `org_voice_personas`
- `sms_message`/`email_message`: resolves body via `template_key` → `org_message_templates`, falls back to `template_inline`

### Flow Trigger (`server/services/flow-trigger.ts`)
- Filters active flows by `organization_id = lead.organizationId` (or NULL for legacy global flows)
- No cross-org flow triggering

### API Changes
- `GET /api/flows` — super_admin sees all flows (with `org_name` badge); regular users see their org only
- `GET /api/orgs/:slug/lead-sources` — queries `org_lead_sources` table (was: hardcoded CARITAS object)
- `GET /api/orgs/:slug/service-types` — queries `org_service_types` table (was: hardcoded CARITAS object)

### Frontend
- `flows.tsx` / `flow-detail.tsx` — updated step type maps to include all new types (`voice_call`, `sms_message`, `email_message`, `provider_match`, `appointment_schedule`, `webhook`)
- `flow-detail.tsx` — shows `template_key` and `condition` inline per step
- `flows.tsx` — shows `org_name` badge on each flow card (visible to super_admin)
- `lead-form-dialog.tsx`, `deals.tsx` — lead source dropdown now dynamically queries the user's actual org (no longer hardcoded to `caritas`)
- `use-auth.ts` — added `organization_id` to `AuthUser` type + `useOrgId()` helper

### Deleted
- `server/config/caritas-constants.ts` — fully replaced by DB-backed org_ tables

### Pending (requires Abeer input)
- Chajinel Vapi assistant ID is `PLACEHOLDER_AWAITING_VAPI_CONFIG` — must be replaced with real assistant ID before `is_active` is set to true

## Phase 3 Sprint 0 — Architectural Foundation (Completed 2026-05-03)

Foundation for profile-aware multi-tenancy. All work on dev only; zero production deploys.

### What shipped
- **6 new tables**: `practice_profiles` (global catalog), `organization_practice_profiles`, `provider_practice_relationships`, `provider_payer_relationships`, `patient_insurance_enrollments`, `claim_provider_assignments`
- **`practice_payer_enrollments` reconciled** 8 → 20 cols (additive ALTERs only; existing 2 demo rows preserved)
- **RLS + FORCE RLS** on all 6 tenant-scoped tables; 2 policies each (`tenant_isolation` + `service_role_bypass`)
- **`claimshield_app_role`** (NOLOGIN, NOINHERIT) — RLS-subject role; `withTenantTx` does `SET LOCAL ROLE` to drop superuser privileges per transaction
- **Tenant context middleware** wired in `server/index.ts:86` (AsyncLocalStorage + transaction-scoped `set_config`)
- **Helper service layer** in `server/services/practice-profile-helpers.ts` (6 helpers, idle behind feature flag)
- **Tier 1 structural validator** at `server/services/rules-engine/tier1-structural-integrity.ts` (8 rules, 16/16 tests pass, not wired)
- **Feature flag** `USE_PROFILE_AWARE_QUERIES=false` in `server/config/feature-flags.ts`
- **Drizzle definitions** for all 7 new/reconciled tables in `shared/schema.ts:721-842`
- **Seed**: `home_care_agency_personal_care` profile mapped to `chajinel-org-001` as `is_primary=true`

### Critical rule for new code
Any tenant-scoped query MUST use `withTenantTx` (or the helpers in `practice-profile-helpers.ts`). The global `db`/`pool` from `server/db.ts` connects as the `postgres` superuser and bypasses RLS — using it for tenant-scoped reads will silently leak cross-tenant rows.

### Sprint 1 prerequisites
- Add `WITH CHECK` clauses to every `tenant_isolation` policy before any Sprint-1 INSERT helper ships (DDL in `docs/architecture/migration-state.md` §3.1)
- `organizations.is_active` does NOT exist — use `status = 'active'`. Audit drift; Drizzle declaration of `organizations` (`shared/schema.ts:518-523`) is also out of date
- `practice_settings.billing_model` DOES exist — Sprint 2 EDI refactor must reconcile profile rule `edi_structural_rules.rendering_provider_loop_2310B.omit_when='agency_billed'` with the existing column

### Verification
- Tenant isolation: 12/12 cases pass (`scripts/verify-tenant-isolation.ts`)
- Tier 1 structural: 16/16 tests pass
- Helper smoke: `chajinel-org-001` resolves home_care profile; RLS isolates demo (2 enrollments) from chajinel (0) and no-ctx (0)

### Key docs
- `docs/architecture/sprint0-audit-report.md` — final audit report
- `docs/architecture/migration-state.md` — single source of truth for Phase 3 migration state and Sprint 1+ prerequisites
- `docs/architecture/sprint0-existing-schemas.md` — pre-sprint inspection + audit drift findings
- `docs/architecture/sprint0-snapshots/sprint0-ddl.sql` + `sprint0-app-role.sql` — applied DDL bundles

## Phase 3 Sprint 1c — EDI Preflight Gate (Completed 2026-05-03)

Wires `evaluateClaim`'s Tier 1 structural-integrity rules (T1-001 … T1-008) into the two Stedi EDI submission routes immediately before `generate837P` is called. Server-side only, dev-only.

### What shipped
- **New helper** `server/services/rules-engine/edi-preflight.ts` (138 lines) exporting `requireTier1Pass(ctx)` and `buildClaimContextForGate({…})`.
- **Two route gates** in `server/routes.ts`:
  - `POST /api/billing/claims/:id/submit-stedi` (gate at 6502–6527)
  - `POST /api/billing/claims/:id/test-stedi` (gate at 6735–6755)
- **Failure contract:** HTTP 400 with `{success:false, error:"VALIDATION_ERROR: …", findings:[{code,severity,message,fixSuggestion}], gateName:"tier1-structural-preflight"}`.
- **7 new tests** in `server/services/rules-engine/edi-preflight.test.ts` (all passing).
- **Pre-existing in-route VALIDATION_ERROR checks** at `routes.ts` 6428/6441/6685/6698 left untouched (Hard Rule 3c) — harmless redundancy that preserves rollback safety.

### Important contract clarification
`evaluateClaim` returns `Promise<RuleViolation[]>` (a flat array) — not the `{ findings, shortCircuited, shortCircuitReason }` wrapper described in the Sprint 1c prompt's "Anchors" section. The gate detects Tier 1 blocks via filter on `source === "tier1-structural" && severity === "block"`. Functionally identical to the prompt's intent; uses the actual contract.

### Path A baseline (carried forward from this sprint's pre-flight)
The dev workspace had **85 pre-existing tsc errors** (63 in `routes.ts`, 5 in `storage.ts`, others scattered) that predate Sprint 1c. Per user direction, Sprint 1c success was redefined as "zero new tsc errors" rather than "tsc clean". Final count after Sprint 1c: **85 = 85** (only positional line-number shifts; no new error codes, files, or types). Sprint 2+ baselines should use explicit error-count assertions instead of binary "clean" claims (see `migration-state.md` §11.4).

### Verification (post-sprint)
- tenant-isolation 12/12, tier1-structural 16/16, rules-engine 4/4, voice-persona-builder 23/23, smoke-helpers green, edi-preflight 7/7, tsc count = 85, workflow boots clean.

### Key docs
- `docs/architecture/sprint1c-audit-report.md` — full Sprint 1c audit (8 sections, line-cited)
- `docs/architecture/migration-state.md` §11 — sprint summary and Sprint 2 pre-flight recommendation
- `docs/architecture/sprint1c-snapshots/dev-pre-sprint1c-20260503-072034Z.sql` — pre-sprint dev DB snapshot (gitignored)

## External Dependencies
- **PostgreSQL**: Primary database.
- **Drizzle ORM**: Database interaction layer.
- **Stedi API**: Real-time 270/271 eligibility checks and 837P claim submissions, including webhook handling for 835/277 responses.
- **Office Ally**: SFTP gateway for EDI claim submissions.
- **Vapi API**: AI-powered outbound calling for patient intake, including webhook integration for call events.
- **Twilio**: SMS capabilities for patient outreach and inbound SMS handling.
- **Nodemailer (with Gmail)**: For sending email notifications and timely filing digests.
- **Playwright**: Headless browser automation for payer document scraping.
- **Claude AI**: Used for extracting structured information from payer manual documents.
- **Passport.js**: Authentication middleware.
- **bcryptjs**: Password hashing.
- **express-session & pg-session-store**: Session management.
- **TanStack Query**: Server state management in the frontend.
- **Radix UI & shadcn/ui**: UI component libraries.
- **Recharts**: Data visualization library.
- **Lucide Icons**: Icon library.
