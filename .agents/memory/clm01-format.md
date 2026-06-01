---
name: CLM01 format
description: How the 837P patient control number (CLM01) is derived from the claim UUID, and how to reverse-match it in SQL.
---

# CLM01 / patient control number format

## The rule

`edi-generator.ts` sets CLM01 as:
```
claim.id.replace(/-/g, "").slice(0, 20)
```

A UUID is 32 hex chars without dashes; CLM01 keeps the first 20.

## Reverse-match in SQL

To find a claim from a CLP01 or patientControlNumber value in an 835:
```sql
WHERE LEFT(REPLACE(id::text, '-', ''), 20) = LOWER($1)
```

This works because LOWER handles the uppercase hex the payer returns in the ERA.

**Why:** Postgres UUID columns store lowercase. Payers echo back CLP01 in uppercase. Matching on the full UUID always fails — the 20-char truncation makes it non-reversible without the prefix query.

**How to apply:** Use this query in every place that resolves a claim from an 835/277 control number: process835ERA, applyCARCRules, pollStedi835ERA, manual ERA upload, any future 277CA claim matching if it ever uses account numbers instead of transaction IDs.
