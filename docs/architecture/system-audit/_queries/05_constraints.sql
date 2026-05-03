SELECT conrelid::regclass::text AS table_name, conname, pg_get_constraintdef(oid) AS def, contype
FROM pg_constraint
WHERE connamespace='public'::regnamespace AND contype IN ('c','u','x')
ORDER BY 1,2;
