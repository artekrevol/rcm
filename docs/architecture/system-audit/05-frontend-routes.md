# 05 — Frontend Routes

Source: `client/src/App.tsx:55-308` (Wouter `<Switch>`). Auth is enforced via `<AuthGuard allowedRoles={[...]}>` from `client/src/components/auth-guard.tsx`. Layouts wrap each route per module.

## Public routes (no auth)

| Path | Component | Line |
|---|---|---:|
| `/auth/login` | `LoginPage` | App.tsx:64 |
| `/cascade-demo` | `CascadeDemo` | App.tsx:67 |
| `/login` → `/auth/login` | redirect | App.tsx:70-72 |

## Root

| Path | Roles | Component | Line |
|---|---|---|---:|
| `/` | any authenticated | `ModuleSelector` (post-login chooser) | 58-62 |

## Intake module (`/intake/*`)

All gated by `allowedRoles={["admin", "intake"]}`.

| Path | Page | Line |
|---|---|---:|
| `/intake/dashboard` | `IntakeDashboard` | 75 |
| `/intake/deals` | `DealsPage` | 85 |
| `/intake/deals/:id` | `DealDetailPage` | 80 |
| `/intake/lead-analytics` | `LeadAnalyticsPage` | 90 |
| `/intake/flows` | `FlowsPage` | 100 |
| `/intake/flows/:id` | `FlowDetailPage` | 95 |
| `/intake/scheduling` | inline placeholder ("Appointment management and availability") | 105 |

## Admin module (`/admin/*`)

All gated by `allowedRoles={["super_admin"]}`.

| Path | Page | Line |
|---|---|---:|
| `/admin` | `AdminOverview` | 153 |
| `/admin/clinics` | `AdminClinics` | 122 |
| `/admin/clinics/:orgId` | `ClinicDetail` | 117 |
| `/admin/payer-manuals` | `PayerManualsPage` (wrapped in `PageErrorBoundary`) | 127 |
| `/admin/rules-database` | `RulesDatabasePage` | 136 |
| `/admin/data-tools` | `DataToolsPage` (wrapped in `PageErrorBoundary`) | 141 |
| `/admin/scrapers` | `ScrapersPage` | 148 |

## Billing module (`/billing/*`)

| Path | Roles | Page | Line |
|---|---|---|---:|
| `/billing/clinic`, `/billing/my-practice`, `/billing/practice` | admin | `ClinicHome` | 160-174 |
| `/billing/dashboard` | admin, rcm_manager | `BillingDashboard` | 175 |
| `/billing/patients` | admin, rcm_manager | `PatientList` | 195 |
| `/billing/patients/new` | admin, rcm_manager | `PatientCreate` | 180 |
| `/billing/patients/archived` | admin, rcm_manager | `ArchivedPatients` | 185 |
| `/billing/patients/:id` | admin, rcm_manager | `PatientDetail` | 190 |
| `/billing/claims` | admin, rcm_manager | `ClaimsPage` | 215 |
| `/billing/claims/new` | admin, rcm_manager | `ClaimWizard` | 200 |
| `/billing/claims/prior-auth` | admin, rcm_manager | `PriorAuthPage` | 205 |
| `/billing/claims/:id` | admin, rcm_manager | `ClaimDetailPage` | 210 |
| `/billing/claim-tracker` | admin, rcm_manager | `ClaimTrackerPage` | 220 |
| `/billing/follow-up` | admin, rcm_manager | `FollowUpPage` | 225 |
| `/billing/filing-alerts` | admin, rcm_manager, **biller** | `FilingAlertsPage` | 230 |
| `/billing/era` | admin, rcm_manager | `ERAPage` | 235 |
| `/billing/codes` | admin, rcm_manager | `BillingHcpcs` | 240 |
| `/billing/intelligence` | admin, rcm_manager | `IntelligencePage` | 255 |
| `/billing/intelligence/logs` | **admin only** | `ActivityLogPage` | 245 |
| `/billing/intelligence/reports` | **admin only** | `ComplianceReportsPage` | 250 |
| `/billing/rules` | admin, rcm_manager | `RulesPage` | 260 |
| `/billing/reports` | admin, rcm_manager | `BillingReports` | 265 |
| `/billing/settings` | admin, rcm_manager | `BillingSettings` | 275 |
| `/billing/settings/users` | **admin only** | `UserManagement` | 270 |

## Legacy redirects (App.tsx:281-305)

- `/dashboard` → `/`
- `/deals` → `/intake/deals`; `/deals/:id` → `/intake/deals/:id`
- `/claims` → `/billing/claims`; `/claims/:id` → `/billing/claims/:id`
- `/intelligence` → `/billing/intelligence`
- `/rules` → `/billing/rules`
- `/lead-analytics` → `/intake/lead-analytics`

## Catch-all

`<Route component={NotFound} />` at App.tsx:307.

## Observations

- 41 `<Route>` declarations total; 35 require auth, 2 are public, 4 are pure redirects.
- The `ModuleSelector` at `/` is the implicit landing page after login.
- Three billing surfaces (`/billing/intelligence/logs`, `/billing/intelligence/reports`, `/billing/settings/users`) are admin-only despite living under "billing" — UI/role-gate alignment looks correct for HIPAA-relevant audit logs.
- Frontend role list in code: `super_admin`, `admin`, `rcm_manager`, `biller`, `intake`. This matches the backend role-permissions table (32 rows in `role_permissions`).
