---
name: care_model enum migration
description: Why the seeder's ALTER COLUMN TYPE silently failed and the correct 3-step fix.
---

## The rule
When converting a `character varying` column to a Postgres enum in a seeder, always:
1. DROP the column default first.
2. ALTER the column type with a USING cast.
3. Restore the default using the enum-typed literal.

## Why
`ALTER TABLE ... ALTER COLUMN ... TYPE care_model_enum` fails with:
> ERROR: default for column "care_model" cannot be cast automatically to type care_model_enum

The seeder had `EXCEPTION WHEN others THEN NULL` around the ALTER, so the failure was completely silent — the column stayed as `varchar` and the bad UPDATE (with a non-enum value) succeeded, proving no constraint was actually in place.

## How to apply
In any Drizzle-less seeder (raw pool.query), the correct idempotent pattern is:

```sql
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name='practice_settings' AND column_name='care_model')
     = 'character varying' THEN
    ALTER TABLE practice_settings ALTER COLUMN care_model DROP DEFAULT;
    ALTER TABLE practice_settings ALTER COLUMN care_model TYPE care_model_enum
      USING care_model::care_model_enum;
    ALTER TABLE practice_settings ALTER COLUMN care_model
      SET DEFAULT 'outpatient_professional'::care_model_enum;
    ALTER TABLE practice_settings ALTER COLUMN care_model SET NOT NULL;
  END IF;
EXCEPTION WHEN others THEN NULL;
END $$;
```

The `IF data_type = 'character varying'` guard makes the outer block idempotent — once converted, the whole block skips safely.
