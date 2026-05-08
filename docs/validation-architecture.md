# ClaimShield Validation Engine — Architecture

## Overview

The validation engine evaluates 837P claims against pluggable rule packs before submission.
It exposes one endpoint (`GET /api/billing/claims/:id/validate`) and returns structured JSON
describing every violation found, which pack flagged it, and whether the claim can be submitted.

```
Claim ID + Org ID
      │
      ▼
 runner.ts ──► loadClaimWithRelations()  ─► DB (claims, patients, payers, auths, referring_providers)
      │     ──► loadPractice()           ─► DB (practice_settings)
      │
      ▼
 pack-loader.ts
   resolvePacksForClaim()
      │
      ├─► x12-base-837p     (always applied for 837P)
      └─► pgba-va-ccn-837p  (applied when payer_id = 'TWVACCN')
            └─ extends x12-base-837p (parent rules run first)
      │
      ▼
 Rule dedup: later pack wins on duplicate ruleId
      │
      ▼
 For each rule:
   1. appliesWhen gate?  →  skip if false
   2. rule.check(ctx)    →  collect Violation[]
   3. rule throws?       →  emit info-severity "rule could not be evaluated"
      │
      ▼
 ValidationResult {
   claimId, packsApplied, violations,
   canSubmit (false if any severity='error'),
   checkedAt
 }
```

---

## How to author a new rule pack

New payers are onboarded by adding a rule pack file — no engine changes required.

**Step-by-step (worked example: Aetna 837P overlay)**

### 1. Create the pack file

```typescript
// server/services/validation/packs/aetna-837p.ts
import type { RulePack, RuleContext, Violation } from '../engine/types.js';

const PACK_ID = 'aetna-837p';

export const aetna837pPack: RulePack = {
  id: PACK_ID,
  name: 'Aetna 837P Overlay',
  version: '1.0.0',
  appliesTo: { claimType: '837P', payerIds: ['AETNA', '60054'] },
  extends: ['x12-base-837p'],   // inherits all base rules
  rules: [

    // Example rule 1: Aetna-specific claim frequency code restriction
    {
      id: 'AETNA-FREQ-CODE',
      code: 'AETNA-FREQ',
      severity: 'error',
      description: 'Aetna only accepts frequency codes 1 and 7.',
      ediSegment: '2300|CLM05-3',
      check(ctx: RuleContext): Violation[] | null {
        const freq = ctx.claim.claimFrequencyCode;
        if (!['1', '7'].includes(freq)) {
          return [{
            ruleId: 'AETNA-FREQ-CODE',
            code: 'AETNA-FREQ',
            severity: 'error',
            message: `Aetna does not accept frequency code "${freq}". Use 1 (original) or 7 (replacement).`,
            fieldPath: 'claim_frequency_code',
            ediSegment: '2300|CLM05-3',
            packId: PACK_ID,
          }];
        }
        return null;
      },
    },

    // Example rule 2: Aetna requires prior auth for certain place-of-service codes
    {
      id: 'AETNA-POS-AUTH',
      code: 'AETNA-AUTH',
      severity: 'warning',
      description: 'Aetna requires prior authorization for home health services (POS 12).',
      appliesWhen: (ctx) => ctx.claim.placeOfService === '12',
      check(ctx: RuleContext): Violation[] | null {
        if (!ctx.claim.authorizationNumber?.trim()) {
          return [{
            ruleId: 'AETNA-POS-AUTH',
            code: 'AETNA-AUTH',
            severity: 'warning',
            message: 'Aetna typically requires prior authorization for home health claims (POS 12). No auth number is on file.',
            fieldPath: 'authorization_number',
            packId: PACK_ID,
          }];
        }
        return null;
      },
    },

  ],
};
```

### 2. Register the pack

```typescript
// server/services/validation/pack-loader.ts
import { aetna837pPack } from './packs/aetna-837p.js';

// Add after the existing registerPack() calls:
registerPack(aetna837pPack);
```

### 3. Add the payer_id mapping

The pack's `appliesTo.payerIds` array controls which payers trigger it.
Add any payer_id values that appear in the `payers` table for this payer.

### 4. Write tests

```typescript
// server/services/validation/packs/aetna-837p.test.ts
import { aetna837pPack } from './aetna-837p.js';
// ... test each rule with passing + failing fixtures
```

### 5. Verify no duplication with the generator

Check `server/services/edi-generator.ts` `validateForPGBA()` for any rules
that may already be implemented. Do not duplicate them in the pack.

---

## How to test a pack in isolation

```bash
# Run the pack's own test file
npx tsx server/services/validation/packs/aetna-837p.test.ts

# Run all validation tests
npx tsx server/services/validation/engine/runner.test.ts
npx tsx server/services/validation/packs/x12-base-837p.test.ts
npx tsx server/services/validation/packs/pgba-va-ccn-837p.test.ts

# Run the EDI guardrail (must stay 37/37 after any validation change)
npx tsx server/services/edi-generator.test.ts
```

---

## Pack registration and resolution

1. Every pack registers itself in `pack-loader.ts` via `registerPack()` at module load time.
2. `resolvePacksForClaim(claim)` selects packs by:
   - Claim type (837P or 837I)
   - `payer.payerId` matched against each pack's `appliesTo.payerIds`
3. The `extends` chain is resolved depth-first so parents always run before children.
4. If two packs define a rule with the same `id`, the later-loaded (more specific) pack wins.
   This is logged as an override.

---

## Why some PGBA rules live in the generator, not the engine

`edi-generator.ts` contains `validateForPGBA()` which implements three checks:

| Check | Code | Location |
|-------|------|----------|
| Per-line charge > $0 and < $100k | H16 / SV102 | `edi-generator.ts` |
| Anesthesia HCPCS modifier requirement | AAT | `edi-generator.ts` |
| Patient ID format (SSN/EDIPI/ICN) | SSC / SSE | `edi-generator.ts` |

These remain in the generator as a **final safety net** — they fire immediately before
EDI emission and throw hard errors that prevent invalid EDI from reaching payers.

The validation engine catches these issues earlier (at "validate" click time, before
the user hits "Submit"). Once the engine is proven stable in production, the plan is
to migrate `validateForPGBA()` into the PGBA pack and remove the generator duplication.
**Do not add H16, AAT, SSC, or SSE rules to the PGBA pack until that migration ticket lands.**

---

## Base pack vs payer overlay — decision rule

| Rule characteristic | Location |
|--------------------|----------|
| True for ANY 837P payer | `x12-base-837p` |
| Applies only to a specific payer | Payer overlay pack |
| Unsure? | Default to payer overlay |

Examples:
- "Each line charge must be > $0" → base (any payer rejects $0 lines)
- "Claim filing indicator must be VA" → overlay (PGBA-specific)
- "Subscriber name must be alphabetic" → overlay (PGBA has documented H68 error; other payers may be more lenient)

---

## Migration path to DB-backed pack registry

Currently packs are registered in-memory in `pack-loader.ts`. When operational scale
demands runtime reconfiguration (adding packs without deploy), the migration path is:

1. Create `payer_rule_packs` table: `(payer_id, pack_id, enabled, priority_order)`
2. Replace the static `payerIds` resolution in `resolvePacksForClaim()` with a DB query
3. Keep the in-memory registry as the source of pack _implementations_ — only the
   _assignment_ moves to the DB
4. Add an admin UI to toggle packs per payer

The `RulePack` interface is designed to support this — `appliesTo.payerIds` can be
overridden by DB assignments without changing pack code.

---

## PGBA companion guide reference

Source: *PGBA Companion Guide for ASC X12N 837 (005010X222A1), version 1.0, March 2021.*

Key Table 5 error codes implemented in the PGBA pack:

| Code | Rule ID | Description |
|------|---------|-------------|
| H68 | PGBA-H68 | Subscriber name contains invalid characters |
| BG5 | PGBA-BG5 | State/ZIP inconsistency |
| RXO | PGBA-RXO | Duplicate diagnosis codes |
| QSF | PGBA-QSF | External-cause code in primary diagnosis position |
| NP4 | PGBA-NP4 | Invalid NPI in Loop 2310A |
| N04 | PGBA-N04 | Zero units on service line |

Additional PGBA rules added beyond Table 5:

| Rule ID | Description |
|---------|-------------|
| PGBA-DX-POINTER | Diagnosis pointer references non-existent code position |
| PGBA-REF-G2 | Loop 2310A REF01 must be G2 (known generator gap) |
| PGBA-AUTH-PRESENT | VA auth number (REF*G1) required for TWVACCN claims |
| PGBA-DOS-WITHIN-AUTH | Service line DOS must be ≤ auth expiration date |

---

## Maintenance notes

When companion guides update (e.g. PGBA releases a new version):
1. Check Table 5 and Table 6 for new or changed error codes
2. Add new rules to the overlay pack
3. Bump the pack `version` semver
4. Update this document with the new source version reference
5. Add test cases for new rules
6. Run full test suite — EDI guardrail must stay 37/37
