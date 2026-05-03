# 07 — Rules Engine

**Source:** `server/services/rules-engine.ts` (698 lines).

## Inputs

`ClaimContext` (`rules-engine.ts:14-34`):
```ts
{
  claimId?, organizationId, patientId,
  payerId | null, payerName,
  planProduct: 'HMO'|'PPO'|'POS'|'EPO'|'Indemnity'|'unknown'|null,
  serviceDate, serviceLines[], icd10Primary, icd10Secondary[],
  authorizationNumber, placeOfService, memberId,
  patientDob, patientFirstName, patientLastName,
  testMode?, pcpReferralCheckStatus?
}
```

`ServiceLine` (`rules-engine.ts:7-12`): `{ code, modifier?, units?, totalCharge? }`.

## Output

`RuleViolation[]` where each violation carries (`rules-engine.ts:48-59`):
- `ruleType` (one of 8 enums)
- `severity`: `block` | `warn` | `info` (`rules-engine.ts:46`)
- `message`, `fixSuggestion`
- `ruleId`, `sourcePage`, `sourceQuote` (provenance to payer manual)
- `payerSpecific` flag
- `reviewedBy`, `lastVerifiedAt`

## Rule type taxonomy (`rules-engine.ts:36-44`)

| Type | Purpose |
|---|---|
| `timely_filing` | Claim past payer's TF window |
| `prior_auth` | PA missing where required |
| `modifier` | Modifier required/disallowed |
| `appeals` | Appeal-deadline tracking |
| `cci_edit` | CMS NCCI PTP unbundling |
| `plan_product_mismatch` | HMO-suspect payer with unknown plan_product |
| `date_sanity` | Future-date / DOS impossible |
| `data_quality` | Missing fields, malformed codes |

## Sanity rules (no DB, `rules-engine.ts:96+` — `runSanityRules`)

Snapshot of structure (first ~120 lines read):
- **Date sanity**:
  - Missing service date → `block` (`rules-engine.ts:101-111`)
  - Future service date → `block` (`rules-engine.ts:117+`)
- **Code regex**: `ICD10_PATTERN` accepts both `F03.90` and `F0390`; `CPT_HCPCS_PATTERN` requires 4–7 alphanumerics (`rules-engine.ts:66-67`).
- **Unbundling modifiers**: `["59", "XE", "XS", "XP", "XU"]` (`rules-engine.ts:68`).
- **HMO-suspect carriers**: name-fragment list includes aetna, kaiser, molina, united, uhc, humana hmo, etc. (`rules-engine.ts:71-75`); when plan_product is `unknown`/`null`, this fires `plan_product_mismatch`.
- **Plan-product matcher**: `appliesTo` array — empty/`["all"]` → matches; otherwise must include the product (`rules-engine.ts:83-90`).

## DB-backed rules

- `rules` table holds **6,238 rows** (per `_queries/01_tables_with_rowcounts.tsv:68`).
- `rule_kinds` (15 rows) is the reference enum for `manual_extraction_items.section_type` and rules taxonomy.
- Rules are joined to payers via `payer_id` (and `manual_extraction_items` provides provenance — 490 rows). The join produces `payerSpecific` violations with full source citation.
- **Rule fetch path** is **UNVERIFIED in this audit** (rest of `rules-engine.ts` after line 120 not read this session); the contract states it queries `rules WHERE payer_id = ? AND ...` and applies via `planProductMatches`. Recommended next read: `rules-engine.ts:120-698`.

## CMS NCCI integration

- `cci_edits` table (currently 0 rows on dev) is loaded by `server/jobs/cci-cron.ts` quarterly (Jan/Apr/Jul/Oct on the 5th).
- The rules engine consults this table for `cci_edit` violations when paired procedure codes appear without an unbundling modifier.

## Risk scoring

- Endpoint: `POST /api/billing/claims/:id/risk` (`server/routes.ts:5419`).
- **Computation logic UNVERIFIED in this read** — likely sums weighted severities (`block` ≥ `warn` ≥ `info`) and writes `risk_score` + `readiness_status` onto the claim row. Confirm by reading `routes.ts:5419-5519`.

## Preflight

- `POST /api/billing/claims/preflight` (`routes.ts:5262`) — runs the rules engine without persisting, returns violations + score.

## Key callers

- Claim wizard preflight & save (`client/src/pages/billing/claim-wizard.tsx`).
- Risk recompute on patch (`PATCH /api/billing/claims/:id` at `routes.ts:5311`) — UNVERIFIED whether risk auto-recomputes on every patch.
- Bulk evaluation by timely-filing cron (separate from RuleViolation pipeline).
