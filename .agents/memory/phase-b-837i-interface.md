---
name: Phase B 837I generator interface
description: Key decisions, interface shapes, and test gotchas for the 837I institutional billing generator and gate functions
---

## Generator files
- `server/services/edi-generator-institutional.ts` — `generate837I()` + `generateNOA()`
- `server/services/edi/select-generator.ts` — `resolveGeneratorKey()`, `selectAndGenerate()`

## generate837I() input shape (non-obvious fields)
- `isa15?: 'P'|'T'` — defaults to `'T'` via `??` operator; `'P'` only in production
- `hippsCode: string` — REQUIRED; throws if empty string passed
- `claimFrequencyCode: '2'|'3'|'4'|'9'` — period-1='2', period-2='3', final='4', void='9'
- `oasisDate: string` — ISO date `YYYY-MM-DD`; produces occurrence code 50 in HI segment
- `fipsCounty: string` — e.g. `'FL086'`; produces value code 85 in HI segment
- `cbsaCode?: string|null` — e.g. `'33100'`; produces value code 61; omit if null
- `utnNumber?: string|null` — if set, produces `REF*9F*<utnNumber>`
- `visitLines: { revenueCode, visitCount, charge }[]` — additional SV2 lines beyond 0023
- GS08 version code: `005010X223A2` (not 837P's `005010X222A1`)
- CLM05 composite: `32:1:<freqCode>` (not `11:B:1` used in 837P)

## generateNOA() differences from generate837I()
- `noaType: 'original'|'cancel'` — original→TOB `032A` (freq digit `A`), cancel→`032D` (`D`)
- Placeholder HIPPS on 0023 line: `1AA11` (no real HIPPS needed for NOA)
- NO occurrence code 50 (no OASIS date on NOA)
- NO value codes 85/61 (no FIPS/CBSA on NOA)
- `rpTransmitted.noaType` is set to the noaType value

## computeNoaStatus (Phase A — server/services/hh/noa.ts)
- Input: `{ soc_date: string, filed_date: string|null }` — snake_case, no `today` param
- Returns: `{ due_date: string, status: 'pending'|'filed'|'late', penalty_days: number }`
- `due_date = soc_date + 5 calendar days`
- No "overdue" status — unfiled past due = still "pending"

## Gate function shapes (server/services/hh/gates.ts)
- Pure context functions (for tests): `assertEpisodeGateFromContext`, `assertRcdUtnGateFromContext`, `assertNoaPreconditionFromContext`
- DB-backed (for routes): `assertEpisodeGate(periodId, orgId, client)`, etc.
- `HhGateError` class with `.gate`, `.code`, `.message` fields
- RCD/UTN: PCR + utnAffirmed=false → throws `HH-G4-UTN-REQUIRED`; postpayment → `{ blocked:false, postpaymentReadinessFlagRequired:true }`

## Valid test NPIs (pass CMS Luhn check)
- `1184288680` — used in VB-0 for referring provider
- `1245319599` — alternate
- `1144221847` — alternate

## VB test gotchas
- `generate837P` validates referring provider NPI via Luhn; must pass `referringProvider` with valid NPI + `payer.referringProviderPolicy: 'situational'`
- VB-8: don't use `edi.includes('*P*')` to check ISA15 — `*P*` may appear in payer qualifiers. Check `edi.split('~')[0].split('*')[15] === 'T'` instead.

**Why:** Phase B introduces a new transaction set (837I) alongside 837P. The generators share the ISA/GS/ST/SE/GE/IEA envelope but diverge on GS08, CLM05, and claim-level segments.
